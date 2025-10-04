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

const AUTOPILOT_SECTION_KEYWORDS = [
    { id: 'intro', keywords: ['intro', 'opening'] },
    { id: 'groove', keywords: ['groove', 'verse', 'pattern', 'flow'] },
    { id: 'peak', keywords: ['peak', 'chorus', 'drop', 'hook', 'climax'] },
    { id: 'break', keywords: ['break', 'outro', 'cooldown', 'breather'] },
    { id: 'transition', keywords: ['transition', 'bridge', 'build', 'riser'] },
];

const VISUALIZER_LAYER_KEYWORDS = {
    background: ['background', 'back', 'base', 'foundation', 'underlay'],
    shadow: ['shadow', 'depth', 'shade', 'under', 'sub'],
    content: ['content', 'core', 'main', 'primary'],
    highlight: ['highlight', 'shine', 'glow', 'beam', 'spot'],
    accent: ['accent', 'flare', 'spark', 'accent layer', 'top'],
};

const VISUALIZER_PROPERTY_KEYWORDS = {
    opacity: ['opacity', 'transparent', 'visibility', 'fade', 'dim', 'ghost', 'wash', 'mute', 'solo', 'spotlight'],
    intensity: ['intensity', 'brightness', 'glow', 'power', 'weight', 'strength', 'punch'],
    reactivity: ['reactivity', 'responsive', 'audio follow', 'sensitivity', 'reactive'],
};

const FRACTIONAL_ANCHOR_PARAMS = new Set(['intensity', 'chaos', 'saturation']);

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

