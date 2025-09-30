const VARIATION_RANGE = { min: 0, max: 99 };

const DEFAULT_PARAM_LIMITS = {
    chaos: { min: 0, max: 1 },
    speed: { min: 0.1, max: 3 },
    hue: { min: 0, max: 360 },
    intensity: { min: 0, max: 1 },
    saturation: { min: 0, max: 1 },
    morphFactor: { min: 0, max: 2 },
    gridDensity: { min: 4, max: 100 },
    dimension: { min: 3, max: 4.5 },
    rot4dXW: { min: -2, max: 2 },
    rot4dYW: { min: -2, max: 2 },
    rot4dZW: { min: -2, max: 2 },
    variation: VARIATION_RANGE,
};

const AUDIO_FEATURES = new Set([
    'bass',
    'mid',
    'high',
    'energy',
    'beat',
    'transient',
    'spectralCentroid',
]);

const AUDIO_TRANSFORMS = new Set(['linear', 'square', 'sqrt', 'cube']);

const SURFACE_TRANSFORMS = new Set(['linear', 'square', 'sqrt', 'cube', 'logistic']);

const AUDIO_MODES = new Set(['absolute', 'additive']);

const AUDIO_STRATEGY_PRESETS = new Set([
    'balanced-reactive',
    'bass-density',
    'bass-color',
    'section-contrast',
]);

const VISUALIZER_LAYERS = new Set(['background', 'shadow', 'content', 'highlight', 'accent']);
const VISUALIZER_PROPERTIES = {
    opacity: { min: 0, max: 1 },
    intensity: { min: 0, max: 1 },
    reactivity: { min: 0.1, max: 2.5 },
};

function clamp(value, min, max) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    return Math.min(Math.max(value, min), max);
}

