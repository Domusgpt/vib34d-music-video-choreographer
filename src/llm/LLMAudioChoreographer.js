const FEATURE_ALIASES = {
    bass: ['bass', 'low', 'kick', 'sub'],
    mid: ['mid', 'midrange', 'body'],
    high: ['high', 'treble', 'top', 'air'],
    energy: ['energy', 'overall', 'loudness', 'intensity'],
    beat: ['beat', 'beats', 'downbeat', 'pulse'],
    transient: ['transient', 'attack', 'impact', 'hit'],
    spectralCentroid: ['centroid', 'brightness'],
};

function clamp(value, min, max) {
    if (min === undefined && max === undefined) return value;
    let next = value;
    if (typeof min === 'number') {
        next = Math.max(min, next);
    }
    if (typeof max === 'number') {
        next = Math.min(max, next);
    }
    return next;
}

function lerp(current, next, smoothing) {
    if (smoothing === undefined) return next;
    return current + (next - current) * (1 - Math.max(0, Math.min(1, smoothing)));
}

export class LLMAudioChoreographer {
    constructor(dynamicEngine, options = {}) {
        this.dynamicEngine = dynamicEngine;
        this.parameterManager = dynamicEngine?.parameterManager || null;
        this.options = {
            fftSize: 2048,
            smoothingTimeConstant: 0.8,
            featureSmoothing: 0.55,
            beatHoldMs: 260,
            beatThreshold: 1.35,
            minBeatIntervalMs: 190,
            bindingSmoothing: 0.35,
            ...options,
        };

        this.audioElement = null;
        this.audioContext = null;
        this.analyser = null;
        this.frequencyData = null;
        this.timeDomainData = null;
        this.sourceNode = null;
        this.currentTrackUrl = null;
        this.currentTrackName = null;
        this.microphoneStream = null;
        this.microphoneSource = null;
        this.usingMicrophone = false;

        this.features = {
            bass: 0,
            mid: 0,
            high: 0,
            energy: 0,
            rms: 0,
            spectralCentroid: 0,
            transient: 0,
            beat: 0,
            beatStrength: 0,
            section: 'idle',
            sectionConfidence: 0,
        };

        this.featureBindings = [];
        this.energyHistory = new Float32Array(256);
        this.energyIndex = 0;
        this.lastBeatAt = 0;
        this.lastFeaturesEmit = 0;
        this.featureSurfaces = [];
        this.listeners = { features: [], bindings: [], surfaces: [], log: [] };
    }

    async ensureAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    setupAnalyser() {
        if (this.analyser) {
            try { this.analyser.disconnect(); } catch (_) { /* noop */ }
        }
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.options.fftSize;
        this.analyser.smoothingTimeConstant = this.options.smoothingTimeConstant;
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeDomainData = new Float32Array(this.analyser.fftSize);
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        return () => {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        };
    }

