import { validateIntent } from './DynamicIntentValidator.js';
import { VisualizerModulationManager } from './VisualizerModulationManager.js';

const EASING = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => 1 - Math.pow(1 - t, 2),
    easeInOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

const AUTOPILOT_ANCHOR_ACTIONS = new Set([
    'setParameter',
    'adjustParameter',
    'scheduleEnvelope',
    'applyMood',
    'setVariation',
]);

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
        this.autoPilot = null;
        this.visualizerModulationManager = null;
        this.options = {
            stateBroadcastInterval: 400,
            ...options,
        };

        if (!this.engine || !this.parameterManager) {
            throw new Error('DynamicControlEngine requires a configured engine with ParameterManager');
        }

        this.visualizerModulationManager = new VisualizerModulationManager(this.engine, options?.visualizerModulation);

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
                case 'setAutopilotState':
                    handlerResult = this.applySetAutopilotState(sanitized);
                    break;
                case 'setAutopilotAnchor':
                    handlerResult = this.applySetAutopilotAnchor(sanitized, context);
                    break;
                case 'clearAutopilotAnchors':
                    handlerResult = this.applyClearAutopilotAnchors(sanitized, context);
                    break;
                case 'captureAutopilotAnchors':
                    handlerResult = this.applyCaptureAutopilotAnchors(sanitized, context);
                    break;
                case 'configureAutopilotSection':
                    handlerResult = this.applyConfigureAutopilotSection(sanitized, context);
                    break;
                case 'clearAutopilotSection':
                    handlerResult = this.applyClearAutopilotSection(sanitized, context);
                    break;
                case 'setVisualizerModulation':
                    handlerResult = this.applyVisualizerModulation(sanitized);
                    break;
                default:
                    handlerResult = { status: 'ignored', message: `Unsupported action ${sanitized.action}` };
            }

            if (handlerResult?.log) {
                this.emit('log', handlerResult.log);
            }

            if (
                this.autoPilot?.observeParameters &&
                handlerResult &&
                (handlerResult.status === 'applied' || handlerResult.status === 'scheduled') &&
                AUTOPILOT_ANCHOR_ACTIONS.has(sanitized.action) &&
                typeof this.parameterManager?.getAllParameters === 'function'
            ) {
                try {
                    this.autoPilot.observeParameters(this.parameterManager.getAllParameters(), {
                        ...context,
                        intent: sanitized,
                        result: handlerResult,
                    });
                } catch (error) {
                    // Ignore anchor observation errors to keep control loop resilient.
                }
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

    applyVisualizerModulation(intent) {
        if (!this.visualizerModulationManager) {
            return {
                status: 'rejected',
                message: 'Visualizer modulation manager unavailable',
                log: {
                    level: 'warn',
                    message: 'Visualizer modulation attempted without manager',
                },
            };
        }

        const outcome = this.visualizerModulationManager.apply(intent);
        if (!outcome.ok) {
            return {
                status: 'rejected',
                message: outcome.reason,
                log: {
                    level: 'warn',
                    message: outcome.reason,
                },
            };
        }

        const descriptor = `${outcome.layer.label || outcome.layer.key} ${intent.property}`;
        const formattedValue = outcome.value.toFixed(2);
        this.emit('state', this.getStateSnapshot());

        return {
            status: 'applied',
            message: `Set ${descriptor} to ${formattedValue}`,
            data: outcome.state,
            log: {
                level: 'info',
                message: `Visualizer ${descriptor} → ${formattedValue}`,
            },
        };
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
        if (this.autoPilot?.attachAudioChoreographer) {
            this.autoPilot.attachAudioChoreographer(choreographer);
        }
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

    attachAutoPilot(autoPilot) {
        this.autoPilot = autoPilot;
        if (autoPilot?.attachAudioChoreographer && this.audioChoreographer) {
            autoPilot.attachAudioChoreographer(this.audioChoreographer);
        }
        this.emit('state', this.getStateSnapshot());
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

    applySetAutopilotState(intent) {
        if (!this.autoPilot) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot state change requested but autopilot unavailable',
                },
            };
        }

        const updates = [];

        if (intent.toggle) {
            const outcome = this.autoPilot.toggleEnabled?.();
            if (!outcome?.ok) {
                return {
                    status: 'rejected',
                    message: outcome?.reason || 'Autopilot toggle failed',
                    log: {
                        level: 'warn',
                        message: outcome?.reason || 'Autopilot toggle failed',
                    },
                };
            }
            const descriptor = outcome.enabled ? 'Autopilot enabled (toggle)' : 'Autopilot paused (toggle)';
            updates.push(outcome.changed ? descriptor : `${descriptor} (unchanged)`);
        }

        if (typeof intent.enabled === 'boolean') {
            const changed = this.autoPilot.setEnabled(intent.enabled);
            const descriptor = intent.enabled ? 'Autopilot enabled' : 'Autopilot paused';
            updates.push(changed ? descriptor : `${descriptor} (unchanged)`);
        }

        if (intent.programId) {
            let outcome;
            if (intent.programToggle) {
                outcome = this.autoPilot.toggleProgram?.(intent.programId);
            } else {
                outcome = this.autoPilot.setProgramState?.(intent.programId, intent.programEnabled);
            }
            if (!outcome?.ok) {
                return {
                    status: 'rejected',
                    message: outcome?.reason || 'Autopilot program update failed',
                    log: {
                        level: 'warn',
                        message: outcome?.reason || 'Autopilot program update failed',
                    },
                };
            }

            const label = outcome.program?.label || outcome.program?.id || intent.programId;
            let descriptor;
            if (intent.programToggle && !('programEnabled' in intent)) {
                descriptor = outcome.enabled
                    ? `Program enabled (toggle) → ${label}`
                    : `Program paused (toggle) → ${label}`;
            } else {
                descriptor = outcome.enabled ? `Program enabled → ${label}` : `Program paused → ${label}`;
            }
            updates.push(outcome.changed ? descriptor : `${descriptor} (unchanged)`);
        }

        if (updates.length === 0) {
            return {
                status: 'ignored',
                message: 'No autopilot changes applied',
                log: {
                    level: 'debug',
                    message: 'Autopilot intent contained no actionable changes',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        return {
            status: 'applied',
            message: updates.join(' & '),
            log: {
                level: 'info',
                message: updates.join(' | '),
            },
        };
    }

    applySetAutopilotAnchor(intent, context = {}) {
        if (!this.autoPilot?.setPreferenceAnchor) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot anchor set requested but autopilot unavailable',
                },
            };
        }

        const outcome = this.autoPilot.setPreferenceAnchor(intent.parameter, intent.value, {
            prompt: intent.prompt || context.prompt,
            preset: context.preset,
            source: intent.source || 'intent',
            locked: intent.locked,
        });

        if (!outcome?.ok) {
            return {
                status: 'rejected',
                message: outcome?.reason || 'Autopilot anchor could not be set',
                log: {
                    level: 'warn',
                    message: outcome?.reason || 'Autopilot anchor could not be set',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        return {
            status: 'applied',
            message: `Autopilot anchor recorded for ${intent.parameter}`,
            data: outcome.anchor,
            log: {
                level: 'info',
                message: `Autopilot anchor recorded → ${intent.parameter}`,
            },
        };
    }

    applyClearAutopilotAnchors(intent, context = {}) {
        if (!this.autoPilot?.clearPreferenceAnchors) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot anchor clear requested but autopilot unavailable',
                },
            };
        }

        const outcome = this.autoPilot.clearPreferenceAnchors(intent.parameters, {
            prompt: intent.prompt || context.prompt,
            preset: context.preset,
            source: intent.source || 'intent',
        });

        if (!outcome?.ok) {
            return {
                status: outcome?.reason ? 'ignored' : 'rejected',
                message: outcome?.reason || 'Autopilot anchors not cleared',
                log: {
                    level: 'info',
                    message: outcome?.reason || 'Autopilot anchors not cleared',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        const descriptor = outcome.cleared.length === 1
            ? `Autopilot anchor released → ${outcome.cleared[0]}`
            : `Cleared ${outcome.cleared.length} autopilot anchors`;

        return {
            status: 'applied',
            message: descriptor,
            data: outcome,
            log: {
                level: 'info',
                message: descriptor,
            },
        };
    }

    applyCaptureAutopilotAnchors(intent, context = {}) {
        if (!this.autoPilot?.captureCurrentAnchors) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot anchor capture requested but autopilot unavailable',
                },
            };
        }

        const outcome = this.autoPilot.captureCurrentAnchors(intent.parameters, {
            prompt: intent.prompt || context.prompt,
            preset: context.preset,
            source: intent.source || 'intent',
        });

        if (!outcome?.ok) {
            return {
                status: 'rejected',
                message: outcome?.reason || 'Autopilot anchors not captured',
                log: {
                    level: 'warn',
                    message: outcome?.reason || 'Autopilot anchors not captured',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        const descriptor = outcome.captured.length === 1
            ? `Captured anchor for ${outcome.captured[0].parameter}`
            : `Captured ${outcome.captured.length} autopilot anchors`;

        return {
            status: 'applied',
            message: descriptor,
            data: outcome,
            log: {
                level: 'info',
                message: descriptor,
            },
        };
    }

    applyConfigureAutopilotSection(intent, context = {}) {
        if (!this.autoPilot?.configureSectionPalette) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot section palette requested but autopilot unavailable',
                },
            };
        }

        const outcome = this.autoPilot.configureSectionPalette(intent, {
            prompt: intent.prompt || context.prompt,
            preset: context.preset,
            source: intent.source || 'intent',
        });

        if (!outcome?.ok) {
            return {
                status: 'rejected',
                message: outcome?.reason || 'Autopilot section palette rejected',
                log: {
                    level: 'warn',
                    message: outcome?.reason || 'Autopilot section palette rejected',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        const label = outcome.palette?.label || this.autoPilot.formatSectionLabel?.(intent.section) || intent.section;
        const descriptor = outcome.palette?.targets?.length
            ? `Autopilot section palette saved → ${label}`
            : `Autopilot section palette updated → ${label}`;

        return {
            status: 'applied',
            message: descriptor,
            data: outcome.palette,
            log: {
                level: 'info',
                message: descriptor,
            },
        };
    }

    applyClearAutopilotSection(intent, context = {}) {
        if (!this.autoPilot?.clearSectionPalette) {
            return {
                status: 'rejected',
                message: 'Autopilot not configured',
                log: {
                    level: 'warn',
                    message: 'Autopilot section palette clear requested but autopilot unavailable',
                },
            };
        }

        const outcome = this.autoPilot.clearSectionPalette(intent.section);
        if (!outcome?.ok) {
            return {
                status: 'rejected',
                message: outcome?.reason || 'Autopilot section palette not cleared',
                log: {
                    level: 'warn',
                    message: outcome?.reason || 'Autopilot section palette not cleared',
                },
            };
        }

        this.emit('state', this.getStateSnapshot());

        const descriptor = outcome.removed
            ? `Autopilot section palette cleared → ${this.autoPilot.formatSectionLabel?.(intent.section) || intent.section}`
            : `Autopilot section palette already clear → ${this.autoPilot.formatSectionLabel?.(intent.section) || intent.section}`;

        return {
            status: outcome.removed ? 'applied' : 'ignored',
            message: descriptor,
            log: {
                level: outcome.removed ? 'info' : 'debug',
                message: descriptor,
            },
        };
    }

    update() {
        const now = performance.now();
        const delta = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        let envelopeTouched = false;
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
                envelopeTouched = true;
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

        if (
            envelopeTouched &&
            this.autoPilot?.observeParameters &&
            typeof this.parameterManager?.getAllParameters === 'function'
        ) {
            try {
                this.autoPilot.observeParameters(this.parameterManager.getAllParameters(), { source: 'envelope' });
            } catch (_) {
                // Swallow envelope observation issues to keep render loop safe.
            }
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
            autopilot: this.autoPilot?.getState?.() ?? null,
            visualizers: this.visualizerModulationManager?.getState?.() ?? [],
        };
    }
}
