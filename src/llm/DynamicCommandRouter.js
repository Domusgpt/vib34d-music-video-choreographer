import { LLMAudioChoreographer } from './LLMAudioChoreographer.js';

const PARAM_SYNONYMS = {
    chaos: ['chaos', 'energy', 'wildness', 'intensity', 'randomness', 'frenzy'],
    speed: ['speed', 'tempo', 'pace', 'movement', 'motion'],
    hue: ['hue', 'color', 'colour', 'palette', 'tone'],
    saturation: ['saturation', 'vibrancy', 'color depth'],
    intensity: ['intensity', 'brightness', 'power', 'amplitude'],
    morphFactor: ['morph', 'shape', 'geometry morph', 'morph factor', 'shape shift'],
    gridDensity: ['density', 'detail', 'grid', 'resolution'],
    dimension: ['dimension', 'dimensionality', 'depth'],
    rot4dXW: ['xw', 'x-w', 'xw rotation', 'tilt xw'],
    rot4dYW: ['yw', 'y-w', 'yw rotation', 'tilt yw'],
    rot4dZW: ['zw', 'z-w', 'zw rotation', 'tilt zw'],
};

const MOOD_KEYWORDS = {
    calm: ['calm', 'ambient', 'chill', 'downtempo', 'breathe'],
    hype: ['hype', 'drop', 'intense', 'explode', 'go crazy', 'max energy'],
    neon: ['neon', 'cyber', 'laser', 'cyberpunk', 'ultraviolet'],
    warm: ['warm', 'sunset', 'golden', 'fire', 'ember'],
};

const COLOR_KEYWORDS = {
    blue: 200,
    teal: 170,
    cyan: 190,
    green: 120,
    lime: 90,
    yellow: 50,
    orange: 30,
    red: 0,
    magenta: 320,
    purple: 280,
    violet: 270,
    pink: 330,
};

const AUDIO_FEATURE_KEYWORDS = {
    bass: ['bass', 'low end', 'kick', 'sub', '808', 'low freq'],
    mid: ['mid', 'midrange', 'body', 'chords', 'pads'],
    high: ['high', 'treble', 'top', 'air', 'hi hat', 'hihat', 'sparkle'],
    energy: ['energy', 'overall level', 'volume', 'loudness', 'intensity'],
    beat: ['beat', 'beats', 'downbeat', 'pulse', 'on beat', 'rhythm hits'],
    transient: ['transient', 'attacks', 'snare', 'impact', 'punch'],
    spectralCentroid: ['brightness', 'brighter', 'tone height', 'shimmer'],
};

const DEFAULT_AUDIO_SCALES = {
    chaos: 0.65,
    speed: 0.85,
    hue: 320,
    intensity: 0.55,
    saturation: 0.45,
    morphFactor: 0.6,
    gridDensity: 42,
};

const DEFAULT_AUDIO_LIMITS = {
    hue: { min: 0, max: 360 },
    saturation: { min: 0, max: 1 },
    intensity: { min: 0, max: 1 },
    morphFactor: { min: 0, max: 2 },
    gridDensity: { min: 6, max: 100 },
    chaos: { min: 0, max: 1 },
    speed: { min: 0.1, max: 3 },
};

function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchParameter(segment) {
    const normalized = normalize(segment);
    const entries = Object.entries(PARAM_SYNONYMS);
    for (const [param, synonyms] of entries) {
        if (synonyms.some(word => normalized.includes(word))) {
            return param;
        }
    }
    return null;
}

function detectMood(text) {
    const normalized = normalize(text);
    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
        if (keywords.some(keyword => normalized.includes(keyword))) {
            return mood;
        }
    }
    return null;
}

function parseFadeCommand(segment) {
    const fadeRegex = /(fade|ramp|sweep|blend|slide)\s+([a-z\s-]+?)\s+from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s+over\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/;
    const match = segment.match(fadeRegex);
    if (!match) return null;
    const [, , paramText, fromValue, toValue, duration] = match;
    const target = matchParameter(paramText);
    if (!target) return null;
    return {
        action: 'scheduleEnvelope',
        target,
        from: parseFloat(fromValue),
        to: parseFloat(toValue),
        duration: parseFloat(duration),
        easing: segment.includes('ease') ? 'easeInOut' : 'linear',
    };
}

function parseSetCommand(segment) {
    const setRegex = /(set|lock|hold|fix|make)\s+([a-z\s-]+?)\s+(?:to|at|around)\s+(-?\d+(?:\.\d+)?)/;
    const match = segment.match(setRegex);
    if (!match) return null;
    const [, , paramText, value] = match;
    const target = matchParameter(paramText);
    if (!target) return null;
    return {
        action: 'setParameter',
        target,
        value: parseFloat(value),
    };
}

