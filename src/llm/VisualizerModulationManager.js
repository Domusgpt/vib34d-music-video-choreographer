const PROPERTY_LIMITS = {
    opacity: { min: 0, max: 1 },
    intensity: { min: 0, max: 1 },
    reactivity: { min: 0.1, max: 2.5 },
};

function clamp(value, min, max) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    let clamped = value;
    if (typeof min === 'number') {
        clamped = Math.max(min, clamped);
    }
    if (typeof max === 'number') {
        clamped = Math.min(max, clamped);
    }
    return clamped;
}

function toLabel(text) {
    if (!text) return 'Layer';
    return text
        .toString()
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(\w)/, (_, ch) => ch.toUpperCase());
}

export class VisualizerModulationManager {
    constructor(engine, options = {}) {
        this.engine = engine;
        this.options = {
            includeIntensity: true,
            includeReactivity: true,
            ...options,
        };
        this.layerMap = new Map();
        this.refresh();
    }

    refresh() {
        this.layerMap.clear();
        const visualizers = Array.isArray(this.engine?.visualizers) ? this.engine.visualizers : [];
        visualizers.forEach((visualizer, index) => {
            if (!visualizer) return;
            const key = (visualizer.role || `layer-${index}`).toLowerCase();
            const canvas = visualizer.canvas ?? (visualizer.canvasId ? document.getElementById(visualizer.canvasId) : null);
            let defaultOpacity = 1;
            if (canvas) {
                try {
                    const computed = window.getComputedStyle(canvas);
                    if (computed?.opacity) {
                        defaultOpacity = parseFloat(computed.opacity);
                    }
                } catch (error) {
                    // Accessing computed style may fail in non-browser environments; ignore gracefully
                }
            }
            const defaultIntensity = typeof visualizer.params?.intensity === 'number' ? visualizer.params.intensity : 0.5;
            const defaultReactivity = typeof visualizer.reactivity === 'number' ? visualizer.reactivity : 1;

            this.layerMap.set(key, {
                key,
                index,
                label: toLabel(visualizer.role || `Layer ${index + 1}`),
                canvasId: canvas?.id,
                canvas,
                visualizer,
                state: {
                    opacity: Number.isFinite(defaultOpacity) ? defaultOpacity : 1,
                    intensity: defaultIntensity,
                    reactivity: defaultReactivity,
                },
                defaults: {
                    opacity: Number.isFinite(defaultOpacity) ? defaultOpacity : 1,
                    intensity: defaultIntensity,
                    reactivity: defaultReactivity,
                },
            });
        });
    }

    getLayer(layer) {
        if (!layer) return null;
        const key = layer.toLowerCase();
        if (this.layerMap.has(key)) {
            return this.layerMap.get(key);
        }
        // Attempt to match by partial role name when exact match missing
        const match = Array.from(this.layerMap.values()).find(entry => entry.key.includes(key));
        return match || null;
    }

    apply(modulation) {
        const { layer, property, value } = modulation;
        const record = this.getLayer(layer);
        if (!record) {
            return { ok: false, reason: `Layer ${layer} unavailable` };
        }
        if (!PROPERTY_LIMITS[property]) {
            return { ok: false, reason: `Unsupported property ${property}` };
        }
        const clamped = clamp(value, PROPERTY_LIMITS[property].min, PROPERTY_LIMITS[property].max);
        if (clamped === null) {
            return { ok: false, reason: `Invalid value for ${property}` };
        }

        const previous = record.state[property];
        record.state[property] = clamped;

        if (property === 'opacity' && record.canvas) {
            record.canvas.style.opacity = clamped.toFixed(3);
        } else if (property === 'intensity' && record.visualizer?.params) {
            record.visualizer.params.intensity = clamped;
        } else if (property === 'reactivity') {
            record.visualizer.reactivity = clamped;
        }

        return {
            ok: true,
            value: clamped,
            previous,
            layer: {
                key: record.key,
                label: record.label,
                index: record.index,
            },
            state: this.getState(),
        };
    }

    getState() {
        return Array.from(this.layerMap.values())
            .sort((a, b) => a.index - b.index)
            .map(entry => ({
                key: entry.key,
                label: entry.label,
                index: entry.index,
                canvasId: entry.canvasId,
                state: {
                    opacity: entry.state.opacity,
                    intensity: this.options.includeIntensity ? entry.state.intensity : undefined,
                    reactivity: this.options.includeReactivity ? entry.state.reactivity : undefined,
                },
            }));
    }
}

export const VISUALIZER_LAYERS = ['background', 'shadow', 'content', 'highlight', 'accent'];
export const VISUALIZER_PROPERTIES = Object.keys(PROPERTY_LIMITS);
