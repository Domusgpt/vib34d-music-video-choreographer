/**
 * ReactivityController
 * ---------------------
 * Centralises the mapping between analysed audio data and engine parameters
 * while exposing live performance controls (XY pad, beat detection, etc.).
 * The controller is intentionally declarative – parameters register their
 * desired signal sources, ranges, smoothing values, and live modifiers.
 */

export class ReactivityController {
    constructor(options = {}) {
        this.mappings = new Map();
        this.modulators = new Map();
        this.modulatorState = new Map();
        this.lastModulatorValues = new Map();
        this.liveVector = { x: 0, y: 0 };
        this.lastValues = new Map();
        this.beatPulse = 0;
        this.beatDecay = options.beatDecay ?? 0.82;
        this.minimumUpdateDelta = options.minimumUpdateDelta ?? 1 / 120;
    }

    /**
     * Register a parameter mapping.
     */
    registerParameter(name, config = {}) {
        const mapping = {
            base: 0,
            influence: 1,
            sources: [{ band: 'energy', weight: 1 }],
            liveAxes: { x: 0, y: 0 },
            smoothing: 0.18,
            range: null,
            wrap: null,
            beatResponse: 0,
            compute: null,
            transform: null,
            postProcess: null,
            consumeOnIdle: true,
            modulators: null,
            ...config
        };

        if (!mapping.sources || mapping.sources.length === 0) {
            mapping.sources = [{ band: 'energy', weight: 1 }];
        }

        this.mappings.set(name, mapping);
        return this;
    }

    registerModulator(name, config = {}) {
        if (!name) {
            throw new Error('Modulator name is required');
        }

        const modulator = {
            type: 'lfo',
            frequency: 0.25,
            amplitude: 1,
            offset: 0,
            phaseOffset: 0,
            shape: 'sine',
            retriggerOnBeat: false,
            beatBoost: 0,
            beatBoostDecay: 0.75,
            amount: 1,
            decay: 0.6,
            attack: 1,
            base: 0,
            range: null,
            smoothing: 0,
            compute: null,
            postProcess: null,
            initialValue: 0,
            initialPhase: 0,
            ...config
        };

        this.modulators.set(name, modulator);
        this.resetModulatorState(name);
        return this;
    }

    resetModulatorState(name) {
        const config = this.modulators.get(name);
        if (!config) return;

        const state = {
            phase: config.initialPhase ?? 0,
            lastValue: Number.isFinite(config.initialValue) ? config.initialValue : 0,
            beatBoost: 0,
            envelope: 0
        };

        this.modulatorState.set(name, state);
        this.lastModulatorValues.set(name, state.lastValue);
    }

    /**
     * Update the live performance vector coming from the XY pad.
     */
    setLiveVector(vector = {}) {
        const clamp = (value) => Math.max(-1, Math.min(1, value ?? 0));
        this.liveVector = {
            x: clamp(vector.x),
            y: clamp(vector.y)
        };
    }

    getLiveVector() {
        return { ...this.liveVector };
    }

    /**
     * Notify the controller of a beat hit (used for parameter surges).
     */
    handleBeat(strength = 1) {
        this.beatPulse = Math.max(this.beatPulse, strength);
        this.modulators.forEach((config, name) => {
            if (!this.modulatorState.has(name)) {
                this.resetModulatorState(name);
            }

            const state = this.modulatorState.get(name);

            if (config.retriggerOnBeat) {
                state.phase = config.initialPhase ?? 0;
            }

            if (config.type === 'beatEnvelope') {
                const amount = config.amount ?? 1;
                const max = Number.isFinite(config.max) ? config.max : Infinity;
                const attack = Math.max(0.01, config.attack ?? 1);
                state.envelope = Math.min(max, (state.envelope ?? 0) + strength * amount * attack);
            }

            if (config.beatBoost) {
                const boost = config.beatBoost * strength;
                state.beatBoost = Math.max(state.beatBoost ?? 0, boost);
            }

            this.modulatorState.set(name, state);
        });
    }

    /**
     * Return current beat momentum (decays over time).
     */
    getBeatMomentum() {
        return this.beatPulse;
    }

