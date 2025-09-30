import { validateIntent } from './DynamicIntentValidator.js';

const EASING = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => 1 - Math.pow(1 - t, 2),
    easeInOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

export class DynamicControlEngine {
    constructor(engine, options = {}) {
        this.engine = engine;
        this.parameterManager = engine?.parameterManager;
        this.listeners = { log: [], state: [] };
        this.envelopes = [];
        this.lastUpdateTime = performance.now();
        this.lastStateBroadcast = 0;
        this.audioChoreographer = null;
        this.audioListeners = [];
        this.options = {
            stateBroadcastInterval: 400,
            ...options,
        };

        if (!this.engine || !this.parameterManager) {
            throw new Error('DynamicControlEngine requires a configured engine with ParameterManager');
        }

        const originalUpdate = this.engine.updateVisualizers.bind(this.engine);
        this.engine.updateVisualizers = () => {
            this.update();
            originalUpdate();
        };
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
        this.listeners[event].forEach(callback => callback(payload));
    }

    enqueueIntents(intents = [], context = {}) {
        const results = [];

        intents.forEach(intent => {
            const validation = validateIntent(intent, this.parameterManager.parameterDefs);
            if (!validation.valid) {
                results.push({
                    intent,
                    status: 'rejected',
                    message: validation.errors.join(', ') || 'Intent rejected',
                });
                this.emit('log', {
                    level: 'warn',
                    message: validation.errors.join(', ') || `Intent rejected: ${intent.action}`,
                    intent,
                });
                return;
            }

            const sanitized = validation.intent;
            let handlerResult;

            switch (sanitized.action) {
                case 'setParameter':
                    handlerResult = this.applySetParameter(sanitized);
                    break;
                case 'adjustParameter':
                    handlerResult = this.applyAdjustParameter(sanitized);
                    break;
                case 'scheduleEnvelope':
                    handlerResult = this.applyEnvelope(sanitized);
                    break;
                case 'setVariation':
                    handlerResult = this.applyVariation(sanitized);
                    break;
                case 'applyMood':
                    handlerResult = this.applyMood(sanitized);
                    break;
                case 'queryState':
                    handlerResult = this.queryState();
                    break;
                case 'bindAudioFeature':
                    handlerResult = this.applyBindAudioFeature(sanitized);
                    break;
                case 'bindAudioSurface':
                    handlerResult = this.applyBindAudioSurface(sanitized);
                    break;
                case 'removeAudioBinding':
                    handlerResult = this.applyRemoveAudioBinding(sanitized);
                    break;
                case 'removeAudioSurface':
                    handlerResult = this.applyRemoveAudioSurface(sanitized);
                    break;
                case 'clearAudioBindings':
                    handlerResult = this.applyClearAudioBindings();
                    break;
                case 'configureAudioStrategy':
                    handlerResult = this.applyConfigureAudioStrategy(sanitized);
                    break;
                default:
                    handlerResult = { status: 'ignored', message: `Unsupported action ${sanitized.action}` };
            }

            if (handlerResult?.log) {
                this.emit('log', handlerResult.log);
            }

            results.push({
                intent: sanitized,
                ...handlerResult,
            });
        });

        if (context.prompt) {
            this.emit('log', {
                level: 'meta',
                message: `Processed ${results.length} intent${results.length === 1 ? '' : 's'} for prompt`,
                prompt: context.prompt,
            });
        }

        return { results };
    }

    applySetParameter(intent) {
        const { target, value } = intent;
        this.parameterManager.setParameter(target, value);
        return {
            status: 'applied',
            message: `Set ${target} to ${value.toFixed ? value.toFixed(2) : value}`,
            log: {
                level: 'info',
                message: `Set ${target} → ${value}`,
            },
        };
    }