function parseAdjustCommand(segment) {
    const adjustRegex = /(increase|raise|boost|decrease|lower|drop|reduce)\s+([a-z\s-]+?)(?:\s+by\s+(-?\d+(?:\.\d+)?))?(?:\s*(?:more|less))?/;
    const match = segment.match(adjustRegex);
    if (!match) return null;
    const [, verb, paramText, value] = match;
    const target = matchParameter(paramText);
    if (!target) return null;
    const magnitude = value ? parseFloat(value) : 0.1;
    const sign = ['decrease', 'lower', 'drop', 'reduce'].includes(verb) ? -1 : 1;
    return {
        action: 'adjustParameter',
        target,
        delta: magnitude * sign,
    };
}

function parseColorKeyword(text) {
    const normalized = normalize(text);
    for (const [keyword, hue] of Object.entries(COLOR_KEYWORDS)) {
        if (normalized.includes(keyword)) {
            return hue;
        }
    }
    return null;
}

function parseVariationCommand(segment) {
    const match = segment.match(/variation\s+(\d{1,3})/);
    if (!match) return null;
    const index = parseInt(match[1], 10) - 1;
    if (Number.isNaN(index)) return null;
    return {
        action: 'setVariation',
        value: index,
    };
}

function parseStateQuery(segment) {
    if (/status|state|how are we|where are we/.test(segment)) {
        return { action: 'queryState' };
    }
    return null;
}

function detectAudioFeature(segment) {
    const normalized = normalize(segment);
    for (const [feature, keywords] of Object.entries(AUDIO_FEATURE_KEYWORDS)) {
        if (keywords.some(keyword => normalized.includes(keyword))) {
            return feature;
        }
    }
    const resolved = LLMAudioChoreographer.resolveFeatureName?.(normalized);
    return resolved || null;
}