    setBeatDecay(decay) {
        this.beatDecay = Math.min(Math.max(decay, 0.5), 0.95);
    }

    /**
     * Reset smoothing caches – useful when switching systems.
     */
    reset() {
        this.lastValues.clear();
        this.beatPulse = 0;
        this.modulatorState.forEach((_, name) => this.resetModulatorState(name));
    }

    getLastValue(name) {
        return this.lastValues.get(name);
    }

    /**
     * Compute a full parameter map for the current frame.
     */
    compute(audioData, context = {}) {
        const consumeBeat = context.consumeBeat !== false;
        const beatStrength = this.beatPulse;

        if (consumeBeat) {
            this.beatPulse = Math.max(0, this.beatPulse * this.beatDecay);
        }

        const results = {};
        const deltaTime = Number.isFinite(context.deltaTime) ? Math.max(0, context.deltaTime) : 0;
        const modulators = this.updateModulators(deltaTime, audioData, context);

        this.mappings.forEach((config, name) => {
            const meta = {
                audio: audioData,
                liveVector: this.liveVector,
                beat: beatStrength,
                context,
                previous: this.lastValues.get(name),
                controller: this,
                modulators,
                modulatorValues: modulators
            };

            let value;

            if (typeof config.compute === 'function') {
                value = config.compute(meta);
            } else {
                const sources = Array.isArray(config.sources) ? config.sources : [];
                let sourceSum = 0;
                sources.forEach(({ band, weight = 1 }) => {
                    const bandValue = audioData[band] ?? 0;
                    sourceSum += bandValue * weight;
                });
                value = (config.base ?? 0) + sourceSum * (config.influence ?? 1);
            }

            // Live performance axes from XY pad
            if (config.liveAxes) {
                const live = config.liveAxes;
                value += (live.x || 0) * this.liveVector.x;
                value += (live.y || 0) * this.liveVector.y;
            }

            // Beat response surge
            if (config.beatResponse) {
                value += config.beatResponse * beatStrength;
            }

            if (config.modulators) {
                value = this.applyModulators(value, config.modulators, meta);
            }

            if (typeof config.transform === 'function') {
                value = config.transform(value, meta);
            }

            const previousValue = this.lastValues.get(name);

            // Wrap support (e.g. hue)
            if (config.wrap && previousValue !== undefined) {
                const wrap = config.wrap;
                let delta = value - previousValue;
                if (delta > wrap / 2) {
                    value -= wrap;
                } else if (delta < -wrap / 2) {
                    value += wrap;
                }
            }

            // Exponential smoothing
            if (config.smoothing !== undefined && previousValue !== undefined) {
                const smoothing = Math.min(Math.max(config.smoothing, 0), 0.95);
                value = previousValue + (value - previousValue) * (1 - smoothing);
            }

            if (config.range) {
                const [min, max] = config.range;
                value = Math.min(max, Math.max(min, value));
            }

            if (config.wrap) {
                const wrap = config.wrap;
                value = ((value % wrap) + wrap) % wrap;
            }

            if (typeof config.postProcess === 'function') {
                value = config.postProcess(value, meta);
            }

            if (Number.isFinite(value)) {
                this.lastValues.set(name, value);
                results[name] = value;
            }
        });

        return results;
    }

    applyModulators(value, entries, meta) {
        const list = Array.isArray(entries) ? entries : [entries];
        let output = value;

        list.forEach((entry) => {
            if (!entry) return;

            if (typeof entry === 'function') {
                output = entry(output, meta);
                return;
            }

            const config = typeof entry === 'string' ? { name: entry } : entry;
            if (!config.name) return;

            const modValue = this.getModulatorValue(config.name);
            if (!Number.isFinite(modValue)) return;

            const weight = config.weight ?? 1;
            const contribution = modValue * weight;

            switch (config.mode) {
                case 'multiply':
                    output *= 1 + contribution;
                    break;
                case 'override':
                    output = contribution;
                    break;
                case 'add':
                default:
                    output += contribution;
            }

            if (typeof config.transform === 'function') {
                output = config.transform(output, modValue, meta);
            }
        });

        return output;
    }

