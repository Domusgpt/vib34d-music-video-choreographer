// Autonomous assistant that listens to audio telemetry and applies
// gentle parameter corrections so visuals stay reactive even without
// explicit prompts. Designed to complement LLM directives rather than
// override them, the autopilot uses cooldown-guarded routines for beat
// pulses, energy swells, bass density mapping, and section-aware mood
// shifts.

const clamp = (value, min, max) => {
    if (value === undefined || value === null) return value;
    if (typeof min === 'number') value = Math.max(min, value);
    if (typeof max === 'number') value = Math.min(max, value);
    return value;
};

const wrapHue = value => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    const wrapped = value % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
};

const AUTOPILOT_SURFACE_PREFIX = 'Autopilot:';

export class LLMAgentAutoPilot {
    constructor(dynamicEngine, audioChoreographer, options = {}) {
        this.dynamicEngine = dynamicEngine;
        this.audioChoreographer = null;
        this.unsubscribeAudio = null;
        this.enabled = options.enabled !== undefined ? options.enabled : true;
        const defaultSilenceTargets = {
            intensity: 0.28,
            chaos: 0.14,
            saturation: 0.36,
            speed: 0.78,
            morphFactor: 0.26,
            gridDensity: 28,
            hue: 210,
        };

        this.options = {
            baselineSmoothing: 0.06,
            beatCooldown: 260,
            bassCooldown: 220,
            bassMin: 18,
            bassMax: 96,
            energyThreshold: 0.12,
            energySurgeCooldown: 1200,
            energyLullCooldown: 1600,
            sectionCooldown: 2800,
            layerReactivityCooldown: 320,
            layerOpacityCooldown: 520,
            layerSectionCooldown: 2600,
            autoConfigureSurfaces: true,
            surfaceAuditInterval: 5200,
            anchorSmoothing: 0.32,
            anchorSnapThreshold: 0.01,
            sectionSnapshotSmoothing: 0.22,
            sectionSnapshotCaptureParameters: [
                'intensity',
                'chaos',
                'saturation',
                'hue',
                'speed',
                'morphFactor',
                'gridDensity',
            ],
            sectionPaletteDefaultDuration: 1.8,
            trackedParameters: ['intensity', 'chaos', 'speed', 'saturation', 'morphFactor', 'gridDensity', 'hue'],
            sectionTransitionCooldown: 2800,
            sectionTransitionLead: 0.72,
            sectionTransitionFollow: 1.8,
            sectionTransitionOverlap: 0.6,
            sectionTransitionMinConfidence: 0.55,
            sectionTransitionHistoryLimit: 18,
            silenceThreshold: 0.06,
            silenceDuration: 3800,
            silenceCooldown: 5200,
            silenceRecoveryDuration: 3.2,
            silenceRecoveryEasing: 'easeInOut',
            silenceRecoveryTargets: { ...defaultSilenceTargets },
            silenceHistoryLimit: 8,
            actionHistoryLimit: 12,
            actionHistoryRetentionMs: 240000,
            forecastHistorySize: 64,
            forecastLookbackMs: 1400,
            forecastMomentumSmoothing: 0.38,
            forecastSurgeThreshold: 0.16,
            forecastSurgeCeiling: 0.48,
            forecastBreakThreshold: 0.14,
            forecastBreakCeiling: 0.42,
            forecastLeadMs: 780,
            forecastSurgeHorizonMs: 2400,
            forecastBreakHorizonMs: 2800,
            forecastMinConfidence: 0.35,
            forecastCooldown: 2600,
            forecastRetentionMs: 4800,
            forecastPredictionLimit: 6,
            ...options,
        };

        if (options?.silenceRecoveryTargets) {
            this.options.silenceRecoveryTargets = {
                ...defaultSilenceTargets,
                ...options.silenceRecoveryTargets,
            };
        }

        const tracked = Array.isArray(this.options.trackedParameters) && this.options.trackedParameters.length
            ? this.options.trackedParameters
            : ['intensity', 'chaos', 'speed', 'saturation', 'morphFactor', 'gridDensity', 'hue'];
        this.trackedParameterOrder = [...tracked];
        this.trackedParameters = new Set(tracked);
        this.preferenceAnchors = new Map();
        this.lastObservedParameters = new Map();
        this.anchorBiasDefaults = {
            intensity: 0.32,
            chaos: 0.28,
            saturation: 0.3,
            hue: 0.18,
            gridDensity: 0.24,
            morphFactor: 0.26,
            speed: 0.24,
        };

        this.state = {
            energyBaseline: 0.32,
            bassBaseline: 0.24,
            lastSection: 'intro',
        };
        this.cooldowns = new Map();
        this.programs = [];
        this.surfacePlans = this.createSurfacePlans();
        this.surfaceMappings = new Map();
        this.surfaceConfigs = new Map();
        this.featureStats = new Map();
        this.lastSurfaceAudit = 0;
        this.sectionPalettes = new Map();
        this.sectionProfiles = new Map();
        this.sectionTransitions = [];
        this.actionHistory = [];
        this.silenceProgram = null;
        this.silenceHistory = [];
        this.initializeForecastState();
        const initialNow = performance.now();
        this.silenceState = {
            active: false,
            level: 1,
            threshold: this.options.silenceThreshold ?? 0.06,
            lastActive: initialNow,
            lastRecovery: null,
            lastAudioAt: initialNow,
            idleMs: 0,
            pendingMs: null,
            recoveryCount: 0,
            lastSummary: null,
            lastOrigin: null,
            lastForced: false,
            lastRecordTimestamp: null,
        };
        this.lastFeatures = {};

        this.configureDefaultPrograms();
        if (this.dynamicEngine?.parameterManager?.getAllParameters) {
            try {
                this.observeParameters(this.dynamicEngine.parameterManager.getAllParameters(), { source: 'init' });
            } catch (_) {
                // Ignore startup snapshot errors.
            }
        }
        if (audioChoreographer) {
            this.attachAudioChoreographer(audioChoreographer);
        }
    }

    resolveTrackedParameters(parameters) {
        if (parameters === undefined || parameters === null) {
            return [...this.trackedParameterOrder];
        }
        const list = Array.isArray(parameters) ? parameters : [parameters];
        const normalized = [];
        const seen = new Set();
        list.forEach(entry => {
            if (typeof entry !== 'string') return;
            const key = entry.trim();
            if (!key) return;
            if (key === '*' || key.toLowerCase() === 'all') {
                normalized.length = 0;
                this.trackedParameterOrder.forEach(param => normalized.push(param));
                seen.clear();
                this.trackedParameterOrder.forEach(param => seen.add(param));
                return;
            }
            if (!this.shouldTrackParameter(key) || seen.has(key)) {
                return;
            }
            seen.add(key);
            normalized.push(key);
        });
        return normalized;
    }

    setPreferenceAnchor(parameter, value, meta = {}) {
        const key = typeof parameter === 'string' ? parameter.trim() : '';
        if (!key || !this.shouldTrackParameter(key)) {
            return { ok: false, reason: `Autopilot does not track parameter ${parameter}` };
        }

        let resolved = value;
        if (!Number.isFinite(resolved)) {
            try {
                resolved = this.dynamicEngine?.parameterManager?.getParameter?.(key);
            } catch (_) {
                resolved = undefined;
            }
        }

        if (!Number.isFinite(resolved)) {
            return { ok: false, reason: `No readable value available for ${key}` };
        }

        const normalizedValue = this.normalizeParameterValue(key, resolved);
        const origin = this.describeAnchorOrigin(meta);
        const now = performance.now();
        const timestamp = Date.now();
        const existing = this.preferenceAnchors.get(key);
        const locked = meta.locked !== undefined ? Boolean(meta.locked) : Boolean(existing?.locked);

        const entry = {
            value: normalizedValue,
            updatedAt: now,
            updatedAtMs: timestamp,
            source: origin.source || existing?.source || 'manual',
            prompt: origin.summary || existing?.prompt || null,
            count: (existing?.count || 0) + 1,
            locked,
        };

        this.preferenceAnchors.set(key, entry);
        this.lastObservedParameters.set(key, normalizedValue);

        return {
            ok: true,
            anchor: {
                parameter: key,
                value: normalizedValue,
                source: entry.source,
                prompt: entry.prompt,
                updates: entry.count,
                locked: entry.locked,
                updatedAt: entry.updatedAt,
                updatedAtMs: entry.updatedAtMs,
            },
        };
    }

    captureCurrentAnchors(parameters, meta = {}) {
        const targets = this.resolveTrackedParameters(parameters);
        if (targets.length === 0) {
            return { ok: false, reason: 'No autopilot parameters available to capture' };
        }

        if (!this.dynamicEngine?.parameterManager?.getParameter) {
            return { ok: false, reason: 'Parameter manager unavailable for capture' };
        }

        const captured = [];
        targets.forEach(param => {
            const outcome = this.setPreferenceAnchor(param, undefined, {
                ...meta,
                source: meta.source || 'capture',
            });
            if (outcome?.ok) {
                captured.push({ parameter: param, value: outcome.anchor.value });
            }
        });

        if (captured.length === 0) {
            return { ok: false, reason: 'No anchors captured' };
        }

        return { ok: true, captured };
    }

    configureSectionPalette(config = {}, meta = {}) {
        const section = typeof config.section === 'string' ? config.section.trim() : '';
        if (!section) {
            return { ok: false, reason: 'Section name missing for autopilot palette' };
        }

        let targets = Array.isArray(config.parameters) ? config.parameters : [];
        if (config.snapshot) {
            targets = this.snapshotSectionParameters(section, meta);
        }

        if (!targets || targets.length === 0) {
            return { ok: false, reason: 'No parameters supplied for autopilot section palette' };
        }

        const normalizedTargets = targets
            .map(entry => {
                if (!entry || typeof entry !== 'object') return null;
                const parameter = typeof entry.parameter === 'string' ? entry.parameter.trim() : '';
                if (!parameter || !this.shouldTrackParameter(parameter)) return null;
                const value = Number(entry.value);
                if (!Number.isFinite(value)) return null;
                const duration = Number(entry.duration);
                const easing = typeof entry.easing === 'string' ? entry.easing.trim() : undefined;
                return {
                    parameter,
                    value: this.normalizeParameterValue(parameter, value),
                    duration: Number.isFinite(duration) && duration > 0 ? Math.min(duration, 18) : undefined,
                    easing: easing || undefined,
                };
            })
            .filter(Boolean);

        if (normalizedTargets.length === 0) {
            return { ok: false, reason: 'Section palette could not derive any parameter targets' };
        }

        const origin = this.describeAnchorOrigin(meta);
        const timestamp = Date.now();
        const now = performance.now();

        const label = typeof config.label === 'string' && config.label.trim()
            ? config.label.trim()
            : this.formatSectionLabel(section);

        this.sectionPalettes.set(section, {
            section,
            label,
            parameters: normalizedTargets,
            source: origin.source || 'manual',
            prompt: origin.summary || null,
            updatedAt: now,
            updatedAtMs: timestamp,
            manual: true,
        });

        return {
            ok: true,
            palette: {
                section,
                label,
                targets: normalizedTargets,
                source: origin.source || 'manual',
            },
        };
    }

    clearSectionPalette(section) {
        const key = typeof section === 'string' ? section.trim() : '';
        if (!key) {
            return { ok: false, reason: 'Section name missing for palette removal' };
        }
        const existed = this.sectionPalettes.delete(key);
        return {
            ok: true,
            removed: existed,
        };
    }

    snapshotSectionParameters(section, meta = {}) {
        const captureList = Array.isArray(this.options.sectionSnapshotCaptureParameters)
            ? this.options.sectionSnapshotCaptureParameters
            : ['intensity', 'chaos', 'saturation', 'hue', 'speed', 'morphFactor', 'gridDensity'];
        if (!this.dynamicEngine?.parameterManager?.getParameter) {
            return [];
        }

        const origin = this.describeAnchorOrigin(meta);
        const values = captureList
            .map(parameter => {
                if (!this.shouldTrackParameter(parameter)) return null;
                const value = this.dynamicEngine.parameterManager.getParameter(parameter);
                if (!Number.isFinite(value)) return null;
                return {
                    parameter,
                    value: this.normalizeParameterValue(parameter, value),
                    duration: this.options.sectionPaletteDefaultDuration,
                    easing: 'easeInOut',
                    source: origin.source,
                };
            })
            .filter(Boolean);

        return values;
    }

    recordSectionSnapshot(section) {
        const key = typeof section === 'string' ? section.trim() : '';
        if (!key || !this.dynamicEngine?.parameterManager?.getAllParameters) {
            return;
        }
        let snapshot;
        try {
            snapshot = this.dynamicEngine.parameterManager.getAllParameters();
        } catch (_) {
            return;
        }
        if (!snapshot) return;

        const captured = {};
        const captureList = Array.isArray(this.options.sectionSnapshotCaptureParameters)
            ? this.options.sectionSnapshotCaptureParameters
            : [];
        captureList.forEach(parameter => {
            if (!this.shouldTrackParameter(parameter)) return;
            const value = this.normalizeParameterValue(parameter, snapshot[parameter]);
            if (!Number.isFinite(value)) return;
            captured[parameter] = value;
        });

        if (Object.keys(captured).length === 0) {
            return;
        }

        const now = performance.now();
        const entry = this.sectionProfiles.get(key) || {
            section: key,
            samples: 0,
            averages: {},
            lastSeen: 0,
            lastSeenMs: 0,
        };

        entry.samples += 1;
        entry.lastSeen = now;
        entry.lastSeenMs = Date.now();
        entry.lastValues = captured;

        const smoothing = Math.max(0, Math.min(1, Number(this.options.sectionSnapshotSmoothing) || 0.22));
        Object.entries(captured).forEach(([parameter, value]) => {
            const current = entry.averages[parameter];
            if (current === undefined) {
                entry.averages[parameter] = value;
            } else {
                entry.averages[parameter] = this.mixParameter(parameter, current, value, smoothing);
            }
        });

        this.sectionProfiles.set(key, entry);
    }