function parseAudioBinding(segment) {
    const feature = detectAudioFeature(segment);
    if (!feature) return null;

    let target = matchParameter(segment);
    if (!target) {
        if (/color|colour|palette|chromatic/.test(segment)) {
            target = 'hue';
        } else if (/thickness|line|grid|mesh/.test(segment)) {
            target = 'gridDensity';
        }
    }
    if (!target) return null;

    const normalized = normalize(segment);
    let mode = normalized.match(/pulse|pump|bump|nudge|accent|push|slam|hit/) ? 'additive' : 'absolute';
    if (/hold|lock|pin|stick/.test(normalized)) {
        mode = 'absolute';
    }

    let scale = DEFAULT_AUDIO_SCALES[target] ?? 1;
    const numberMatch = segment.match(/(?:by|with|at|range(?: of)?|swing(?: of)?|amount(?: of)?|scale(?: of)?)\s*(-?\d+(?:\.\d+)?)/i);
    if (numberMatch) {
        scale = parseFloat(numberMatch[1]);
        if (target === 'hue' && scale <= 3) {
            scale *= 90;
        }
    } else if (feature === 'beat' && mode === 'additive') {
        scale = 0.45;
    } else if (feature === 'beat' && mode === 'absolute') {
        scale = 1;
    }

    let offset;
    if (/center at\s*(-?\d+(?:\.\d+)?)/i.test(segment)) {
        offset = parseFloat(segment.match(/center at\s*(-?\d+(?:\.\d+)?)/i)[1]);
    } else if (target === 'hue' && mode === 'absolute' && /cool|blue|cyan/.test(normalized)) {
        offset = 180;
    } else if (target === 'hue' && mode === 'absolute' && /warm|sunset|red|orange|gold/.test(normalized)) {
        offset = 40;
    }

    let smoothing;
    if (/snappy|tight|immediate|rapid|on the beat|direct/.test(normalized)) {
        smoothing = 0.1;
    } else if (/slow|gradual|wash|float|drift|long/.test(normalized)) {
        smoothing = 0.75;
    }

    let transform = 'linear';
    if (/square|punch|hard/.test(normalized)) {
        transform = 'square';
    } else if (/gentle|soft|feather|light/.test(normalized)) {
        transform = 'sqrt';
    } else if (/wild|extreme|explode|insane/.test(normalized)) {
        transform = 'cube';
    }

    const invert = /invert|reverse|flip|mirror/.test(normalized);

    let min;
    let max;
    const rangeMatch = segment.match(/between\s*(-?\d+(?:\.\d+)?)\s*and\s*(-?\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
        min = parseFloat(rangeMatch[1]);
        max = parseFloat(rangeMatch[2]);
    }
    const capMatch = segment.match(/cap(?:ped)?\s*(?:at)?\s*(-?\d+(?:\.\d+)?)/i);
    if (capMatch) {
        max = parseFloat(capMatch[1]);
    }
    const floorMatch = segment.match(/floor(?:ed)?\s*(?:at)?\s*(-?\d+(?:\.\d+)?)/i);
    if (floorMatch) {
        min = parseFloat(floorMatch[1]);
    }

    if (!rangeMatch && DEFAULT_AUDIO_LIMITS[target]) {
        min = min ?? DEFAULT_AUDIO_LIMITS[target].min;
        max = max ?? DEFAULT_AUDIO_LIMITS[target].max;
    }

    const intent = {
        action: 'bindAudioFeature',
        feature,
        target,
        mode,
        scale,
        transform,
        invert,
    };

    if (offset !== undefined) intent.offset = offset;
    if (smoothing !== undefined) intent.smoothing = smoothing;
    if (min !== undefined) intent.min = min;
    if (max !== undefined) intent.max = max;

    return intent;
}

function parseAudioRemoval(segment) {
    if (!/(remove|clear|stop|drop|cut off|kill).*(audio|beat|bass|react|mapping|link)/i.test(segment)) {
        return null;
    }
    if (/remove all|clear all|reset audio|kill audio react/i.test(segment)) {
        return { action: 'clearAudioBindings' };
    }

    const feature = detectAudioFeature(segment);
    let target = matchParameter(segment);
    if (!target && /color|colour|palette/.test(segment)) {
        target = 'hue';
    } else if (!target && /grid|line|mesh|thickness/.test(segment)) {
        target = 'gridDensity';
    }

    if (!feature && !target) {
        return { action: 'clearAudioBindings' };
    }

    return {
        action: 'removeAudioBinding',
        ...(feature ? { feature } : {}),
        ...(target ? { target } : {}),
    };
}

export class LLMCommandRouter {
    constructor(options = {}) {
        this.options = {
            defaultEnvelopeDuration: 6,
            ...options,
        };
    }

    processPrompt(prompt) {
        const normalized = normalize(prompt);
        if (!normalized) {
            return { intents: [], summary: 'No prompt provided.' };
        }

        const intents = [];
        const notes = [];

        const mood = detectMood(normalized);
        if (mood) {
            intents.push({ action: 'applyMood', moodId: mood });
            notes.push(`Mood detected → ${mood}`);
        }

        const colorHue = parseColorKeyword(normalized);
        if (colorHue !== null) {
            intents.push({ action: 'scheduleEnvelope', target: 'hue', to: colorHue, duration: this.options.defaultEnvelopeDuration });
            notes.push(`Color keyword detected → hue ${colorHue}`);
        }

        const segments = normalized.split(/(?:,| and | then |\n|;)/).map(seg => seg.trim()).filter(Boolean);
        segments.forEach(segment => {
            const clearAudio = parseAudioRemoval(segment);
            if (clearAudio) {
                intents.push(clearAudio);
                if (clearAudio.action === 'clearAudioBindings') {
                    notes.push('Audio bindings cleared');
                } else {
                    notes.push('Audio binding removal requested');
                }
                return;
            }

            const audioBinding = parseAudioBinding(segment);
            if (audioBinding) {
                intents.push(audioBinding);
                notes.push(`Audio binding parsed ${audioBinding.feature} → ${audioBinding.target}`);
                return;
            }
            const fade = parseFadeCommand(segment);
            if (fade) {
                intents.push(fade);
                notes.push(`Fade command parsed for ${fade.target}`);
                return;
            }
            const setCmd = parseSetCommand(segment);
            if (setCmd) {
                intents.push(setCmd);
                notes.push(`Set command parsed for ${setCmd.target}`);
                return;
            }
            const adjustCmd = parseAdjustCommand(segment);
            if (adjustCmd) {
                intents.push(adjustCmd);
                notes.push(`Adjust command parsed for ${adjustCmd.target}`);
                return;
            }
            const variation = parseVariationCommand(segment);
            if (variation) {
                intents.push(variation);
                notes.push(`Variation command parsed → ${variation.value + 1}`);
                return;
            }
            const stateQuery = parseStateQuery(segment);
            if (stateQuery) {
                intents.push(stateQuery);
                notes.push('State query detected');
            }
        });

        if (intents.length === 0) {
            notes.push('No explicit commands detected; applying ambient tweak.');
            intents.push({ action: 'adjustParameter', target: 'chaos', delta: 0.05 });
            intents.push({ action: 'adjustParameter', target: 'speed', delta: 0.05 });
        }

        return {
            intents,
            summary: notes.join(' | '),
        };
    }
}