function collectParameters(segment) {
    const candidates = new Set();
    const pieces = segment.split(/(?:\band\b|\bplus\b|\bwith\b|,|\/)/i);
    pieces.forEach(piece => {
        const param = matchParameter(piece);
        if (param) {
            candidates.add(param);
        }
    });

    const overall = matchParameter(segment);
    if (overall) {
        candidates.add(overall);
    }

    if (/color|colour|palette|chromatic/.test(segment)) {
        candidates.add('hue');
    }
    if (/thickness|line|grid|mesh/.test(segment)) {
        candidates.add('gridDensity');
    }

    return Array.from(candidates);
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

function listAudioFeatures(segment) {
    const normalized = normalize(segment);
    const found = new Set();
    Object.entries(AUDIO_FEATURE_KEYWORDS).forEach(([feature, keywords]) => {
        keywords.forEach(keyword => {
            if (normalized.includes(keyword)) {
                found.add(feature);
            }
        });
    });
    const resolved = LLMAudioChoreographer.resolveFeatureName?.(normalized);
    if (resolved) {
        found.add(resolved);
    }
    return Array.from(found);
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

function matchVisualizerLayer(segment) {
    const normalized = normalize(segment);
    for (const [layer, keywords] of Object.entries(VISUALIZER_LAYER_KEYWORDS)) {
        if (keywords.some(keyword => normalized.includes(keyword))) {
            return layer;
        }
    }
    return null;
}

function matchVisualizerProperty(segment) {
    const normalized = normalize(segment);
    for (const [property, keywords] of Object.entries(VISUALIZER_PROPERTY_KEYWORDS)) {
        if (keywords.some(keyword => normalized.includes(keyword))) {
            return property;
        }
    }
    if (/dim|fade|spotlight|focus|solo/.test(normalized)) {
        return 'opacity';
    }
    if (/glow|bright|shine/.test(normalized)) {
        return 'intensity';
    }
    if (/reactive|follow/.test(normalized)) {
        return 'reactivity';
    }
    return null;
}

function parseVisualizerModulation(segment) {
    const layer = matchVisualizerLayer(segment);
    if (!layer) return null;

    const property = matchVisualizerProperty(segment) || 'opacity';
    const explicitMatch = segment.match(/(?:to|at|around|=)\s*(-?\d+(?:\.\d+)?)(%?)/i);
    const percentMatch = explicitMatch?.[2] === '%' ? explicitMatch : segment.match(/(-?\d+(?:\.\d+)?)\s*%/);
    let value = null;

    if (explicitMatch) {
        value = parseFloat(explicitMatch[1]);
        if (explicitMatch[2] === '%') {
            value /= 100;
        }
    } else if (percentMatch) {
        value = parseFloat(percentMatch[1]) / 100;
    }

    const normalized = normalize(segment);
    if (value === null) {
        if (/kill|mute|zero|cut/.test(normalized)) {
            value = property === 'reactivity' ? 0.15 : 0;
        } else if (/dim|fade|lower|soften|ghost/.test(normalized)) {
            value = property === 'reactivity' ? 0.6 : 0.35;
        } else if (/spotlight|focus|solo|feature|max|boost|brighten|crank/.test(normalized)) {
            value = property === 'reactivity' ? 1.2 : 0.95;
        }
    }

    if (value === null) {
        return null;
    }

    if (property !== 'reactivity' && value > 1.5) {
        value = value / 100;
    }

    if (property === 'reactivity' && /%/.test(segment) && value <= 1) {
        value = Math.max(0.1, value * 2.5);
    }

    return {
        action: 'setVisualizerModulation',
        layer,
        property,
        value,
    };
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

function parseAudioSurface(segment) {
    if (!/(surface|matrix|plane|grid|field|map|x\s*-\s*y|xy|x axis|y axis|coordinate)/i.test(segment)) {
        return null;
    }

    const normalized = normalize(segment);
    const axisSlice = pattern => {
        const match = segment.match(pattern);
        return match ? match[0] : segment;
    };

    const features = listAudioFeatures(segment);
    const xHintText = axisSlice(/(?:x(?:\s*axis)?|horizontal|width|sideways|pan)[^.;\n]*/i);
    const yHintText = axisSlice(/(?:y(?:\s*axis)?|vertical|height|rise|lift|tilt)[^.;\n]*/i);
    let xFeature = detectAudioFeature(xHintText);
    let yFeature = detectAudioFeature(yHintText);

    const vsParts = segment.split(/\bvs\b|\bversus\b/i);
    if ((!xFeature || !yFeature) && vsParts.length >= 2) {
        if (!xFeature) xFeature = detectAudioFeature(vsParts[0]);
        if (!yFeature) yFeature = detectAudioFeature(vsParts[1]);
    }

    if (!xFeature && features.length > 0) {
        xFeature = features[0];
    }
    if (!yFeature) {
        const remaining = features.filter(feature => feature !== xFeature);
        yFeature = remaining[0];
    }

    if (!yFeature && xFeature) {
        yFeature = xFeature === 'energy' ? 'transient' : 'energy';
    }

    if (!xFeature || !yFeature) {
        return null;
    }

    const axisTransformFromText = text => {
        if (/gentle|smooth|glide|soft/i.test(text)) return 'sqrt';
        if (/sharp|punch|hard|slam/i.test(text)) return 'square';
        if (/wild|extreme|insane|chaotic/i.test(text)) return 'cube';
        if (/threshold|gate|binary|switch/i.test(text)) return 'logistic';
        return 'linear';
    };

    const axisInvert = (text, axisLabel) => {
        if (axisLabel === 'x' && /invert|flip|mirror.*(?:x|horizontal)/i.test(text)) return true;
        if (axisLabel === 'y' && /invert|flip|mirror.*(?:y|vertical)/i.test(text)) return true;
        return false;
    };

    const axisNumeric = (text, keyword) => {
        const regex = new RegExp(`${keyword}\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
        const match = text.match(regex);
        return match ? parseFloat(match[1]) : undefined;
    };

    const buildAxis = (feature, label, hintText) => {
        const axisText = hintText || segment;
        const axis = {
            feature,
            transform: axisTransformFromText(axisText),
            invert: axisInvert(axisText, label) || axisInvert(segment, label),
        };
        const scale = axisNumeric(axisText, '(?:scale|spread|range)');
        if (scale !== undefined && !Number.isNaN(scale)) axis.scale = scale;
        const offset = axisNumeric(axisText, '(?:offset|bias|shift)');
        if (offset !== undefined && !Number.isNaN(offset)) axis.offset = offset;
        const minMatch = axisNumeric(axisText, 'min(?:imum)?');
        if (minMatch !== undefined && !Number.isNaN(minMatch)) axis.min = minMatch;
        const maxMatch = axisNumeric(axisText, 'max(?:imum)?');
        if (maxMatch !== undefined && !Number.isNaN(maxMatch)) axis.max = maxMatch;
        return axis;
    };

    const axes = {
        x: buildAxis(xFeature, 'x', xHintText),
        y: buildAxis(yFeature, 'y', yHintText),
    };

    const parameters = collectParameters(segment);
    if (parameters.length === 0) {
        parameters.push('intensity');
    }

    const smoothing = /snappy|tight|immediate|crisp/i.test(normalized)
        ? 0.18
        : /drift|wash|float|slow|glide/i.test(normalized)
        ? 0.7
        : 0.38;

    const xWeightHeavy = /(x|horizontal).*?(lead|dominate|focus|primary|heavier)/i.test(segment) ? 0.85 : 0.6;
    const yWeightHeavy = /(y|vertical).*?(lead|dominate|focus|primary|heavier)/i.test(segment) ? 0.85 : 0.6;
    const crossWeight = /diagonal|blend|fusion|cross|interaction/i.test(normalized) ? 0.75 : 0.45;
    const additive = /(accent|punch|boost|slam|impact|burst|push)/i.test(normalized);

    const targets = parameters.map((target, index) => {
        const limits = DEFAULT_AUDIO_LIMITS[target];
        const base = limits ? (limits.min + limits.max) / 2 : 0;
        const scale = DEFAULT_AUDIO_SCALES[target] ?? (limits ? (limits.max - limits.min) * 0.5 : 1);
        const xWeight = index === 0 ? xWeightHeavy : Math.max(0.35, xWeightHeavy - 0.2);
        const yWeight = index === 0 ? yWeightHeavy : Math.max(0.35, yWeightHeavy - 0.1);
        const xyWeight = index === 0 ? crossWeight : Math.max(0.25, crossWeight - 0.15);
        return {
            target,
            base,
            xWeight,
            yWeight,
            xyWeight,
            scale,
            smoothing,
            mode: additive ? 'additive' : 'absolute',
            ...(limits ? { min: limits.min, max: limits.max } : {}),
        };
    });

    const label = `${xFeature.toUpperCase()}↔${yFeature.toUpperCase()}`;

    return {
        action: 'bindAudioSurface',
        axes,
        targets,
        smoothing,
        mode: additive ? 'additive' : 'absolute',
        label,
    };
}

function parseAudioRemoval(segment) {
    if (!/(remove|clear|stop|drop|cut off|kill)/i.test(segment)) {
        return null;
    }

    const wantsSurface = /(surface|matrix|plane|grid|field|map)/i.test(segment);
    const wantsAudio = /(audio|beat|bass|react|mapping|link)/i.test(segment);

    if (!wantsSurface && !wantsAudio) {
        return null;
    }

    if (/remove all|clear all|reset audio|kill audio react|clear surfaces/i.test(segment)) {
        return { action: 'clearAudioBindings' };
    }

    if (wantsSurface) {
        const target = matchParameter(segment);
        const surfaceIdMatch = segment.match(/surface\s+([a-z0-9_-]+)/i);
        const payload = { action: 'removeAudioSurface' };
        if (surfaceIdMatch) {
            payload.surfaceId = surfaceIdMatch[1];
        }
        if (target) {
            payload.target = target;
        }
        return payload;
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

function parseAudioStrategy(segment) {
    const strategyHint = /(strategy|program|preset|arrangement|auto|verse|chorus|section|bridge|plan|balanced reactive)/i;
    if (!strategyHint.test(segment)) {
        return null;
    }

    const normalized = normalize(segment);
    let preset = null;

    const mentionsBass = /bass/.test(normalized);
    const mentionsDensity = /(density|grid|mesh|lines|thickness|structure)/.test(normalized);
    const mentionsColor = /(color|colour|hue|palette|tone|light)/.test(normalized);
    const mentionsSections = /(verse|chorus|bridge|drop|break|section|arrangement|part)/.test(normalized);
    const mentionsAuto = /(auto|smart|dynamic|adaptive).*(audio|react|music|map)/.test(normalized);

    if (mentionsSections) {
        preset = 'section-contrast';
    }
    if (!preset && mentionsBass && mentionsDensity) {
        preset = 'bass-density';
    }
    if (!preset && mentionsBass && mentionsColor) {
        preset = 'bass-color';
    }
    if (!preset && mentionsAuto) {
        preset = 'balanced-reactive';
    }
    if (!preset && /balanced reactive/.test(normalized)) {
        preset = 'balanced-reactive';
    }

    if (!preset) {
        return null;
    }

    const keepExisting = /(keep|layer|blend|add|stack|plus)/i.test(segment) && !/(reset|replace|clear|wipe)/i.test(segment);
    const intent = { action: 'configureAudioStrategy', preset };
    if (keepExisting) {
        intent.keepExisting = true;
    }
    return intent;
}

function parseAutopilotControl(segment) {
    if (!segment) return null;
    const autopilotHint = /(auto\s*-?pilot|co\s*-?pilot|pilot\s*assist|assistant\s*pilot)/i;
    if (!autopilotHint.test(segment)) {
        return null;
    }

    const normalized = normalize(segment);
    const wantsEnable = /(enable|resume|start|activate|engage|turn on|wake)/i.test(segment);
    const wantsDisable = /(disable|pause|stop|kill|turn off|shut|park|suspend|halt)/i.test(segment);
    const wantsToggle = /(toggle|switch)/i.test(segment);

    const programMatchers = [
        { id: 'beat-pulse', regex: /(beat|pulse|kick|thump|downbeat)/i },
        { id: 'energy-swell', regex: /(energy|swell|surge|lull|overall)/i },
        { id: 'bass-density', regex: /(bass|density|grid|lines|thick|structure)/i },
        { id: 'section-mood', regex: /(section|verse|chorus|bridge|drop|transition|mood)/i },
    ];

    const matchedProgram = programMatchers.find(entry => entry.regex.test(normalized));
    const intent = { action: 'setAutopilotState' };

    if (matchedProgram) {
        if (wantsToggle && !wantsEnable && !wantsDisable) {
            return {
                action: 'setAutopilotState',
                programId: matchedProgram.id,
                programToggle: true,
            };
        }
        if (wantsEnable === wantsDisable && !wantsToggle) {
            return null;
        }
        intent.programId = matchedProgram.id;
        if (wantsDisable && !wantsEnable) {
            intent.programEnabled = false;
            return intent;
        }
        if (wantsEnable && !wantsDisable) {
            intent.programEnabled = true;
            return intent;
        }
        return null;
    }

    if (wantsToggle && !wantsEnable && !wantsDisable) {
        return { action: 'setAutopilotState', toggle: true };
    }

    if (wantsEnable === wantsDisable) {
        return null;
    }

    intent.enabled = wantsEnable && !wantsDisable;
    if (wantsDisable && !wantsEnable) {
        intent.enabled = false;
    }

    return intent;
}

function resolveAutopilotSection(segment) {
    if (!segment) return null;
    const normalized = normalize(segment);
    for (const entry of AUTOPILOT_SECTION_KEYWORDS) {
        if (entry.keywords.some(keyword => normalized.includes(keyword))) {
            return entry.id;
        }
    }
    return null;
}

function parseAutopilotSectionCommand(segment) {
    if (!segment) return null;
    if (!/(auto\s*-?pilot|co\s*-?pilot|pilot\s*assist|assistant\s*pilot)/i.test(segment)) {
        return null;
    }

    const normalized = normalize(segment);
    const section = resolveAutopilotSection(normalized);
    if (!section) {
        return null;
    }

    const wantsClear = /(clear|reset|remove|forget|wipe|drop)/i.test(normalized);
    const wantsSnapshot = /(learn|remember|capture|adopt|copy|match|use current|from now|based on now|record)/i.test(normalized);
    const paletteCue = /(palette|profile|program|plan|mood|treatment|recipe|scheme|vibe|map)/i.test(normalized);
    const applyCue = /(set|dial|drive|push|target|tune|bias|align|steer)/i.test(normalized);

    if (!paletteCue && !wantsSnapshot && !wantsClear && !applyCue) {
        return null;
    }

    if (wantsClear) {
        return { action: 'clearAutopilotSection', section };
    }

    const durationMatch = segment.match(/over\s*(\d+(?:\.\d+)?)\s*(?:sec|second|seconds|s)/i);
    const duration = durationMatch ? Number(durationMatch[1]) : undefined;

    let easing;
    if (/ease in out|smooth|gentle|glide/i.test(normalized)) {
        easing = 'easeInOut';
    } else if (/ease in|fade in|ramp in|swell in/i.test(normalized)) {
        easing = 'easeIn';
    } else if (/ease out|fade out|release/i.test(normalized)) {
        easing = 'easeOut';
    } else if (/linear|direct|immediate/i.test(normalized)) {
        easing = 'linear';
    }

    const parameters = [];
    const seen = new Set();
    const parameterNames = collectParameters(normalized);
    parameterNames.forEach(param => {
        const value = parseAnchorValue(segment, param);
        if (value === null || seen.has(param)) {
            return;
        }
        const entry = { parameter: param, value };
        if (duration !== undefined) {
            entry.duration = duration;
        }
        if (easing) {
            entry.easing = easing;
        }
        seen.add(param);
        parameters.push(entry);
    });

    const colorHue = parseColorKeyword(normalized);
    if (colorHue !== null && !seen.has('hue')) {
        const entry = { parameter: 'hue', value: colorHue };
        if (duration !== undefined) {
            entry.duration = duration;
        }
        if (easing) {
            entry.easing = easing;
        }
        parameters.push(entry);
    }

    const labelMatch = segment.match(/(?:as|called|label(?:led)?|name(?:d)?)\s+([^,.;]+)/i);
    const label = labelMatch ? labelMatch[1].replace(/['"]+/g, '').trim() : undefined;

    if (!parameters.length && !wantsSnapshot) {
        if (!paletteCue) {
            return null;
        }
    }

    const intent = { action: 'configureAutopilotSection', section };
    if (parameters.length) {
        intent.parameters = parameters;
    }
    if (label) {
        intent.label = label;
    }
    if (wantsSnapshot || (!parameters.length && paletteCue)) {
        intent.snapshot = true;
    }

    return intent;
}

function parseAnchorValue(segment, parameter) {
    if (!segment) return null;
    const percentMatch = segment.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch && FRACTIONAL_ANCHOR_PARAMS.has(parameter)) {
        const percent = Number(percentMatch[1]);
        if (!Number.isNaN(percent)) {
            return percent / 100;
        }
    }
    if (parameter === 'hue') {
        const hueMatch = segment.match(/(\d+(?:\.\d+)?)\s*(?:deg|degree|°)/i);
        if (hueMatch) {
            const hue = Number(hueMatch[1]);
            if (!Number.isNaN(hue)) {
                return hue;
            }
        }
    }
    const numericMatch = segment.match(/(?:to|at|=)\s*(-?\d+(?:\.\d+)?)/i);
    if (numericMatch) {
        const value = Number(numericMatch[1]);
        if (!Number.isNaN(value)) {
            return value;
        }
    }
    return null;
}

function parseAutopilotAnchorCommand(segment) {
    if (!segment) return null;
    const anchorHint = /(anchor|baseline|lock|pin|capture|remember|release|clear|reset|forget|hold)/i;
    if (!anchorHint.test(segment)) {
        return null;
    }
    if (!/(auto\s*-?pilot|co\s*-?pilot|pilot\b|assistant\s*pilot)/i.test(segment)) {
        return null;
    }

    const normalized = normalize(segment);
    const parameters = collectParameters(normalized);
    const primaryParam = parameters[0];
    const numericValue = primaryParam ? parseAnchorValue(normalized, primaryParam) : null;
    const wantsClear = /(clear|reset|release|forget|remove|drop|wipe|unset)/i.test(normalized);
    const wantsCapture = /(capture|remember|lock|pin|hold|save|store|keep)/i.test(normalized);
    const wantsSet = /(set|assign|target|bias|calibrate)/i.test(normalized);

    if (wantsClear) {
        const intent = { action: 'clearAutopilotAnchors' };
        if (parameters.length > 0 && !/(all|everything|every baseline)/i.test(normalized)) {
            intent.parameters = parameters;
        }
        return intent;
    }

    if ((wantsSet || numericValue !== null) && parameters.length > 0) {
        const intent = { action: 'setAutopilotAnchor', parameter: primaryParam };
        if (numericValue !== null) {
            intent.value = numericValue;
        }
        if (/(lock|pin|hold)/i.test(normalized)) {
            intent.locked = true;
        }
        return intent;
    }

    if (wantsCapture) {
        const intent = { action: 'captureAutopilotAnchors' };
        if (parameters.length > 0) {
            intent.parameters = parameters;
        }
        return intent;
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
            const clearAudio = parseAudioRemoval(segment);
            if (clearAudio) {
                intents.push(clearAudio);
                if (clearAudio.action === 'clearAudioBindings') {
                    notes.push('Audio bindings cleared');
                } else if (clearAudio.action === 'removeAudioSurface') {
                    notes.push('Audio surface removal requested');
                } else {
                    notes.push('Audio binding removal requested');
                }
                return;
            }

            const audioStrategy = parseAudioStrategy(segment);
            if (audioStrategy) {
                intents.push(audioStrategy);
                notes.push(`Audio strategy parsed → ${audioStrategy.preset}`);
                return;
            }

            const autopilotSection = parseAutopilotSectionCommand(segment);
            if (autopilotSection) {
                intents.push(autopilotSection);
                if (autopilotSection.action === 'clearAutopilotSection') {
                    notes.push(`Autopilot section palette cleared → ${autopilotSection.section}`);
                } else {
                    notes.push(
                        autopilotSection.snapshot && !autopilotSection.parameters?.length
                            ? `Autopilot section palette learned → ${autopilotSection.section}`
                            : `Autopilot section palette set → ${autopilotSection.section}`,
                    );
                }
                return;
            }

            const autopilotAnchor = parseAutopilotAnchorCommand(segment);
            if (autopilotAnchor) {
                intents.push(autopilotAnchor);
                if (autopilotAnchor.action === 'captureAutopilotAnchors') {
                    notes.push(
                        autopilotAnchor.parameters?.length
                            ? `Autopilot anchors captured → ${autopilotAnchor.parameters.join(', ')}`
                            : 'Autopilot anchors captured',
                    );
                } else if (autopilotAnchor.action === 'clearAutopilotAnchors') {
                    notes.push(
                        autopilotAnchor.parameters?.length
                            ? `Autopilot anchors cleared → ${autopilotAnchor.parameters.join(', ')}`
                            : 'Autopilot anchors cleared',
                    );
                } else if (autopilotAnchor.action === 'setAutopilotAnchor') {
                    notes.push(
                        autopilotAnchor.value !== undefined
                            ? `Autopilot anchor set → ${autopilotAnchor.parameter} @ ${autopilotAnchor.value}`
                            : `Autopilot anchor set → ${autopilotAnchor.parameter}`,
                    );
                }
                return;
            }

            const autopilotControl = parseAutopilotControl(segment);
            if (autopilotControl) {
                intents.push(autopilotControl);
                if (autopilotControl.programId) {
                    if (autopilotControl.programToggle) {
                        notes.push(`Autopilot program toggle → ${autopilotControl.programId}`);
                    } else {
                        notes.push(
                            `Autopilot program ${autopilotControl.programEnabled ? 'enabled' : 'paused'} → ${autopilotControl.programId}`,
                        );
                    }
                } else if (typeof autopilotControl.enabled === 'boolean') {
                    notes.push(`Autopilot ${autopilotControl.enabled ? 'resumed' : 'paused'}`);
                } else if (autopilotControl.toggle) {
                    notes.push('Autopilot toggle requested');
                }
                return;
            }

            const audioSurface = parseAudioSurface(segment);
            if (audioSurface) {
                intents.push(audioSurface);
                notes.push(`Audio surface parsed ${audioSurface.axes.x.feature}/${audioSurface.axes.y.feature}`);
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
            const visualizerModulation = parseVisualizerModulation(segment);
            if (visualizerModulation) {
                intents.push(visualizerModulation);
                notes.push(`Layer modulation parsed → ${visualizerModulation.layer}.${visualizerModulation.property}`);
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
