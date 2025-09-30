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
