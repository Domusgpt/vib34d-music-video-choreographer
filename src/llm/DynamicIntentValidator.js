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
        default:
            errors.push(`Unsupported action: ${sanitized.action}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        intent: sanitized,
    };
}
