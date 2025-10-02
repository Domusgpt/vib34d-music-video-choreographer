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
            ...options,
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

        this.configureDefaultPrograms();
        if (audioChoreographer) {
            this.attachAudioChoreographer(audioChoreographer);
        }
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
            this.createBassDensityProgram(),
            this.createSectionMoodProgram(),
            this.createLayerAtmosphereProgram(),
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
                program.state.restIntensity = context.mix(
                    program.state.restIntensity ?? currentIntensity,
                    currentIntensity,
                    0.35,
                );

                const beatStrength = Math.max(0.2, Math.min(1.4, features.beatStrength || 0.8));
                const peak = clamp(currentIntensity * (0.9 + beatStrength * 0.35) + 0.18, 0, 1);
                const settle = clamp(program.state.restIntensity * 0.95, 0.18, 0.85);

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

                if (deviation > 0) {
                    const chaosBump = Math.min(0.18, 0.12 + deviation * 0.35);
                    const speedBump = Math.min(0.22, 0.1 + deviation * 0.3);
                    return {
                        actions: [
                            { action: 'adjustParameter', target: 'chaos', delta: chaosBump, ceiling: 1 },
                            { action: 'adjustParameter', target: 'speed', delta: speedBump, ceiling: 3 },
                        ],
                        summary: 'Energy surge → chaos + speed',
                    };
                }

                const currentSpeed = context.getParam('speed') ?? 1;
                const targetSpeed = clamp(currentSpeed * 0.88, 0.55, 3);
                return {
                    actions: [
                        { action: 'adjustParameter', target: 'chaos', delta: -0.14, floor: 0 },
                        { action: 'scheduleEnvelope', target: 'speed', from: currentSpeed, to: targetSpeed, duration: 1.6 },
                    ],
                    summary: 'Energy lull → soften chaos, ease speed',
                };
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
                const desired = clamp(this.options.bassMin + (features.bass ?? 0) * range, this.options.bassMin, this.options.bassMax);
                const smoothed = context.mix(program.state.lastTarget ?? desired, desired, 0.25);
                program.state.lastTarget = smoothed;

                const current = context.getParam('gridDensity') ?? smoothed;
                if (Math.abs(smoothed - current) < 0.8) {
                    return null;
                }
                if (!context.consume('density', this.options.bassCooldown)) {
                    return null;
                }

                return {
                    actions: [
                        { action: 'setParameter', target: 'gridDensity', value: smoothed },
                    ],
                    summary: `Bass density → ${smoothed.toFixed(1)}`,
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

                const actions = sectionPrograms[features.section] || [
                    { action: 'adjustParameter', target: 'chaos', delta: 0.04, ceiling: 1 },
                ];

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

    resolveParam(name, fallback, min, max) {
        const manager = this.dynamicEngine?.parameterManager;
        const value = manager?.getParameter?.(name);
        const numeric = typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
        const base = numeric === undefined || numeric === null ? fallback : numeric;
        return clamp(base, min, max);
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
        if (!next) {
            this.teardownSurfaces();
        } else if (changed && this.options.autoConfigureSurfaces) {
            this.lastSurfaceAudit = 0;
            this.maintainSurfaceMappings(performance.now(), { force: true });
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

    handleFeatures(features = {}) {
        if (!this.dynamicEngine) return;

        const now = performance.now();
        this.updateFeatureStats(features);
        this.maintainSurfaceMappings(now);

        if (!this.enabled) return;

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
            this.dispatch(program, result.actions, { summary: result.summary });
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
        program.state.lastSummary = meta.summary || successful.map(item => item.message).filter(Boolean).join(' | ');
        program.state.lastActions = actions;

        this.dynamicEngine.emit('log', {
            level: 'info',
            message: `Autopilot ${program.label}: ${program.state.lastSummary || 'action applied'}`,
            source: 'autopilot',
        });
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
            section: this.state.lastSection,
            featureRanges: Array.from(this.featureStats.entries())
                .map(([feature, stats]) => ({
                    feature,
                    min: stats.min,
                    max: stats.max,
                    avg: stats.avg,
                    samples: stats.samples,
                }))
                .sort((a, b) => a.feature.localeCompare(b.feature)),
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