    applyAdjustParameter(intent) {
        const { target, delta, ceiling, floor } = intent;
        const current = this.parameterManager.getParameter(target);
        let next = current + delta;
        if (typeof ceiling === 'number') {
            next = Math.min(next, ceiling);
        }
        if (typeof floor === 'number') {
            next = Math.max(next, floor);
        }
        this.parameterManager.setParameter(target, next);
        return {
            status: 'applied',
            message: `Adjusted ${target} by ${delta > 0 ? '+' : ''}${delta.toFixed ? delta.toFixed(2) : delta}`,
            log: {
                level: 'info',
                message: `Adjusted ${target}: ${current.toFixed?.(3) ?? current} → ${next.toFixed?.(3) ?? next}`,
            },
        };
    }

    applyEnvelope(intent) {
        const { target, from, to, duration, easing = 'easeInOut', delay = 0 } = intent;
        const now = performance.now();
        const startValue = from !== undefined ? from : this.parameterManager.getParameter(target);
        const envelope = {
            id: `${target}-${now}`,
            target,
            startValue,
            endValue: to,
            durationMs: duration * 1000,
            startTime: now + delay * 1000,
            easing,
            createdAt: now,
        };
        this.envelopes.push(envelope);
        return {
            status: 'scheduled',
            message: `Envelope scheduled: ${target} ${startValue} → ${to} over ${duration}s`,
            log: {
                level: 'info',
                message: `Scheduled ${target} envelope (${duration}s, easing ${easing})`,
            },
        };
    }

    applyVariation(intent) {
        const variation = intent.value;
        if (typeof this.engine.setVariation !== 'function') {
            return {
                status: 'rejected',
                message: 'Engine cannot switch variations in this context',
                log: {
                    level: 'warn',
                    message: 'Variation change rejected - engine missing setVariation',
                },
            };
        }

        this.engine.setVariation(variation);
        const applied = this.engine.currentVariation === variation;
        return {
            status: applied ? 'applied' : 'rejected',
            message: applied ? `Switched to variation ${variation + 1}` : 'Variation could not be applied',
            log: {
                level: applied ? 'info' : 'warn',
                message: applied ? `Variation → ${variation + 1}` : `Variation ${variation + 1} unavailable`,
            },
        };
    }

    applyMood(intent) {
        const moods = {
            calm: [
                { action: 'scheduleEnvelope', target: 'chaos', to: 0.15, duration: 6, easing: 'easeOut' },
                { action: 'scheduleEnvelope', target: 'speed', to: 0.7, duration: 6 },
                { action: 'scheduleEnvelope', target: 'intensity', to: 0.4, duration: 5 },
                { action: 'scheduleEnvelope', target: 'hue', to: 200, duration: 8 },
            ],
            hype: [
                { action: 'scheduleEnvelope', target: 'chaos', to: 0.85, duration: 4, easing: 'easeIn' },
                { action: 'scheduleEnvelope', target: 'speed', to: 1.8, duration: 5 },
                { action: 'scheduleEnvelope', target: 'intensity', to: 0.9, duration: 3 },
                { action: 'adjustParameter', target: 'hue', delta: 30, ceiling: 360 },
            ],
            neon: [
                { action: 'scheduleEnvelope', target: 'hue', to: 310, duration: 6 },
                { action: 'scheduleEnvelope', target: 'saturation', to: 1, duration: 5 },
                { action: 'scheduleEnvelope', target: 'intensity', to: 0.85, duration: 4 },
            ],
            warm: [
                { action: 'scheduleEnvelope', target: 'hue', to: 40, duration: 5 },
                { action: 'scheduleEnvelope', target: 'saturation', to: 0.75, duration: 5 },
                { action: 'scheduleEnvelope', target: 'intensity', to: 0.65, duration: 4 },
            ],
        };

        const moodActions = moods[intent.moodId];
        if (!moodActions) {
            return {
                status: 'rejected',
                message: `Mood ${intent.moodId} unavailable`,
                log: {
                    level: 'warn',
                    message: `Unknown mood preset: ${intent.moodId}`,
                },
            };
        }

        const results = this.enqueueIntents(moodActions.map(action => ({ ...action })), { prompt: `mood:${intent.moodId}` });
        return {
            status: 'applied',
            message: `Mood ${intent.moodId} applied with ${results.results.length} actions`,
            log: {
                level: 'info',
                message: `Mood preset applied → ${intent.moodId}`,
            },
        };
    }