    updateModulators(deltaTime, audioData, context) {
        const values = new Map();
        const dt = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
        const TAU = Math.PI * 2;

        this.modulators.forEach((config, name) => {
            if (!this.modulatorState.has(name)) {
                this.resetModulatorState(name);
            }

            const state = this.modulatorState.get(name);
            const modMeta = {
                audio: audioData,
                context,
                controller: this,
                deltaTime: dt,
                beat: this.beatPulse,
                state
            };

            let value = state.lastValue ?? config.initialValue ?? 0;

            if (typeof config.compute === 'function') {
                value = config.compute(modMeta);
            } else if (config.type === 'beatEnvelope') {
                const base = config.base ?? 0;
                const decay = Math.max(0.01, Math.min(0.999, config.decay ?? 0.65));
                const release = dt > 0 ? Math.pow(decay, dt * 60) : 1;
                state.envelope = (state.envelope ?? 0) * release;
                value = base + (state.envelope ?? 0);
            } else {
                const frequency = Math.max(0, config.frequency ?? 0);
                const amplitude = config.amplitude ?? 1;
                const phaseOffset = config.phaseOffset ?? 0;
                const shape = config.shape ?? 'sine';

                if (frequency > 0 && dt > 0) {
                    const phase = (state.phase ?? 0) + frequency * dt * TAU;
                    state.phase = ((phase % TAU) + TAU) % TAU;
                }

                const phase = (state.phase ?? 0) + phaseOffset;
                let waveform = this.computeWaveform(phase, shape);

                if ((state.beatBoost ?? 0) > 0 && config.beatBoostDecay) {
                    const boostDecay = Math.max(0.01, Math.min(0.999, config.beatBoostDecay));
                    const appliedDecay = dt > 0 ? Math.pow(boostDecay, dt * 60) : 1;
                    waveform *= 1 + state.beatBoost;
                    state.beatBoost *= appliedDecay;
                    if (state.beatBoost < 0.0001) {
                        state.beatBoost = 0;
                    }
                }

                value = waveform * amplitude + (config.offset ?? 0);
            }

            if (!Number.isFinite(value)) {
                value = state.lastValue ?? config.initialValue ?? 0;
            }

            if (config.range && Array.isArray(config.range)) {
                const [min, max] = config.range;
                if (Number.isFinite(min) && Number.isFinite(max)) {
                    value = Math.min(max, Math.max(min, value));
                }
            }

            if (config.smoothing && Number.isFinite(state.lastValue)) {
                const smoothing = Math.max(0, Math.min(0.95, config.smoothing));
                value = state.lastValue + (value - state.lastValue) * (1 - smoothing);
            }

            if (typeof config.postProcess === 'function') {
                value = config.postProcess(value, modMeta);
            }

            state.lastValue = value;
            this.modulatorState.set(name, state);
            values.set(name, value);
        });

        this.lastModulatorValues = values;
        return values;
    }

    computeWaveform(phase, shape = 'sine') {
        const TAU = Math.PI * 2;
        const normalized = ((phase % TAU) + TAU) % TAU;
        const ratio = normalized / TAU;

        switch (shape) {
            case 'triangle': {
                const saw = 2 * ratio - 1;
                return 1 - 2 * Math.abs(saw);
            }
            case 'saw':
            case 'sawtooth':
                return 2 * ratio - 1;
            case 'square':
                return normalized < Math.PI ? 1 : -1;
            default:
                return Math.sin(normalized);
        }
    }

    getModulatorValue(name) {
        if (!name) return 0;
        if (this.lastModulatorValues && this.lastModulatorValues.has(name)) {
            return this.lastModulatorValues.get(name);
        }
        const state = this.modulatorState.get(name);
        if (state && Number.isFinite(state.lastValue)) {
            return state.lastValue;
        }
        const config = this.modulators.get(name);
        if (config && Number.isFinite(config.initialValue)) {
            return config.initialValue;
        }
        return 0;
    }

    getModulatorSnapshot() {
        const snapshot = {};
        this.modulators.forEach((_, name) => {
            const value = this.getModulatorValue(name);
            snapshot[name] = Number.isFinite(value) ? value : 0;
        });
        return snapshot;
    }
}