export function validateIntent(intent, parameterDefs = {}) {
    const errors = [];
    const sanitized = { ...intent };

    const mergedLimits = { ...DEFAULT_PARAM_LIMITS };
    Object.entries(parameterDefs).forEach(([key, def]) => {
        mergedLimits[key] = {
            min: typeof def.min === 'number' ? def.min : mergedLimits[key]?.min ?? -Infinity,
            max: typeof def.max === 'number' ? def.max : mergedLimits[key]?.max ?? Infinity,
        };
    });

    switch (sanitized.action) {
        case 'setParameter': {
            if (!sanitized.target || !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
                break;
            }
            const limits = mergedLimits[sanitized.target];
            const value = clamp(Number(sanitized.value), limits.min, limits.max);
            if (value === null) {
                errors.push(`Invalid value for ${sanitized.target}`);
            } else {
                sanitized.value = value;
            }
            break;
        }
        case 'adjustParameter': {
            if (!sanitized.target || !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
                break;
            }
            const delta = Number(sanitized.delta);
            if (Number.isNaN(delta) || !Number.isFinite(delta)) {
                errors.push(`Invalid delta for ${sanitized.target}`);
            } else {
                sanitized.delta = delta;
            }
            if (sanitized.ceiling !== undefined) {
                const limits = mergedLimits[sanitized.target];
                sanitized.ceiling = clamp(Number(sanitized.ceiling), limits.min, limits.max);
            }
            if (sanitized.floor !== undefined) {
                const limits = mergedLimits[sanitized.target];
                sanitized.floor = clamp(Number(sanitized.floor), limits.min, limits.max);
            }
            break;
        }
        case 'scheduleEnvelope': {
            if (!sanitized.target || !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
                break;
            }
            const limits = mergedLimits[sanitized.target];
            const from = sanitized.from !== undefined ? clamp(Number(sanitized.from), limits.min, limits.max) : undefined;
            const to = clamp(Number(sanitized.to), limits.min, limits.max);
            if (to === null) {
                errors.push(`Invalid end value for ${sanitized.target}`);
            } else {
                sanitized.to = to;
            }
            if (from === null) {
                errors.push(`Invalid start value for ${sanitized.target}`);
            } else if (from !== undefined) {
                sanitized.from = from;
            }
            const duration = Number(sanitized.duration);
            if (Number.isNaN(duration) || duration <= 0) {
                errors.push('Envelope duration must be positive');
            } else {
                sanitized.duration = duration;
            }
            if (sanitized.delay !== undefined) {
                const delay = Number(sanitized.delay);
                sanitized.delay = Number.isNaN(delay) || delay < 0 ? 0 : delay;
            }
            sanitized.easing = sanitized.easing || 'easeInOut';
            break;
        }
        case 'setVariation': {
            const value = clamp(Number(sanitized.value), VARIATION_RANGE.min, VARIATION_RANGE.max);
            if (value === null) {
                errors.push('Variation index must be a number');
            } else {
                sanitized.value = Math.round(value);
            }
            break;
        }
        case 'applyMood': {
            if (!sanitized.moodId) {
                errors.push('Mood identifier missing');
            }
            break;
        }
        case 'queryState':
            break;
        case 'setVisualizerModulation': {
            const layer = sanitized.layer?.toLowerCase();
            const property = sanitized.property?.toLowerCase();
            if (!layer || !VISUALIZER_LAYERS.has(layer)) {
                errors.push(`Unknown visualizer layer: ${sanitized.layer}`);
            } else {
                sanitized.layer = layer;
            }
            if (!property || !VISUALIZER_PROPERTIES[property]) {
                errors.push(`Unsupported visualizer property: ${sanitized.property}`);
            } else {
                sanitized.property = property;
                const limits = VISUALIZER_PROPERTIES[property];
                const value = clamp(Number(sanitized.value), limits.min, limits.max);
                if (value === null) {
                    errors.push(`Invalid value for ${property}`);
                } else {
                    sanitized.value = value;
                }
            }
            break;
        }
        case 'bindAudioFeature': {
            if (!sanitized.feature || !AUDIO_FEATURES.has(sanitized.feature)) {
                errors.push(`Unknown audio feature: ${sanitized.feature}`);
            }
            if (!sanitized.target || !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
            }
            if (sanitized.mode && !AUDIO_MODES.has(sanitized.mode)) {
                errors.push(`Invalid audio binding mode: ${sanitized.mode}`);
            }
            if (sanitized.transform && !AUDIO_TRANSFORMS.has(sanitized.transform)) {
                errors.push(`Invalid audio transform: ${sanitized.transform}`);
            }
            if (sanitized.scale !== undefined) {
                const scale = Number(sanitized.scale);
                if (Number.isNaN(scale)) {
                    errors.push('Audio binding scale must be numeric');
                } else {
                    sanitized.scale = scale;
                }
            }
            if (sanitized.offset !== undefined) {
                const offset = Number(sanitized.offset);
                if (Number.isNaN(offset)) {
                    errors.push('Audio binding offset must be numeric');
                } else {
                    sanitized.offset = offset;
                }
            }
            if (sanitized.smoothing !== undefined) {
                const smoothing = Number(sanitized.smoothing);
                if (Number.isNaN(smoothing)) {
                    errors.push('Audio binding smoothing must be numeric');
                } else {
                    sanitized.smoothing = Math.min(Math.max(smoothing, 0), 0.95);
                }
            }
            if (sanitized.min !== undefined) {
                const min = Number(sanitized.min);
                if (Number.isNaN(min)) {
                    errors.push('Audio binding minimum must be numeric');
                } else {
                    sanitized.min = min;
                }
            }
            if (sanitized.max !== undefined) {
                const max = Number(sanitized.max);
                if (Number.isNaN(max)) {
                    errors.push('Audio binding maximum must be numeric');
                } else {
                    sanitized.max = max;
                }
            }
            sanitized.mode = sanitized.mode || 'absolute';
            sanitized.transform = sanitized.transform || 'linear';
            sanitized.invert = Boolean(sanitized.invert);
            break;
        }
        case 'bindAudioSurface': {
            if (!sanitized.axes || !sanitized.axes.x || !sanitized.axes.y) {
                errors.push('Audio surface requires x and y axes');
                break;
            }

            const normalizedAxes = {};
            ['x', 'y'].forEach(axisKey => {
                const axis = sanitized.axes[axisKey];
                if (!axis?.feature || !AUDIO_FEATURES.has(axis.feature)) {
                    errors.push(`Unknown audio feature for ${axisKey}-axis: ${axis?.feature}`);
                    return;
                }
                const transform = axis.transform || 'linear';
                if (!SURFACE_TRANSFORMS.has(transform)) {
                    errors.push(`Invalid transform for ${axisKey}-axis: ${transform}`);
                }
                const normalizedAxis = {
                    feature: axis.feature,
                    transform,
                    invert: Boolean(axis.invert),
                };
                if (axis.scale !== undefined) {
                    const scale = Number(axis.scale);
                    if (Number.isNaN(scale)) {
                        errors.push(`${axisKey}-axis scale must be numeric`);
                    } else {
                        normalizedAxis.scale = scale;
                    }
                }
                if (axis.offset !== undefined) {
                    const offset = Number(axis.offset);
                    if (Number.isNaN(offset)) {
                        errors.push(`${axisKey}-axis offset must be numeric`);
                    } else {
                        normalizedAxis.offset = offset;
                    }
                }
                if (axis.min !== undefined) {
                    const min = Number(axis.min);
                    if (Number.isNaN(min)) {
                        errors.push(`${axisKey}-axis minimum must be numeric`);
                    } else {
                        normalizedAxis.min = min;
                    }
                }
                if (axis.max !== undefined) {
                    const max = Number(axis.max);
                    if (Number.isNaN(max)) {
                        errors.push(`${axisKey}-axis maximum must be numeric`);
                    } else {
                        normalizedAxis.max = max;
                    }
                }
                normalizedAxes[axisKey] = normalizedAxis;
            });

            if (!Array.isArray(sanitized.targets) || sanitized.targets.length === 0) {
                errors.push('Audio surface requires at least one target parameter');
                break;
            }

            const normalizedTargets = sanitized.targets.map(target => {
                if (!target?.target || !mergedLimits[target.target]) {
                    errors.push(`Unknown parameter target for surface: ${target?.target}`);
                    return null;
                }
                const normalizedTarget = { target: target.target };

                const numericProps = ['base', 'xWeight', 'yWeight', 'xyWeight', 'bias', 'scale', 'offset'];
                numericProps.forEach(prop => {
                    if (target[prop] !== undefined) {
                        const value = Number(target[prop]);
                        if (Number.isNaN(value)) {
                            errors.push(`Surface target ${prop} must be numeric for ${target.target}`);
                        } else {
                            normalizedTarget[prop] = value;
                        }
                    }
                });

                if (target.smoothing !== undefined) {
                    const smoothing = Number(target.smoothing);
                    if (Number.isNaN(smoothing)) {
                        errors.push(`Surface target smoothing must be numeric for ${target.target}`);
                    } else {
                        normalizedTarget.smoothing = Math.min(Math.max(smoothing, 0), 0.95);
                    }
                }

                if (target.min !== undefined) {
                    const min = Number(target.min);
                    if (Number.isNaN(min)) {
                        errors.push(`Surface target minimum must be numeric for ${target.target}`);
                    } else {
                        normalizedTarget.min = min;
                    }
                }

                if (target.max !== undefined) {
                    const max = Number(target.max);
                    if (Number.isNaN(max)) {
                        errors.push(`Surface target maximum must be numeric for ${target.target}`);
                    } else {
                        normalizedTarget.max = max;
                    }
                }

                if (target.mode !== undefined) {
                    if (!AUDIO_MODES.has(target.mode)) {
                        errors.push(`Invalid surface mode for ${target.target}: ${target.mode}`);
                    } else {
                        normalizedTarget.mode = target.mode;
                    }
                }

                return normalizedTarget;
            }).filter(Boolean);

            if (normalizedTargets.length === 0) {
                errors.push('Audio surface requires at least one valid target');
            }

            sanitized.axes = normalizedAxes;
            sanitized.targets = normalizedTargets;
            sanitized.smoothing = sanitized.smoothing !== undefined ? Math.min(Math.max(Number(sanitized.smoothing), 0), 0.95) : undefined;
            sanitized.mode = sanitized.mode && AUDIO_MODES.has(sanitized.mode) ? sanitized.mode : undefined;
            sanitized.label = sanitized.label ? String(sanitized.label) : undefined;
            break;
        }
        case 'configureAudioStrategy': {
            const preset = String(sanitized.preset || '').toLowerCase();
            if (!AUDIO_STRATEGY_PRESETS.has(preset)) {
                errors.push(`Unknown audio strategy preset: ${sanitized.preset}`);
            } else {
                sanitized.preset = preset;
            }
            if (sanitized.keepExisting !== undefined) {
                sanitized.keepExisting = Boolean(sanitized.keepExisting);
            }
            break;
        }
        case 'removeAudioBinding': {
            if (!sanitized.bindingId && !sanitized.target && !sanitized.feature) {
                errors.push('Audio binding removal requires bindingId, target, or feature');
            }
            if (sanitized.bindingId !== undefined && sanitized.bindingId !== null) {
                sanitized.bindingId = String(sanitized.bindingId);
            }
            if (sanitized.target && !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
            }
            if (sanitized.feature && !AUDIO_FEATURES.has(sanitized.feature)) {
                errors.push(`Unknown audio feature: ${sanitized.feature}`);
            }
            break;
        }
        case 'removeAudioSurface': {
            if (!sanitized.surfaceId && !sanitized.target) {
                errors.push('Audio surface removal requires surfaceId or target');
            }
            if (sanitized.surfaceId !== undefined && sanitized.surfaceId !== null) {
                sanitized.surfaceId = String(sanitized.surfaceId);
            }
            if (sanitized.target && !mergedLimits[sanitized.target]) {
                errors.push(`Unknown parameter target: ${sanitized.target}`);
            }
            break;
        }
        case 'clearAudioBindings':
            break;
        default:
            errors.push(`Unsupported action: ${sanitized.action}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        intent: sanitized,
    };
}