    resolveSectionPalette(section) {
        const key = typeof section === 'string' ? section.trim() : '';
        if (!key) return null;

        const manual = this.sectionPalettes.get(key);
        if (manual) {
            return { ...manual, manual: true };
        }

        const profile = this.sectionProfiles.get(key);
        if (!profile || !profile.samples || Object.keys(profile.averages || {}).length === 0) {
            return null;
        }

        const parameters = Object.entries(profile.averages).map(([parameter, value]) => ({
            parameter,
            value: this.normalizeParameterValue(parameter, value),
            duration: this.options.sectionPaletteDefaultDuration,
            easing: 'easeInOut',
        }));

        if (parameters.length === 0) {
            return null;
        }

        return {
            section: key,
            label: `${this.formatSectionLabel(key)} memory`,
            parameters,
            source: 'learned',
            updatedAt: profile.lastSeen,
            updatedAtMs: profile.lastSeenMs,
            manual: false,
            learned: true,
            samples: profile.samples,
        };
    }

    extractPaletteTargetMap(palette) {
        const map = new Map();
        if (!palette?.parameters) {
            return map;
        }
        palette.parameters.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const parameter = entry.parameter;
            if (!parameter || !this.shouldTrackParameter(parameter)) return;
            const value = this.normalizeParameterValue(parameter, Number(entry.value));
            if (!Number.isFinite(value)) return;
            map.set(parameter, value);
        });
        return map;
    }

    getSectionAverages(section) {
        const key = typeof section === 'string' ? section.trim() : '';
        if (!key) {
            return new Map();
        }
        const profile = this.sectionProfiles.get(key);
        if (!profile?.averages) {
            return new Map();
        }
        const map = new Map();
        Object.entries(profile.averages).forEach(([parameter, value]) => {
            if (!this.shouldTrackParameter(parameter)) return;
            const normalized = this.normalizeParameterValue(parameter, value);
            if (!Number.isFinite(normalized)) return;
            map.set(parameter, normalized);
        });
        return map;
    }

    sectionAverageValue(section, parameter) {
        if (!parameter) return undefined;
        const averages = this.getSectionAverages(section);
        return averages.get(parameter);
    }

    formatSectionLabel(section) {
        if (!section) return 'Section';
        return section
            .split(/[^a-z0-9]+/i)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    buildSectionPaletteActions(palette, context) {
        if (!palette?.parameters?.length) {
            return null;
        }

        const actions = [];
        const summaryParts = [];

        palette.parameters.forEach(target => {
            if (!target || typeof target !== 'object') return;
            const parameter = target.parameter;
            if (!parameter || !this.shouldTrackParameter(parameter)) return;
            const desired = Number(target.value);
            if (!Number.isFinite(desired)) return;

            const biased = this.biasTowardAnchor(parameter, desired, 0.35);
            const duration = Number.isFinite(target.duration)
                ? Math.max(0.12, Math.min(18, target.duration))
                : this.options.sectionPaletteDefaultDuration;
            const easing = typeof target.easing === 'string' && target.easing.trim()
                ? target.easing.trim()
                : 'easeInOut';

            const current = context.getParam(parameter);
            if (parameter === 'gridDensity') {
                if (Number.isFinite(current) && Math.abs(current - biased) < 0.4) {
                    return;
                }
                actions.push({ action: 'setParameter', target: parameter, value: biased });
            } else {
                const action = {
                    action: 'scheduleEnvelope',
                    target: parameter,
                    to: biased,
                    duration,
                    easing,
                };
                if (Number.isFinite(current)) {
                    action.from = current;
                }
                actions.push(action);
            }

            const formatted = parameter === 'hue'
                ? `${Math.round(biased)}°`
                : parameter === 'gridDensity'
                ? biased.toFixed(1)
                : biased.toFixed(2);
            summaryParts.push(`${parameter}→${formatted}`);
        });

        if (actions.length === 0) {
            return null;
        }

        return {
            actions,
            summary:
                summaryParts.join(' | ') || palette.label || this.formatSectionLabel(palette.section),
        };
    }

    clearPreferenceAnchors(parameters, meta = {}) {
        const hasSpecific = parameters !== undefined && parameters !== null;
        const targets = hasSpecific ? this.resolveTrackedParameters(parameters) : null;

        if (!hasSpecific && this.preferenceAnchors.size === 0) {
            return { ok: false, reason: 'No anchors to clear' };
        }

        if (hasSpecific && (!targets || targets.length === 0)) {
            return { ok: false, reason: 'No matching anchors to clear' };
        }

        let cleared = [];
        if (!hasSpecific) {
            cleared = Array.from(this.preferenceAnchors.keys());
            this.preferenceAnchors.clear();
        } else {
            targets.forEach(param => {
                if (this.preferenceAnchors.delete(param)) {
                    cleared.push(param);
                }
            });
        }

        if (cleared.length === 0) {
            return { ok: false, reason: 'No anchors cleared' };
        }

        return {
            ok: true,
            cleared,
            remaining: this.preferenceAnchors.size,
        };
    }

    createSurfacePlans() {
        return [
            {
                key: 'energy-spectrum',
                label: `${AUTOPILOT_SURFACE_PREFIX} Energy × Brightness`,
                targetParameters: ['saturation', 'chaos'],
                build: context => {
                    const baseSaturation = context.resolveParam('saturation', 0.52, 0.25, 0.85);
                    const baseChaos = context.resolveParam('chaos', 0.36, 0.08, 0.82);
                    return {
                        smoothing: 0.34,
                        axes: (() => {
                            const energyRange = context.featureRange('energy', 0, 1.2);
                            const spectrumRange = context.featureRange('spectralCentroid', 0, 1.1);
                            return {
                                x: { feature: 'energy', transform: 'sqrt', min: energyRange.min, max: energyRange.max },
                                y: { feature: 'spectralCentroid', transform: 'linear', min: spectrumRange.min, max: spectrumRange.max },
                            };
                        })(),
                        targets: [
                            {
                                target: 'saturation',
                                base: baseSaturation,
                                xWeight: 0.38,
                                yWeight: 0.32,
                                xyWeight: 0.24,
                                bias: 0.06,
                                smoothing: 0.3,
                                min: 0,
                                max: 1,
                            },
                            {
                                target: 'chaos',
                                base: baseChaos,
                                xWeight: 0.42,
                                yWeight: 0.16,
                                xyWeight: 0.2,
                                smoothing: 0.36,
                                min: 0,
                                max: 1,
                            },
                        ],
                    };
                },
            },
            {
                key: 'bass-transient',
                label: `${AUTOPILOT_SURFACE_PREFIX} Bass × Transient Structure`,
                targetParameters: ['gridDensity', 'morphFactor'],
                build: context => {
                    const baseGrid = context.resolveParam('gridDensity', 42, 18, 88);
                    const baseMorph = context.resolveParam('morphFactor', 0.42, 0.1, 1.6);
                    return {
                        smoothing: 0.4,
                        axes: (() => {
                            const bassRange = context.featureRange('bass', 0, 1.1);
                            const transientRange = context.featureRange('transient', 0, 1.1);
                            return {
                                x: { feature: 'bass', transform: 'sqrt', min: bassRange.min, max: bassRange.max },
                                y: { feature: 'transient', transform: 'sqrt', min: transientRange.min, max: transientRange.max },
                            };
                        })(),
                        targets: [
                            {
                                target: 'gridDensity',
                                base: baseGrid,
                                xWeight: 36,
                                yWeight: 18,
                                xyWeight: 14,
                                smoothing: 0.42,
                                min: 12,
                                max: 98,
                            },
                            {
                                target: 'morphFactor',
                                base: baseMorph,
                                xWeight: 0.22,
                                yWeight: 0.52,
                                xyWeight: 0.26,
                                smoothing: 0.38,
                                min: 0,
                                max: 1.8,
                            },
                        ],
                    };
                },
            },
            {
                key: 'beat-energy',
                label: `${AUTOPILOT_SURFACE_PREFIX} Beat × Energy Accents`,
                targetParameters: ['intensity', 'hue'],
                build: context => {
                    const baseIntensity = context.resolveParam('intensity', 0.5, 0.22, 0.85);
                    const baseHue = context.wrapHue(context.resolveParam('hue', 180, 0, 360));
                    return {
                        smoothing: 0.32,
                        axes: (() => {
                            const beatRange = context.featureRange('beat', 0, 1.3);
                            const energyRange = context.featureRange('energy', 0, 1.2);
                            return {
                                x: { feature: 'beat', transform: 'linear', min: beatRange.min, max: beatRange.max },
                                y: { feature: 'energy', transform: 'sqrt', min: energyRange.min, max: energyRange.max },
                            };
                        })(),
                        targets: [
                            {
                                target: 'intensity',
                                base: baseIntensity,
                                xWeight: 0.46,
                                yWeight: 0.34,
                                xyWeight: 0.22,
                                bias: 0.08,
                                smoothing: 0.28,
                                min: 0.2,
                                max: 1,
                            },
                            {
                                target: 'hue',
                                base: baseHue,
                                xWeight: 48,
                                yWeight: 82,
                                xyWeight: 54,
                                smoothing: 0.42,
                                min: 0,
                                max: 360,
                            },
                        ],
                    };
                },
            },
        ];
    }

    configureDefaultPrograms() {
        this.programs = [
            this.createBeatPulseProgram(),
            this.createEnergySwellProgram(),
            this.createForecastPreludeProgram(),
            this.createBassDensityProgram(),
            this.createSectionTransitionProgram(),
            this.createSectionMoodProgram(),
            this.createLayerAtmosphereProgram(),
            this.createSilenceRecoveryProgram(),
        ];
    }

    createBeatPulseProgram() {
        const program = {
            id: 'beat-pulse',
            label: 'Beat intensity accents',
            state: {
                restIntensity: this.dynamicEngine?.parameterManager?.getParameter('intensity') ?? 0.5,
            },
            evaluate: (features, context) => {
                if (!features || features.beat <= 0) return null;
                if (!context.consume('beat', this.options.beatCooldown)) return null;

                const currentIntensity = context.getParam('intensity') ?? 0.5;
                const anchorIntensity = this.getPreferenceValue('intensity');
                let rest = context.mix(
                    program.state.restIntensity ?? currentIntensity,
                    currentIntensity,
                    0.35,
                );
                if (Number.isFinite(anchorIntensity)) {
                    rest = this.mixParameter('intensity', rest, anchorIntensity, 0.3);
                }
                program.state.restIntensity = rest;

                const beatStrength = Math.max(0.2, Math.min(1.4, features.beatStrength || 0.8));
                const peakBase = clamp(currentIntensity * (0.9 + beatStrength * 0.35) + 0.18, 0, 1);
                const peak = this.biasTowardAnchor('intensity', peakBase, 0.24);
                const settleBase = clamp((program.state.restIntensity ?? currentIntensity) * 0.95, 0.18, 0.85);
                const settle = this.biasTowardAnchor('intensity', settleBase, 0.4);

                return {
                    actions: [
                        {
                            action: 'scheduleEnvelope',
                            target: 'intensity',
                            from: currentIntensity,
                            to: peak,
                            duration: 0.18,
                            easing: 'easeOut',
                        },
                        {
                            action: 'scheduleEnvelope',
                            target: 'intensity',
                            from: peak,
                            to: settle,
                            duration: 0.42,
                            delay: 0.22,
                            easing: 'easeIn',
                        },
                    ],
                    summary: `Beat accent → intensity ${peak.toFixed(2)}`,
                };
            },
        };
        return program;
    }

    createEnergySwellProgram() {
        const program = {
            id: 'energy-swell',
            label: 'Energy swells & lulls',
            state: {},
            evaluate: (features, context) => {
                if (!features) return null;
                const baseline = this.state.energyBaseline ?? features.energy ?? 0;
                const deviation = (features.energy ?? 0) - baseline;
                const absDeviation = Math.abs(deviation);
                if (absDeviation < this.options.energyThreshold) {
                    return null;
                }

                const direction = deviation > 0 ? 'surge' : 'lull';
                const cooldown =
                    direction === 'surge' ? this.options.energySurgeCooldown : this.options.energyLullCooldown;
                if (!context.consume(direction, cooldown)) {
                    return null;
                }

                const anchorChaos = this.getPreferenceValue('chaos');
                const anchorSpeed = this.getPreferenceValue('speed');

                if (deviation > 0) {
                    const chaosBump = Math.min(0.18, 0.12 + deviation * 0.35);
                    const speedBump = Math.min(0.22, 0.1 + deviation * 0.3);
                    const chaosCeiling = Number.isFinite(anchorChaos)
                        ? Math.min(1, Math.max(anchorChaos + 0.28, 0.88))
                        : 1;
                    const speedCeiling = Number.isFinite(anchorSpeed)
                        ? Math.min(3, Math.max(anchorSpeed + 0.45, 1.6))
                        : 3;
                    return {
                        actions: [
                            { action: 'adjustParameter', target: 'chaos', delta: chaosBump, ceiling: chaosCeiling },
                            { action: 'adjustParameter', target: 'speed', delta: speedBump, ceiling: speedCeiling },
                        ],
                        summary: 'Energy surge → chaos + speed',
                    };
                }

                const currentSpeed = context.getParam('speed') ?? 1;
                const targetSpeed = clamp(currentSpeed * 0.88, 0.55, 3);
                const minTarget = Number.isFinite(anchorSpeed) ? Math.max(0.55, anchorSpeed * 0.9) : 0.55;
                const easedTarget = Math.min(currentSpeed, Math.max(targetSpeed, minTarget));
                return {
                    actions: [
                        {
                            action: 'adjustParameter',
                            target: 'chaos',
                            delta: -0.14,
                            floor: Number.isFinite(anchorChaos) ? Math.max(0, anchorChaos - 0.06) : 0,
                        },
                        {
                            action: 'scheduleEnvelope',
                            target: 'speed',
                            from: currentSpeed,
                            to: easedTarget,
                            duration: 1.6,
                        },
                    ],
                    summary: 'Energy lull → soften chaos, ease speed',
                };
            },
        };
        return program;
    }

    createForecastPreludeProgram() {
        const program = {
            id: 'forecast-prelude',
            label: 'Forecast preludes',
            state: {},
            evaluate: (features, context) => {
                const now = context.now;
                const surge = this.consumeForecastPrediction('surge', now);
                if (surge) {
                    const currentIntensity = Number.isFinite(context.getParam('intensity'))
                        ? context.getParam('intensity')
                        : 0.5;
                    const anchorChaos = this.getPreferenceValue('chaos');
                    const targetIntensity = this.biasTowardAnchor(
                        'intensity',
                        clamp(currentIntensity + 0.18 + surge.confidence * 0.24, 0.18, 1),
                        0.32,
                    );
                    const chaosDelta = Math.min(0.2, 0.06 + surge.confidence * 0.14);
                    const chaosCeiling = Number.isFinite(anchorChaos)
                        ? Math.min(1, anchorChaos + 0.28)
                        : 1;
                    const currentHue = Number.isFinite(context.getParam('hue'))
                        ? context.getParam('hue')
                        : 200;
                    const hueTarget = this.biasTowardAnchor(
                        'hue',
                        wrapHue(currentHue + 36 * surge.confidence),
                        0.18,
                    );
                    const currentSaturation = Number.isFinite(context.getParam('saturation'))
                        ? context.getParam('saturation')
                        : 0.6;
                    const saturationTarget = this.biasTowardAnchor(
                        'saturation',
                        clamp(currentSaturation + 0.08 + surge.confidence * 0.18, 0.18, 1),
                        0.28,
                    );
                    const leadMs = Number.isFinite(surge.leadMs)
                        ? surge.leadMs
                        : this.options.forecastLeadMs || 780;
                    const duration = Math.max(0.42, Math.min(1.8, leadMs / 1000));

                    return {
                        actions: [
                            {
                                action: 'scheduleEnvelope',
                                target: 'intensity',
                                from: currentIntensity,
                                to: targetIntensity,
                                duration,
                                easing: 'easeInOut',
                            },
                            {
                                action: 'adjustParameter',
                                target: 'chaos',
                                delta: chaosDelta,
                                ceiling: chaosCeiling,
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'saturation',
                                from: currentSaturation,
                                to: saturationTarget,
                                duration: duration + 0.35,
                                easing: 'easeInOut',
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'hue',
                                from: currentHue,
                                to: hueTarget,
                                duration: duration + 0.55,
                                easing: 'easeInOut',
                            },
                        ],
                        summary: `Forecast surge ${Math.round(surge.confidence * 100)}% → staging lift`,
                    };
                }

                const breakForecast = this.consumeForecastPrediction('break', now);
                if (breakForecast) {
                    const currentChaos = Number.isFinite(context.getParam('chaos'))
                        ? context.getParam('chaos')
                        : 0.38;
                    const currentIntensity = Number.isFinite(context.getParam('intensity'))
                        ? context.getParam('intensity')
                        : 0.52;
                    const currentSaturation = Number.isFinite(context.getParam('saturation'))
                        ? context.getParam('saturation')
                        : 0.62;
                    const currentHue = Number.isFinite(context.getParam('hue'))
                        ? context.getParam('hue')
                        : 210;
                    const currentSpeed = Number.isFinite(context.getParam('speed'))
                        ? context.getParam('speed')
                        : 1;

                    const chaosTarget = this.biasTowardAnchor(
                        'chaos',
                        clamp(currentChaos - (0.1 + breakForecast.confidence * 0.16), 0, 1),
                        0.46,
                    );
                    const intensityTarget = this.biasTowardAnchor(
                        'intensity',
                        clamp(currentIntensity * (0.88 - breakForecast.confidence * 0.12), 0.18, 1),
                        0.34,
                    );
                    const saturationTarget = this.biasTowardAnchor(
                        'saturation',
                        clamp(currentSaturation * (0.9 - breakForecast.confidence * 0.16), 0.16, 1),
                        0.4,
                    );
                    const hueTarget = this.biasTowardAnchor(
                        'hue',
                        wrapHue(currentHue - 28 * breakForecast.confidence),
                        0.2,
                    );
                    const speedTarget = this.biasTowardAnchor(
                        'speed',
                        clamp(currentSpeed * (0.9 - breakForecast.confidence * 0.12), 0.35, 3),
                        0.42,
                    );
                    const duration = 1.2 + breakForecast.confidence * 0.9;

                    return {
                        actions: [
                            {
                                action: 'scheduleEnvelope',
                                target: 'chaos',
                                from: currentChaos,
                                to: chaosTarget,
                                duration,
                                easing: 'easeOut',
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'intensity',
                                from: currentIntensity,
                                to: intensityTarget,
                                duration: duration + 0.4,
                                easing: 'easeInOut',
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'saturation',
                                from: currentSaturation,
                                to: saturationTarget,
                                duration: duration + 0.6,
                                easing: 'easeInOut',
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'hue',
                                from: currentHue,
                                to: hueTarget,
                                duration: duration + 0.8,
                                easing: 'easeInOut',
                            },
                            {
                                action: 'scheduleEnvelope',
                                target: 'speed',
                                from: currentSpeed,
                                to: speedTarget,
                                duration: duration + 0.6,
                                easing: 'easeOut',
                            },
                        ],
                        summary: `Forecast break ${Math.round(breakForecast.confidence * 100)}% → easing contrast`,
                    };
                }

                return null;
            },
        };
        return program;
    }

    createBassDensityProgram() {
        const program = {
            id: 'bass-density',
            label: 'Bass-driven density glide',
            state: {
                lastTarget: this.dynamicEngine?.parameterManager?.getParameter('gridDensity') ?? 24,
            },
            evaluate: (features, context) => {
                if (!features) return null;
                const range = this.options.bassMax - this.options.bassMin;
                let desired = clamp(
                    this.options.bassMin + (features.bass ?? 0) * range,
                    this.options.bassMin,
                    this.options.bassMax,
                );
                desired = this.biasTowardAnchor('gridDensity', desired, 0.3);
                const smoothed = context.mix(program.state.lastTarget ?? desired, desired, 0.25);
                const targetValue = this.biasTowardAnchor('gridDensity', smoothed, 0.28);
                program.state.lastTarget = targetValue;

                const current = context.getParam('gridDensity') ?? targetValue;
                if (Math.abs(targetValue - current) < 0.8) {
                    return null;
                }
                if (!context.consume('density', this.options.bassCooldown)) {
                    return null;
                }

                return {
                    actions: [
                        { action: 'setParameter', target: 'gridDensity', value: targetValue },
                    ],
                    summary: `Bass density → ${targetValue.toFixed(1)}`,
                };
            },
        };
        return program;
    }

    createSectionTransitionProgram() {
        const program = {
            id: 'section-transition',
            label: 'Section transition preludes',
            state: {
                lastSection: this.state.lastSection,
            },
            evaluate: (features, context) => {
                const currentSection = typeof features?.section === 'string' ? features.section : null;
                const confidence = Number.isFinite(features?.sectionConfidence)
                    ? features.sectionConfidence
                    : 0;
                const minConfidence = Number(this.options.sectionTransitionMinConfidence) || 0.55;
                if (!currentSection || confidence < minConfidence) {
                    return null;
                }

                const previousSection = program.state.lastSection ?? this.state.lastSection ?? null;
                if (!previousSection) {
                    program.state.lastSection = currentSection;
                    this.state.lastSection = currentSection;
                    return null;
                }
                if (previousSection === currentSection) {
                    program.state.lastSection = currentSection;
                    this.state.lastSection = currentSection;
                    return null;
                }

                const cooldown = Number(this.options.sectionTransitionCooldown) || 2600;
                if (!context.consume('transition', cooldown)) {
                    program.state.lastSection = currentSection;
                    this.state.lastSection = currentSection;
                    return null;
                }

                const lead = Math.max(0.2, Number(this.options.sectionTransitionLead) || 0.72);
                const follow = Math.max(0.6, Number(this.options.sectionTransitionFollow) || 1.8);
                const overlap = Math.max(0, Math.min(1, Number(this.options.sectionTransitionOverlap) || 0.6));
                const followDelay = lead * overlap;

                const palette = this.resolveSectionPalette(currentSection);
                const targets = this.extractPaletteTargetMap(palette);
                const previousAverages = this.getSectionAverages(previousSection);

                const watchParameters = ['intensity', 'chaos', 'saturation', 'hue', 'morphFactor'];
                const actions = [];
                const deltas = {};

                watchParameters.forEach(parameter => {
                    if (!this.shouldTrackParameter(parameter)) return;

                    const currentValue = context.getParam(parameter);
                    let startValue = Number.isFinite(currentValue)
                        ? this.normalizeParameterValue(parameter, currentValue)
                        : undefined;
                    if (!Number.isFinite(startValue)) {
                        const average = previousAverages.get(parameter);
                        if (Number.isFinite(average)) {
                            startValue = average;
                        }
                    }
                    if (!Number.isFinite(startValue)) {
                        const anchor = this.getPreferenceValue(parameter);
                        if (Number.isFinite(anchor)) {
                            startValue = this.normalizeParameterValue(parameter, anchor);
                        }
                    }
                    if (!Number.isFinite(startValue)) {
                        return;
                    }

                    let desired = targets.get(parameter);
                    if (!Number.isFinite(desired)) {
                        desired = this.sectionAverageValue(currentSection, parameter);
                    }
                    if (!Number.isFinite(desired)) {
                        const anchor = this.getPreferenceValue(parameter);
                        if (Number.isFinite(anchor)) {
                            desired = this.normalizeParameterValue(parameter, anchor);
                        }
                    }
                    if (!Number.isFinite(desired)) {
                        return;
                    }

                    const finalTarget = this.normalizeParameterValue(
                        parameter,
                        this.biasTowardAnchor(parameter, desired, 0.42),
                    );

                    let delta;
                    if (parameter === 'hue') {
                        delta = this.hueDifference(startValue, finalTarget);
                    } else {
                        delta = finalTarget - startValue;
                    }

                    const threshold =
                        parameter === 'hue'
                            ? 12
                            : parameter === 'morphFactor'
                            ? 0.08
                            : parameter === 'chaos'
                            ? 0.05
                            : 0.04;
                    if (Math.abs(delta) < threshold) {
                        return;
                    }

                    deltas[parameter] = delta;

                    let warmupTarget;
                    if (parameter === 'hue') {
                        warmupTarget = wrapHue(startValue + delta * 0.45);
                    } else {
                        warmupTarget = startValue + delta * 0.45;
                    }
                    warmupTarget = this.normalizeParameterValue(
                        parameter,
                        this.biasTowardAnchor(parameter, warmupTarget, 0.2),
                    );

                    const warmupAction = this.applyAnchorBias(
                        {
                            action: 'scheduleEnvelope',
                            target: parameter,
                            from: startValue,
                            to: warmupTarget,
                            duration: lead,
                            easing: 'easeInOut',
                        },
                        0.22,
                    );

                    const settleAction = this.applyAnchorBias(
                        {
                            action: 'scheduleEnvelope',
                            target: parameter,
                            to: finalTarget,
                            duration: follow,
                            delay: followDelay,
                            easing: 'easeInOut',
                        },
                        0.4,
                    );

                    actions.push(warmupAction, settleAction);
                });

                program.state.lastSection = currentSection;
                this.state.lastSection = currentSection;

                if (actions.length === 0) {
                    return null;
                }

                const summary = `${this.formatSectionLabel(previousSection)} → ${this.formatSectionLabel(currentSection)}`;

                return {
                    actions,
                    summary: `Transition prelude → ${summary}`,
                    transition: {
                        from: previousSection,
                        to: currentSection,
                        confidence,
                        label: palette?.label || this.formatSectionLabel(currentSection),
                        strategy: palette?.manual ? 'manual' : palette?.learned ? 'learned' : 'inferred',
                        deltas,
                    },
                };
            },
        };
        return program;
    }

    createSectionMoodProgram() {
        const program = {
            id: 'section-mood',
            label: 'Section mood sculptor',
            state: {
                lastSection: this.state.lastSection,
            },
            evaluate: (features, context) => {
                if (!features?.section || (features.sectionConfidence ?? 0) < 0.5) {
                    return null;
                }

                if (program.state.lastSection === features.section) {
                    return null;
                }

                if (!context.consume('section', this.options.sectionCooldown)) {
                    return null;
                }

                program.state.lastSection = features.section;
                context.markSection(features.section);
                this.recordSectionSnapshot(features.section);

                const palettePlan = this.resolveSectionPalette(features.section);
                if (palettePlan) {
                    const plan = this.buildSectionPaletteActions(palettePlan, context);
                    if (plan?.actions?.length) {
                        return {
                            actions: plan.actions.map(action => this.applyAnchorBias(action)),
                            summary:
                                plan.summary ||
                                `Section palette → ${this.formatSectionLabel(features.section)}`,
                        };
                    }
                }

                const hue = context.getParam('hue') ?? 200;
                const morph = context.getParam('morphFactor') ?? 1;
                const sectionPrograms = {
                    peak: [
                        { action: 'scheduleEnvelope', target: 'chaos', to: 0.92, duration: 1.8 },
                        { action: 'scheduleEnvelope', target: 'intensity', to: 0.95, duration: 1.2 },
                        { action: 'scheduleEnvelope', target: 'hue', from: hue, to: wrapHue(hue + 48), duration: 2.4 },
                    ],
                    transition: [
                        { action: 'scheduleEnvelope', target: 'speed', to: clamp((context.getParam('speed') ?? 1.1) + 0.3, 0.4, 2.6), duration: 1.6 },
                        { action: 'scheduleEnvelope', target: 'morphFactor', to: clamp(morph + 0.18, 0, 2), duration: 2 },
                    ],
                    break: [
                        { action: 'scheduleEnvelope', target: 'chaos', to: 0.28, duration: 1.4 },
                        { action: 'scheduleEnvelope', target: 'intensity', to: 0.42, duration: 1.3 },
                        { action: 'scheduleEnvelope', target: 'hue', from: hue, to: wrapHue(hue - 60), duration: 2.6 },
                    ],
                    intro: [
                        { action: 'scheduleEnvelope', target: 'chaos', to: 0.32, duration: 2 },
                        { action: 'scheduleEnvelope', target: 'speed', to: 0.78, duration: 1.8 },
                        { action: 'scheduleEnvelope', target: 'intensity', to: 0.55, duration: 1.6 },
                    ],
                    groove: [
                        { action: 'scheduleEnvelope', target: 'morphFactor', to: clamp(morph + 0.12, 0.2, 1.6), duration: 2.4 },
                        { action: 'adjustParameter', target: 'chaos', delta: 0.06, ceiling: 1 },
                    ],
                };

                const actions = (sectionPrograms[features.section] || [
                    { action: 'adjustParameter', target: 'chaos', delta: 0.04, ceiling: 1 },
                ]).map(action => this.applyAnchorBias(action));

                return {
                    actions,
                    summary: `Section shift → ${features.section.toUpperCase()}`,
                };
            },
        };
        return program;
    }

    createLayerAtmosphereProgram() {
        const program = {
            id: 'layer-atmosphere',
            label: 'Layer atmosphere weaver',
            state: {},
            evaluate: (features, context) => {
                if (!features || !this.dynamicEngine?.visualizerModulationManager) {
                    return null;
                }

                const manager = this.dynamicEngine.visualizerModulationManager;
                const highlight = manager.getLayer?.('highlight');
                const background = manager.getLayer?.('background');
                const accent = manager.getLayer?.('accent');
                const actions = [];
                const summary = [];

                if (highlight?.state && Number.isFinite(features.energy)) {
                    const current = highlight.state.reactivity ?? 1;
                    const target = clamp(0.55 + features.energy * 1.25, 0.35, 2.3);
                    if (Math.abs(target - current) > 0.06 && context.consume('highlight-reactivity', this.options.layerReactivityCooldown)) {
                        actions.push({
                            action: 'setVisualizerModulation',
                            layer: highlight.key,
                            property: 'reactivity',
                            value: target,
                        });
                        summary.push(`Highlight reactivity ${target.toFixed(2)}`);
                    }
                }

                if (background?.state && Number.isFinite(features.bass)) {
                    const current = background.state.opacity ?? 0.6;
                    const target = clamp(0.22 + features.bass * 0.55, 0.18, 0.92);
                    if (Math.abs(target - current) > 0.04 && context.consume('background-opacity', this.options.layerOpacityCooldown)) {
                        actions.push({
                            action: 'setVisualizerModulation',
                            layer: background.key,
                            property: 'opacity',
                            value: target,
                        });
                        summary.push(`Background opacity ${target.toFixed(2)}`);
                    }
                }

                if (accent?.state && features.section) {
                    const sectionTargets = {
                        peak: 0.95,
                        transition: 0.78,
                        break: 0.46,
                        intro: 0.62,
                        groove: 0.82,
                    };
                    const desired = sectionTargets[features.section] ?? 0.74;
                    const current = accent.state.intensity ?? desired;
                    if (Math.abs(desired - current) > 0.05 && context.consume(`accent-${features.section}`, this.options.layerSectionCooldown)) {
                        const value = clamp(desired, 0.2, 1);
                        actions.push({
                            action: 'setVisualizerModulation',
                            layer: accent.key,
                            property: 'intensity',
                            value,
                        });
                        summary.push(`Accent intensity ${value.toFixed(2)}`);
                    }
                }

                if (actions.length === 0) {
                    return null;
                }

                return {
                    actions,
                    summary: summary.join(' | ') || 'Layer atmosphere modulation',
                };
            },
        };
        return program;
    }

    createSilenceRecoveryProgram() {
        const now = performance.now();
        const program = {
            id: 'silence-recovery',
            label: 'Silence recovery & idle glow',
            state: {
                silenceActive: false,
                lastRecovery: 0,
                lastAudioAt: now,
            },
            evaluate: (features, context) => this.planSilenceRecovery(program, features, { now: context?.now }),
        };
        this.silenceProgram = program;
        if (this.silenceState) {
            const {
                recoveryCount = 0,
                lastSummary = null,
                lastOrigin = null,
                lastForced = false,
            } = this.silenceState;
            this.silenceState = {
                active: false,
                level: this.silenceState.level ?? 1,
                threshold: this.options.silenceThreshold ?? this.silenceState.threshold ?? 0.06,
                lastActive: now,
                lastRecovery: null,
                lastAudioAt: now,
                idleMs: 0,
                pendingMs: null,
                recoveryCount,
                lastSummary,
                lastOrigin,
                lastForced,
                lastRecordTimestamp: null,
            };
        }
        return program;
    }

    getSilenceTargetsList() {
        const targets = this.options.silenceRecoveryTargets || {};
        const ordered = [];
        const seen = new Set();
        this.trackedParameterOrder.forEach(parameter => {
            if (!this.shouldTrackParameter(parameter)) return;
            if (targets[parameter] === undefined) return;
            const value = this.normalizeParameterValue(parameter, Number(targets[parameter]));
            if (!Number.isFinite(value)) return;
            ordered.push({ parameter, value });
            seen.add(parameter);
        });
        Object.entries(targets).forEach(([parameter, value]) => {
            if (seen.has(parameter)) return;
            if (!this.shouldTrackParameter(parameter)) return;
            const normalized = this.normalizeParameterValue(parameter, Number(value));
            if (!Number.isFinite(normalized)) return;
            ordered.push({ parameter, value: normalized });
        });
        return ordered;
    }

    formatParameterValueForSummary(parameter, value) {
        if (!Number.isFinite(value)) return '?';
        switch (parameter) {
            case 'hue':
                return `${Math.round(wrapHue(value))}°`;
            case 'gridDensity':
                return `${Math.round(value)}`;
            case 'speed':
                return `${value.toFixed(2)}×`;
            case 'morphFactor':
                return value.toFixed(2);
            default:
                return value.toFixed(2);
        }
    }

    configureSilenceRecovery(config = {}, meta = {}) {
        const updates = [];

        if (config.threshold !== undefined) {
            const next = Math.max(0, Math.min(1, Number(config.threshold)));
            if (Number.isFinite(next)) {
                this.options.silenceThreshold = next;
                this.silenceState.threshold = next;
                updates.push(`threshold ${Math.round(next * 100)}%`);
            }
        }

        if (config.idleSeconds !== undefined) {
            const seconds = Math.max(0.5, Math.min(30, Number(config.idleSeconds)));
            if (Number.isFinite(seconds)) {
                this.options.silenceDuration = seconds * 1000;
                updates.push(`idle ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`);
            }
        }

        if (config.cooldownSeconds !== undefined) {
            const seconds = Math.max(0.5, Math.min(45, Number(config.cooldownSeconds)));
            if (Number.isFinite(seconds)) {
                this.options.silenceCooldown = seconds * 1000;
                updates.push(`cooldown ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`);
            }
        }

        if (config.durationSeconds !== undefined) {
            const seconds = Math.max(0.4, Math.min(18, Number(config.durationSeconds)));
            if (Number.isFinite(seconds)) {
                this.options.silenceRecoveryDuration = seconds;
                updates.push(`duration ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`);
            }
        }

        if (Array.isArray(config.targets)) {
            const nextTargets = {};
            config.targets.forEach(entry => {
                if (!entry || typeof entry !== 'object') return;
                const parameter = typeof entry.parameter === 'string' ? entry.parameter.trim() : '';
                if (!parameter || !this.shouldTrackParameter(parameter)) return;
                const value = this.normalizeParameterValue(parameter, Number(entry.value));
                if (!Number.isFinite(value)) return;
                nextTargets[parameter] = value;
            });
            this.options.silenceRecoveryTargets = { ...nextTargets };
            updates.push(
                Object.keys(nextTargets).length
                    ? `targets ${Object.keys(nextTargets).length}`
                    : 'targets cleared',
            );
        }

        const summaryBase = updates.length
            ? `Autopilot silence recovery tuned (${updates.join(', ')})`
            : 'Autopilot silence recovery updated';

        const applyNow = config.apply !== undefined ? Boolean(config.apply) : false;
        const force = config.force !== undefined ? Boolean(config.force) : true;
        let triggerSummary = null;
        if (applyNow) {
            const triggered = this.triggerSilenceRecovery({
                force,
                meta,
                origin: meta?.source || (meta?.preset ? 'preset' : 'manual'),
            });
            if (triggered?.ok) {
                triggerSummary = triggered.summary;
            } else if (triggered?.reason) {
                triggerSummary = `apply failed: ${triggered.reason}`;
            }
        }

        this.planSilenceRecovery(this.silenceProgram, this.lastFeatures || {}, {
            now: performance.now(),
            preview: true,
        });

        return {
            ok: true,
            summary: triggerSummary ? `${summaryBase} → ${triggerSummary}` : summaryBase,
        };
    }

    triggerSilenceRecovery(options = {}) {
        if (!this.dynamicEngine) {
            return { ok: false, reason: 'Dynamic engine unavailable' };
        }
        if (!this.silenceProgram) {
            return { ok: false, reason: 'Silence program unavailable' };
        }

        const force = options.force !== undefined ? Boolean(options.force) : true;
        const features = options.features || this.lastFeatures || {};
        const meta = options.meta ? { ...options.meta } : {};
        if (options.prompt && !meta.prompt) {
            meta.prompt = options.prompt;
        }
        if (!meta.source) {
            meta.source = options.origin || (meta.preset ? 'preset' : meta.prompt ? 'intent' : 'manual');
        }

        const plan = this.planSilenceRecovery(this.silenceProgram, features, {
            now: performance.now(),
            force,
        });
        if (!plan || !plan.actions?.length) {
            return { ok: false, reason: 'No silence recovery actions available' };
        }
        this.dispatch(this.silenceProgram, plan.actions, { summary: plan.summary });
        this.recordSilenceRecovery(plan, {
            force,
            origin: options.origin,
            meta,
        });
        return { ok: true, summary: plan.summary };
    }

    planSilenceRecovery(program, features = {}, options = {}) {
        if (!program) return null;

        const now = Number.isFinite(options.now) ? options.now : performance.now();
        const force = Boolean(options.force);
        const preview = Boolean(options.preview) && !force;
        const threshold = Math.max(0, Math.min(1, Number(this.options.silenceThreshold) || 0.05));
        const margin = Math.max(0.02, threshold * 0.12);

        const state = program.state;
        if (!Number.isFinite(state.lastAudioAt)) {
            state.lastAudioAt = now;
        }
        if (!Number.isFinite(this.silenceState.lastAudioAt)) {
            this.silenceState.lastAudioAt = state.lastAudioAt;
        }

        const readings = [
            Number(features?.energy),
            Number(features?.rms),
            Number(features?.bass),
            Number(features?.mid),
            Number(features?.transient),
            Number(features?.beatStrength),
        ];
        let signal = 0;
        readings.forEach(value => {
            if (Number.isFinite(value)) {
                signal = Math.max(signal, value);
            }
        });
        if (Number.isFinite(features?.rms)) {
            signal = Math.max(signal, features.rms * 1.4);
        }
        signal = Math.min(1, Math.max(0, signal));

        this.silenceState.threshold = threshold;
        this.silenceState.level = signal;

        if (!force && signal > threshold + margin) {
            state.silenceActive = false;
            state.lastAudioAt = now;
            this.silenceState.active = false;
            this.silenceState.lastActive = now;
            this.silenceState.lastAudioAt = now;
            this.silenceState.idleMs = 0;
            this.silenceState.pendingMs = null;
            return null;
        }

        const idleMs = now - (state.lastAudioAt ?? now);
        this.silenceState.idleMs = Math.max(0, idleMs);
        this.silenceState.lastAudioAt = state.lastAudioAt ?? now;

        const requiredMs = Math.max(600, Number(this.options.silenceDuration) || 3600);
        const pendingMs = Math.max(0, requiredMs - idleMs);
        this.silenceState.pendingMs = pendingMs > 0 ? pendingMs : null;

        if (preview) {
            return null;
        }

        if (!force && pendingMs > 0) {
            return null;
        }

        const cooldownMs = Math.max(600, Number(this.options.silenceCooldown) || 5200);
        if (!force && !this.consumeCooldown(`${program.id}:silence`, cooldownMs)) {
            return null;
        }

        const parameterManager = this.dynamicEngine?.parameterManager;
        if (!parameterManager?.getParameter) {
            return null;
        }

        const targets = this.getSilenceTargetsList();
        if (!targets.length) {
            return null;
        }

        const duration = Math.max(0.4, Number(this.options.silenceRecoveryDuration) || 3.2);
        const easing =
            typeof this.options.silenceRecoveryEasing === 'string'
                ? this.options.silenceRecoveryEasing
                : 'easeInOut';

        const actions = [];
        const summaryParts = [];

        targets.forEach(entry => {
            const current = parameterManager.getParameter(entry.parameter);
            if (!Number.isFinite(current)) return;
            const targetValue = this.normalizeParameterValue(entry.parameter, entry.value);
            if (!Number.isFinite(targetValue)) return;

            const delta = this.parameterDelta(entry.parameter, targetValue, current);
            const deltaThreshold = (() => {
                if (entry.parameter === 'hue') return 3;
                if (entry.parameter === 'gridDensity') return 0.8;
                if (entry.parameter === 'speed') return 0.04;
                return 0.01;
            })();
            if (!force && delta < deltaThreshold) {
                return;
            }

            const action = {
                action: 'scheduleEnvelope',
                target: entry.parameter,
                from: entry.parameter === 'hue' ? wrapHue(current) : current,
                to: entry.parameter === 'hue' ? wrapHue(targetValue) : targetValue,
                duration,
                easing,
            };
            actions.push(action);
            summaryParts.push(`${entry.parameter} ${this.formatParameterValueForSummary(entry.parameter, targetValue)}`);
        });

        if (!actions.length) {
            return null;
        }

        program.state.silenceActive = true;
        program.state.lastRecovery = now;
        program.state.lastAudioAt = now;
        this.silenceState.active = true;
        this.silenceState.lastRecovery = now;
        this.silenceState.lastActive = now;
        this.silenceState.lastAudioAt = now;
        this.silenceState.idleMs = 0;
        this.silenceState.pendingMs = null;

        const summary = summaryParts.length
            ? `Silence recovery → ${summaryParts.join(', ')}`
            : 'Silence recovery engaged';
        const timestamp = Date.now();
        program.state.lastSummary = summary;
        program.state.lastTrigger = now;
        this.silenceState.lastSummary = summary;

        return {
            actions,
            summary,
            targets,
            force,
            timestamp,
        };
    }

    recordSilenceRecovery(plan = {}, context = {}) {
        if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
            return;
        }

        const limit = Math.max(1, Number(this.options.silenceHistoryLimit) || 8);
        const timestamp = Number.isFinite(plan.timestamp) ? plan.timestamp : Date.now();
        const lastTimestamp = this.silenceState?.lastRecordTimestamp;
        if (Number.isFinite(lastTimestamp) && Math.abs(timestamp - lastTimestamp) < 50) {
            return;
        }

        if (this.silenceState) {
            this.silenceState.lastRecordTimestamp = timestamp;
        }

        const meta = context.meta || {};
        let origin = context.origin || meta.source;
        if (!origin) {
            if (meta.preset) {
                origin = 'preset';
            } else if (meta.prompt) {
                origin = 'intent';
            } else if (context.force) {
                origin = 'manual';
            } else {
                origin = 'autopilot';
            }
        }

        const entry = {
            timestamp,
            summary: plan.summary || 'Silence recovery engaged',
            forced: Boolean(context.force),
            origin,
            preset: meta.preset || null,
            prompt: meta.prompt || null,
            actions: plan.actions.length,
            targets: Array.isArray(plan.targets)
                ? plan.targets
                      .filter(target => target && target.parameter)
                      .map(target => ({
                          parameter: target.parameter,
                          value: this.normalizeParameterValue(target.parameter, target.value),
                      }))
                : [],
        };

        this.silenceHistory.unshift(entry);
        if (this.silenceHistory.length > limit) {
            this.silenceHistory.length = limit;
        }

        if (this.silenceState) {
            this.silenceState.recoveryCount = (this.silenceState.recoveryCount || 0) + 1;
            this.silenceState.lastSummary = entry.summary;
            this.silenceState.lastOrigin = origin;
            this.silenceState.lastForced = entry.forced;
        }
    }

    resolveParam(name, fallback, min, max) {
        const manager = this.dynamicEngine?.parameterManager;
        const value = manager?.getParameter?.(name);
        let base = typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
        if (base === undefined || base === null) {
            base = fallback;
        }
        const anchor = this.getPreferenceValue(name);
        if (Number.isFinite(anchor)) {
            base = base === undefined || base === null ? anchor : this.mixParameter(name, base, anchor, 0.4);
        }
        return clamp(base, min, max);
    }

    initializeForecastState() {
        this.forecastState = {
            history: [],
            predictions: [],
            energyMomentum: 0,
            bassMomentum: 0,
            transientMomentum: 0,
            lastPredictionAt: Object.create(null),
        };
    }

    resetForecastState() {
        if (!this.forecastState) {
            this.initializeForecastState();
            return;
        }
        this.forecastState.history = [];
        this.forecastState.predictions = [];
        this.forecastState.energyMomentum = 0;
        this.forecastState.bassMomentum = 0;
        this.forecastState.transientMomentum = 0;
        this.forecastState.lastPredictionAt = Object.create(null);
    }

    pruneForecasts(now = performance.now()) {
        if (!this.forecastState) {
            this.initializeForecastState();
            return;
        }

        const retention = Number.isFinite(this.options.forecastRetentionMs)
            ? Math.max(0, this.options.forecastRetentionMs)
            : 4800;
        const limit = Number.isFinite(this.options.forecastPredictionLimit)
            ? Math.max(1, this.options.forecastPredictionLimit)
            : 6;

        this.forecastState.predictions = this.forecastState.predictions.filter(prediction => {
            if (!prediction) return false;
            const horizon = Number.isFinite(prediction.horizonMs)
                ? prediction.horizonMs
                : this.options.forecastHorizonMs ?? 2000;
            const age = now - (prediction.createdAt ?? now);
            return age <= horizon + retention;
        });

        if (this.forecastState.predictions.length > limit) {
            this.forecastState.predictions.splice(
                0,
                this.forecastState.predictions.length - limit,
            );
        }
    }

    registerForecastPrediction(type, confidence, meta = {}) {
        if (!type || !Number.isFinite(confidence)) return null;
        const minConfidence = Number.isFinite(this.options.forecastMinConfidence)
            ? this.options.forecastMinConfidence
            : 0.35;
        if (confidence < minConfidence) return null;

        if (!this.forecastState) {
            this.initializeForecastState();
        }

        const now = performance.now();
        const cooldown = Number.isFinite(this.options.forecastCooldown)
            ? Math.max(0, this.options.forecastCooldown)
            : 0;
        const lastMap = this.forecastState.lastPredictionAt || Object.create(null);
        const lastTrigger = Number.isFinite(lastMap[type]) ? lastMap[type] : 0;
        if (cooldown && now - lastTrigger < cooldown) {
            return null;
        }

        const horizon = Number.isFinite(meta.horizonMs)
            ? meta.horizonMs
            : this.options.forecastHorizonMs ?? 2000;
        const lead = Number.isFinite(meta.leadMs)
            ? meta.leadMs
            : this.options.forecastLeadMs ?? 720;

        const prediction = {
            id: `${type}:${Date.now()}:${Math.round(now)}`,
            type,
            confidence: clamp(confidence, 0, 1),
            horizonMs: horizon,
            leadMs: lead,
            createdAt: now,
            timestamp: Date.now(),
            meta: {
                energyMomentum: Number.isFinite(meta.energyMomentum) ? meta.energyMomentum : null,
                bassMomentum: Number.isFinite(meta.bassMomentum) ? meta.bassMomentum : null,
                transient: Number.isFinite(meta.transient) ? meta.transient : null,
            },
            consumed: false,
            consumedAt: null,
            consumedTimestamp: null,
        };

        this.forecastState.predictions.push(prediction);
        this.forecastState.lastPredictionAt = lastMap;
        this.forecastState.lastPredictionAt[type] = now;
        this.pruneForecasts(now);

        if (this.enabled && this.dynamicEngine) {
            const label = type === 'surge' ? 'energy surge' : 'break';
            const percent = Math.round(prediction.confidence * 100);
            this.dynamicEngine.emit('log', {
                level: 'info',
                message: `Autopilot forecasted ${label} (${percent}%)`,
                source: 'autopilot',
            });
        }

        return prediction;
    }

    consumeForecastPrediction(type, now = performance.now(), options = {}) {
        if (!type || !this.forecastState?.predictions?.length) {
            return null;
        }

        this.pruneForecasts(now);

        const minConfidence = Number.isFinite(options.minConfidence)
            ? options.minConfidence
            : Number.isFinite(this.options.forecastMinConfidence)
            ? this.options.forecastMinConfidence
            : 0.35;

        const prediction = this.forecastState.predictions.find(entry => {
            if (!entry || entry.type !== type || entry.consumed) return false;
            if (!Number.isFinite(entry.confidence) || entry.confidence < minConfidence) {
                return false;
            }
            const horizon = Number.isFinite(entry.horizonMs)
                ? entry.horizonMs
                : this.options.forecastHorizonMs ?? 2000;
            const age = now - (entry.createdAt ?? now);
            return age <= horizon + 60;
        });

        if (!prediction) {
            return null;
        }

        prediction.consumed = true;
        prediction.consumedAt = now;
        prediction.consumedTimestamp = Date.now();
        return prediction;
    }

    updateForecastTelemetry(features = {}, now = performance.now()) {
        if (!this.forecastState) {
            this.initializeForecastState();
        }

        const historyLimit = Number.isFinite(this.options.forecastHistorySize)
            ? Math.max(8, this.options.forecastHistorySize)
            : 64;
        const history = this.forecastState.history;
        history.push({
            time: now,
            energy: Number.isFinite(features.energy) ? features.energy : null,
            bass: Number.isFinite(features.bass) ? features.bass : null,
            transient: Number.isFinite(features.transient) ? features.transient : null,
        });
        if (history.length > historyLimit) {
            history.splice(0, history.length - historyLimit);
        }

        const lookback = Math.max(200, Number(this.options.forecastLookbackMs) || 1400);
        let reference = null;
        for (let i = history.length - 1; i >= 0; i -= 1) {
            const sample = history[i];
            if (!sample) continue;
            if (now - sample.time >= lookback) {
                reference = sample;
                break;
            }
        }
        if (!reference && history.length > 0) {
            reference = history[0];
        }

        const momentumSmoothing = Number.isFinite(this.options.forecastMomentumSmoothing)
            ? this.options.forecastMomentumSmoothing
            : 0.38;

        if (reference) {
            if (Number.isFinite(features.energy) && Number.isFinite(reference.energy)) {
                const delta = features.energy - reference.energy;
                if (!Number.isFinite(this.forecastState.energyMomentum)) {
                    this.forecastState.energyMomentum = delta;
                } else {
                    this.forecastState.energyMomentum = this.mix(
                        this.forecastState.energyMomentum,
                        delta,
                        momentumSmoothing,
                    );
                }
            }
            if (Number.isFinite(features.bass) && Number.isFinite(reference.bass)) {
                const delta = features.bass - reference.bass;
                if (!Number.isFinite(this.forecastState.bassMomentum)) {
                    this.forecastState.bassMomentum = delta;
                } else {
                    this.forecastState.bassMomentum = this.mix(
                        this.forecastState.bassMomentum,
                        delta,
                        momentumSmoothing,
                    );
                }
            }
            if (Number.isFinite(features.transient) && Number.isFinite(reference.transient)) {
                const delta = features.transient - reference.transient;
                if (!Number.isFinite(this.forecastState.transientMomentum)) {
                    this.forecastState.transientMomentum = delta;
                } else {
                    this.forecastState.transientMomentum = this.mix(
                        this.forecastState.transientMomentum,
                        delta,
                        momentumSmoothing,
                    );
                }
            }
        }

        this.pruneForecasts(now);

        const energyMomentum = Number.isFinite(this.forecastState.energyMomentum)
            ? this.forecastState.energyMomentum
            : 0;
        const bassMomentum = Number.isFinite(this.forecastState.bassMomentum)
            ? this.forecastState.bassMomentum
            : 0;
        const transient = Number.isFinite(features.transient) ? features.transient : 0;

        const surgeThreshold = Number.isFinite(this.options.forecastSurgeThreshold)
            ? this.options.forecastSurgeThreshold
            : 0.16;
        const surgeCeiling = Number.isFinite(this.options.forecastSurgeCeiling)
            ? this.options.forecastSurgeCeiling
            : Math.max(surgeThreshold + 0.12, 0.42);
        const breakThreshold = Number.isFinite(this.options.forecastBreakThreshold)
            ? this.options.forecastBreakThreshold
            : 0.14;
        const breakCeiling = Number.isFinite(this.options.forecastBreakCeiling)
            ? this.options.forecastBreakCeiling
            : Math.max(breakThreshold + 0.12, 0.38);
        const lead = Math.max(300, Number(this.options.forecastLeadMs) || 780);

        if (energyMomentum > surgeThreshold) {
            const normalized = clamp(
                (energyMomentum - surgeThreshold) / Math.max(0.01, surgeCeiling - surgeThreshold),
                0,
                1,
            );
            const transientBoost = clamp(transient * 0.35, 0, 0.35);
            const bassBoost = clamp(Math.max(0, bassMomentum) * 1.1, 0, 0.3);
            const confidence = clamp(normalized + transientBoost + bassBoost, 0, 1);
            this.registerForecastPrediction('surge', confidence, {
                energyMomentum,
                bassMomentum,
                transient,
                horizonMs: Number.isFinite(this.options.forecastSurgeHorizonMs)
                    ? this.options.forecastSurgeHorizonMs
                    : 2400,
                leadMs: lead,
            });
        }

        if (energyMomentum < -breakThreshold) {
            const normalized = clamp(
                (Math.abs(energyMomentum) - breakThreshold) /
                    Math.max(0.01, breakCeiling - breakThreshold),
                0,
                1,
            );
            const bassRelief = clamp(Math.max(0, -bassMomentum) * 1.2, 0, 0.35);
            const transientRelief = clamp((1 - transient) * 0.25, 0, 0.25);
            const confidence = clamp(normalized + bassRelief + transientRelief, 0, 1);
            this.registerForecastPrediction('break', confidence, {
                energyMomentum,
                bassMomentum,
                transient,
                horizonMs: Number.isFinite(this.options.forecastBreakHorizonMs)
                    ? this.options.forecastBreakHorizonMs
                    : 2800,
                leadMs: Math.round(lead * 1.1),
            });
        }
    }

    resetFeatureStats() {
        this.featureStats.clear();
    }

    updateFeatureStats(features = {}) {
        const now = performance.now();
        Object.entries(features).forEach(([feature, value]) => {
            if (!Number.isFinite(value)) return;
            const existing = this.featureStats.get(feature);
            if (existing) {
                existing.min = Math.min(existing.min, value);
                existing.max = Math.max(existing.max, value);
                existing.avg = this.mix(existing.avg, value, 0.12);
                existing.last = value;
                existing.samples += 1;
                existing.lastUpdate = now;
            } else {
                this.featureStats.set(feature, {
                    min: value,
                    max: value,
                    avg: value,
                    last: value,
                    samples: 1,
                    lastUpdate: now,
                });
            }
        });

        this.featureStats.forEach(stats => {
            if (!Number.isFinite(stats.lastUpdate)) return;
            const idle = now - stats.lastUpdate;
            if (idle > 5000) {
                const relax = Math.min(0.35, idle / 20000);
                stats.min = this.mix(stats.min, stats.avg, relax);
                stats.max = this.mix(stats.max, stats.avg, relax);
            }
        });
    }

    getFeatureRange(feature, fallbackMin = 0, fallbackMax = 1) {
        const stats = feature ? this.featureStats.get(feature) : null;
        if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || stats.samples < 12) {
            return { min: fallbackMin, max: fallbackMax };
        }

        const defaultSpan = Math.max(0.1, Math.abs(fallbackMax - fallbackMin) || 1);
        const span = Math.max(0.02, stats.max - stats.min);
        const padding = Math.max(defaultSpan * 0.08, span * 0.2);

        let min = stats.min - padding;
        let max = stats.max + padding;

        if (Number.isFinite(fallbackMin)) {
            min = Math.max(fallbackMin, min);
        }
        if (Number.isFinite(fallbackMax)) {
            max = Math.min(fallbackMax, max);
        }

        if (!Number.isFinite(min)) min = fallbackMin;
        if (!Number.isFinite(max)) max = fallbackMax;

        if (max - min < defaultSpan * 0.25) {
            const center = Number.isFinite(stats.avg) ? stats.avg : (stats.max + stats.min) / 2;
            min = Math.max(fallbackMin, center - defaultSpan * 0.18);
            max = Math.min(fallbackMax, center + defaultSpan * 0.18);
        }

        if (max <= min) {
            max = min + defaultSpan * 0.3;
        }

        return {
            min,
            max,
        };
    }

    cloneSurfaceConfig(surface) {
        if (!surface) return null;
        const cloneAxis = axis => {
            if (!axis) return {};
            return {
                feature: axis.feature,
                transform: axis.transform,
                invert: axis.invert,
                scale: axis.scale,
                offset: axis.offset,
                min: axis.min,
                max: axis.max,
            };
        };
        const cloneTarget = target => ({
            target: target.target,
            base: target.base,
            xWeight: target.xWeight,
            yWeight: target.yWeight,
            xyWeight: target.xyWeight,
            bias: target.bias,
            smoothing: target.smoothing,
            mode: target.mode,
            min: target.min,
            max: target.max,
        });
        return {
            label: surface.label,
            smoothing: surface.smoothing,
            axes: {
                x: cloneAxis(surface.axes?.x),
                y: cloneAxis(surface.axes?.y),
            },
            targets: Array.isArray(surface.targets) ? surface.targets.map(cloneTarget) : [],
        };
    }

    shouldReconfigureSurface(previous, next) {
        if (!previous) return true;

        const axisChanged = axis => {
            const prevAxis = previous.axes?.[axis];
            const nextAxis = next.axes?.[axis];
            if (!prevAxis || !nextAxis) return true;
            if (prevAxis.feature !== nextAxis.feature) return true;
            const prevMin = Number.isFinite(prevAxis.min) ? prevAxis.min : 0;
            const prevMax = Number.isFinite(prevAxis.max) ? prevAxis.max : 0;
            const nextMin = Number.isFinite(nextAxis.min) ? nextAxis.min : prevMin;
            const nextMax = Number.isFinite(nextAxis.max) ? nextAxis.max : prevMax;
            const span = Math.max(0.1, Math.abs(nextMax - nextMin) || Math.abs(prevMax - prevMin) || 1);
            const tolerance = span * 0.08;
            return Math.abs(prevMin - nextMin) > tolerance || Math.abs(prevMax - nextMax) > tolerance;
        };

        if (axisChanged('x') || axisChanged('y')) {
            return true;
        }

        const prevTargets = Array.isArray(previous.targets) ? previous.targets : [];
        const nextTargets = Array.isArray(next.targets) ? next.targets : [];
        if (prevTargets.length !== nextTargets.length) {
            return true;
        }

        const baseTolerance = target => {
            switch (target) {
                case 'hue':
                    return 8;
                case 'gridDensity':
                    return 2.8;
                case 'morphFactor':
                    return 0.18;
                default:
                    return 0.12;
            }
        };

        const hueDifference = (a, b) => {
            if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
            const diff = Math.abs(((a - b + 540) % 360) - 180);
            return Math.min(diff, 360 - diff);
        };

        for (let index = 0; index < nextTargets.length; index += 1) {
            const nextTarget = nextTargets[index];
            const prevTarget = prevTargets[index];
            if (!nextTarget || !prevTarget) {
                return true;
            }
            if (nextTarget.target !== prevTarget.target) {
                return true;
            }
            const tolerance = baseTolerance(nextTarget.target);
            if (nextTarget.target === 'hue') {
                if (hueDifference(prevTarget.base, nextTarget.base) > tolerance) {
                    return true;
                }
            } else {
                const prevBase = Number.isFinite(prevTarget.base) ? prevTarget.base : 0;
                const nextBase = Number.isFinite(nextTarget.base) ? nextTarget.base : prevBase;
                if (Math.abs(prevBase - nextBase) > tolerance) {
                    return true;
                }
            }
        }

        return false;
    }

    maintainSurfaceMappings(now = performance.now(), options = {}) {
        if (!this.options.autoConfigureSurfaces || !this.surfacePlans?.length) {
            return;
        }

        const choreographer = this.audioChoreographer;
        if (!choreographer || typeof choreographer.getSurfaces !== 'function' || typeof choreographer.registerFeatureSurface !== 'function') {
            return;
        }

        const force = Boolean(options.force);
        if (!force && (!this.enabled || (this.options.surfaceAuditInterval && now - this.lastSurfaceAudit < this.options.surfaceAuditInterval))) {
            return;
        }

        this.lastSurfaceAudit = now;

        const surfaces = choreographer.getSurfaces?.() ?? [];
        const autopSurfaces = surfaces.filter(surface => (surface.label || '').startsWith(AUTOPILOT_SURFACE_PREFIX));
        const autopIds = new Set(autopSurfaces.map(surface => surface.id));

        Array.from(this.surfaceMappings.entries()).forEach(([key, id]) => {
            if (!autopIds.has(id)) {
                this.surfaceMappings.delete(key);
                this.surfaceConfigs.delete(key);
            }
        });

        autopSurfaces.forEach(surface => {
            const plan = this.surfacePlans.find(entry => entry.label === surface.label);
            if (!plan) return;
            const existing = this.surfaceConfigs.get(plan.key)?.config;
            if (!existing) {
                this.surfaceConfigs.set(plan.key, { config: this.cloneSurfaceConfig(surface) });
            }
        });

        this.surfacePlans.forEach(plan => {
            const match = autopSurfaces.find(surface => surface.label === plan.label);
            if (match) {
                this.surfaceMappings.set(plan.key, match.id);
            }
        });

        if (!this.enabled) {
            return;
        }

        const manualTargets = new Set();
        surfaces.forEach(surface => {
            const autop = (surface.label || '').startsWith(AUTOPILOT_SURFACE_PREFIX);
            surface.targets?.forEach(target => {
                if (!target?.target) return;
                if (!autop) {
                    manualTargets.add(target.target);
                }
            });
        });

        const context = {
            resolveParam: (name, fallback, min, max) => this.resolveParam(name, fallback, min, max),
            featureRange: (feature, fallbackMin, fallbackMax) =>
                this.getFeatureRange(feature, fallbackMin, fallbackMax),
            wrapHue,
            clamp,
        };

        this.surfacePlans.forEach(plan => {
            const existingId = this.surfaceMappings.get(plan.key);

            if ((plan.targetParameters || []).some(target => manualTargets.has(target))) {
                if (existingId) {
                    try {
                        choreographer.removeSurface(existingId);
                    } catch (_) {
                        // Ignore cleanup issues; surfaces will be rebuilt if needed later.
                    }
                    this.surfaceMappings.delete(plan.key);
                    this.surfaceConfigs.delete(plan.key);
                }
                return;
            }

            const planConfig = plan.build ? plan.build(context) : plan;
            if (!planConfig?.axes || !planConfig.targets?.length) {
                if (existingId) {
                    try {
                        choreographer.removeSurface(existingId);
                    } catch (_) {
                        // noop
                    }
                    this.surfaceMappings.delete(plan.key);
                    this.surfaceConfigs.delete(plan.key);
                }
                return;
            }

            const config = {
                label: plan.label,
                smoothing: planConfig.smoothing,
                axes: planConfig.axes,
                targets: planConfig.targets,
            };

            const previousConfig = this.surfaceConfigs.get(plan.key)?.config;
            if (existingId && previousConfig && !this.shouldReconfigureSurface(previousConfig, config)) {
                return;
            }

            if (existingId) {
                try {
                    choreographer.removeSurface(existingId);
                } catch (_) {
                    // ignore removal issues
                }
                this.surfaceMappings.delete(plan.key);
            }

            try {
                const created = choreographer.registerFeatureSurface(config);
                if (created?.id) {
                    this.surfaceMappings.set(plan.key, created.id);
                    this.surfaceConfigs.set(plan.key, { config: this.cloneSurfaceConfig(created) });
                    this.dynamicEngine?.emit?.('log', {
                        level: 'info',
                        message: `${plan.label} armed for XY weighting`,
                        source: 'autopilot',
                    });
                }
            } catch (error) {
                this.dynamicEngine?.emit?.('log', {
                    level: 'warn',
                    message: `Autopilot surface setup failed → ${plan.key}`,
                    detail: error?.message,
                    source: 'autopilot',
                });
            }
        });
    }

    teardownSurfaces(targetChoreographer = this.audioChoreographer) {
        if (!this.surfaceMappings.size) {
            return;
        }

        const choreographer = targetChoreographer;
        if (!choreographer || typeof choreographer.removeSurface !== 'function') {
            this.surfaceMappings.clear();
            this.lastSurfaceAudit = 0;
            return;
        }

        Array.from(this.surfaceMappings.values()).forEach(id => {
            try {
                choreographer.removeSurface(id);
            } catch (_) {
                // Ignore removal failures silently to avoid cascading errors.
            }
        });
        this.surfaceMappings.clear();
        this.surfaceConfigs.clear();
        this.lastSurfaceAudit = 0;
    }

    attachAudioChoreographer(choreographer) {
        if (this.unsubscribeAudio) {
            this.unsubscribeAudio();
            this.unsubscribeAudio = null;
        }
        if (this.audioChoreographer && this.audioChoreographer !== choreographer) {
            this.teardownSurfaces(this.audioChoreographer);
        }
        this.audioChoreographer = choreographer;
        this.resetFeatureStats();
        this.resetForecastState();
        const now = performance.now();
        if (this.silenceState) {
            this.silenceState.active = false;
            this.silenceState.pendingMs = null;
            this.silenceState.lastActive = now;
            this.silenceState.lastAudioAt = now;
            this.silenceState.lastRecovery = null;
            this.silenceState.lastRecordTimestamp = null;
        }
        this.lastFeatures = {};
        if (!choreographer) {
            return;
        }
        this.unsubscribeAudio = choreographer.on('features', features => this.handleFeatures(features));
        if (this.enabled && this.options.autoConfigureSurfaces) {
            this.maintainSurfaceMappings(performance.now(), { force: true });
        }
    }

    setEnabled(enabled) {
        const next = Boolean(enabled);
        const changed = this.enabled !== next;
        this.enabled = next;
        const now = performance.now();
        if (!next) {
            this.teardownSurfaces();
            if (this.silenceState) {
                this.silenceState.active = false;
                this.silenceState.pendingMs = null;
                this.silenceState.lastActive = now;
                this.silenceState.lastRecordTimestamp = null;
            }
        } else {
            if (changed && this.options.autoConfigureSurfaces) {
                this.lastSurfaceAudit = 0;
                this.maintainSurfaceMappings(now, { force: true });
            }
            if (this.silenceProgram) {
                this.planSilenceRecovery(this.silenceProgram, this.lastFeatures || {}, { now, preview: true });
            }
            if (this.silenceState) {
                this.silenceState.lastRecordTimestamp = null;
            }
        }
        return changed;
    }

    toggleEnabled() {
        const changed = this.setEnabled(!this.enabled);
        return { ok: true, enabled: this.enabled, changed };
    }

    setProgramState(programId, enabled) {
        if (!programId) {
            return { ok: false, reason: 'Autopilot program identifier missing' };
        }

        const program = this.programs.find(entry => entry.id === programId);
        if (!program) {
            return { ok: false, reason: `Unknown autopilot program: ${programId}` };
        }

        const next = Boolean(enabled);
        const changed = program.enabled !== next;
        program.enabled = next;

        if (!next) {
            const prefix = `${program.id}:`;
            Array.from(this.cooldowns.keys())
                .filter(key => key.startsWith(prefix))
                .forEach(key => this.cooldowns.delete(key));
        }

        return { ok: true, program, enabled: next, changed };
    }

    toggleProgram(programId) {
        if (!programId) {
            return { ok: false, reason: 'Autopilot program identifier missing' };
        }

        const program = this.programs.find(entry => entry.id === programId);
        if (!program) {
            return { ok: false, reason: `Unknown autopilot program: ${programId}` };
        }

        return this.setProgramState(programId, !program.enabled);
    }

    mapActionHistoryResult(result = {}) {
        const intent = result.intent || {};
        const target = typeof intent.target === 'string' ? intent.target.trim() : null;
        const parameter = typeof intent.parameter === 'string' ? intent.parameter.trim() : target;
        const property = typeof intent.property === 'string' ? intent.property.trim() : null;
        const layer =
            typeof intent.layer === 'string'
                ? intent.layer.trim()
                : typeof intent.layerId === 'string'
                ? intent.layerId.trim()
                : typeof intent.layerKey === 'string'
                ? intent.layerKey.trim()
                : null;
        const mood = typeof intent.moodId === 'string' ? intent.moodId.trim() : null;
        const valueNumber = Number(intent.value);
        const toNumber = Number(intent.to);
        const fromNumber = Number(intent.from);
        const deltaNumber = Number(intent.delta);
        const durationNumber = Number(intent.duration);

        const normalize = (param, value) => {
            if (!Number.isFinite(value)) return null;
            if (param) {
                return this.normalizeParameterValue(param, value);
            }
            return value;
        };

        return {
            action: intent.action || null,
            target: target || parameter || property || null,
            parameter: parameter || null,
            property: property || null,
            layer: layer || null,
            value: normalize(parameter, valueNumber),
            to: normalize(parameter, toNumber),
            from: normalize(parameter, fromNumber),
            delta: Number.isFinite(deltaNumber) ? deltaNumber : null,
            duration: Number.isFinite(durationNumber) ? durationNumber : null,
            easing: typeof intent.easing === 'string' ? intent.easing : null,
            status: result.status || null,
            message: result.message || null,
            mood,
        };
    }

    recordActionHistory(program, results, meta = {}, triggeredAt = performance.now()) {
        const nowMs = Date.now();
        const limit = Number.isFinite(this.options.actionHistoryLimit)
            ? Math.max(1, this.options.actionHistoryLimit)
            : 12;
        const retentionMs = Number.isFinite(this.options.actionHistoryRetentionMs)
            ? Math.max(0, this.options.actionHistoryRetentionMs)
            : 0;
        const triggered = Number.isFinite(triggeredAt) ? triggeredAt : performance.now();

        const entry = {
            id: `${program.id || 'program'}:${nowMs}:${Math.round(triggered)}`,
            program: program.id,
            label: program.label || program.id,
            summary: meta.summary || null,
            transition: meta.transition
                ? {
                      from: meta.transition.from || null,
                      to: meta.transition.to || null,
                      label: meta.transition.label || null,
                      strategy: meta.transition.strategy || null,
                      confidence: Number.isFinite(meta.transition.confidence)
                          ? meta.transition.confidence
                          : null,
                  }
                : null,
            actions: Array.isArray(results) ? results.map(result => this.mapActionHistoryResult(result)) : [],
            recordedAt: nowMs,
            timestamp: triggered,
        };

        this.actionHistory.unshift(entry);

        if (retentionMs > 0) {
            const cutoff = nowMs - retentionMs;
            this.actionHistory = this.actionHistory.filter(item => (item.recordedAt || nowMs) >= cutoff);
        }

        if (this.actionHistory.length > limit) {
            this.actionHistory.length = limit;
        }
    }

    recordSectionTransition(transition = {}) {
        const limit = Number.isFinite(this.options.sectionTransitionHistoryLimit)
            ? Math.max(1, this.options.sectionTransitionHistoryLimit)
            : 18;
        const entry = {
            from: transition.from || null,
            to: transition.to || null,
            confidence: Number.isFinite(transition.confidence) ? transition.confidence : null,
            summary: transition.summary || null,
            label: transition.label || null,
            strategy: transition.strategy || null,
            program: transition.program || null,
            deltas: transition.deltas
                ? Object.entries(transition.deltas).reduce((acc, [parameter, delta]) => {
                      if (!Number.isFinite(delta)) return acc;
                      acc[parameter] = delta;
                      return acc;
                  }, {})
                : null,
            timestamp: Date.now(),
            triggeredAt: performance.now(),
        };
        this.sectionTransitions.push(entry);
        if (this.sectionTransitions.length > limit) {
            this.sectionTransitions.splice(0, this.sectionTransitions.length - limit);
        }
    }

    mix(current, target, smoothing) {
        if (current === undefined || current === null) return target;
        const factor = Math.max(0, Math.min(1, smoothing));
        return current + (target - current) * factor;
    }

    consumeCooldown(key, intervalMs) {
        if (!intervalMs) return true;
        const now = performance.now();
        const existing = this.cooldowns.get(key) || 0;
        if (existing > now) {
            return false;
        }
        this.cooldowns.set(key, now + intervalMs);
        return true;
    }

    anchorBiasForParameter(parameter) {
        return this.anchorBiasDefaults?.[parameter] ?? 0.3;
    }

    biasTowardAnchor(parameter, candidate, strength) {
        if (!Number.isFinite(candidate)) return candidate;
        const anchor = this.getPreferenceValue(parameter);
        if (!Number.isFinite(anchor)) return candidate;
        const factor = strength !== undefined ? Math.max(0, Math.min(1, strength)) : this.anchorBiasForParameter(parameter);
        return this.mixParameter(parameter, candidate, anchor, factor);
    }

    hueDifference(from, to) {
        if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
        const start = wrapHue(from);
        const dest = wrapHue(to);
        return ((dest - start + 540) % 360) - 180;
    }

    mixParameter(parameter, current, target, factor = 0.5) {
        if (!Number.isFinite(target)) return current;
        if (!Number.isFinite(current)) return target;
        const amount = Math.max(0, Math.min(1, factor));
        if (parameter === 'hue') {
            const base = wrapHue(current);
            const dest = wrapHue(target);
            const diff = ((dest - base + 540) % 360) - 180;
            return wrapHue(base + diff * amount);
        }
        return current + (target - current) * amount;
    }

    normalizeParameterValue(parameter, value) {
        if (!Number.isFinite(value)) return value;
        if (parameter === 'hue') {
            return wrapHue(value);
        }
        return value;
    }

    parameterDelta(parameter, next, previous) {
        if (!Number.isFinite(next) || !Number.isFinite(previous)) return Infinity;
        if (parameter === 'hue') {
            const diff = ((next - previous + 540) % 360) - 180;
            return Math.abs(diff);
        }
        return Math.abs(next - previous);
    }

    anchorThresholdFor(parameter) {
        const defaultThreshold = typeof this.options.anchorSnapThreshold === 'number' ? this.options.anchorSnapThreshold : 0.01;
        const thresholds = {
            intensity: 0.01,
            chaos: 0.01,
            saturation: 0.01,
            morphFactor: 0.02,
            speed: 0.02,
            gridDensity: 0.5,
            hue: 2,
        };
        return thresholds[parameter] ?? defaultThreshold;
    }

    shouldTrackParameter(parameter) {
        return this.trackedParameters.has(parameter);
    }

    describeAnchorOrigin(meta = {}) {
        const prompt = typeof meta.prompt === 'string' ? meta.prompt.trim() : '';
        if (prompt) {
            if (prompt.toLowerCase().startsWith('autopilot:')) {
                return { source: 'autopilot', summary: null };
            }
            const summary = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
            return { source: 'prompt', summary };
        }

        const preset = typeof meta.preset === 'string' ? meta.preset.trim() : '';
        if (preset) {
            return { source: 'preset', summary: preset };
        }

        if (typeof meta.source === 'string' && meta.source.trim()) {
            return { source: meta.source.trim(), summary: null };
        }

        return { source: 'manual', summary: null };
    }

    observeParameters(parameters = {}, meta = {}) {
        if (!parameters) return;
        const origin = this.describeAnchorOrigin(meta);
        const now = performance.now();
        const timestamp = Date.now();

        Object.entries(parameters).forEach(([parameter, value]) => {
            if (!Number.isFinite(value) || !this.shouldTrackParameter(parameter)) {
                return;
            }

            const normalized = this.normalizeParameterValue(parameter, value);
            const last = this.lastObservedParameters.get(parameter);
            const delta = last === undefined ? Infinity : this.parameterDelta(parameter, normalized, last);
            this.lastObservedParameters.set(parameter, normalized);

            const target = meta.intent?.target;
            if (target && target !== parameter) {
                return;
            }

            if (origin.source === 'autopilot') {
                return;
            }

            const threshold = this.anchorThresholdFor(parameter);
            if (!(delta > threshold || last === undefined)) {
                return;
            }

            const existing = this.preferenceAnchors.get(parameter);
            if (existing?.locked) {
                return;
            }
            if (!existing) {
                this.preferenceAnchors.set(parameter, {
                    value: normalized,
                    updatedAt: now,
                    updatedAtMs: timestamp,
                    source: origin.source,
                    prompt: origin.summary || null,
                    count: 1,
                });
            } else {
                const smoothing = Math.max(0, Math.min(1, typeof this.options.anchorSmoothing === 'number' ? this.options.anchorSmoothing : 0.32));
                const base = Number.isFinite(existing.value) ? existing.value : normalized;
                existing.value = this.mixParameter(parameter, base, normalized, smoothing);
                existing.updatedAt = now;
                existing.updatedAtMs = timestamp;
                existing.source = origin.source;
                if (origin.summary) {
                    existing.prompt = origin.summary;
                }
                existing.count = (existing.count || 0) + 1;
            }
        });
    }

    getPreferenceValue(parameter, fallback) {
        const entry = this.preferenceAnchors.get(parameter);
        if (!entry || !Number.isFinite(entry.value)) {
            return fallback;
        }
        if (parameter === 'hue') {
            return wrapHue(entry.value);
        }
        return entry.value;
    }

    applyAnchorBias(action, overrideStrength) {
        if (!action || typeof action !== 'object' || !action.target) {
            return action;
        }
        const next = { ...action };
        if (next.to !== undefined) {
            next.to = this.biasTowardAnchor(next.target, next.to, overrideStrength);
        }
        if (next.value !== undefined) {
            next.value = this.biasTowardAnchor(next.target, next.value, overrideStrength);
        }
        return next;
    }

    handleFeatures(features = {}) {
        if (!this.dynamicEngine) return;

        const now = performance.now();
        this.updateFeatureStats(features);
        this.updateForecastTelemetry(features, now);
        this.maintainSurfaceMappings(now);

        this.lastFeatures = { ...features };

        if (!this.enabled) {
            if (this.silenceProgram) {
                this.planSilenceRecovery(this.silenceProgram, features, { now, preview: true });
            }
            return;
        }

        if (Number.isFinite(features.energy)) {
            this.state.energyBaseline = this.mix(
                this.state.energyBaseline,
                features.energy,
                this.options.baselineSmoothing,
            );
        }

        if (Number.isFinite(features.bass)) {
            this.state.bassBaseline = this.mix(
                this.state.bassBaseline,
                features.bass,
                this.options.baselineSmoothing,
            );
        }

        const baseContext = {
            now,
            features,
            getParam: name => this.dynamicEngine?.parameterManager?.getParameter(name),
            mix: (current, target, smoothing = 0.5) => this.mix(current, target, smoothing),
            markSection: section => {
                this.state.lastSection = section;
            },
            lastSection: this.state.lastSection,
        };

        this.programs.forEach(program => {
            if (program.enabled === false) return;
            const context = {
                ...baseContext,
                consume: (suffix, interval) => this.consumeCooldown(`${program.id}:${suffix || 'default'}`, interval),
            };
            const result = program.evaluate(features, context);
            if (!result || !Array.isArray(result.actions) || result.actions.length === 0) {
                return;
            }
            const metadata = { summary: result.summary };
            if (result.transition) {
                metadata.transition = result.transition;
            }
            this.dispatch(program, result.actions, metadata);
            if (program.id === 'silence-recovery') {
                this.recordSilenceRecovery(result, {
                    force: Boolean(result.force),
                    origin: 'autopilot',
                    meta: { source: 'autopilot' },
                });
            }
        });
    }

    dispatch(program, actions, meta = {}) {
        if (!this.dynamicEngine || !actions?.length) return;
        const { results } = this.dynamicEngine.enqueueIntents(actions, {
            prompt: `autopilot:${program.id}`,
        });
        if (!results) return;

        const successful = results.filter(result => result.status !== 'rejected' && result.status !== 'ignored');
        if (successful.length === 0) {
            return;
        }

        const now = performance.now();
        program.state.lastTrigger = now;
        const summaryText = meta.summary || successful.map(item => item.message).filter(Boolean).join(' | ');
        program.state.lastSummary = summaryText;
        program.state.lastActions = actions;

        this.recordActionHistory(program, successful, meta, now);

        this.dynamicEngine.emit('log', {
            level: 'info',
            message: `Autopilot ${program.label}: ${program.state.lastSummary || 'action applied'}`,
            source: 'autopilot',
        });
        if (meta.transition) {
            this.recordSectionTransition({
                ...meta.transition,
                summary: summaryText,
                program: program.id,
            });
        }
        this.dynamicEngine.emit('state', this.dynamicEngine.getStateSnapshot());
    }

    getState() {
        const now = performance.now();
        return {
            enabled: this.enabled,
            baselines: {
                energy: this.state.energyBaseline,
                bass: this.state.bassBaseline,
            },
            silence: (() => {
                if (!this.silenceState) return null;
                const idleMs = Number.isFinite(this.silenceState.idleMs) ? this.silenceState.idleMs : null;
                const pendingMs = Number.isFinite(this.silenceState.pendingMs) ? this.silenceState.pendingMs : null;
                return {
                    active: Boolean(this.silenceState.active),
                    level: Number.isFinite(this.silenceState.level) ? this.silenceState.level : null,
                    threshold: Number.isFinite(this.silenceState.threshold) ? this.silenceState.threshold : null,
                    idleMs,
                    pendingMs,
                    lastRecoveryMsAgo: Number.isFinite(this.silenceState.lastRecovery)
                        ? now - this.silenceState.lastRecovery
                        : null,
                    lastAudioMsAgo: Number.isFinite(this.silenceState.lastAudioAt)
                        ? now - this.silenceState.lastAudioAt
                        : null,
                    cooldownMs: Number.isFinite(this.options.silenceCooldown) ? this.options.silenceCooldown : null,
                    idleRequiredMs: Number.isFinite(this.options.silenceDuration) ? this.options.silenceDuration : null,
                    durationSeconds: Number.isFinite(this.options.silenceRecoveryDuration)
                        ? this.options.silenceRecoveryDuration
                        : null,
                    targets: this.getSilenceTargetsList(),
                    lastSummary: this.silenceState.lastSummary || null,
                    lastOrigin: this.silenceState.lastOrigin || null,
                    lastForced: this.silenceState.lastForced ?? null,
                    recoveryCount: Number.isFinite(this.silenceState.recoveryCount)
                        ? this.silenceState.recoveryCount
                        : this.silenceHistory.length,
                    history: this.silenceHistory.map(entry => ({
                        timestamp: entry.timestamp,
                        summary: entry.summary,
                        forced: entry.forced,
                        origin: entry.origin,
                        preset: entry.preset,
                        prompt: entry.prompt,
                        actions: entry.actions,
                        targets: Array.isArray(entry.targets)
                            ? entry.targets.map(target => ({
                                  parameter: target.parameter,
                                  value: this.normalizeParameterValue(target.parameter, target.value),
                              }))
                            : [],
                    })),
                };
            })(),
            section: this.state.lastSection,
            sections: (() => {
                const keys = new Set([
                    ...Array.from(this.sectionProfiles.keys()),
                    ...Array.from(this.sectionPalettes.keys()),
                ]);
                return Array.from(keys)
                    .map(section => {
                        const profile = this.sectionProfiles.get(section);
                        const palette = this.sectionPalettes.get(section);
                        return {
                            section,
                            label: palette?.label || this.formatSectionLabel(section),
                            manual: Boolean(palette?.manual),
                            source: palette?.source || (profile ? 'learned' : null),
                            prompt: palette?.prompt || null,
                            updatedMsAgo: palette?.updatedAt ? now - palette.updatedAt : null,
                            lastSeenMsAgo: profile?.lastSeen ? now - profile.lastSeen : null,
                            samples: profile?.samples || 0,
                            targets: (palette?.parameters || []).map(entry => ({
                                parameter: entry.parameter,
                                value: this.normalizeParameterValue(entry.parameter, entry.value),
                                duration: entry.duration || null,
                                easing: entry.easing || null,
                            })),
                            averages: profile
                                ? Object.entries(profile.averages || {}).map(([parameter, value]) => ({
                                      parameter,
                                      value: this.normalizeParameterValue(parameter, value),
                                  }))
                                : [],
                        };
                    })
                    .sort((a, b) => a.section.localeCompare(b.section));
            })(),
            transitions: this.sectionTransitions
                .slice(-8)
                .reverse()
                .map(entry => ({
                    from: entry.from,
                    to: entry.to,
                    summary: entry.summary || null,
                    label: entry.label || null,
                    strategy: entry.strategy || null,
                    program: entry.program || null,
                    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null,
                    deltas: entry.deltas || null,
                    ageMsAgo: entry.triggeredAt ? now - entry.triggeredAt : null,
                })),
            actions: {
                limit: Number.isFinite(this.options.actionHistoryLimit)
                    ? Math.max(1, this.options.actionHistoryLimit)
                    : this.actionHistory.length,
                history: this.actionHistory.map(entry => ({
                    id: entry.id,
                    program: entry.program,
                    label: entry.label,
                    summary: entry.summary,
                    ageMs: entry.timestamp ? now - entry.timestamp : null,
                    recordedAt: entry.recordedAt || null,
                    transition: entry.transition
                        ? {
                              from: entry.transition.from || null,
                              to: entry.transition.to || null,
                              label: entry.transition.label || null,
                              strategy: entry.transition.strategy || null,
                              confidence: Number.isFinite(entry.transition.confidence)
                                  ? entry.transition.confidence
                                  : null,
                          }
                        : null,
                    actions: Array.isArray(entry.actions)
                        ? entry.actions.map(action => ({
                              action: action.action || null,
                              target: action.target || null,
                              parameter: action.parameter || null,
                              property: action.property || null,
                              layer: action.layer || null,
                              value: Number.isFinite(action.value) ? action.value : null,
                              to: Number.isFinite(action.to) ? action.to : null,
                              from: Number.isFinite(action.from) ? action.from : null,
                              delta: Number.isFinite(action.delta) ? action.delta : null,
                              duration: Number.isFinite(action.duration) ? action.duration : null,
                              easing: action.easing || null,
                              status: action.status || null,
                              message: action.message || null,
                              mood: action.mood || null,
                          }))
                        : [],
                })),
            },
            forecasts: (() => {
                if (!this.forecastState) {
                    this.initializeForecastState();
                }
                const momentum = {
                    energy: Number.isFinite(this.forecastState?.energyMomentum)
                        ? this.forecastState.energyMomentum
                        : null,
                    bass: Number.isFinite(this.forecastState?.bassMomentum)
                        ? this.forecastState.bassMomentum
                        : null,
                    transient: Number.isFinite(this.forecastState?.transientMomentum)
                        ? this.forecastState.transientMomentum
                        : null,
                };
                const predictions = Array.isArray(this.forecastState?.predictions)
                    ? this.forecastState.predictions.map(prediction => ({
                          id: prediction.id,
                          type: prediction.type,
                          confidence: Number.isFinite(prediction.confidence)
                              ? prediction.confidence
                              : null,
                          horizonMs: Number.isFinite(prediction.horizonMs) ? prediction.horizonMs : null,
                          leadMs: Number.isFinite(prediction.leadMs) ? prediction.leadMs : null,
                          createdMsAgo: Number.isFinite(prediction.createdAt)
                              ? now - prediction.createdAt
                              : null,
                          timestamp: prediction.timestamp || null,
                          consumed: Boolean(prediction.consumed),
                          consumedMsAgo: Number.isFinite(prediction.consumedAt)
                              ? now - prediction.consumedAt
                              : null,
                          status: (() => {
                              if (prediction.consumed) return 'executed';
                              const lead = Number.isFinite(prediction.leadMs) ? prediction.leadMs : 0;
                              const age = Number.isFinite(prediction.createdAt) ? now - prediction.createdAt : 0;
                              return age >= lead ? 'ready' : 'projected';
                          })(),
                          meta: {
                              energyMomentum: Number.isFinite(prediction.meta?.energyMomentum)
                                  ? prediction.meta.energyMomentum
                                  : null,
                              bassMomentum: Number.isFinite(prediction.meta?.bassMomentum)
                                  ? prediction.meta.bassMomentum
                                  : null,
                              transient: Number.isFinite(prediction.meta?.transient)
                                  ? prediction.meta.transient
                                  : null,
                          },
                      }))
                    : [];
                return { momentum, predictions };
            })(),
            featureRanges: Array.from(this.featureStats.entries())
                .map(([feature, stats]) => ({
                    feature,
                    min: stats.min,
                    max: stats.max,
                    avg: stats.avg,
                    samples: stats.samples,
                }))
                .sort((a, b) => a.feature.localeCompare(b.feature)),
            anchors: Array.from(this.preferenceAnchors.entries())
                .map(([parameter, anchor]) => ({
                    parameter,
                    value: this.normalizeParameterValue(parameter, anchor.value),
                    source: anchor.source || 'manual',
                    prompt: anchor.prompt || null,
                    updates: anchor.count || 1,
                    updatedMsAgo: anchor.updatedAt ? now - anchor.updatedAt : null,
                    locked: Boolean(anchor.locked),
                }))
                .sort((a, b) => {
                    const orderIndex = parameter => {
                        const idx = this.trackedParameterOrder.indexOf(parameter);
                        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
                    };
                    const aOrder = orderIndex(a.parameter);
                    const bOrder = orderIndex(b.parameter);
                    if (aOrder === bOrder) {
                        return a.parameter.localeCompare(b.parameter);
                    }
                    return aOrder - bOrder;
                }),
            programs: this.programs.map(program => {
                const programCooldowns = Array.from(this.cooldowns.entries())
                    .filter(([key]) => key.startsWith(`${program.id}:`))
                    .map(([, expiry]) => Math.max(0, expiry - now));
                const cooldownRemaining = programCooldowns.length
                    ? Math.max(...programCooldowns)
                    : 0;
                const lastTriggerMsAgo = program.state.lastTrigger ? now - program.state.lastTrigger : null;
                return {
                    id: program.id,
                    label: program.label,
                    active: program.enabled !== false,
                    lastSummary: program.state.lastSummary || null,
                    lastTriggerMsAgo,
                    cooldownMsRemaining: cooldownRemaining,
                };
            }),
            surfaces: this.surfacePlans.map(plan => ({
                key: plan.key,
                label: plan.label,
                targets: plan.targetParameters || [],
                active: this.surfaceMappings.has(plan.key),
                surfaceId: this.surfaceMappings.get(plan.key) || null,
                axes: (() => {
                    const config = this.surfaceConfigs.get(plan.key)?.config;
                    if (!config?.axes) return null;
                    const formatAxis = axis =>
                        axis
                            ? {
                                  feature: axis.feature,
                                  min: axis.min,
                                  max: axis.max,
                              }
                            : null;
                    return {
                        x: formatAxis(config.axes.x),
                        y: formatAxis(config.axes.y),
                    };
                })(),
            })),
        };
    }
}
