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
            ...options,
        };

        this.state = {
            energyBaseline: 0.32,
            bassBaseline: 0.24,
            lastSection: 'intro',
        };
        this.cooldowns = new Map();
        this.programs = [];

        this.configureDefaultPrograms();
        if (audioChoreographer) {
            this.attachAudioChoreographer(audioChoreographer);
        }
    }

    configureDefaultPrograms() {
        this.programs = [
            this.createBeatPulseProgram(),
            this.createEnergySwellProgram(),
            this.createBassDensityProgram(),
            this.createSectionMoodProgram(),
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

    attachAudioChoreographer(choreographer) {
        if (this.unsubscribeAudio) {
            this.unsubscribeAudio();
            this.unsubscribeAudio = null;
        }
        this.audioChoreographer = choreographer;
        if (!choreographer) return;
        this.unsubscribeAudio = choreographer.on('features', features => this.handleFeatures(features));
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (this.dynamicEngine) {
            this.dynamicEngine.emit('state', this.dynamicEngine.getStateSnapshot());
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

    handleFeatures(features = {}) {
        if (!this.enabled || !this.dynamicEngine) return;

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

        const now = performance.now();
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
        };
    }
}