    emit(event, payload) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(payload));
    }

    async attachAudioElement(audioElement) {
        if (!audioElement) {
            throw new Error('attachAudioElement requires an HTMLAudioElement');
        }

        await this.ensureAudioContext();

        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (_) { /* noop */ }
        }

        if (this.usingMicrophone) {
            this.disableMicrophone();
        }

        if (!this.sourceNode || this.audioElement !== audioElement || this.sourceNode.mediaElement !== audioElement) {
            if (this.sourceNode) {
                try { this.sourceNode.disconnect(); } catch (_) { /* noop */ }
            }
            this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
        } else {
            try { this.sourceNode.disconnect(); } catch (_) { /* noop */ }
        }

        this.audioElement = audioElement;
        this.setupAnalyser();
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
        this.usingMicrophone = false;

        this.emit('log', { level: 'info', message: 'Audio source attached for LLM choreography' });
        this.emit('features', this.getFeatures());
    }

    async loadFile(file, audioElement) {
        if (!(file instanceof File)) {
            throw new Error('loadFile expects a File');
        }
        if (!audioElement) {
            throw new Error('loadFile requires the audio element that will play the track');
        }
        this.disableMicrophone();
        const objectUrl = URL.createObjectURL(file);
        if (this.currentTrackUrl) {
            URL.revokeObjectURL(this.currentTrackUrl);
        }
        this.currentTrackUrl = objectUrl;
        this.currentTrackName = file.name;
        audioElement.src = objectUrl;
        await audioElement.play().catch(() => audioElement.pause());
        await this.attachAudioElement(audioElement);
        this.emit('log', { level: 'info', message: `Loaded audio file: ${file.name}` });
    }

    async enableMicrophone() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microphone capture is not supported in this browser');
        }

        await this.ensureAudioContext();

        this.disableMicrophone();

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = this.audioContext.createMediaStreamSource(stream);

        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (_) { /* noop */ }
        }

        this.setupAnalyser();
        source.connect(this.analyser);

        this.microphoneStream = stream;
        this.microphoneSource = source;
        this.sourceNode = source;
        this.usingMicrophone = true;
        this.currentTrackName = null;

        if (this.audioElement) {
            try { this.audioElement.pause(); } catch (_) { /* noop */ }
        }

        this.emit('log', { level: 'info', message: 'Microphone enabled for LLM choreography' });
        this.emit('features', this.getFeatures());
        return stream;
    }

    disableMicrophone() {
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => {
                try { track.stop(); } catch (_) { /* noop */ }
            });
        }

        if (this.microphoneSource) {
            try { this.microphoneSource.disconnect(); } catch (_) { /* noop */ }
        }

        if (this.sourceNode === this.microphoneSource) {
            this.sourceNode = null;
        }

        this.microphoneStream = null;
        this.microphoneSource = null;

        if (this.usingMicrophone) {
            this.usingMicrophone = false;
            this.emit('log', { level: 'info', message: 'Microphone disabled' });
            this.emit('features', this.getFeatures());
        }
    }

    isMicrophoneActive() {
        return this.usingMicrophone && Boolean(this.microphoneStream);
    }

    registerFeatureBinding(binding) {
        if (!this.parameterManager) {
            throw new Error('Parameter manager not available for audio bindings');
        }
        const id = `${binding.target}-${binding.feature}-${Date.now()}`;
        const normalized = {
            id,
            feature: binding.feature,
            target: binding.target,
            mode: binding.mode || 'absolute',
            scale: typeof binding.scale === 'number' ? binding.scale : 1,
            offset: typeof binding.offset === 'number' ? binding.offset : 0,
            smoothing: binding.smoothing ?? this.options.bindingSmoothing,
            transform: binding.transform || 'linear',
            invert: Boolean(binding.invert),
            min: binding.min,
            max: binding.max,
            lastValue: this.parameterManager.getParameter(binding.target) ?? 0,
            lastContribution: 0,
        };
        this.featureBindings.push(normalized);
        this.emit('bindings', this.getBindings());
        this.emit('log', { level: 'info', message: `Audio feature ${binding.feature} → ${binding.target} (${normalized.mode})` });
        return normalized;
    }

    registerFeatureSurface(surface) {
        if (!this.parameterManager) {
            throw new Error('Parameter manager not available for audio surfaces');
        }

        const id = `${surface.axes.x.feature}-${surface.axes.y.feature}-${Date.now()}`;
        const normalizeAxis = axis => ({
            feature: axis.feature,
            transform: axis.transform || 'linear',
            invert: Boolean(axis.invert),
            scale: typeof axis.scale === 'number' ? axis.scale : 1,
            offset: typeof axis.offset === 'number' ? axis.offset : 0,
            min: typeof axis.min === 'number' ? axis.min : undefined,
            max: typeof axis.max === 'number' ? axis.max : undefined,
        });

        const normalizedTargets = surface.targets.map(target => ({
            target: target.target,
            base: typeof target.base === 'number' ? target.base : 0,
            xWeight: typeof target.xWeight === 'number' ? target.xWeight : 0,
            yWeight: typeof target.yWeight === 'number' ? target.yWeight : 0,
            xyWeight: typeof target.xyWeight === 'number' ? target.xyWeight : 0,
            bias: typeof target.bias === 'number' ? target.bias : 0,
            scale: typeof target.scale === 'number' ? target.scale : 1,
            offset: typeof target.offset === 'number' ? target.offset : 0,
            smoothing: target.smoothing ?? surface.smoothing ?? this.options.bindingSmoothing,
            mode: target.mode || surface.mode || 'absolute',
            min: target.min,
            max: target.max,
            lastValue: this.parameterManager.getParameter(target.target) ?? 0,
            lastContribution: 0,
        }));

        const normalizedSurface = {
            id,
            label: surface.label || `${surface.axes.x.feature.toUpperCase()}↔${surface.axes.y.feature.toUpperCase()}`,
            axes: {
                x: normalizeAxis(surface.axes.x),
                y: normalizeAxis(surface.axes.y),
            },
            targets: normalizedTargets,
            smoothing: surface.smoothing ?? this.options.bindingSmoothing,
        };

        this.featureSurfaces.push(normalizedSurface);
        this.emit('surfaces', this.getSurfaces());
        this.emit('log', {
            level: 'info',
            message: `Audio surface ${normalizedSurface.axes.x.feature}/${normalizedSurface.axes.y.feature} mapped to ${normalizedTargets.map(t => t.target).join(', ')}`,
        });
        return normalizedSurface;
    }

    removeBinding(bindingId) {
        const before = this.featureBindings.length;
        this.featureBindings = this.featureBindings.filter(binding => binding.id !== bindingId);
        if (this.featureBindings.length !== before) {
            this.emit('bindings', this.getBindings());
            this.emit('log', { level: 'info', message: `Removed audio binding ${bindingId}` });
        }
    }

    removeSurface(surfaceId) {
        const before = this.featureSurfaces.length;
        this.featureSurfaces = this.featureSurfaces.filter(surface => surface.id !== surfaceId);
        if (this.featureSurfaces.length !== before) {
            this.emit('surfaces', this.getSurfaces());
            this.emit('log', { level: 'info', message: `Removed audio surface ${surfaceId}` });
        }
    }

    clearBindings() {
        let changed = false;
        if (this.featureBindings.length > 0) {
            this.featureBindings = [];
            this.emit('bindings', this.getBindings());
            changed = true;
        }
        if (this.featureSurfaces.length > 0) {
            this.featureSurfaces = [];
            this.emit('surfaces', this.getSurfaces());
            changed = true;
        }
        if (changed) {
            this.emit('log', { level: 'info', message: 'Cleared all audio feature mappings' });
        }
    }

    getFeatures() {
        return { ...this.features };
    }

    getBindings() {
        return this.featureBindings.map(binding => ({
            id: binding.id,
            feature: binding.feature,
            target: binding.target,
            mode: binding.mode,
            scale: binding.scale,
            offset: binding.offset,
            smoothing: binding.smoothing,
            transform: binding.transform,
            invert: binding.invert,
            min: binding.min,
            max: binding.max,
        }));
    }

    getSurfaces() {
        return this.featureSurfaces.map(surface => ({
            id: surface.id,
            label: surface.label,
            axes: {
                x: {
                    feature: surface.axes.x.feature,
                    transform: surface.axes.x.transform,
                    invert: surface.axes.x.invert,
                    scale: surface.axes.x.scale,
                    offset: surface.axes.x.offset,
                    min: surface.axes.x.min,
                    max: surface.axes.x.max,
                },
                y: {
                    feature: surface.axes.y.feature,
                    transform: surface.axes.y.transform,
                    invert: surface.axes.y.invert,
                    scale: surface.axes.y.scale,
                    offset: surface.axes.y.offset,
                    min: surface.axes.y.min,
                    max: surface.axes.y.max,
                },
            },
            targets: surface.targets.map(target => ({
                target: target.target,
                mode: target.mode,
                base: target.base,
                xWeight: target.xWeight,
                yWeight: target.yWeight,
                xyWeight: target.xyWeight,
                bias: target.bias,
                scale: target.scale,
                offset: target.offset,
                smoothing: target.smoothing,
                min: target.min,
                max: target.max,
            })),
        }));
    }

    getSourceInfo() {
        if (this.isMicrophoneActive()) {
            return {
                type: 'microphone',
                isPlaying: true,
            };
        }

        if (this.audioElement) {
            const hasSrc = Boolean(this.audioElement.currentSrc || this.audioElement.src);
            const isPlaying = !this.audioElement.paused && !this.audioElement.ended;
            return {
                type: hasSrc ? 'track' : 'element',
                trackName: this.currentTrackName || (hasSrc ? this.audioElement.currentSrc || this.audioElement.src : null),
                isPlaying,
            };
        }

        return { type: 'none', isPlaying: false };
    }

    update(deltaSeconds = 0) {
        if (!this.analyser || !this.frequencyData || !this.timeDomainData) {
            return;
        }

        this.analyser.getByteFrequencyData(this.frequencyData);
        this.analyser.getFloatTimeDomainData(this.timeDomainData);

        const len = this.frequencyData.length;
        const bassEnd = Math.max(1, Math.floor(len * 0.12));
        const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.4));

        let bass = 0;
        let mid = 0;
        let high = 0;

        for (let i = 0; i < bassEnd; i++) bass += this.frequencyData[i];
        for (let i = bassEnd; i < midEnd; i++) mid += this.frequencyData[i];
        for (let i = midEnd; i < len; i++) high += this.frequencyData[i];

        bass = bass / bassEnd / 255;
        mid = mid / (midEnd - bassEnd) / 255;
        high = high / (len - midEnd) / 255;

        const smoothing = this.options.featureSmoothing;
        this.features.bass = lerp(this.features.bass, bass, smoothing);
        this.features.mid = lerp(this.features.mid, mid, smoothing);
        this.features.high = lerp(this.features.high, high, smoothing);
        this.features.energy = (this.features.bass + this.features.mid + this.features.high) / 3;

        let sumSquares = 0;
        for (let i = 0; i < this.timeDomainData.length; i++) {
            const sample = this.timeDomainData[i];
            sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / this.timeDomainData.length);
        this.features.rms = lerp(this.features.rms, rms, smoothing);

        // Spectral centroid estimation
        const nyquist = (this.audioContext?.sampleRate || 48000) / 2;
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < len; i++) {
            const magnitude = this.frequencyData[i];
            numerator += i * magnitude;
            denominator += magnitude;
        }
        const spectralCentroid = denominator > 0 ? (numerator / denominator) * (nyquist / len) : 0;
        this.features.spectralCentroid = lerp(this.features.spectralCentroid, spectralCentroid / nyquist, smoothing);

        const instantEnergy = rms * rms;
        this.energyHistory[this.energyIndex] = instantEnergy;
        this.energyIndex = (this.energyIndex + 1) % this.energyHistory.length;
        const avgEnergy = this.energyHistory.reduce((acc, value) => acc + value, 0) / this.energyHistory.length;
        const transient = Math.max(0, instantEnergy - avgEnergy);
        this.features.transient = lerp(this.features.transient, transient * 32, smoothing);

        const now = performance.now();
        let beat = 0;
        if (
            instantEnergy > avgEnergy * this.options.beatThreshold &&
            now - this.lastBeatAt > this.options.minBeatIntervalMs
        ) {
            this.lastBeatAt = now;
            beat = 1;
        }
        this.features.beat = beat;
        this.features.beatStrength = beat ? instantEnergy / (avgEnergy + 1e-6) : 0;

        // Section inference based on energy distribution
        const energyVariance = this.energyHistory.reduce((acc, value) => acc + Math.pow(value - avgEnergy, 2), 0) / this.energyHistory.length;
        let section = 'groove';
        let confidence = 0.4;
        if (this.features.energy < 0.18) {
            section = 'intro';
            confidence = 0.6;
        } else if (this.features.energy > 0.65 && this.features.transient > 0.25) {
            section = 'peak';
            confidence = 0.75;
        } else if (energyVariance < 0.0005) {
            section = 'break';
            confidence = 0.5;
        } else if (this.features.transient > 0.4) {
            section = 'transition';
            confidence = 0.55;
        }
        this.features.section = section;
        this.features.sectionConfidence = lerp(this.features.sectionConfidence, confidence, 0.6);

        this.applyBindings(deltaSeconds);
        this.applySurfaces();

        if (now - this.lastFeaturesEmit > 160) {
            this.emit('features', this.getFeatures());
            this.lastFeaturesEmit = now;
        }
    }

    applyBindings(deltaSeconds) {
        if (!this.parameterManager || this.featureBindings.length === 0) return;

        this.featureBindings.forEach(binding => {
            const base = this.features[binding.feature] ?? 0;
            const featureValue = binding.invert ? 1 - base : base;
            let transformed = featureValue;
            switch (binding.transform) {
                case 'square':
                    transformed = featureValue * featureValue;
                    break;
                case 'sqrt':
                    transformed = Math.sqrt(Math.max(0, featureValue));
                    break;
                case 'cube':
                    transformed = featureValue * featureValue * featureValue;
                    break;
                default:
                    break;
            }

            const contribution = transformed * binding.scale + binding.offset;
            let mapped;
            if (binding.mode === 'additive') {
                const current = this.parameterManager.getParameter(binding.target) ?? 0;
                mapped = current - (binding.lastContribution ?? 0) + contribution;
                binding.lastContribution = contribution;
            } else {
                mapped = contribution;
                binding.lastContribution = 0;
            }

            const clamped = clamp(mapped, binding.min, binding.max);
            const smoothed = lerp(binding.lastValue, clamped, binding.smoothing);
            binding.lastValue = smoothed;
            const finalValue = clamp(smoothed, binding.min, binding.max);
            this.parameterManager.setParameter(binding.target, finalValue);
        });
    }

    applySurfaces() {
        if (!this.parameterManager || this.featureSurfaces.length === 0) return;

        const transformValue = (value, transform) => {
            switch (transform) {
                case 'square':
                    return value * value;
                case 'sqrt':
                    return Math.sqrt(Math.max(0, value));
                case 'cube':
                    return value * value * value;
                case 'logistic':
                    return 1 / (1 + Math.exp(-4 * (value - 0.5)));
                default:
                    return value;
            }
        };

        const evalAxis = axis => {
            const raw = this.features[axis.feature] ?? 0;
            const base = axis.invert ? 1 - raw : raw;
            const transformed = transformValue(base, axis.transform);
            const scaled = transformed * (axis.scale ?? 1) + (axis.offset ?? 0);
            return clamp(scaled, axis.min, axis.max);
        };

        this.featureSurfaces.forEach(surface => {
            const xValue = evalAxis(surface.axes.x);
            const yValue = evalAxis(surface.axes.y);

            surface.targets.forEach(target => {
                const base = target.base ?? 0;
                const xTerm = xValue * (target.xWeight ?? 0);
                const yTerm = yValue * (target.yWeight ?? 0);
                const xyTerm = xValue * yValue * (target.xyWeight ?? 0);
                const bias = target.bias ?? 0;
                const combined = base + xTerm + yTerm + xyTerm + bias;
                const scaled = combined * (target.scale ?? 1) + (target.offset ?? 0);

                let mapped;
                if (target.mode === 'additive') {
                    const current = this.parameterManager.getParameter(target.target) ?? 0;
                    mapped = current - (target.lastContribution ?? 0) + scaled;
                    target.lastContribution = scaled;
                } else {
                    mapped = scaled;
                    target.lastContribution = 0;
                }

                const clamped = clamp(mapped, target.min, target.max);
                const smoothed = lerp(target.lastValue, clamped, target.smoothing ?? surface.smoothing);
                target.lastValue = smoothed;
                const finalValue = clamp(smoothed, target.min, target.max);
                this.parameterManager.setParameter(target.target, finalValue);
            });
        });
    }

    toLLMContext() {
        return {
            features: this.getFeatures(),
            bindings: this.getBindings(),
            surfaces: this.getSurfaces(),
            hasAudio: Boolean(this.analyser),
        };
    }

    static resolveFeatureName(text) {
        const normalized = text.trim().toLowerCase();
        const entries = Object.entries(FEATURE_ALIASES);
        for (const [feature, aliases] of entries) {
            if (feature === normalized || aliases.includes(normalized)) {
                return feature;
            }
        }
        return null;
    }
}