    queryState() {
        const snapshot = this.getStateSnapshot();
        return {
            status: 'info',
            message: 'Current state reported',
            data: snapshot,
            log: {
                level: 'info',
                message: `State → chaos ${snapshot.parameters.chaos.toFixed(2)}, speed ${snapshot.parameters.speed.toFixed(2)}`,
            },
        };
    }

    attachAudioChoreographer(choreographer) {
        this.audioListeners.forEach(unsub => unsub?.());
        this.audioListeners = [];
        this.audioChoreographer = choreographer;
        if (!choreographer) return;
        const unsubs = [
            choreographer.on('log', entry => this.emit('log', entry)),
            choreographer.on('features', () => this.emit('state', this.getStateSnapshot())),
            choreographer.on('bindings', () => this.emit('state', this.getStateSnapshot())),
            choreographer.on('surfaces', () => this.emit('state', this.getStateSnapshot())),
            choreographer.on('strategies', () => this.emit('state', this.getStateSnapshot())),
        ].filter(Boolean);
        this.audioListeners.push(...unsubs);
    }

    applyBindAudioFeature(intent) {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to bind audio feature without audio choreographer',
                },
            };
        }

        const binding = this.audioChoreographer.registerFeatureBinding(intent);
        return {
            status: 'applied',
            message: `Audio ${intent.feature} → ${intent.target} binding active`,
            data: binding,
            log: {
                level: 'info',
                message: `Audio binding set ${intent.feature} → ${intent.target}`,
            },
        };
    }

    applyBindAudioSurface(intent) {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to bind audio surface without audio choreographer',
                },
            };
        }

        const surface = this.audioChoreographer.registerFeatureSurface(intent);
        return {
            status: 'applied',
            message: `Audio surface ${intent.axes.x.feature}/${intent.axes.y.feature} engaged`,
            data: surface,
            log: {
                level: 'info',
                message: `Audio surface set ${intent.axes.x.feature}/${intent.axes.y.feature} → ${surface.targets.map(t => t.target).join(', ')}`,
            },
        };
    }

    applyConfigureAudioStrategy(intent) {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to configure audio strategy without audio choreographer',
                },
            };
        }

        try {
            const summary = this.audioChoreographer.configureStrategy(intent.preset, {
                keepExisting: intent.keepExisting,
            });
            return {
                status: 'applied',
                message: summary.label,
                data: summary,
                log: {
                    level: 'info',
                    message: `Audio strategy configured → ${summary.preset}`,
                },
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                log: {
                    level: 'error',
                    message: `Audio strategy failed: ${error.message}`,
                },
            };
        }
    }

    applyRemoveAudioBinding(intent) {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to remove audio binding without audio choreographer',
                },
            };
        }

        let removed = false;
        if (intent.bindingId) {
            this.audioChoreographer.removeBinding(intent.bindingId);
            removed = true;
        } else if (intent.target || intent.feature) {
            const bindings = this.audioChoreographer.getBindings();
            const match = bindings.find(binding => {
                const targetMatch = intent.target ? binding.target === intent.target : true;
                const featureMatch = intent.feature ? binding.feature === intent.feature : true;
                return targetMatch && featureMatch;
            });
            if (match) {
                this.audioChoreographer.removeBinding(match.id);
                removed = true;
            }
        }

        if (!removed) {
            return {
                status: 'ignored',
                message: 'No matching audio binding found to remove',
                log: {
                    level: 'info',
                    message: 'Audio binding removal requested but no match located',
                },
            };
        }

        return {
            status: 'applied',
            message: 'Audio binding removed',
            log: {
                level: 'info',
                message: 'Removed requested audio binding',
            },
        };
    }

    applyRemoveAudioSurface(intent) {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to remove audio surface without audio choreographer',
                },
            };
        }

        const surfaces = this.audioChoreographer.getSurfaces();
        let removed = false;
        if (intent.surfaceId) {
            this.audioChoreographer.removeSurface(intent.surfaceId);
            removed = true;
        } else if (intent.target) {
            const match = surfaces.find(surface => surface.targets.some(target => target.target === intent.target));
            if (match) {
                this.audioChoreographer.removeSurface(match.id);
                removed = true;
            }
        }

        if (!removed) {
            return {
                status: 'ignored',
                message: 'No matching audio surface found to remove',
                log: {
                    level: 'info',
                    message: 'Audio surface removal requested but no match located',
                },
            };
        }

        return {
            status: 'applied',
            message: 'Audio surface removed',
            log: {
                level: 'info',
                message: 'Removed requested audio surface mapping',
            },
        };
    }

    applyClearAudioBindings() {
        if (!this.audioChoreographer) {
            return {
                status: 'rejected',
                message: 'Audio choreographer not configured',
                log: {
                    level: 'warn',
                    message: 'Attempted to clear audio bindings without audio choreographer',
                },
            };
        }

        this.audioChoreographer.clearBindings();
        return {
            status: 'applied',
            message: 'Cleared all audio bindings and surfaces',
            log: {
                level: 'info',
                message: 'Cleared all audio feature mappings',
            },
        };
    }

    update() {
        const now = performance.now();
        const delta = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        if (this.envelopes.length > 0) {
            this.envelopes = this.envelopes.filter(envelope => {
                if (now < envelope.startTime) {
                    return true;
                }
                const progress = Math.min((now - envelope.startTime) / envelope.durationMs, 1);
                const easingFn = EASING[envelope.easing] || EASING.easeInOut;
                const eased = easingFn(progress);
                const value = envelope.startValue + (envelope.endValue - envelope.startValue) * eased;
                this.parameterManager.setParameter(envelope.target, value);
                if (progress >= 1) {
                    this.parameterManager.setParameter(envelope.target, envelope.endValue);
                    this.emit('log', {
                        level: 'debug',
                        message: `Envelope completed → ${envelope.target}`,
                    });
                    return false;
                }
                return true;
            });
        }

        if (this.audioChoreographer) {
            this.audioChoreographer.update(delta);
        }

        if (now - this.lastStateBroadcast >= this.options.stateBroadcastInterval) {
            this.emit('state', this.getStateSnapshot());
            this.lastStateBroadcast = now;
        }

        return delta;
    }

    getStateSnapshot() {
        const params = this.parameterManager.getAllParameters();
        const now = performance.now();
        return {
            timestamp: Date.now(),
            variation: this.engine.currentVariation ?? 0,
            parameters: {
                chaos: params.chaos,
                speed: params.speed,
                hue: params.hue,
                intensity: params.intensity,
                saturation: params.saturation,
                morphFactor: params.morphFactor,
                gridDensity: params.gridDensity,
            },
            envelopes: this.envelopes.map(envelope => ({
                target: envelope.target,
                remaining: Math.max(0, (envelope.startTime + envelope.durationMs - now) / 1000),
                easing: envelope.easing,
            })),
            audio: this.audioChoreographer
                ? {
                      features: this.audioChoreographer.getFeatures(),
                      bindings: this.audioChoreographer.getBindings(),
                      surfaces: this.audioChoreographer.getSurfaces(),
                      strategies: this.audioChoreographer.getSectionStrategies?.(),
                      source: this.audioChoreographer.getSourceInfo?.(),
                  }
                : null,
        };
    }
}
