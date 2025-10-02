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
            ...config
        };

        if (!mapping.sources || mapping.sources.length === 0) {
            mapping.sources = [{ band: 'energy', weight: 1 }];
        }

        this.mappings.set(name, mapping);
        return this;
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

        this.mappings.forEach((config, name) => {
            const meta = {
                audio: audioData,
                liveVector: this.liveVector,
                beat: beatStrength,
                context,
                previous: this.lastValues.get(name),
                controller: this
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
}

