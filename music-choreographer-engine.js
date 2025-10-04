/**
 * VIB34D Music Video Choreographer Engine
 * Hybrid live + timeline orchestrator with extended reactivity controls.
 */

import { VIB34DIntegratedEngine } from './src/core/Engine.js';
import { QuantumEngine } from './src/quantum/QuantumEngine.js';
import { RealHolographicSystem } from './src/holograms/RealHolographicSystem.js';
import { ReactivityController } from './src/core/ReactivityController.js';
import { ReactiveXYPad } from './src/ui/ReactiveXYPad.js';
import { StatusManager } from './src/ui/StatusManager.js';

const GEOMETRY_VARIATIONS = 9;
const RECORD_BUTTON_ACTIVE_CLASS = 'recording';
const AUTOMATION_MODE_ACTIVE_CLASS = 'automation-active';
const AUTOMATION_SNAPSHOT_STORAGE_KEY = 'vib34dAutomationSnapshotV1';
const DEFAULT_AUTOMATION_GLIDE = 0.28;
const SCENE_STORAGE_KEY = 'vib34dSceneSetV1';
const SCENE_STORAGE_SCHEMA_VERSION = 1;

export class MusicVideoChoreographer {
    constructor(mode = 'reactive') {
        this.mode = mode;

        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';

        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.sourceNode = null;

        this.currentSystem = 'faceted';
        this.currentEngine = null;
        this.isPlaying = false;
        this.animationId = null;

        this.dom = {};
        this.statusManager = new StatusManager();

        this.reactivityController = new ReactivityController();
        this.xyPad = null;
        this.axisLocks = { x: false, y: false };
        this.reactivityParameterOrder = [];
        this.reactivityModulatorOrder = [];
        this.reactivityTelemetry = {
            parameterNodes: new Map(),
            modulatorNodes: new Map(),
            lastRenderedAt: 0,
            initialized: false
        };
        this.modulatorUi = {
            controls: new Map()
        };

        this.sceneState = {
            scenes: [],
            selectedSceneId: null,
            crossfadeSeconds: 1.5,
            transition: null,
            captureCount: 0,
            storageKey: SCENE_STORAGE_KEY,
            storageAvailable: false,
            storageHasData: false,
            lastSavedAt: null,
            isDirty: false,
            timeline: {
                cues: [],
                isArmed: false,
                nextCueIndex: 0,
                loop: false,
                followPlayback: true
            }
        };
        this.sceneUi = {};
        this.sceneTimelineUi = {};
        this.sceneTimelineRuntime = {
            triggeredCueIds: new Set(),
            lastPlaybackTime: 0,
            lastStatusUpdate: 0,
            lastCueId: null
        };

        this.boundSceneHotkeyHandler = (event) => this.handleSceneHotkey(event);
        this.boundBeforeUnloadHandler = (event) => this.handleBeforeUnload(event);

        this.sequences = [];
        this.currentSequence = null;

        this.previousAudio = { energy: 0, bass: 0, mid: 0, high: 0, lowMid: 0 };
        this.smoothedEnergy = 0;
        this.energyMomentum = 0;
        this.lastAudioData = {
            bass: 0,
            lowMid: 0,
            mid: 0,
            high: 0,
            energy: 0,
            brightness: 0,
            warmth: 0,
            spectralTilt: 0,
            transient: 0,
            dynamics: 0,
            momentum: 0
        };

        this.detectedBPM = 0;
        this.lastBeatTime = 0;
        this.previousBeatTimestamp = 0;
        this.minimumBeatInterval = 240;

        this.lastFrameTime = performance.now();

        this.geometryState = {
            index: 0,
            lastChange: 0
        };

        this.isRecordingAutomation = false;
        this.automationData = [];
        this.lastAutomationTimestamp = -1;
        this.automationPlaybackData = [];
        this.automationPlaybackIndex = 0;
        this.automationPlaybackVector = { x: 0, y: 0 };
        this.isAutomationPlaybackEnabled = false;
        this.automationResumeTime = 0;
        this.automationPlaybackMeta = null;
        this.automationGlide = DEFAULT_AUTOMATION_GLIDE;
        this.automationSnapshot = null;
        this.lastReactiveParameters = {};
        this.pendingSystemSwitch = null;
        this.currentAudioObjectUrl = null;

        this.init();
    }

    async init() {
        console.log(`🎵 Initializing Music Video Choreographer in ${this.mode.toUpperCase()} mode`);

        this.cacheDomReferences();
        this.configureReactivitySystem();
        this.initializeModulatorControls();
        this.initializeSceneLab();
        this.setupEventListeners();
        this.initializeAutomationControls();
        this.setupReactivityPad();
        this.updateAxisLockUi();
        this.renderReactivityTelemetry();
        this.updateAutomationUiState();

        await this.initializeAudio();
        await this.switchSystem(this.currentSystem);

        if (this.mode === 'choreographed') {
            await this.generateDefaultChoreography();
        }

        this.updateStatus('Ready to load audio file', 'info');
        console.log('✅ Choreographer initialized');
    }

    cacheDomReferences() {
        this.dom = {
            fileInput: document.getElementById('audio-file'),
            playButton: document.getElementById('play-btn'),
            pauseButton: document.getElementById('pause-btn'),
            stopButton: document.getElementById('stop-btn'),
            timeline: document.getElementById('timeline'),
            timelineProgress: document.getElementById('timeline-progress'),
            status: document.getElementById('status'),
            systemButtons: Array.from(document.querySelectorAll('.system-btn')),
            beatInfo: document.getElementById('beat-info'),
            energyInfo: document.getElementById('energy-info'),
            spectralInfo: document.getElementById('spectral-info'),
            reactivityInfo: document.getElementById('reactivity-info'),
            reactivityPad: document.getElementById('reactivity-pad'),
            reactivityReadoutX: document.getElementById('reactivity-readout-x'),
            reactivityReadoutY: document.getElementById('reactivity-readout-y'),
            recordAutomationBtn: document.getElementById('record-automation-btn'),
            exportAutomationBtn: document.getElementById('export-automation-btn'),
            automationPlaybackBtn: document.getElementById('automation-playback-btn'),
            importAutomationBtn: document.getElementById('import-automation-btn'),
            automationGlideInput: document.getElementById('automation-glide'),
            automationGlideValue: document.getElementById('automation-glide-value'),
            saveAutomationSnapshotBtn: document.getElementById('save-automation-snapshot-btn'),
            loadAutomationSnapshotBtn: document.getElementById('load-automation-snapshot-btn'),
            automationSnapshotInfo: document.getElementById('automation-snapshot-info'),
            reactivityParameterList: document.getElementById('reactivity-parameter-list'),
            reactivityModulatorList: document.getElementById('reactivity-modulator-list'),
            modulatorControlGrid: document.getElementById('modulator-control-grid'),
            lockXAxisBtn: document.getElementById('lock-axis-x'),
            lockYAxisBtn: document.getElementById('lock-axis-y'),
            resetPadBtn: document.getElementById('reset-reactivity-btn'),
            resyncModulatorsBtn: document.getElementById('resync-modulators-btn'),
            sequenceList: document.getElementById('sequence-list'),
            captureSceneBtn: document.getElementById('capture-scene-btn'),
            applySceneBtn: document.getElementById('apply-scene-btn'),
            saveSceneSetBtn: document.getElementById('save-scene-set-btn'),
            loadSceneSetBtn: document.getElementById('load-scene-set-btn'),
            clearSceneSetBtn: document.getElementById('clear-scene-set-btn'),
            sceneList: document.getElementById('scene-list'),
            sceneCrossfadeInput: document.getElementById('scene-crossfade'),
            sceneCrossfadeValue: document.getElementById('scene-crossfade-value'),
            sceneHotkeyHint: document.getElementById('scene-hotkey-hint'),
            sceneStorageStatus: document.getElementById('scene-storage-status'),
            sceneTimeline: document.getElementById('scene-timeline'),
            timelineList: document.getElementById('scene-timeline-list'),
            timelineStatus: document.getElementById('scene-timeline-status'),
            timelineAddCueBtn: document.getElementById('timeline-add-cue-btn'),
            timelineClearBtn: document.getElementById('timeline-clear-btn'),
            timelineArmBtn: document.getElementById('timeline-arm-btn'),
            timelineFollowBtn: document.getElementById('timeline-follow-btn'),
            timelineLoopBtn: document.getElementById('timeline-loop-btn')
        };
    }

    configureReactivitySystem() {
        this.reactivityParameterOrder = [
            'gridDensity',
            'morphFactor',
            'chaos',
            'speed',
            'intensity',
            'saturation',
            'dimension',
            'hue'
        ];

        this.reactivityModulatorOrder = [
            'orbitalSweep',
            'beatSurge',
            'dimensionFlux',
            'momentumRise',
            'auroraRandom',
            'pulseSequencer'
        ];

        this.reactivityTelemetry.initialized = false;
        this.reactivityTelemetry.parameterNodes = new Map();
        this.reactivityTelemetry.modulatorNodes = new Map();

        this.reactivityController
            .registerModulator('orbitalSweep', {
                type: 'lfo',
                frequency: 0.075,
                amplitude: 0.45,
                offset: 0,
                phaseOffset: Math.PI / 6,
                smoothing: 0.1,
                range: [-1, 1],
                beatBoost: 0.25,
                beatBoostDecay: 0.6,
                initialValue: 0
            })
            .registerModulator('beatSurge', {
                type: 'beatEnvelope',
                amount: 0.95,
                decay: 0.58,
                range: [0, 1.2],
                smoothing: 0.1,
                base: 0,
                attack: 1.15
            })
            .registerModulator('dimensionFlux', {
                type: 'lfo',
                shape: 'triangle',
                frequency: 0.045,
                amplitude: 0.35,
                offset: 0,
                smoothing: 0.12,
                range: [-1, 1],
                phaseOffset: -Math.PI / 4
            })
            .registerModulator('auroraRandom', {
                type: 'noise',
                amplitude: 0.35,
                offset: 0,
                tempoSync: true,
                division: 0.5,
                noiseSmoothing: 0.82,
                range: [-1, 1],
                initialValue: 0
            })
            .registerModulator('pulseSequencer', {
                type: 'stepSequencer',
                steps: [0, 0.95, 0.35, 0.75],
                amount: 1,
                offset: 0,
                tempoSync: true,
                division: 2,
                smoothing: 0.12,
                retriggerOnBeat: true,
                range: [0, 1]
            })
            .registerModulator('momentumRise', {
                type: 'custom',
                smoothing: 0.3,
                range: [0, 1],
                compute: ({ audio }) => Math.max(0, Math.min(1, audio.momentum ?? 0))
            })
            .registerParameter('gridDensity', {
                base: 18,
                sources: [
                    { band: 'bass', weight: 28 },
                    { band: 'lowMid', weight: 16 }
                ],
                liveAxes: { x: 22, y: 12 },
                range: [8, 96],
                smoothing: 0.22,
                modulators: [
                    { name: 'orbitalSweep', weight: 9 },
                    { name: 'beatSurge', weight: 22 },
                    { name: 'pulseSequencer', weight: 12 }
                ],
                transform: (value, meta) => {
                    const densityBoost = meta.context?.sequence?.densityBoost ?? 0;
                    return Math.round(value + densityBoost);
                }
            })
            .registerParameter('morphFactor', {
                base: 0.95,
                sources: [
                    { band: 'mid', weight: 0.9 },
                    { band: 'high', weight: 0.7 }
                ],
                liveAxes: { x: 0.4, y: 0.3 },
                range: [0.4, 1.9],
                smoothing: 0.24,
                modulators: [
                    { name: 'orbitalSweep', weight: 0.25 },
                    { name: 'dimensionFlux', weight: 0.35 }
                ],
                transform: (value, meta) => {
                    if (meta.context?.sequence?.rotation === 'chaos') {
                        value += 0.35;
                    } else if (meta.context?.sequence?.rotation === 'extreme') {
                        value += 0.5;
                    }
                    return value;
                }
            })
            .registerParameter('chaos', {
                base: 0.18,
                sources: [
                    { band: 'high', weight: 0.6 },
                    { band: 'spectralTilt', weight: 0.5 }
                ],
                liveAxes: { y: 0.35 },
                range: [0, 1],
                smoothing: 0.28,
                beatResponse: 0.18,
                modulators: [
                    { name: 'beatSurge', weight: 0.45 },
                    { name: 'momentumRise', weight: 0.4 },
                    { name: 'auroraRandom', weight: 0.25 }
                ],
                transform: (value, meta) => {
                    const baseChaos = meta.context?.sequence?.chaos;
                    if (typeof baseChaos === 'number') {
                        value = baseChaos * 0.6 + value * 0.6;
                    }
                    return value;
                }
            })
            .registerParameter('speed', {
                base: 0.9,
                sources: [
                    { band: 'energy', weight: 1.4 },
                    { band: 'momentum', weight: 1.1 }
                ],
                liveAxes: { x: 0.45 },
                range: [0.25, 3],
                smoothing: 0.18,
                beatResponse: 0.25,
                modulators: [
                    { name: 'momentumRise', weight: 0.65 },
                    { name: 'orbitalSweep', weight: 0.12, mode: 'multiply' }
                ],
                transform: (value, meta) => {
                    const baseSpeed = meta.context?.sequence?.speed;
                    if (typeof baseSpeed === 'number') {
                        value = baseSpeed * 0.65 + value * 0.7;
                    }
                    return value;
                }
            })
            .registerParameter('intensity', {
                base: 0.42,
                sources: [
                    { band: 'energy', weight: 0.8 },
                    { band: 'transient', weight: 0.6 }
                ],
                liveAxes: { x: 0.2 },
                range: [0.2, 1],
                smoothing: 0.15,
                modulators: [
                    { name: 'beatSurge', weight: 0.35 },
                    { name: 'momentumRise', weight: 0.45 },
                    { name: 'auroraRandom', weight: 0.2 }
                ]
            })
            .registerParameter('saturation', {
                base: 0.62,
                sources: [
                    { band: 'bass', weight: 0.45 },
                    { band: 'warmth', weight: 0.3 }
                ],
                liveAxes: { y: 0.2 },
                range: [0.2, 1],
                smoothing: 0.2,
                modulators: [
                    { name: 'orbitalSweep', weight: 0.18 },
                    { name: 'beatSurge', weight: 0.22 },
                    { name: 'auroraRandom', weight: 0.18 }
                ]
            })
            .registerParameter('dimension', {
                base: 3.35,
                sources: [
                    { band: 'energy', weight: 0.4 }
                ],
                liveAxes: { y: 0.35 },
                range: [3.1, 4.4],
                smoothing: 0.3,
                modulators: [
                    { name: 'dimensionFlux', weight: 0.25 },
                    { name: 'beatSurge', weight: 0.18 },
                    { name: 'auroraRandom', weight: 0.15 }
                ],
                transform: (value, meta) => value + meta.audio.spectralTilt * 0.4
            })
            .registerParameter('rot4dXW', {
                range: [-1.6, 1.6],
                smoothing: 0.32,
                compute: (meta) => {
                    const t = meta.context?.time ?? 0;
                    const seq = meta.context?.sequence;
                    const baseFreq = seq?.rotation === 'extreme' ? 3.5 : seq?.rotation === 'chaos' ? 2.4 : 1.1;
                    const amplitude = 0.7 + meta.audio.bass * 0.8;
                    const orbital = meta.controller?.getModulatorValue('orbitalSweep') ?? 0;
                    return Math.sin(t * baseFreq) * amplitude + meta.liveVector.y * 0.9 + orbital * 0.4;
                }
            })
            .registerParameter('rot4dYW', {
                range: [-1.6, 1.6],
                smoothing: 0.32,
                compute: (meta) => {
                    const t = meta.context?.time ?? 0;
                    const seq = meta.context?.sequence;
                    const baseFreq = seq?.rotation === 'extreme' ? 2.9 : seq?.rotation === 'accelerate' ? 1.8 : 0.9;
                    const amplitude = 0.6 + meta.audio.mid * 0.9;
                    const flux = meta.controller?.getModulatorValue('dimensionFlux') ?? 0;
                    return Math.cos(t * baseFreq) * amplitude + meta.liveVector.x * 0.6 + flux * 0.45;
                }
            })
            .registerParameter('rot4dZW', {
                range: [-1.6, 1.6],
                smoothing: 0.28,
                compute: (meta) => {
                    const t = meta.context?.time ?? 0;
                    const seq = meta.context?.sequence;
                    const baseFreq = seq?.rotation === 'extreme' ? 4.1 : 1.6;
                    const amplitude = 0.5 + meta.audio.high * 0.9;
                    const surge = meta.controller?.getModulatorValue('beatSurge') ?? 0;
                    return Math.sin(t * baseFreq + meta.audio.high * Math.PI) * amplitude + meta.liveVector.y * 0.4 + surge * 0.35;
                }
            })
            .registerParameter('hue', {
                wrap: 360,
                smoothing: 0.12,
                modulators: [
                    { name: 'orbitalSweep', weight: 24 },
                    { name: 'dimensionFlux', weight: 18 },
                    { name: 'beatSurge', weight: 12 },
                    { name: 'auroraRandom', weight: 16 },
                    { name: 'pulseSequencer', weight: 9 }
                ],
                compute: (meta) => {
                    const t = meta.context?.time ?? 0;
                    const seq = meta.context?.sequence;
                    let base = t * 18;
                    if (seq) {
                        if (seq.colorShift === 'rainbow') {
                            base = t * 60;
                        } else if (seq.colorShift === 'fast') {
                            base = t * 30;
                        } else if (seq.colorShift === 'medium') {
                            base = t * 12;
                        } else if (seq.colorShift === 'slow') {
                            base = t * 6;
                        } else if (seq.colorShift === 'freeze') {
                            base = seq.baseHue ?? 180;
                        }
                    }
                    const modulation = meta.audio.mid * 90 + meta.audio.high * 70;
                    const live = meta.liveVector.x * 45 + meta.liveVector.y * 15;
                    return base + modulation + live;
                }
            });
    }

    async initializeAudio() {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }

    setupEventListeners() {
        const {
            fileInput,
            playButton,
            pauseButton,
            stopButton,
            timeline,
            systemButtons,
            recordAutomationBtn,
            exportAutomationBtn,
            automationPlaybackBtn,
            importAutomationBtn,
            automationGlideInput,
            saveAutomationSnapshotBtn,
            loadAutomationSnapshotBtn
        } = this.dom;

        if (fileInput) {
            fileInput.addEventListener('change', (event) => {
                const file = event.target.files?.[0];
                this.loadAudioFile(file);
            });
        }

        if (playButton) {
            playButton.addEventListener('click', () => this.play());
        }
        if (pauseButton) {
            pauseButton.addEventListener('click', () => this.pause());
        }
        if (stopButton) {
            stopButton.addEventListener('click', () => this.stop());
        }

        if (timeline) {
            timeline.addEventListener('click', (event) => {
                if (!this.audio.duration) return;
                const rect = timeline.getBoundingClientRect();
                const pos = (event.clientX - rect.left) / rect.width;
                this.audio.currentTime = pos * this.audio.duration;
                this.updateTimeline();
            });
        }

        if (systemButtons && systemButtons.length) {
            systemButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const system = btn.dataset.system;
                    if (system && system !== this.currentSystem) {
                        this.switchSystem(system);
                    }
                });
            });
        }

        if (recordAutomationBtn) {
            recordAutomationBtn.addEventListener('click', () => this.toggleAutomationRecording());
        }

        if (exportAutomationBtn) {
            exportAutomationBtn.addEventListener('click', () => this.exportAutomationData());
        }

        if (automationPlaybackBtn) {
            automationPlaybackBtn.addEventListener('click', () => this.toggleAutomationPlayback());
        }

        if (importAutomationBtn) {
            importAutomationBtn.addEventListener('click', () => this.promptAutomationImport());
        }

        if (this.dom.lockXAxisBtn) {
            this.dom.lockXAxisBtn.addEventListener('click', () => this.toggleAxisLock('x'));
        }

        if (this.dom.lockYAxisBtn) {
            this.dom.lockYAxisBtn.addEventListener('click', () => this.toggleAxisLock('y'));
        }

        if (this.dom.resetPadBtn) {
            this.dom.resetPadBtn.addEventListener('click', () => this.resetLiveVector());
        }

        if (this.dom.resyncModulatorsBtn) {
            this.dom.resyncModulatorsBtn.addEventListener('click', () => this.handleResyncModulators());
        }

        if (automationGlideInput) {
            automationGlideInput.addEventListener('input', (event) => {
                const value = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : parseFloat(event.target.value);
                this.setAutomationGlide(value, { updateSlider: false, announce: true });
            });
        }

        if (saveAutomationSnapshotBtn) {
            saveAutomationSnapshotBtn.addEventListener('click', () => this.handleSaveAutomationSnapshot());
        }

        if (loadAutomationSnapshotBtn) {
            loadAutomationSnapshotBtn.addEventListener('click', () => this.handleLoadAutomationSnapshot());
        }

        this.audio.addEventListener('ended', () => this.stop());
        this.audio.addEventListener('timeupdate', () => this.updateTimeline());
    }

    setupReactivityPad() {
        const padElement = this.dom.reactivityPad;
        if (!padElement) return;

        this.xyPad = new ReactiveXYPad(padElement, {
            snap: 0.02,
            onEngage: () => {
                this.suspendAutomationPlayback();
                this.recordAutomationPoint(this.reactivityController.getLiveVector());
            },
            onChange: (vector) => {
                const safeVector = this.commitLiveVector(vector, { fromPad: true });
                this.recordAutomationPoint(safeVector);
                this.applyLiveVector();
            },
            onRelease: (vector) => {
                this.suspendAutomationPlayback(600);
                const safeVector = this.commitLiveVector(vector, { fromPad: true });
                this.recordAutomationPoint(safeVector);
                this.applyLiveVector();
            },
            onActivity: () => this.suspendAutomationPlayback()
        });

        const initialVector = this.reactivityController.getLiveVector();
        this.xyPad.setValue(initialVector, true);
        this.updateReactivityReadout(initialVector);
    }

    toggleAxisLock(axis) {
        if (!axis || (axis !== 'x' && axis !== 'y')) return;
        this.axisLocks[axis] = !this.axisLocks[axis];
        this.updateAxisLockUi();
        this.commitLiveVector(this.reactivityController.getLiveVector(), { updatePad: true });
        this.applyLiveVector();
        const label = axis.toUpperCase();
        const state = this.axisLocks[axis] ? 'locked' : 'unlocked';
        this.updateStatus(`${label} axis ${state}`, 'info');
    }

    updateAxisLockUi() {
        if (!this.axisLocks) {
            this.axisLocks = { x: false, y: false };
        }

        if (this.dom.lockXAxisBtn) {
            const locked = Boolean(this.axisLocks.x);
            this.dom.lockXAxisBtn.classList.toggle('active', locked);
            this.dom.lockXAxisBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
            this.dom.lockXAxisBtn.textContent = locked ? '🔓 Unlock X Axis' : '🔒 Lock X Axis';
        }

        if (this.dom.lockYAxisBtn) {
            const locked = Boolean(this.axisLocks.y);
            this.dom.lockYAxisBtn.classList.toggle('active', locked);
            this.dom.lockYAxisBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
            this.dom.lockYAxisBtn.textContent = locked ? '🔓 Unlock Y Axis' : '🔒 Lock Y Axis';
        }
    }

    resetLiveVector(announce = true) {
        const vector = this.commitLiveVector({ x: 0, y: 0 }, { updatePad: true });
        this.applyLiveVector();
        if (announce) {
            this.updateStatus('Reactivity pad centered', 'info');
        }
        return vector;
    }

    initializeTelemetryLists() {
        if (this.reactivityTelemetry.initialized) return;

        const { reactivityParameterList, reactivityModulatorList } = this.dom;

        if (reactivityParameterList && Array.isArray(this.reactivityParameterOrder)) {
            reactivityParameterList.innerHTML = '';
            this.reactivityTelemetry.parameterNodes = new Map();
            this.reactivityParameterOrder.forEach((name) => {
                const item = document.createElement('li');
                item.className = 'telemetry-item';
                const label = document.createElement('span');
                label.className = 'telemetry-label';
                label.textContent = this.getParameterTelemetryLabel(name);
                const value = document.createElement('span');
                value.className = 'telemetry-value';
                value.textContent = '--';
                item.appendChild(label);
                item.appendChild(value);
                reactivityParameterList.appendChild(item);
                this.reactivityTelemetry.parameterNodes.set(name, value);
            });
        }

        if (reactivityModulatorList && Array.isArray(this.reactivityModulatorOrder)) {
            reactivityModulatorList.innerHTML = '';
            this.reactivityTelemetry.modulatorNodes = new Map();
            this.reactivityModulatorOrder.forEach((name) => {
                const item = document.createElement('li');
                item.className = 'telemetry-item';
                const label = document.createElement('span');
                label.className = 'telemetry-label';
                label.textContent = this.getModulatorTelemetryLabel(name);
                const value = document.createElement('span');
                value.className = 'telemetry-value';
                value.textContent = '--';
                item.appendChild(label);
                item.appendChild(value);
                reactivityModulatorList.appendChild(item);
                this.reactivityTelemetry.modulatorNodes.set(name, value);
            });
        }

        this.reactivityTelemetry.initialized = true;
    }

    renderReactivityTelemetry(params = this.lastReactiveParameters, modulators = this.reactivityController.getModulatorSnapshot()) {
        if (!this.dom.reactivityParameterList && !this.dom.reactivityModulatorList) {
            return;
        }

        this.initializeTelemetryLists();

        const now = this.getNow();
        if (now - (this.reactivityTelemetry.lastRenderedAt || 0) < 80) {
            return;
        }
        this.reactivityTelemetry.lastRenderedAt = now;

        const parameterValues = params || this.lastReactiveParameters || {};
        this.reactivityTelemetry.parameterNodes.forEach((node, name) => {
            const value = parameterValues[name];
            node.textContent = this.formatParameterTelemetryValue(name, value);
        });

        const modValues = modulators || this.reactivityController.getModulatorSnapshot() || {};
        this.reactivityTelemetry.modulatorNodes.forEach((node, name) => {
            const value = modValues[name];
            const enabled = this.reactivityController.isModulatorEnabled(name);
            node.textContent = enabled ? this.formatModulatorTelemetryValue(name, value) : 'OFF';
            const container = node.closest('.telemetry-item');
            if (container) {
                container.classList.toggle('is-disabled', !enabled);
            }
        });
    }

    getParameterTelemetryLabel(name) {
        const labels = {
            gridDensity: 'Grid Density',
            morphFactor: 'Morph Factor',
            chaos: 'Chaos',
            speed: 'Speed',
            intensity: 'Intensity',
            saturation: 'Saturation',
            dimension: 'Dimension',
            hue: 'Hue'
        };
        return labels[name] ?? name;
    }

    getModulatorTelemetryLabel(name) {
        const labels = {
            orbitalSweep: 'Orbital Sweep',
            beatSurge: 'Beat Surge',
            dimensionFlux: 'Dimension Flux',
            momentumRise: 'Momentum Rise',
            auroraRandom: 'Aurora Randomizer',
            pulseSequencer: 'Pulse Sequencer'
        };
        return labels[name] ?? name;
    }

    formatParameterTelemetryValue(name, value) {
        if (!Number.isFinite(value)) {
            return '--';
        }

        switch (name) {
            case 'gridDensity':
                return Math.round(value).toString();
            case 'morphFactor':
                return value.toFixed(2);
            case 'chaos':
            case 'intensity':
            case 'saturation':
                return `${Math.round(value * 100)}%`;
            case 'speed':
                return `${value.toFixed(2)}×`;
            case 'dimension':
                return value.toFixed(2);
            case 'hue': {
                const normalized = ((value % 360) + 360) % 360;
                return `${Math.round(normalized)}°`;
            }
            default:
                return value.toFixed(2);
        }
    }

    formatModulatorTelemetryValue(name, value) {
        if (!Number.isFinite(value)) {
            return '--';
        }
        const formatted = value.toFixed(2);
        return value > 0 ? `+${formatted}` : formatted;
    }

    initializeModulatorControls() {
        const container = this.dom.modulatorControlGrid;
        if (!container || !this.reactivityController) {
            return;
        }

        container.innerHTML = '';
        this.modulatorUi.controls = new Map();

        const definitions = this.reactivityController.getModulatorDefinitions();
        if (!definitions.length) {
            return;
        }

        const map = new Map(definitions.map((def) => [def.name, def]));
        const orderedNames = (this.reactivityModulatorOrder || []).filter((name) => map.has(name));
        const names = orderedNames.length ? orderedNames : Array.from(map.keys());

        names.forEach((name) => {
            const config = map.get(name);
            if (!config) return;

            const card = document.createElement('div');
            card.className = 'modulator-card';
            card.dataset.modulator = name;

            const header = document.createElement('div');
            header.className = 'modulator-card__header';

            const title = document.createElement('span');
            title.className = 'modulator-card__title';
            title.textContent = this.getModulatorTelemetryLabel(name);
            header.appendChild(title);

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'modulator-card__toggle';
            toggle.addEventListener('click', () => this.handleModulatorToggle(name));
            header.appendChild(toggle);

            card.appendChild(header);

            const meta = document.createElement('div');
            meta.className = 'modulator-card__meta';
            card.appendChild(meta);

            const body = document.createElement('div');
            body.className = 'modulator-card__body';
            card.appendChild(body);

            const controlEntry = {
                card,
                toggle,
                meta
            };

            const addSlider = (key, options) => {
                const slider = this.createModulatorSlider(body, options);
                if (slider) {
                    controlEntry[key] = slider;
                }
            };

            if (typeof config.amplitude === 'number' && (config.type === 'lfo' || config.type === 'noise')) {
                addSlider('amplitude', {
                    label: 'Amplitude',
                    min: 0,
                    max: 1.5,
                    step: 0.05,
                    value: Number.isFinite(config.amplitude) ? config.amplitude : 0,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { amplitude: val });
                        this.renderReactivityTelemetry();
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} amplitude ${val.toFixed(2)}`, 'info');
                    }
                });
            }

            if (config.type === 'lfo' && !config.tempoSync) {
                addSlider('frequency', {
                    label: 'Frequency (Hz)',
                    min: 0,
                    max: 2,
                    step: 0.01,
                    value: Number.isFinite(config.frequency) ? config.frequency : 0,
                    format: (val) => `${val.toFixed(2)} Hz`,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { frequency: val });
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} frequency ${val.toFixed(2)} Hz`, 'info');
                    }
                });
            }

            if (config.tempoSync) {
                addSlider('division', {
                    label: 'Tempo Multiplier',
                    min: 0.25,
                    max: 4,
                    step: 0.25,
                    value: Number.isFinite(config.division) ? config.division : 1,
                    format: (val) => `×${val.toFixed(2)}`,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { division: val });
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} tempo ×${val.toFixed(2)}`, 'info');
                    }
                });
            }

            if (config.type === 'beatEnvelope') {
                addSlider('amount', {
                    label: 'Amount',
                    min: 0,
                    max: 1.5,
                    step: 0.05,
                    value: Number.isFinite(config.amount) ? config.amount : 1,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { amount: val });
                        this.renderReactivityTelemetry();
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} amount ${val.toFixed(2)}`, 'info');
                    }
                });

                addSlider('decay', {
                    label: 'Decay',
                    min: 0.2,
                    max: 0.95,
                    step: 0.01,
                    value: Number.isFinite(config.decay) ? config.decay : 0.6,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { decay: val });
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} decay ${val.toFixed(2)}`, 'info');
                    }
                });
            }

            if (config.type === 'noise') {
                addSlider('noiseSmoothing', {
                    label: 'Drift Smoothness',
                    min: 0.4,
                    max: 0.95,
                    step: 0.01,
                    value: Number.isFinite(config.noiseSmoothing) ? config.noiseSmoothing : 0.7,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { noiseSmoothing: val });
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} smoothness ${val.toFixed(2)}`, 'info');
                    }
                });
            }

            if (config.type === 'stepSequencer') {
                addSlider('amount', {
                    label: 'Step Amount',
                    min: 0,
                    max: 1.5,
                    step: 0.05,
                    value: Number.isFinite(config.amount) ? config.amount : 1,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { amount: val });
                        this.renderReactivityTelemetry();
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} amount ${val.toFixed(2)}`, 'info');
                    }
                });
            }

            if (config.type === 'custom' && Number.isFinite(config.smoothing)) {
                addSlider('smoothing', {
                    label: 'Smoothing',
                    min: 0,
                    max: 0.9,
                    step: 0.05,
                    value: config.smoothing,
                    onChange: (val) => {
                        this.reactivityController.updateModulatorConfig(name, { smoothing: val });
                        this.updateModulatorControlState(name);
                    },
                    onCommit: (val) => {
                        this.updateStatus(`${this.getModulatorTelemetryLabel(name)} smoothing ${val.toFixed(2)}`, 'info');
                    }
                });
            }

            container.appendChild(card);
            this.modulatorUi.controls.set(name, controlEntry);
        });

        this.refreshAllModulatorControlStates();
    }

    createModulatorSlider(container, options = {}) {
        if (!container) return null;
        const {
            label = 'Control',
            min = 0,
            max = 1,
            step = 0.01,
            value = 0,
            format,
            onChange,
            onCommit
        } = options;

        const formatter = typeof format === 'function' ? format : (val) => val.toFixed(2);

        const wrapper = document.createElement('label');
        wrapper.className = 'modulator-slider';

        const title = document.createElement('span');
        title.className = 'modulator-slider__label';
        title.textContent = label;
        wrapper.appendChild(title);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'modulator-slider__input';
        slider.min = `${min}`;
        slider.max = `${max}`;
        slider.step = `${step}`;
        slider.value = `${Number.isFinite(value) ? value : 0}`;
        slider.setAttribute('aria-label', label);

        const readout = document.createElement('span');
        readout.className = 'modulator-slider__value';
        readout.textContent = formatter(Number.isFinite(value) ? value : 0);

        slider.addEventListener('input', (event) => {
            const numeric = Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : parseFloat(event.target.value);
            readout.textContent = formatter(numeric);
            if (typeof onChange === 'function') {
                onChange(numeric);
            }
        });

        if (typeof onCommit === 'function') {
            slider.addEventListener('change', (event) => {
                const numeric = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : parseFloat(event.target.value);
                onCommit(numeric);
            });
        }

        wrapper.appendChild(slider);
        wrapper.appendChild(readout);
        container.appendChild(wrapper);

        return {
            wrapper,
            input: slider,
            readout,
            formatter
        };
    }

    handleModulatorToggle(name) {
        if (!name) return;
        const enabled = this.reactivityController.isModulatorEnabled(name);
        this.reactivityController.setModulatorEnabled(name, !enabled);
        const label = this.getModulatorTelemetryLabel(name);
        this.updateStatus(`${label} ${enabled ? 'disabled' : 'enabled'}`, enabled ? 'warning' : 'success');
        this.updateModulatorControlState(name);
        this.renderReactivityTelemetry();
    }

    updateModulatorControlState(name) {
        const control = this.modulatorUi.controls.get(name);
        const config = this.reactivityController.getModulatorDefinition(name);
        if (!control || !config) {
            return;
        }

        const enabled = this.reactivityController.isModulatorEnabled(name);
        control.card.classList.toggle('modulator-card--disabled', !enabled);
        control.toggle.setAttribute('aria-pressed', String(enabled));
        control.toggle.textContent = enabled ? 'Disable' : 'Enable';
        control.toggle.dataset.state = enabled ? 'on' : 'off';
        control.toggle.title = enabled ? 'Disable modulator' : 'Enable modulator';

        if (control.meta) {
            control.meta.textContent = this.describeModulator(config);
        }

        const updateSlider = (entry, value) => {
            if (!entry) return;
            const numeric = Number.isFinite(value) ? value : 0;
            entry.input.value = `${numeric}`;
            entry.input.disabled = !enabled;
            const formatFn = entry.formatter || ((val) => val.toFixed(2));
            entry.readout.textContent = formatFn(numeric);
        };

        updateSlider(control.amplitude, config.amplitude);
        updateSlider(control.frequency, config.frequency);
        updateSlider(control.division, config.division);
        updateSlider(control.amount, config.amount);
        updateSlider(control.decay, config.decay);
        updateSlider(control.noiseSmoothing, config.noiseSmoothing);
        updateSlider(control.smoothing, config.smoothing);
    }

    refreshAllModulatorControlStates() {
        if (!this.modulatorUi || !this.modulatorUi.controls) {
            return;
        }
        this.modulatorUi.controls.forEach((_, name) => this.updateModulatorControlState(name));
    }

    describeModulator(config) {
        if (!config) return '';
        if (config.tempoSync) {
            const tempo = this.reactivityController.getGlobalTempo();
            const division = Number.isFinite(config.division) ? config.division : 1;
            return `Tempo sync ×${division.toFixed(2)} @ ${Math.round(tempo)} BPM`;
        }
        if (config.type === 'beatEnvelope') {
            return 'Triggers on beat transients';
        }
        if (config.type === 'noise') {
            return 'Organic drift generator';
        }
        if (config.type === 'stepSequencer') {
            return 'Quantised pulse pattern';
        }
        return 'Free-run modulator';
    }

    initializeSceneLab() {
        this.sceneUi = {
            list: this.dom.sceneList,
            captureBtn: this.dom.captureSceneBtn,
            applyBtn: this.dom.applySceneBtn,
            saveBtn: this.dom.saveSceneSetBtn,
            loadBtn: this.dom.loadSceneSetBtn,
            clearBtn: this.dom.clearSceneSetBtn,
            crossfadeInput: this.dom.sceneCrossfadeInput,
            crossfadeValue: this.dom.sceneCrossfadeValue,
            hotkeyHint: this.dom.sceneHotkeyHint,
            persistenceStatus: this.dom.sceneStorageStatus
        };

        this.initializeSceneTimelineUi();

        this.sceneState.storageAvailable = this.detectLocalStorageAvailability();

        if (this.sceneUi.captureBtn) {
            this.sceneUi.captureBtn.addEventListener('click', () => this.captureCurrentScene());
        }

        if (this.sceneUi.applyBtn) {
            this.sceneUi.applyBtn.addEventListener('click', () => this.launchSelectedScene());
        }

        if (this.sceneUi.saveBtn) {
            this.sceneUi.saveBtn.addEventListener('click', () => this.handleSceneSetSave());
        }

        if (this.sceneUi.loadBtn) {
            this.sceneUi.loadBtn.addEventListener('click', () => this.handleSceneSetLoad());
        }

        if (this.sceneUi.clearBtn) {
            this.sceneUi.clearBtn.addEventListener('click', () => this.handleSceneSetClear());
        }

        if (this.sceneUi.crossfadeInput) {
            const initial = Number(this.sceneUi.crossfadeInput.value);
            if (Number.isFinite(initial)) {
                this.sceneState.crossfadeSeconds = Math.max(0, initial);
            }

            this.sceneUi.crossfadeInput.addEventListener('input', (event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                    this.sceneState.crossfadeSeconds = Math.max(0, value);
                    this.updateSceneCrossfadeDisplay();
                    this.markSceneStateDirty();
                }
            });
            this.updateSceneCrossfadeDisplay();
        }

        if (this.sceneUi.list) {
            this.sceneUi.list.addEventListener('click', (event) => this.handleSceneListClick(event));
            this.sceneUi.list.addEventListener('keydown', (event) => this.handleSceneListKeyDown(event));
        }

        this.sceneState.storageHasData = this.sceneState.storageAvailable
            && Boolean(window.localStorage?.getItem?.(this.sceneState.storageKey));

        if (this.sceneState.storageHasData) {
            this.loadSceneSetFromStorage({ announce: false });
        } else {
            this.renderSceneList();
            this.updateSceneUiState();
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
            this.updateSceneTimelineStatus();
        }

        document.addEventListener('keydown', this.boundSceneHotkeyHandler);
        window.addEventListener('beforeunload', this.boundBeforeUnloadHandler);
    }

    initializeSceneTimelineUi() {
        this.sceneTimelineUi = {
            container: this.dom.sceneTimeline,
            list: this.dom.timelineList,
            status: this.dom.timelineStatus,
            addCueBtn: this.dom.timelineAddCueBtn,
            clearBtn: this.dom.timelineClearBtn,
            armBtn: this.dom.timelineArmBtn,
            followBtn: this.dom.timelineFollowBtn,
            loopBtn: this.dom.timelineLoopBtn
        };

        const {
            addCueBtn,
            clearBtn,
            armBtn,
            followBtn,
            loopBtn,
            list
        } = this.sceneTimelineUi;

        if (addCueBtn) {
            addCueBtn.addEventListener('click', () => this.handleAddTimelineCue());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSceneTimeline({ announce: true }));
        }

        if (armBtn) {
            armBtn.addEventListener('click', () => this.toggleTimelineArmed());
        }

        if (followBtn) {
            followBtn.addEventListener('click', () => this.toggleTimelineFollow());
        }

        if (loopBtn) {
            loopBtn.addEventListener('click', () => this.toggleTimelineLoop());
        }

        if (list) {
            const handleFieldEdit = (event) => this.handleTimelineFieldEdit(event);
            list.addEventListener('input', handleFieldEdit);
            list.addEventListener('change', handleFieldEdit);
            list.addEventListener('click', (event) => this.handleTimelineListClick(event));
        }

        this.updateSceneTimelineUiState();
        this.renderSceneTimeline();
        this.updateSceneTimelineStatus();
    }

    updateSceneCrossfadeDisplay() {
        if (!this.sceneUi.crossfadeValue) return;
        const seconds = Number.isFinite(this.sceneState.crossfadeSeconds)
            ? this.sceneState.crossfadeSeconds
            : 0;
        this.sceneUi.crossfadeValue.textContent = `${seconds.toFixed(1)}s`;
    }

    handleSceneListClick(event) {
        const card = event.target.closest('.scene-card');
        if (!card || !this.sceneUi.list || !this.sceneUi.list.contains(card)) {
            return;
        }

        const sceneId = card.dataset.sceneId;
        if (!sceneId) return;

        const actionButton = event.target.closest('[data-scene-action]');
        if (actionButton) {
            const action = actionButton.dataset.sceneAction;
            this.handleSceneAction(action, sceneId);
            event.stopPropagation();
            return;
        }

        this.selectScene(sceneId, { announce: true });
    }

    handleSceneListKeyDown(event) {
        if (event.defaultPrevented) return;
        const card = event.target.closest('.scene-card');
        if (!card || !this.sceneUi.list || !this.sceneUi.list.contains(card)) {
            return;
        }

        const sceneId = card.dataset.sceneId;
        if (!sceneId) return;

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.selectScene(sceneId, { announce: true });
        }
    }

    handleSceneAction(action, sceneId) {
        if (!action) return;
        const scene = this.getSceneById(sceneId);
        if (!scene) {
            this.updateStatus('Scene not found', 'warning');
            return;
        }

        switch (action) {
            case 'activate':
                this.beginSceneTransition(scene);
                break;
            case 'rename': {
                const previousName = scene.name;
                const nextName = typeof window !== 'undefined'
                    ? window.prompt('Rename scene', scene.name)
                    : null;
                const trimmed = nextName?.trim();
                if (trimmed) {
                    scene.name = trimmed;
                    this.renderSceneList();
                    this.updateSceneUiState();
                    this.markSceneStateDirty();
                    this.handleSceneRenamed(scene.id, previousName, trimmed);
                    this.updateStatus(`Scene renamed to ${trimmed}`, 'info');
                }
                break;
            }
            case 'duplicate': {
                const clone = this.cloneScene(scene);
                if (clone) {
                    this.sceneState.scenes.splice(
                        this.sceneState.scenes.findIndex((entry) => entry.id === scene.id) + 1,
                        0,
                        clone
                    );
                    this.sceneState.selectedSceneId = clone.id;
                    this.renderSceneList();
                    this.updateSceneUiState();
                    this.markSceneStateDirty();
                    this.updateStatus(`Duplicated ${scene.name}`, 'success');
                }
                break;
            }
            case 'delete': {
                const index = this.sceneState.scenes.findIndex((entry) => entry.id === scene.id);
                if (index >= 0) {
                    this.sceneState.scenes.splice(index, 1);
                    if (this.sceneState.selectedSceneId === scene.id) {
                        this.sceneState.selectedSceneId = this.sceneState.scenes[index]?.id || null;
                    }
                    this.renderSceneList();
                    this.updateSceneUiState();
                    this.markSceneStateDirty();
                    this.handleSceneRemoved(scene.id);
                    this.updateStatus(`Deleted ${scene.name}`, 'warning');
                }
                break;
            }
            case 'move-up': {
                const index = this.sceneState.scenes.findIndex((entry) => entry.id === scene.id);
                if (index > 0) {
                    const [removed] = this.sceneState.scenes.splice(index, 1);
                    this.sceneState.scenes.splice(index - 1, 0, removed);
                    this.renderSceneList();
                    this.updateSceneUiState();
                    this.markSceneStateDirty();
                }
                break;
            }
            case 'move-down': {
                const index = this.sceneState.scenes.findIndex((entry) => entry.id === scene.id);
                if (index >= 0 && index < this.sceneState.scenes.length - 1) {
                    const [removed] = this.sceneState.scenes.splice(index, 1);
                    this.sceneState.scenes.splice(index + 1, 0, removed);
                    this.renderSceneList();
                    this.updateSceneUiState();
                    this.markSceneStateDirty();
                }
                break;
            }
            default:
                break;
        }

        this.updateSceneUiState();
    }

    renderSceneList() {
        const container = this.sceneUi.list;
        if (!container) return;

        container.innerHTML = '';
        const scenes = this.sceneState.scenes || [];

        if (!scenes.length) {
            const empty = document.createElement('div');
            empty.className = 'scene-lab__empty';
            empty.textContent = 'Capture the current modulation blend to build a scene set.';
            container.appendChild(empty);
            this.updateSceneHotkeyHint();
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
            this.updateSceneTimelineStatus();
            return;
        }

        scenes.forEach((scene, index) => {
            const card = document.createElement('div');
            card.className = 'scene-card';
            card.dataset.sceneId = scene.id;
            if (index < 9) {
                card.dataset.sceneHotkey = String(index + 1);
            }
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            if (scene.id === this.sceneState.selectedSceneId) {
                card.classList.add('scene-card--selected');
                card.setAttribute('aria-selected', 'true');
            } else {
                card.setAttribute('aria-selected', 'false');
            }

            const header = document.createElement('div');
            header.className = 'scene-card__header';

            const title = document.createElement('span');
            title.className = 'scene-card__title';
            title.textContent = scene.name;
            header.appendChild(title);

            if (index < 9) {
                const hotkey = document.createElement('span');
                hotkey.className = 'scene-card__hotkey';
                hotkey.textContent = `⌨ ${index + 1}`;
                header.appendChild(hotkey);
            }

            const timestamp = document.createElement('span');
            timestamp.className = 'scene-card__timestamp';
            timestamp.textContent = this.describeSceneTimestamp(scene.createdAt);
            header.appendChild(timestamp);

            card.appendChild(header);

            const meta = document.createElement('div');
            meta.className = 'scene-card__meta';
            const snapshot = scene.snapshot || {};
            const modulatorCount = Object.keys(snapshot.modulatorConfigs || {}).length;
            const vector = snapshot.liveVector || { x: 0, y: 0 };
            const hotkeyLabel = index < 9 ? ` Hotkey ${index + 1}.` : '';
            card.setAttribute(
                'aria-label',
                `${scene.name}. ${modulatorCount} modulators. Pad X ${vector.x.toFixed(2)}, Y ${vector.y.toFixed(2)}.${hotkeyLabel}`
            );
            meta.textContent = `${modulatorCount} modulators • Pad ${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}`;
            card.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'scene-card__actions';

            const launchBtn = document.createElement('button');
            launchBtn.type = 'button';
            launchBtn.className = 'scene-card__action scene-card__action--launch';
            launchBtn.dataset.sceneAction = 'activate';
            launchBtn.textContent = 'Launch';
            actions.appendChild(launchBtn);

            const renameBtn = document.createElement('button');
            renameBtn.type = 'button';
            renameBtn.className = 'scene-card__action';
            renameBtn.dataset.sceneAction = 'rename';
            renameBtn.textContent = 'Rename';
            actions.appendChild(renameBtn);

            const duplicateBtn = document.createElement('button');
            duplicateBtn.type = 'button';
            duplicateBtn.className = 'scene-card__action';
            duplicateBtn.dataset.sceneAction = 'duplicate';
            duplicateBtn.textContent = 'Duplicate';
            actions.appendChild(duplicateBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'scene-card__action';
            deleteBtn.dataset.sceneAction = 'delete';
            deleteBtn.textContent = 'Delete';
            actions.appendChild(deleteBtn);

            if (index > 0) {
                const upBtn = document.createElement('button');
                upBtn.type = 'button';
                upBtn.className = 'scene-card__action scene-card__action--move';
                upBtn.dataset.sceneAction = 'move-up';
                upBtn.textContent = '↑';
                upBtn.title = 'Move up';
                actions.appendChild(upBtn);
            }

            if (index < scenes.length - 1) {
                const downBtn = document.createElement('button');
                downBtn.type = 'button';
                downBtn.className = 'scene-card__action scene-card__action--move';
                downBtn.dataset.sceneAction = 'move-down';
                downBtn.textContent = '↓';
                downBtn.title = 'Move down';
                actions.appendChild(downBtn);
            }

            card.appendChild(actions);

            container.appendChild(card);
        });

        this.updateSceneHotkeyHint();
        this.renderSceneTimeline();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus();
    }

    selectScene(sceneId, options = {}) {
        if (!sceneId) return;
        this.sceneState.selectedSceneId = sceneId;
        this.renderSceneList();
        this.updateSceneUiState();

        if (options.announce) {
            const scene = this.getSceneById(sceneId);
            if (scene) {
                this.updateStatus(`Selected ${scene.name}`, 'info');
            }
        }
    }

    launchSelectedScene() {
        if (!this.sceneState.selectedSceneId) {
            this.updateStatus('Select a scene to launch', 'warning');
            return;
        }

        const scene = this.getSceneById(this.sceneState.selectedSceneId);
        if (!scene) {
            this.updateStatus('Scene not found', 'warning');
            return;
        }

        this.beginSceneTransition(scene);
    }

    updateSceneUiState() {
        const hasSelection = Boolean(this.sceneState.selectedSceneId);
        if (this.sceneUi.applyBtn) {
            this.sceneUi.applyBtn.disabled = !hasSelection;
        }

        const hasScenes = this.sceneState.scenes.length > 0;
        if (this.sceneUi.saveBtn) {
            this.sceneUi.saveBtn.disabled = !this.sceneState.storageAvailable || !hasScenes;
        }

        if (this.sceneUi.loadBtn) {
            this.sceneUi.loadBtn.disabled = !this.sceneState.storageAvailable || !this.sceneState.storageHasData;
        }

        if (this.sceneUi.clearBtn) {
            this.sceneUi.clearBtn.disabled = !hasScenes && !this.sceneState.storageHasData;
        }

        this.updateScenePersistenceUi();
        this.updateSceneTimelineUiState();
    }

    markSceneStateDirty() {
        if (!this.sceneState.isDirty) {
            this.sceneState.isDirty = true;
            this.updateScenePersistenceUi();
        } else {
            this.updateScenePersistenceUi();
        }
    }

    updateScenePersistenceUi() {
        if (!this.sceneUi.persistenceStatus) {
            return;
        }

        const statusEl = this.sceneUi.persistenceStatus;
        if (!this.sceneState.storageAvailable) {
            statusEl.textContent = 'Local storage unavailable';
            statusEl.dataset.state = 'unavailable';
        } else if (this.sceneState.isDirty) {
            statusEl.textContent = 'Unsaved changes';
            statusEl.dataset.state = 'dirty';
        } else if (this.sceneState.storageHasData) {
            const savedAt = this.sceneState.lastSavedAt;
            statusEl.textContent = savedAt
                ? `Saved ${this.describeSceneTimestamp(savedAt)}`
                : 'Saved';
            statusEl.dataset.state = 'saved';
        } else {
            statusEl.textContent = this.sceneState.scenes.length
                ? 'Not saved'
                : 'No scenes yet';
            statusEl.dataset.state = 'empty';
        }

        if (this.sceneUi.hotkeyHint) {
            this.updateSceneHotkeyHint();
        }
    }

    getSceneById(sceneId) {
        if (!sceneId) return null;
        return this.sceneState.scenes.find((scene) => scene.id === sceneId) || null;
    }

    updateSceneHotkeyHint() {
        if (!this.sceneUi.hotkeyHint) {
            return;
        }

        const { scenes } = this.sceneState;
        if (!scenes.length) {
            this.sceneUi.hotkeyHint.textContent = 'Capture scenes to unlock hotkeys (1-9).';
            return;
        }

        const descriptors = scenes.slice(0, 5).map((scene, index) => {
            if (index >= 9) return null;
            return `${index + 1}›${scene.name}`;
        }).filter(Boolean);

        const suffix = scenes.length > 5 ? '…' : '';
        this.sceneUi.hotkeyHint.textContent = descriptors.length
            ? `Hotkeys: ${descriptors.join('  •  ')}${suffix}`
            : 'Hotkeys: assignable to first 9 scenes';
    }

    detectLocalStorageAvailability() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return false;
        }
        try {
            const testKey = `${this.sceneState.storageKey}__test`;
            window.localStorage.setItem(testKey, '1');
            window.localStorage.removeItem(testKey);
            return true;
        } catch (error) {
            console.warn('Scene Lab storage unavailable', error);
            return false;
        }
    }

    createSceneSnapshot() {
        const base = this.reactivityController.captureState({
            includeParameters: false,
            includeModulatorConfigs: true,
            includeLiveVector: true
        });

        return {
            ...base,
            axisLocks: { ...this.axisLocks },
            automationSnapshot: this.cloneAutomationSnapshot(this.automationSnapshot)
        };
    }

    captureCurrentScene() {
        const snapshot = this.createSceneSnapshot();
        if (!snapshot) {
            this.updateStatus('Unable to capture scene snapshot', 'error');
            return null;
        }

        this.sceneState.captureCount += 1;
        const id = `scene-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        const name = `Scene ${this.sceneState.captureCount}`;
        const scene = {
            id,
            name,
            createdAt: Date.now(),
            snapshot
        };

        this.sceneState.scenes.push(scene);
        this.sceneState.selectedSceneId = id;

        this.renderSceneList();
        this.updateSceneUiState();
        this.markSceneStateDirty();
        this.updateStatus(`Captured ${name}`, 'success');

        return scene;
    }

    cloneAutomationSnapshot(snapshot) {
        if (!snapshot) return null;
        try {
            return JSON.parse(JSON.stringify(snapshot));
        } catch (error) {
            console.warn('Failed to clone automation snapshot', error);
            return null;
        }
    }

    cloneModulatorConfigs(configs = {}) {
        const cloned = {};
        Object.entries(configs || {}).forEach(([name, config]) => {
            const copy = {};
            Object.entries(config || {}).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    copy[key] = [...value];
                } else if (value && typeof value === 'object') {
                    copy[key] = { ...value };
                } else {
                    copy[key] = value;
                }
            });
            cloned[name] = copy;
        });
        return cloned;
    }

    cloneSceneSnapshot(snapshot = {}) {
        return {
            ...snapshot,
            liveVector: snapshot.liveVector ? { ...snapshot.liveVector } : undefined,
            axisLocks: snapshot.axisLocks ? { ...snapshot.axisLocks } : undefined,
            modulatorConfigs: this.cloneModulatorConfigs(snapshot.modulatorConfigs),
            automationSnapshot: this.cloneAutomationSnapshot(snapshot.automationSnapshot)
        };
    }

    cloneScene(scene) {
        if (!scene) return null;
        const snapshot = this.cloneSceneSnapshot(scene.snapshot);
        return {
            id: `scene-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            name: `${scene.name} Copy`,
            createdAt: Date.now(),
            snapshot
        };
    }

    handleSceneSetSave() {
        this.persistSceneStateToStorage({ announce: true });
    }

    handleSceneSetLoad() {
        const result = this.loadSceneSetFromStorage({ announce: true });
        if (!result) {
            this.updateSceneUiState();
        }
    }

    handleSceneSetClear() {
        this.confirmSceneSetReset();
    }

    persistSceneStateToStorage(options = {}) {
        const { announce = false } = options;

        if (!this.sceneState.storageAvailable) {
            if (announce) {
                this.updateStatus('Local storage unavailable', 'warning');
            }
            return false;
        }

        const payload = {
            version: SCENE_STORAGE_SCHEMA_VERSION,
            savedAt: Date.now(),
            crossfadeSeconds: this.sceneState.crossfadeSeconds,
            captureCount: this.sceneState.captureCount,
            scenes: this.sceneState.scenes.map((scene) => ({
                id: scene.id,
                name: scene.name,
                createdAt: scene.createdAt,
                snapshot: this.cloneSceneSnapshot(scene.snapshot)
            })),
            timeline: {
                cues: (this.sceneState.timeline?.cues || []).map((cue) => ({
                    id: cue.id,
                    sceneId: cue.sceneId,
                    time: Number.isFinite(cue.time) ? cue.time : 0,
                    label: cue.label || '',
                    crossfadeSeconds: Number.isFinite(cue.crossfadeSeconds)
                        ? Math.max(0, cue.crossfadeSeconds)
                        : null,
                    notes: cue.notes || ''
                })),
                loop: Boolean(this.sceneState.timeline?.loop),
                followPlayback: this.sceneState.timeline?.followPlayback !== false
            }
        };

        try {
            if (!payload.scenes.length) {
                window.localStorage.removeItem(this.sceneState.storageKey);
                this.sceneState.storageHasData = false;
                this.sceneState.lastSavedAt = null;
            } else {
                window.localStorage.setItem(this.sceneState.storageKey, JSON.stringify(payload));
                this.sceneState.storageHasData = true;
                this.sceneState.lastSavedAt = payload.savedAt;
            }
            this.sceneState.isDirty = false;
            this.updateScenePersistenceUi();

            if (announce) {
                const message = payload.scenes.length
                    ? 'Scene set saved locally'
                    : 'Scene storage cleared';
                this.updateStatus(message, 'success');
            }
            return true;
        } catch (error) {
            console.error('Failed to persist scene set', error);
            if (announce) {
                this.updateStatus('Unable to save scene set', 'error');
            }
            return false;
        }
    }

    loadSceneSetFromStorage(options = {}) {
        const { announce = false } = options;

        if (!this.sceneState.storageAvailable) {
            if (announce) {
                this.updateStatus('Local storage unavailable', 'warning');
            }
            return null;
        }

        let raw = null;
        try {
            raw = window.localStorage.getItem(this.sceneState.storageKey);
        } catch (error) {
            console.error('Failed to read scene storage', error);
            if (announce) {
                this.updateStatus('Unable to access saved scenes', 'error');
            }
            return null;
        }

        if (!raw) {
            this.sceneState.storageHasData = false;
            if (announce) {
                this.updateStatus('No saved scene set found', 'info');
            }
            this.updateScenePersistenceUi();
            return null;
        }

        try {
            const payload = JSON.parse(raw);
            if (!payload || !Array.isArray(payload.scenes)) {
                throw new Error('Invalid scene set payload');
            }

            const scenes = payload.scenes.map((scene, index) => ({
                id: scene.id || `scene-${Date.now()}-${index.toString(16)}`,
                name: scene.name || `Scene ${index + 1}`,
                createdAt: scene.createdAt || Date.now(),
                snapshot: this.cloneSceneSnapshot(scene.snapshot || {})
            }));

            this.sceneState.scenes = scenes;
            this.sceneState.selectedSceneId = scenes[0]?.id || null;
            this.sceneState.storageHasData = scenes.length > 0;
            this.sceneState.lastSavedAt = Number.isFinite(Number(payload.savedAt))
                ? Number(payload.savedAt)
                : Date.now();
            this.sceneState.isDirty = false;
            const storedCaptureCount = Number(payload.captureCount);
            if (Number.isFinite(storedCaptureCount)) {
                this.sceneState.captureCount = Math.max(storedCaptureCount, scenes.length);
            } else {
                this.sceneState.captureCount = scenes.length;
            }

            const crossfadeSeconds = Number(payload.crossfadeSeconds);
            if (Number.isFinite(crossfadeSeconds)) {
                this.sceneState.crossfadeSeconds = Math.max(0, crossfadeSeconds);
                if (this.sceneUi.crossfadeInput) {
                    this.sceneUi.crossfadeInput.value = `${this.sceneState.crossfadeSeconds}`;
                }
            }
            this.updateSceneCrossfadeDisplay();

            const storedTimeline = payload.timeline || {};
            const storedCues = Array.isArray(storedTimeline.cues) ? storedTimeline.cues : [];
            this.sceneState.timeline.cues = storedCues.map((cue, index) => ({
                id: cue.id || `cue-${Date.now()}-${index.toString(16)}`,
                sceneId: cue.sceneId || '',
                time: Number.isFinite(Number(cue.time)) ? Math.max(0, Number(cue.time)) : 0,
                label: cue.label || '',
                crossfadeSeconds: Number.isFinite(Number(cue.crossfadeSeconds))
                    ? Math.max(0, Number(cue.crossfadeSeconds))
                    : null,
                notes: cue.notes ? String(cue.notes) : ''
            }));
            this.sceneState.timeline.loop = Boolean(storedTimeline.loop);
            this.sceneState.timeline.followPlayback = storedTimeline.followPlayback !== false;
            this.sceneState.timeline.isArmed = false;
            this.sceneState.timeline.nextCueIndex = 0;
            this.sceneTimelineRuntime.triggeredCueIds.clear();
            this.resetTimelineRuntime({ preserveTriggered: false });
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
            this.updateSceneTimelineStatus({ force: true });

            this.renderSceneList();
            this.updateSceneUiState();

            if (announce) {
                this.updateStatus('Scene set loaded', 'success');
            }
            return scenes;
        } catch (error) {
            console.error('Failed to load scene set', error);
            this.clearSceneStorage();
            this.sceneState.scenes = [];
            this.sceneState.selectedSceneId = null;
            this.sceneState.captureCount = 0;
            this.sceneState.lastSavedAt = null;
            this.sceneState.isDirty = false;
            this.renderSceneList();
            this.updateSceneUiState();
            if (announce) {
                this.updateStatus('Saved scene set corrupted – reset', 'error');
            }
            return null;
        }
    }

    clearSceneStorage(options = {}) {
        const { announce = false } = options;

        if (!this.sceneState.storageAvailable) {
            if (announce) {
                this.updateStatus('Local storage unavailable', 'warning');
            }
            return false;
        }

        try {
            window.localStorage.removeItem(this.sceneState.storageKey);
            this.sceneState.storageHasData = false;
            this.sceneState.lastSavedAt = null;
            this.updateScenePersistenceUi();
            if (announce) {
                this.updateStatus('Scene set cleared from storage', 'warning');
            }
            return true;
        } catch (error) {
            console.error('Failed to clear scene storage', error);
            if (announce) {
                this.updateStatus('Unable to clear scene storage', 'error');
            }
            return false;
        }
    }

    confirmSceneSetReset() {
        const hasScenes = this.sceneState.scenes.length > 0;
        const hasStored = this.sceneState.storageHasData;

        if (!hasScenes && !hasStored) {
            this.updateStatus('No scenes to clear', 'info');
            return;
        }

        const message = hasStored
            ? 'Clear all captured scenes and remove the saved set? This cannot be undone.'
            : 'Clear all captured scenes from memory?';

        if (typeof window !== 'undefined' && !window.confirm(message)) {
            return;
        }

        if (hasStored) {
            this.clearSceneStorage();
        }

        this.sceneState.scenes = [];
        this.sceneState.selectedSceneId = null;
        this.sceneState.captureCount = 0;
        this.sceneState.isDirty = false;
        this.sceneState.lastSavedAt = null;

        this.clearSceneTimeline({ preserveSettings: false, announce: false });

        this.renderSceneList();
        this.updateSceneUiState();
        this.updateStatus('Scene lab reset', 'warning');
    }

    handleSceneHotkey(event) {
        if (!event || event.defaultPrevented) return;
        if (!this.sceneState.scenes.length) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;

        const key = event.key;
        if (!key || !/^[1-9]$/.test(key)) {
            return;
        }

        const target = event.target;
        const isElement = typeof Element !== 'undefined' && target instanceof Element;
        if (isElement) {
            const interactive = target.closest('input, textarea, select, button, [contenteditable="true"]');
            if (interactive) {
                return;
            }
        } else if (target && typeof target.closest === 'function') {
            const interactive = target.closest('input, textarea, select, button, [contenteditable="true"]');
            if (interactive) {
                return;
            }
        }

        const index = Number(key) - 1;
        const scene = this.sceneState.scenes[index];
        if (!scene) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.beginSceneTransition(scene);
    }

    handleBeforeUnload(event) {
        if (!this.sceneState || !this.sceneState.isDirty || !this.sceneState.scenes.length) {
            return;
        }

        event.preventDefault();
        // eslint-disable-next-line no-param-reassign
        event.returnValue = '';
    }

    beginSceneTransition(scene, options = {}) {
        if (!scene) return;

        const duration = Number.isFinite(options.crossfadeSeconds)
            ? options.crossfadeSeconds
            : this.sceneState.crossfadeSeconds;
        const crossfade = Math.max(0, Number(duration) || 0);

        const targetSnapshot = this.cloneSceneSnapshot(scene.snapshot);
        const currentSnapshot = this.reactivityController.captureState({
            includeModulatorConfigs: true,
            includeLiveVector: true
        });
        currentSnapshot.axisLocks = { ...this.axisLocks };

        this.sceneState.selectedSceneId = scene.id;
        this.renderSceneList();
        this.updateSceneUiState();

        if (crossfade <= 0.01 || !this.isPlaying) {
            this.applySceneState(targetSnapshot, { enforceAxisLocks: true, loadAutomation: true });
            this.sceneState.transition = null;
            const statusLabel = this.isPlaying
                ? `Scene "${scene.name}" loaded`
                : `Scene "${scene.name}" primed`;
            this.updateStatus(statusLabel, 'success');
            return;
        }

        this.sceneState.transition = {
            sceneId: scene.id,
            sceneName: scene.name,
            from: currentSnapshot,
            to: targetSnapshot,
            duration: crossfade,
            elapsed: 0
        };

        this.suspendAutomationPlayback(600);
        this.updateStatus(`Scene "${scene.name}" transitioning over ${crossfade.toFixed(1)}s`, 'info');
    }

    easeSceneProgress(t) {
        const clamped = Math.max(0, Math.min(1, t));
        return clamped * clamped * (3 - 2 * clamped);
    }

    applyBlendedModulatorConfigs(fromConfigs = {}, toConfigs = {}, ratio = 1) {
        const names = new Set([
            ...Object.keys(fromConfigs || {}),
            ...Object.keys(toConfigs || {})
        ]);

        names.forEach((name) => {
            const start = fromConfigs?.[name] || {};
            const end = toConfigs?.[name] || {};
            const current = this.reactivityController.getModulatorDefinition(name) || {};
            const updates = {};
            const numericKeys = [
                'frequency',
                'amplitude',
                'offset',
                'phaseOffset',
                'beatBoost',
                'beatBoostDecay',
                'amount',
                'decay',
                'attack',
                'base',
                'smoothing',
                'division',
                'rate',
                'noiseSmoothing'
            ];

            numericKeys.forEach((key) => {
                const startVal = Number(start[key]);
                const endVal = Number(end[key]);
                if (Number.isFinite(startVal) && Number.isFinite(endVal)) {
                    updates[key] = startVal + (endVal - startVal) * ratio;
                } else if (Number.isFinite(endVal)) {
                    const fallback = Number.isFinite(current[key]) ? current[key] : endVal;
                    updates[key] = fallback + (endVal - fallback) * ratio;
                }
            });

            if (Object.keys(updates).length) {
                this.reactivityController.updateModulatorConfig(name, updates);
            }
        });
    }

    updateSceneTransition(deltaTime = 0) {
        const transition = this.sceneState.transition;
        if (!transition) return;

        const padEngaged = this.xyPad && typeof this.xyPad.isEngaged === 'function'
            ? this.xyPad.isEngaged()
            : false;
        if (padEngaged) {
            this.sceneState.transition = null;
            this.updateStatus('Scene transition cancelled – pad engaged', 'warning');
            return;
        }

        const dt = Math.max(0, Number(deltaTime) || 0);
        transition.elapsed += dt;
        const progress = transition.duration > 0 ? Math.min(1, transition.elapsed / transition.duration) : 1;
        const eased = this.easeSceneProgress(progress);

        if (transition.from && transition.to) {
            const fromVector = transition.from.liveVector || { x: 0, y: 0 };
            const toVector = transition.to.liveVector || fromVector;
            const blendedVector = {
                x: fromVector.x + (toVector.x - fromVector.x) * eased,
                y: fromVector.y + (toVector.y - fromVector.y) * eased
            };
            this.commitLiveVector(blendedVector, { updatePad: true });
            this.applyBlendedModulatorConfigs(transition.from.modulatorConfigs, transition.to.modulatorConfigs, eased);
        }

        if (progress >= 1) {
            this.sceneState.transition = null;
            this.applySceneState(transition.to, { enforceAxisLocks: true, loadAutomation: true });
            this.updateStatus(`Scene "${transition.sceneName || 'Scene'}" engaged`, 'success');
        }
    }

    applySceneState(state = {}, options = {}) {
        if (!state) return;

        const { enforceAxisLocks = false, loadAutomation = true } = options;

        if (enforceAxisLocks && state.axisLocks) {
            this.axisLocks = {
                x: Boolean(state.axisLocks.x),
                y: Boolean(state.axisLocks.y)
            };
            this.updateAxisLockUi();
        }

        if (state.modulatorConfigs) {
            this.reactivityController.applyModulatorSceneConfigs(state.modulatorConfigs);
        }

        if (state.liveVector) {
            this.commitLiveVector(state.liveVector, { updatePad: true });
        }

        if (loadAutomation && state.automationSnapshot) {
            this.loadAutomationSnapshot(state.automationSnapshot);
        }

        this.refreshAllModulatorControlStates();
        this.renderReactivityTelemetry();
    }

    describeSceneTimestamp(timestamp) {
        if (!timestamp) return '';
        const now = Date.now();
        const diff = Math.max(0, now - timestamp);
        const seconds = Math.round(diff / 1000);
        if (seconds < 60) {
            return `${seconds}s ago`;
        }
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        const hours = Math.round(minutes / 60);
        if (hours < 24) {
            return `${hours}h ago`;
        }
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleDateString();
        }
        return '';
    }

    formatTimelineTime(seconds = 0) {
        const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
        const minutes = Math.floor(value / 60);
        const secs = Math.floor(value % 60);
        const tenths = Math.round((value % 1) * 10);
        const base = `${minutes}:${secs.toString().padStart(2, '0')}`;
        return tenths > 0 ? `${base}.${tenths}` : base;
    }

    renderSceneTimeline() {
        const ui = this.sceneTimelineUi;
        if (!ui?.list) {
            return;
        }

        const { cues = [] } = this.sceneState.timeline || {};
        ui.list.innerHTML = '';

        if (!cues.length) {
            const empty = document.createElement('div');
            empty.className = 'scene-timeline__empty';
            empty.textContent = this.sceneState.scenes.length
                ? 'Add cues to automate your scene launches.'
                : 'Capture scenes to start building a performance timeline.';
            ui.list.appendChild(empty);
            return;
        }

        const runtime = this.sceneTimelineRuntime;
        const nextIndex = Math.max(0, Math.min(this.sceneState.timeline.nextCueIndex ?? 0, cues.length - 1));

        cues.forEach((cue, index) => {
            const item = document.createElement('div');
            item.className = 'scene-timeline__item';
            item.dataset.cueId = cue.id;

            if (runtime.triggeredCueIds.has(cue.id)) {
                item.classList.add('scene-timeline__item--triggered');
            }

            if (this.sceneState.timeline.isArmed && index === nextIndex) {
                item.classList.add('scene-timeline__item--upcoming');
            }

            const scene = this.getSceneById(cue.sceneId);
            if (!scene) {
                item.classList.add('scene-timeline__item--missing');
            }

            const header = document.createElement('div');
            header.className = 'scene-timeline__item-header';

            const title = document.createElement('span');
            title.className = 'scene-timeline__item-title';
            title.textContent = cue.label || scene?.name || `Cue ${index + 1}`;
            header.appendChild(title);

            const time = document.createElement('span');
            time.className = 'scene-timeline__item-time';
            time.textContent = `@ ${this.formatTimelineTime(cue.time)}`;
            header.appendChild(time);

            item.appendChild(header);

            const fields = document.createElement('div');
            fields.className = 'scene-timeline__item-fields';

            const sceneLabel = document.createElement('label');
            sceneLabel.textContent = 'Scene';
            const sceneSelect = document.createElement('select');
            sceneSelect.dataset.cueField = 'sceneId';
            sceneSelect.disabled = this.sceneState.scenes.length === 0;

            if (!this.sceneState.scenes.length) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No scenes available';
                option.selected = true;
                sceneSelect.appendChild(option);
            } else {
                this.sceneState.scenes.forEach((availableScene) => {
                    const option = document.createElement('option');
                    option.value = availableScene.id;
                    option.textContent = availableScene.name;
                    if (availableScene.id === cue.sceneId) {
                        option.selected = true;
                    }
                    sceneSelect.appendChild(option);
                });
            }

            sceneLabel.appendChild(sceneSelect);
            fields.appendChild(sceneLabel);

            const timeLabel = document.createElement('label');
            timeLabel.textContent = 'Time (s)';
            const timeInput = document.createElement('input');
            timeInput.type = 'number';
            timeInput.step = '0.1';
            timeInput.min = '0';
            timeInput.value = Number.isFinite(cue.time) ? cue.time : 0;
            timeInput.dataset.cueField = 'time';
            timeLabel.appendChild(timeInput);
            fields.appendChild(timeLabel);

            const crossfadeLabel = document.createElement('label');
            crossfadeLabel.textContent = 'Crossfade (s)';
            const crossfadeInput = document.createElement('input');
            crossfadeInput.type = 'number';
            crossfadeInput.step = '0.1';
            crossfadeInput.min = '0';
            crossfadeInput.placeholder = `${this.sceneState.crossfadeSeconds}`;
            crossfadeInput.value = Number.isFinite(cue.crossfadeSeconds) ? cue.crossfadeSeconds : '';
            crossfadeInput.dataset.cueField = 'crossfadeSeconds';
            crossfadeLabel.appendChild(crossfadeInput);
            fields.appendChild(crossfadeLabel);

            const labelField = document.createElement('label');
            labelField.textContent = 'Label';
            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.value = cue.label || scene?.name || '';
            labelInput.dataset.cueField = 'label';
            labelField.appendChild(labelInput);
            fields.appendChild(labelField);

            const notesField = document.createElement('label');
            notesField.textContent = 'Notes';
            const notesArea = document.createElement('textarea');
            notesArea.dataset.cueField = 'notes';
            notesArea.value = cue.notes || '';
            notesField.appendChild(notesArea);
            fields.appendChild(notesField);

            item.appendChild(fields);

            const actions = document.createElement('div');
            actions.className = 'scene-timeline__item-actions';

            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.dataset.cueAction = 'preview';
            previewBtn.textContent = 'Preview';
            previewBtn.disabled = !scene;
            actions.appendChild(previewBtn);

            const snapBtn = document.createElement('button');
            snapBtn.type = 'button';
            snapBtn.dataset.cueAction = 'snap-playhead';
            snapBtn.textContent = 'Align to Playhead';
            actions.appendChild(snapBtn);

            const jumpBtn = document.createElement('button');
            jumpBtn.type = 'button';
            jumpBtn.dataset.cueAction = 'jump';
            jumpBtn.textContent = 'Jump Audio';
            actions.appendChild(jumpBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.dataset.cueAction = 'delete';
            deleteBtn.textContent = 'Delete';
            actions.appendChild(deleteBtn);

            item.appendChild(actions);

            ui.list.appendChild(item);
        });
    }

    updateSceneTimelineUiState() {
        const timeline = this.sceneState.timeline;
        const ui = this.sceneTimelineUi || {};
        const hasScenes = this.sceneState.scenes.length > 0;
        const hasCues = Boolean(timeline?.cues?.length);

        if (ui.addCueBtn) {
            ui.addCueBtn.disabled = !hasScenes;
        }

        if (ui.clearBtn) {
            ui.clearBtn.disabled = !hasCues;
        }

        if (ui.armBtn) {
            ui.armBtn.disabled = !hasCues;
            const armed = Boolean(timeline?.isArmed);
            ui.armBtn.classList.toggle('scene-timeline__toggle--active', armed);
            ui.armBtn.setAttribute('aria-pressed', armed ? 'true' : 'false');
            ui.armBtn.textContent = armed ? '🛑 Disarm Timeline' : '🎯 Arm Timeline';
        }

        if (ui.followBtn) {
            const follow = timeline?.followPlayback !== false;
            ui.followBtn.classList.toggle('scene-timeline__toggle--active', follow);
            ui.followBtn.setAttribute('aria-pressed', follow ? 'true' : 'false');
            ui.followBtn.textContent = follow ? '⏱ Follow Playhead' : '🧭 Manual Advance';
        }

        if (ui.loopBtn) {
            const looping = Boolean(timeline?.loop);
            ui.loopBtn.classList.toggle('scene-timeline__toggle--active', looping);
            ui.loopBtn.setAttribute('aria-pressed', looping ? 'true' : 'false');
            ui.loopBtn.textContent = looping ? '🔁 Looping' : '🔁 Loop';
        }
    }

    updateSceneTimelineStatus(options = {}) {
        const ui = this.sceneTimelineUi;
        if (!ui?.status) {
            return;
        }

        const { currentTime = this.audio?.currentTime ?? 0, force = false } = options;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!force && now - (this.sceneTimelineRuntime.lastStatusUpdate || 0) < 120) {
            return;
        }
        this.sceneTimelineRuntime.lastStatusUpdate = now;

        const timeline = this.sceneState.timeline;
        const cues = timeline?.cues || [];

        if (!cues.length) {
            ui.status.textContent = this.sceneState.scenes.length
                ? 'Timeline idle – add cues to begin.'
                : 'Timeline idle – capture scenes first.';
            ui.status.dataset.state = 'empty';
            return;
        }

        if (!timeline?.isArmed && (timeline?.nextCueIndex ?? 0) >= cues.length) {
            ui.status.textContent = timeline?.loop
                ? 'Timeline complete – ready to loop again'
                : 'Timeline complete';
            ui.status.dataset.state = 'complete';
            return;
        }

        if (!timeline?.isArmed) {
            const nextCue = cues[timeline?.nextCueIndex ?? 0] || cues[0];
            if (nextCue) {
                const scene = this.getSceneById(nextCue.sceneId);
                const label = nextCue.label || scene?.name || 'Cue';
                ui.status.textContent = `Timeline idle • Next: ${label} @ ${this.formatTimelineTime(nextCue.time)}`;
            } else {
                ui.status.textContent = 'Timeline idle';
            }
            ui.status.dataset.state = 'idle';
            return;
        }

        const nextCue = cues[Math.min(timeline.nextCueIndex ?? 0, cues.length - 1)];
        if (!nextCue) {
            ui.status.textContent = timeline?.loop ? 'Looping… awaiting restart' : 'Timeline complete';
            ui.status.dataset.state = timeline?.loop ? 'loop' : 'complete';
            return;
        }

        const scene = this.getSceneById(nextCue.sceneId);
        const label = nextCue.label || scene?.name || 'Cue';
        const remaining = Math.max(0, (Number(nextCue.time) || 0) - currentTime);
        ui.status.textContent = `Armed • ${label} in ${remaining.toFixed(1)}s`;
        ui.status.dataset.state = 'armed';
    }

    handleAddTimelineCue(options = {}) {
        const timeline = this.sceneState.timeline;
        if (!timeline) {
            return null;
        }

        const targetSceneId = options.sceneId
            || this.sceneState.selectedSceneId
            || this.sceneState.scenes[0]?.id;

        if (!targetSceneId) {
            this.updateStatus('Capture a scene before adding cues', 'warning');
            return null;
        }

        const scene = this.getSceneById(targetSceneId);
        const now = Number.isFinite(options.time)
            ? options.time
            : this.audio?.currentTime ?? 0;
        const snappedTime = Math.max(0, Math.round(Math.max(0, now) * 10) / 10);

        const cue = {
            id: `cue-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            sceneId: targetSceneId,
            time: snappedTime,
            label: options.label || scene?.name || `Cue ${timeline.cues.length + 1}`,
            crossfadeSeconds: Number.isFinite(options.crossfadeSeconds)
                ? Math.max(0, options.crossfadeSeconds)
                : null,
            notes: options.notes ? String(options.notes) : ''
        };

        timeline.cues.push(cue);
        timeline.cues.sort((a, b) => (a.time - b.time) || a.id.localeCompare(b.id));
        this.markSceneStateDirty();
        this.resetTimelineRuntime({ preserveTriggered: false });

        if (timeline.followPlayback) {
            this.syncTimelineToPlayback(this.audio?.currentTime ?? 0);
        } else {
            timeline.nextCueIndex = timeline.cues.findIndex((entry) => entry.id === cue.id);
        }

        this.renderSceneTimeline();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });
        this.updateStatus(`Added cue for ${cue.label}`, 'success');

        return cue;
    }

    handleTimelineFieldEdit(event) {
        if (!event || event.defaultPrevented) return;
        const target = event.target;
        if (!target || !target.dataset) return;

        const field = target.dataset.cueField;
        if (!field) return;

        const item = target.closest('[data-cue-id]');
        if (!item) return;

        const cueId = item.dataset.cueId;
        if (!cueId) return;

        const isInputEvent = event.type === 'input';
        const value = target.value;

        if ((field === 'time' || field === 'crossfadeSeconds') && isInputEvent && value === '') {
            return;
        }

        const result = this.updateTimelineCue(cueId, field, value);
        if (!result.changed) {
            return;
        }

        if (result.needsResync) {
            if (this.sceneState.timeline.followPlayback) {
                this.syncTimelineToPlayback(this.audio?.currentTime ?? 0, { keepTriggered: true });
            } else {
                this.sceneState.timeline.nextCueIndex = Math.min(
                    this.sceneState.timeline.nextCueIndex,
                    this.sceneState.timeline.cues.length
                );
            }
            this.resetTimelineRuntime({ preserveTriggered: true });
        }

        if (result.needsResort) {
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
        } else if (result.headerShouldUpdate) {
            this.updateTimelineItemHeader(item, result.cue);
        }

        if (result.needsStatus) {
            this.updateSceneTimelineStatus({ force: true });
        }
    }

    updateTimelineCue(cueId, field, rawValue) {
        const timeline = this.sceneState.timeline;
        const cues = timeline?.cues || [];
        const cue = cues.find((entry) => entry.id === cueId);
        if (!cue) {
            return { changed: false };
        }

        const result = {
            changed: false,
            needsResync: false,
            needsResort: false,
            needsStatus: false,
            headerShouldUpdate: false,
            cue
        };

        switch (field) {
            case 'sceneId': {
                const previousScene = this.getSceneById(cue.sceneId);
                const value = rawValue || '';
                if (cue.sceneId !== value) {
                    cue.sceneId = value;
                    result.changed = true;
                    result.needsResync = true;
                    result.needsStatus = true;
                    result.headerShouldUpdate = true;
                    const nextScene = this.getSceneById(value);
                    if (!cue.label || cue.label === previousScene?.name) {
                        cue.label = nextScene?.name || cue.label || '';
                        result.headerShouldUpdate = true;
                    }
                }
                break;
            }
            case 'time': {
                const numeric = Number(rawValue);
                if (Number.isFinite(numeric)) {
                    const sanitized = Math.max(0, Math.round(numeric * 1000) / 1000);
                    if (cue.time !== sanitized) {
                        cue.time = sanitized;
                        result.changed = true;
                        result.needsResync = true;
                        result.needsResort = true;
                        result.needsStatus = true;
                    }
                }
                result.headerShouldUpdate = true;
                break;
            }
            case 'crossfadeSeconds': {
                if (rawValue === '' || rawValue === null || rawValue === undefined) {
                    if (Number.isFinite(cue.crossfadeSeconds)) {
                        cue.crossfadeSeconds = null;
                        result.changed = true;
                    }
                    break;
                }

                const numeric = Number(rawValue);
                if (Number.isFinite(numeric)) {
                    const sanitized = Math.max(0, numeric);
                    const previous = Number.isFinite(cue.crossfadeSeconds) ? cue.crossfadeSeconds : null;
                    if (sanitized !== previous) {
                        cue.crossfadeSeconds = sanitized;
                        result.changed = true;
                    }
                }
                break;
            }
            case 'label': {
                const label = String(rawValue ?? '').trim();
                if (cue.label !== label) {
                    cue.label = label;
                    result.changed = true;
                    result.headerShouldUpdate = true;
                }
                break;
            }
            case 'notes': {
                const notes = String(rawValue ?? '');
                if ((cue.notes || '') !== notes) {
                    cue.notes = notes;
                    result.changed = true;
                }
                break;
            }
            default:
                break;
        }

        if (result.changed) {
            this.markSceneStateDirty();
        }

        return result;
    }

    updateTimelineItemHeader(item, cue) {
        if (!item || !cue) return;
        const title = item.querySelector('.scene-timeline__item-title');
        const time = item.querySelector('.scene-timeline__item-time');
        if (title) {
            const scene = this.getSceneById(cue.sceneId);
            title.textContent = cue.label || scene?.name || title.textContent || 'Cue';
        }
        if (time) {
            time.textContent = `@ ${this.formatTimelineTime(cue.time)}`;
        }
    }

    handleTimelineListClick(event) {
        if (!event || event.defaultPrevented) return;
        const button = event.target.closest('[data-cue-action]');
        if (!button) return;

        const item = button.closest('[data-cue-id]');
        if (!item) return;
        const cueId = item.dataset.cueId;
        if (!cueId) return;

        event.preventDefault();
        event.stopPropagation();
        this.handleTimelineAction(button.dataset.cueAction, cueId);
    }

    handleTimelineAction(action, cueId) {
        switch (action) {
            case 'delete':
                this.removeTimelineCue(cueId, { announce: true });
                break;
            case 'preview':
                this.previewTimelineCue(cueId);
                break;
            case 'jump':
                this.jumpToTimelineCue(cueId);
                break;
            case 'snap-playhead':
                this.snapCueToPlayhead(cueId);
                break;
            default:
                break;
        }
    }

    removeTimelineCue(cueId, options = {}) {
        const { announce = false } = options;
        const timeline = this.sceneState.timeline;
        const cues = timeline?.cues || [];
        const index = cues.findIndex((cue) => cue.id === cueId);
        if (index < 0) {
            return;
        }

        const [removed] = cues.splice(index, 1);
        timeline.nextCueIndex = Math.max(0, Math.min(timeline.nextCueIndex, cues.length));
        timeline.isArmed = timeline.isArmed && cues.length > 0;

        this.sceneTimelineRuntime.triggeredCueIds.delete(cueId);
        this.markSceneStateDirty();

        this.renderSceneTimeline();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });

        if (announce) {
            const scene = this.getSceneById(removed?.sceneId);
            const label = removed?.label || scene?.name || 'Cue';
            this.updateStatus(`Removed timeline cue for ${label}`, 'warning');
        }
    }

    previewTimelineCue(cueId) {
        const timeline = this.sceneState.timeline;
        const cue = timeline?.cues?.find((entry) => entry.id === cueId);
        if (!cue) {
            this.updateStatus('Cue not found', 'warning');
            return;
        }

        const scene = this.getSceneById(cue.sceneId);
        if (!scene) {
            this.updateStatus('Cue scene unavailable', 'warning');
            return;
        }

        const crossfade = Number.isFinite(cue.crossfadeSeconds) ? cue.crossfadeSeconds : undefined;
        this.beginSceneTransition(scene, { crossfadeSeconds: crossfade });
        this.updateStatus(`Previewing ${cue.label || scene.name}`, 'info');
    }

    jumpToTimelineCue(cueId) {
        const timeline = this.sceneState.timeline;
        const cue = timeline?.cues?.find((entry) => entry.id === cueId);
        if (!cue) {
            this.updateStatus('Cue not found', 'warning');
            return;
        }

        if (!this.audio) {
            this.updateStatus('Audio not loaded', 'warning');
            return;
        }

        const time = Math.max(0, Number(cue.time) || 0);
        try {
            this.audio.currentTime = time;
        } catch (error) {
            console.warn('Failed to jump audio to cue time', error);
        }

        if (this.sceneState.timeline.followPlayback) {
            this.syncTimelineToPlayback(time, { keepTriggered: true });
            this.renderSceneTimeline();
        }

        this.updateSceneTimelineStatus({ currentTime: time, force: true });
        this.updateStatus(`Jumped to ${this.formatTimelineTime(time)}`, 'info');
    }

    snapCueToPlayhead(cueId) {
        const currentTime = this.audio?.currentTime;
        if (!Number.isFinite(currentTime)) {
            this.updateStatus('Playback head unavailable', 'warning');
            return;
        }

        const snapped = Math.round(Math.max(0, currentTime) * 10) / 10;
        const result = this.updateTimelineCue(cueId, 'time', snapped, { isInputEvent: false });
        if (!result.changed) {
            return;
        }

        if (this.sceneState.timeline.followPlayback) {
            this.syncTimelineToPlayback(snapped, { keepTriggered: true });
        }

        this.renderSceneTimeline();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ currentTime: snapped, force: true });
        this.updateStatus(`Cue aligned to ${this.formatTimelineTime(snapped)}`, 'info');
    }

    clearSceneTimeline(options = {}) {
        const { preserveSettings = true, announce = false } = options;
        const timeline = this.sceneState.timeline;
        if (!timeline) {
            return false;
        }

        const hadCues = Boolean(timeline.cues.length);
        timeline.cues = [];
        timeline.nextCueIndex = 0;
        timeline.isArmed = false;
        if (!preserveSettings) {
            timeline.loop = false;
            timeline.followPlayback = true;
        }

        this.sceneTimelineRuntime.triggeredCueIds.clear();
        this.sceneTimelineRuntime.lastCueId = null;
        this.sceneTimelineRuntime.lastStatusUpdate = 0;

        if (hadCues) {
            this.markSceneStateDirty();
        }

        this.renderSceneTimeline();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });

        if (announce && hadCues) {
            this.updateStatus('Timeline cues cleared', 'warning');
        }

        return true;
    }

    toggleTimelineArmed() {
        const timeline = this.sceneState.timeline;
        if (!timeline?.cues?.length) {
            this.updateStatus('Add cues before arming the timeline', 'warning');
            return;
        }

        timeline.isArmed = !timeline.isArmed;
        if (timeline.isArmed) {
            const currentTime = this.audio?.currentTime ?? 0;
            this.resetTimelineRuntime({ preserveTriggered: false });
            if (timeline.followPlayback) {
                this.syncTimelineToPlayback(currentTime);
            }
            this.updateStatus('Timeline armed – cues will launch automatically', 'info');
        } else {
            this.updateStatus('Timeline disarmed', 'info');
        }

        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });
        this.renderSceneTimeline();
    }

    toggleTimelineFollow() {
        const timeline = this.sceneState.timeline;
        if (!timeline) return;

        timeline.followPlayback = !timeline.followPlayback;
        if (timeline.followPlayback) {
            this.syncTimelineToPlayback(this.audio?.currentTime ?? 0, { keepTriggered: true });
            this.updateStatus('Timeline now follows the audio playhead', 'info');
        } else {
            this.updateStatus('Timeline follow disabled – using manual ordering', 'info');
        }

        this.markSceneStateDirty();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });
        this.renderSceneTimeline();
    }

    toggleTimelineLoop() {
        const timeline = this.sceneState.timeline;
        if (!timeline) return;

        timeline.loop = !timeline.loop;
        this.markSceneStateDirty();
        this.updateSceneTimelineUiState();
        this.updateSceneTimelineStatus({ force: true });

        const message = timeline.loop
            ? 'Timeline loop enabled'
            : 'Timeline loop disabled';
        this.updateStatus(message, 'info');
    }

    resetTimelineRuntime(options = {}) {
        const { preserveTriggered = false } = options;
        if (!preserveTriggered) {
            this.sceneTimelineRuntime.triggeredCueIds.clear();
            this.sceneState.timeline.nextCueIndex = 0;
        } else {
            this.sceneState.timeline.nextCueIndex = Math.min(
                this.sceneState.timeline.nextCueIndex,
                this.sceneState.timeline.cues.length
            );
        }
        this.sceneTimelineRuntime.lastCueId = null;
        this.sceneTimelineRuntime.lastStatusUpdate = 0;
        this.sceneTimelineRuntime.lastPlaybackTime = this.audio?.currentTime ?? 0;
    }

    syncTimelineToPlayback(currentTime = 0, options = {}) {
        const { keepTriggered = false } = options;
        const timeline = this.sceneState.timeline;
        const cues = timeline?.cues || [];
        const triggered = this.sceneTimelineRuntime.triggeredCueIds;

        if (!keepTriggered) {
            triggered.clear();
        } else {
            const existing = new Set(triggered);
            triggered.clear();
            cues.forEach((cue) => {
                if (existing.has(cue.id) && (Number(cue.time) || 0) <= currentTime) {
                    triggered.add(cue.id);
                }
            });
        }

        const tolerance = 0.05;
        cues.forEach((cue) => {
            if ((Number(cue.time) || 0) + tolerance < currentTime) {
                triggered.add(cue.id);
            }
        });

        const nextIndex = cues.findIndex((cue) => {
            if (triggered.has(cue.id)) return false;
            return (Number(cue.time) || 0) + tolerance >= currentTime;
        });

        timeline.nextCueIndex = nextIndex >= 0 ? nextIndex : cues.length;
        this.sceneTimelineRuntime.lastPlaybackTime = currentTime;
    }

    updateSceneTimeline(currentTime = 0, deltaTime = 0) {
        const timeline = this.sceneState.timeline;
        if (!timeline?.isArmed) return;
        const cues = timeline.cues || [];
        if (!cues.length) return;

        const runtime = this.sceneTimelineRuntime;
        const tolerance = 0.05;

        if (timeline.followPlayback) {
            if (currentTime < runtime.lastPlaybackTime - 0.1) {
                this.syncTimelineToPlayback(currentTime);
                this.renderSceneTimeline();
            }
            runtime.lastPlaybackTime = currentTime;
        }

        let triggeredAny = false;
        let guard = 0;
        const guardLimit = cues.length + 2;

        while (timeline.isArmed && timeline.nextCueIndex < cues.length && guard < guardLimit) {
            guard += 1;
            const cue = cues[timeline.nextCueIndex];
            if (!cue) break;

            const triggerTime = Math.max(0, Number(cue.time) || 0);

            if (!timeline.followPlayback && runtime.triggeredCueIds.has(cue.id)) {
                timeline.nextCueIndex += 1;
                continue;
            }

            if (currentTime + tolerance < triggerTime && !runtime.triggeredCueIds.has(cue.id)) {
                break;
            }

            if (runtime.triggeredCueIds.has(cue.id)) {
                timeline.nextCueIndex += 1;
                continue;
            }

            const launched = this.launchTimelineCue(cue);
            runtime.triggeredCueIds.add(cue.id);
            triggeredAny = launched || triggeredAny;
            timeline.nextCueIndex += 1;

            if (timeline.nextCueIndex >= cues.length) {
                if (timeline.loop) {
                    this.resetTimelineRuntime({ preserveTriggered: false });
                    if (timeline.followPlayback) {
                        this.syncTimelineToPlayback(currentTime);
                    }
                    this.renderSceneTimeline();
                } else {
                    timeline.isArmed = false;
                    this.updateSceneTimelineUiState();
                }
                break;
            }
        }

        if (triggeredAny) {
            this.renderSceneTimeline();
        }

        this.updateSceneTimelineStatus({ currentTime });
    }

    launchTimelineCue(cue) {
        if (!cue) return false;
        const scene = this.getSceneById(cue.sceneId);
        if (!scene) {
            this.updateStatus('Timeline cue skipped – scene unavailable', 'warning');
            return false;
        }

        const crossfade = Number.isFinite(cue.crossfadeSeconds) ? cue.crossfadeSeconds : undefined;
        this.beginSceneTransition(scene, { crossfadeSeconds: crossfade });
        const label = cue.label || scene.name || 'Cue';
        if (cue.notes) {
            this.updateStatus(`Timeline launched ${label} • ${cue.notes}`, 'success');
        } else {
            this.updateStatus(`Timeline launched ${label}`, 'success');
        }
        this.sceneTimelineRuntime.lastCueId = cue.id;
        return true;
    }

    handleSceneRemoved(sceneId) {
        if (!sceneId) return;
        const timeline = this.sceneState.timeline;
        if (!timeline) return;

        const before = timeline.cues.length;
        timeline.cues = timeline.cues.filter((cue) => cue.sceneId !== sceneId);
        if (timeline.cues.length !== before) {
            this.resetTimelineRuntime({ preserveTriggered: false });
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
            this.updateSceneTimelineStatus({ force: true });
            this.markSceneStateDirty();
        } else {
            this.renderSceneTimeline();
            this.updateSceneTimelineUiState();
        }
    }

    handleSceneRenamed(sceneId, previousName, nextName) {
        if (!sceneId) return;
        const timeline = this.sceneState.timeline;
        if (!timeline) return;

        let changed = false;
        timeline.cues.forEach((cue) => {
            if (cue.sceneId === sceneId) {
                if (!cue.label || cue.label === previousName) {
                    cue.label = nextName;
                    changed = true;
                }
            }
        });

        if (changed) {
            this.markSceneStateDirty();
            this.renderSceneTimeline();
            this.updateSceneTimelineStatus({ force: true });
        }
    }

    updateTempoLinkedControls() {
        this.refreshAllModulatorControlStates();
    }

    handleResyncModulators() {
        if (!this.reactivityController) return;
        this.reactivityController.retriggerAllModulators();
        this.updateStatus('Modulators resynced to beat', 'success');
        this.refreshAllModulatorControlStates();
        this.renderReactivityTelemetry();
    }

    initializeAutomationControls() {
        const storedSnapshot = this.loadAutomationSnapshotFromStorage();
        if (storedSnapshot) {
            this.automationSnapshot = storedSnapshot;
            if (Number.isFinite(storedSnapshot.glide)) {
                this.setAutomationGlide(storedSnapshot.glide, {
                    updateSlider: true,
                    updateLabel: true,
                    announce: false
                });
            }
        } else {
            this.setAutomationGlide(this.automationGlide, {
                updateSlider: true,
                updateLabel: true,
                announce: false
            });
        }

        this.renderAutomationSnapshotInfo();
    }

    setAutomationGlide(value, options = {}) {
        const { updateSlider = true, updateLabel = true, announce = false } = options;
        let numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            numeric = this.automationGlide ?? DEFAULT_AUTOMATION_GLIDE;
        }

        numeric = Math.max(0, Math.min(0.95, numeric));
        this.automationGlide = numeric;

        if (updateSlider && this.dom.automationGlideInput) {
            this.dom.automationGlideInput.value = `${numeric}`;
        }

        if (updateLabel && this.dom.automationGlideValue) {
            this.dom.automationGlideValue.textContent = numeric.toFixed(2);
        }

        if (announce) {
            this.updateStatus(`Automation glide set to ${numeric.toFixed(2)}`, 'info');
        }

        this.renderAutomationSnapshotInfo();
        return numeric;
    }

    handleSaveAutomationSnapshot() {
        const snapshot = this.saveAutomationSnapshot();
        if (!snapshot) return;

        const label = snapshot.meta?.label ? ` (${snapshot.meta.label})` : '';
        this.updateStatus(`Automation snapshot saved${label}`, 'success');
    }

    handleLoadAutomationSnapshot() {
        if (this.isRecordingAutomation) {
            this.updateStatus('Stop recording before loading a snapshot', 'warning');
            return;
        }

        if (!this.hasAutomationSnapshot()) {
            const storedSnapshot = this.loadAutomationSnapshotFromStorage();
            if (storedSnapshot) {
                this.automationSnapshot = storedSnapshot;
                this.updateAutomationUiState();
            } else {
                this.updateStatus('No automation snapshot available to load', 'warning');
                return;
            }
        }

        const loaded = this.loadAutomationSnapshot(this.automationSnapshot);
        if (!loaded) {
            this.updateStatus('Failed to load automation snapshot', 'error');
        }
    }

    hasAutomationSnapshot() {
        return Boolean(
            this.automationSnapshot &&
            Array.isArray(this.automationSnapshot.points) &&
            this.automationSnapshot.points.length
        );
    }

    getAutomationStorage() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage;
            }
        } catch (error) {
            console.warn('Automation snapshot storage unavailable', error);
        }
        return null;
    }

    loadAutomationSnapshotFromStorage() {
        const storage = this.getAutomationStorage();
        if (!storage) return null;

        try {
            const raw = storage.getItem(AUTOMATION_SNAPSHOT_STORAGE_KEY);
            if (!raw) return null;

            const payload = JSON.parse(raw);
            if (!payload || !Array.isArray(payload.points) || !payload.points.length) {
                return null;
            }

            const normalized = this.normalizeAutomationPoints(payload.points);
            if (!normalized.length) {
                return null;
            }

            return {
                ...payload,
                points: normalized
            };
        } catch (error) {
            console.warn('Failed to load automation snapshot from storage', error);
            return null;
        }
    }

    persistAutomationSnapshot(snapshot) {
        const storage = this.getAutomationStorage();
        if (!storage || !snapshot) return;

        try {
            storage.setItem(AUTOMATION_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
        } catch (error) {
            console.warn('Failed to persist automation snapshot', error);
        }
    }

    saveAutomationSnapshot(meta = {}) {
        const dataset = this.automationPlaybackData.length
            ? this.automationPlaybackData
            : this.normalizeAutomationPoints(this.automationData);

        if (!dataset.length) {
            this.updateStatus('No automation dataset available to save', 'warning');
            return null;
        }

        const normalized = this.normalizeAutomationPoints(dataset);
        if (!normalized.length) {
            this.updateStatus('Automation dataset was empty after normalization', 'warning');
            return null;
        }

        const metaPayload = {
            mode: this.mode,
            system: this.currentSystem,
            duration: this.audio?.duration ?? null,
            label: meta.label ?? this.automationPlaybackMeta?.label ?? 'Snapshot',
            source: meta.source ?? this.automationPlaybackMeta?.source ?? 'snapshot'
        };

        Object.keys(metaPayload).forEach((key) => {
            if (metaPayload[key] === undefined || metaPayload[key] === null) {
                delete metaPayload[key];
            }
        });

        const snapshot = {
            version: 1,
            savedAt: new Date().toISOString(),
            glide: this.automationGlide,
            points: normalized,
            meta: metaPayload
        };

        this.automationSnapshot = snapshot;
        this.persistAutomationSnapshot(snapshot);
        this.updateAutomationUiState();
        return snapshot;
    }

    loadAutomationSnapshot(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.points) || !snapshot.points.length) {
            return false;
        }

        const glide = Number.isFinite(snapshot.glide) ? snapshot.glide : this.automationGlide;
        this.setAutomationGlide(glide, { updateSlider: true, updateLabel: true, announce: false });

        const normalizedPoints = this.normalizeAutomationPoints(snapshot.points);
        if (!normalizedPoints.length) {
            return false;
        }

        const prepared = this.prepareAutomationPlayback(normalizedPoints, {
            ...snapshot.meta,
            source: snapshot.meta?.source ?? 'snapshot',
            label: snapshot.meta?.label ?? 'Snapshot',
            glide,
            updatePad: true
        });

        if (prepared) {
            this.updateStatus(
                `Automation snapshot loaded${snapshot.meta?.label ? ` (${snapshot.meta.label})` : ''}`,
                'success'
            );
        }

        return prepared;
    }

    renderAutomationSnapshotInfo() {
        if (!this.dom.automationSnapshotInfo) return;

        if (!this.hasAutomationSnapshot()) {
            this.dom.automationSnapshotInfo.textContent = 'No snapshot saved';
            return;
        }

        const { meta = {}, savedAt, points = [] } = this.automationSnapshot;
        const label = meta.label ?? meta.source ?? 'Snapshot';
        const rawGlide = Number.isFinite(this.automationSnapshot.glide)
            ? this.automationSnapshot.glide
            : this.automationGlide;
        const glideValue = Number.isFinite(rawGlide) ? rawGlide : DEFAULT_AUTOMATION_GLIDE;

        let timestamp = '';
        if (savedAt) {
            const date = new Date(savedAt);
            if (!Number.isNaN(date.getTime())) {
                timestamp = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
            }
        }

        const parts = [label];
        if (timestamp) {
            parts.push(timestamp);
        }
        parts.push(`${points.length} pts`);
        parts.push(`Glide ${glideValue.toFixed(2)}`);

        this.dom.automationSnapshotInfo.textContent = parts.join(' • ');
    }

    updateReactivityReadout(vector = this.reactivityController.getLiveVector()) {
        if (this.dom.reactivityReadoutX) {
            this.dom.reactivityReadoutX.textContent = `X: ${vector.x.toFixed(2)}`;
        }
        if (this.dom.reactivityReadoutY) {
            this.dom.reactivityReadoutY.textContent = `Y: ${vector.y.toFixed(2)}`;
        }
    }

    applyLiveVector() {
        const params = this.reactivityController.compute(this.lastAudioData, {
            time: this.audio.currentTime,
            deltaTime: 0,
            mode: this.mode,
            isPlaying: this.isPlaying,
            consumeBeat: false
        });
        this.applyParameters(params);
    }

    resetAutomationState(options = {}) {
        const { preservePlaybackData = true } = options;

        this.isRecordingAutomation = false;
        this.automationData = [];
        this.lastAutomationTimestamp = -1;

        if (!preservePlaybackData) {
            this.automationPlaybackData = [];
            this.automationPlaybackIndex = 0;
            this.automationPlaybackVector = { x: 0, y: 0 };
            this.isAutomationPlaybackEnabled = false;
        }

        if (this.dom.recordAutomationBtn) {
            this.dom.recordAutomationBtn.textContent = '● Start Recording';
            this.dom.recordAutomationBtn.classList.remove(RECORD_BUTTON_ACTIVE_CLASS);
        }

        this.updateAutomationUiState();
    }

    toggleAutomationRecording() {
        this.isRecordingAutomation = !this.isRecordingAutomation;

        if (this.isRecordingAutomation) {
            this.automationData = [];
            this.lastAutomationTimestamp = -1;
            this.isAutomationPlaybackEnabled = false;
            this.updateStatus('Automation recording armed — playback paused', 'info');
            if (this.dom.recordAutomationBtn) {
                this.dom.recordAutomationBtn.textContent = '■ Stop Recording';
                this.dom.recordAutomationBtn.classList.add(RECORD_BUTTON_ACTIVE_CLASS);
            }
        } else {
            const hasData = this.automationData.length > 0;
            if (hasData) {
                this.prepareAutomationPlayback(this.automationData, {
                    source: 'live-recording',
                    label: 'Live Recording',
                    updatePad: false
                });
                this.updateStatus('Automation recording stopped — playback ready', 'success');
            } else {
                this.updateStatus('Automation recording stopped', 'info');
            }
            if (this.dom.recordAutomationBtn) {
                this.dom.recordAutomationBtn.textContent = '● Start Recording';
                this.dom.recordAutomationBtn.classList.remove(RECORD_BUTTON_ACTIVE_CLASS);
            }
        }

        this.updateAutomationUiState();
    }

    exportAutomationData() {
        const dataset = this.automationPlaybackData.length
            ? this.automationPlaybackData
            : this.normalizeAutomationPoints(this.automationData);

        if (!dataset.length) {
            this.updateStatus('No automation data to export', 'warning');
            return;
        }

        const payload = {
            createdAt: new Date().toISOString(),
            duration: this.audio?.duration ?? null,
            mode: this.mode,
            system: this.currentSystem,
            ...this.automationPlaybackMeta,
            points: dataset
        };

        if (dataset.length > 1) {
            let totalInterval = 0;
            for (let i = 1; i < dataset.length; i += 1) {
                totalInterval += Math.max(dataset[i].time - dataset[i - 1].time, 0);
            }
            const avgInterval = totalInterval / (dataset.length - 1);
            if (avgInterval > 0) {
                payload.estimatedFrameRate = Number((1 / avgInterval).toFixed(2));
            }
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'reactivity-automation.json';
        link.click();
        URL.revokeObjectURL(url);

        this.updateStatus('Automation data exported', 'success');
    }

    recordAutomationPoint(vector) {
        if (!this.isRecordingAutomation) return;

        const time = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
        const roundedTime = Number(time.toFixed(3));
        if (this.lastAutomationTimestamp === roundedTime) {
            const last = this.automationData[this.automationData.length - 1];
            if (last) {
                const safeVector = this.clampLiveVector(vector);
                last.x = Number(safeVector.x.toFixed(3));
                last.y = Number(safeVector.y.toFixed(3));
            }
            return;
        }

        this.lastAutomationTimestamp = roundedTime;
        const safeVector = this.clampLiveVector(vector);
        this.automationData.push({
            time: roundedTime,
            x: Number(safeVector.x.toFixed(3)),
            y: Number(safeVector.y.toFixed(3))
        });
    }

    clampLiveVector(vector = {}) {
        const clamp = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return 0;
            return Math.max(-1, Math.min(1, numeric));
        };

        return {
            x: clamp(vector.x),
            y: clamp(vector.y)
        };
    }

    commitLiveVector(vector, options = {}) {
        const { fromPad = false, updatePad = false } = options;
        const safeVector = this.clampLiveVector(vector);
        const current = this.reactivityController.getLiveVector();
        const lockedVector = {
            x: this.axisLocks?.x ? current.x : safeVector.x,
            y: this.axisLocks?.y ? current.y : safeVector.y
        };

        this.reactivityController.setLiveVector(lockedVector);

        if (updatePad && this.xyPad) {
            const engaged = typeof this.xyPad.isEngaged === 'function' ? this.xyPad.isEngaged() : false;
            if (!engaged || fromPad) {
                this.xyPad.setValue(lockedVector, true);
            }
        }

        this.updateReactivityReadout(lockedVector);
        this.renderReactivityTelemetry();
        return lockedVector;
    }

    normalizeAutomationPoints(points = []) {
        if (!Array.isArray(points)) return [];

        const deduped = new Map();

        points.forEach((point) => {
            if (!point) return;
            const time = Number(point.time);
            if (!Number.isFinite(time)) return;
            const safeVector = this.clampLiveVector(point);
            const key = time.toFixed(3);
            deduped.set(key, {
                time,
                x: Number(safeVector.x.toFixed(4)),
                y: Number(safeVector.y.toFixed(4))
            });
        });

        return Array.from(deduped.values()).sort((a, b) => a.time - b.time);
    }

    prepareAutomationPlayback(points, meta = {}) {
        const normalized = this.normalizeAutomationPoints(points);

        if (!normalized.length) {
            this.automationPlaybackData = [];
            this.automationPlaybackIndex = 0;
            this.automationPlaybackVector = { x: 0, y: 0 };
            this.isAutomationPlaybackEnabled = false;
            this.automationPlaybackMeta = null;
            this.updateAutomationUiState();
            return false;
        }

        this.automationPlaybackData = normalized;
        this.automationPlaybackIndex = 0;
        const initialVector = this.clampLiveVector(normalized[0]);
        this.automationPlaybackVector = initialVector;
        const { updatePad, ...restMeta } = meta;
        const sanitizedMeta = Object.fromEntries(
            Object.entries(restMeta).filter(([, value]) => value !== undefined && value !== null)
        );

        if (Number.isFinite(sanitizedMeta.glide)) {
            this.setAutomationGlide(sanitizedMeta.glide, {
                updateSlider: true,
                updateLabel: true,
                announce: false
            });
        }

        const glideValue = Number.isFinite(sanitizedMeta.glide) ? sanitizedMeta.glide : this.automationGlide;

        this.automationPlaybackMeta = {
            mode: this.mode,
            system: this.currentSystem,
            duration: this.audio?.duration ?? null,
            source: sanitizedMeta.source ?? 'external',
            label: sanitizedMeta.label ?? sanitizedMeta.source ?? 'automation',
            updatedAt: new Date().toISOString(),
            ...sanitizedMeta,
            glide: glideValue
        };

        if (updatePad !== false) {
            this.commitLiveVector(initialVector, { updatePad: true });
        }

        this.updateAutomationUiState();
        return true;
    }

    toggleAutomationPlayback() {
        if (this.isRecordingAutomation) {
            this.updateStatus('Stop recording before enabling playback', 'warning');
            return;
        }

        if (!this.automationPlaybackData.length) {
            this.updateStatus('Record or import automation data first', 'warning');
            return;
        }

        this.isAutomationPlaybackEnabled = !this.isAutomationPlaybackEnabled;

        if (this.isAutomationPlaybackEnabled) {
            this.automationPlaybackVector = this.clampLiveVector(this.reactivityController.getLiveVector());
            const currentTime = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
            const target = this.resolveAutomationVector(currentTime) ?? this.automationPlaybackVector;
            if (target) {
                this.automationPlaybackVector = this.clampLiveVector(target);
                this.commitLiveVector(this.automationPlaybackVector, { updatePad: true });
            }
            this.automationResumeTime = this.getNow();
            this.updateStatus('Automation playback enabled', 'success');
        } else {
            this.updateStatus('Automation playback disabled', 'info');
        }

        this.updateAutomationUiState();
    }

    updateAutomationUiState() {
        const hasData = this.automationPlaybackData.length > 0;
        if (this.dom.exportAutomationBtn) {
            this.dom.exportAutomationBtn.disabled = this.isRecordingAutomation || !hasData;
        }
        if (this.dom.automationPlaybackBtn) {
            this.dom.automationPlaybackBtn.disabled = this.isRecordingAutomation || !hasData;
            this.dom.automationPlaybackBtn.classList.toggle(
                AUTOMATION_MODE_ACTIVE_CLASS,
                this.isAutomationPlaybackEnabled
            );
            this.dom.automationPlaybackBtn.textContent = this.isAutomationPlaybackEnabled
                ? '⏸ Automation Playback'
                : '▶ Automation Playback';
            this.dom.automationPlaybackBtn.setAttribute('aria-pressed', this.isAutomationPlaybackEnabled ? 'true' : 'false');
        }

        if (this.dom.saveAutomationSnapshotBtn) {
            this.dom.saveAutomationSnapshotBtn.disabled = this.isRecordingAutomation || !hasData;
        }

        const hasSnapshot = this.hasAutomationSnapshot();
        if (this.dom.loadAutomationSnapshotBtn) {
            this.dom.loadAutomationSnapshotBtn.disabled = !hasSnapshot;
        }

        if (this.dom.automationGlideValue) {
            this.dom.automationGlideValue.textContent = this.automationGlide.toFixed(2);
        }

        if (this.dom.automationGlideInput) {
            this.dom.automationGlideInput.value = `${this.automationGlide}`;
        }

        this.renderAutomationSnapshotInfo();
    }

    suspendAutomationPlayback(duration = 800) {
        const now = this.getNow();
        this.automationResumeTime = Math.max(this.automationResumeTime, now + duration);
    }

    getNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    resolveAutomationVector(currentTime = 0) {
        if (!this.automationPlaybackData.length) {
            return null;
        }

        const data = this.automationPlaybackData;
        if (data.length === 1) {
            this.automationPlaybackIndex = 0;
            return this.clampLiveVector(data[0]);
        }

        const safeTime = Number.isFinite(currentTime) ? currentTime : 0;

        if (safeTime <= data[0].time) {
            this.automationPlaybackIndex = 0;
            return this.clampLiveVector(data[0]);
        }

        if (safeTime >= data[data.length - 1].time) {
            this.automationPlaybackIndex = data.length - 1;
            return this.clampLiveVector(data[data.length - 1]);
        }

        while (
            this.automationPlaybackIndex < data.length - 1 &&
            safeTime >= data[this.automationPlaybackIndex + 1].time
        ) {
            this.automationPlaybackIndex += 1;
        }

        while (this.automationPlaybackIndex > 0 && safeTime < data[this.automationPlaybackIndex].time) {
            this.automationPlaybackIndex -= 1;
        }

        const start = data[this.automationPlaybackIndex];
        const end = data[this.automationPlaybackIndex + 1];
        if (!end) {
            return this.clampLiveVector(start);
        }

        const span = Math.max(end.time - start.time, 0.0001);
        const ratio = Math.max(0, Math.min(1, (safeTime - start.time) / span));

        return this.clampLiveVector({
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio
        });
    }

    applyAutomationPlayback(currentTime, deltaTime) {
        if (!this.isAutomationPlaybackEnabled || !this.automationPlaybackData.length) {
            return null;
        }

        const now = this.getNow();
        if (now < this.automationResumeTime) {
            return null;
        }

        const padEngaged = this.xyPad && typeof this.xyPad.isEngaged === 'function' ? this.xyPad.isEngaged() : false;
        if (padEngaged) {
            this.automationPlaybackVector = this.clampLiveVector(this.reactivityController.getLiveVector());
            this.suspendAutomationPlayback();
            return null;
        }

        const target = this.resolveAutomationVector(currentTime);
        if (!target) {
            return null;
        }

        const dt = Math.max(deltaTime || 0, 1 / 240);
        const baseGlide = Math.max(0, Math.min(0.95, this.automationGlide ?? DEFAULT_AUTOMATION_GLIDE));

        let smoothing = 1;
        if (baseGlide > 0 && baseGlide < 0.999) {
            const frames = Math.max(dt * 60, 1);
            smoothing = 1 - Math.pow(1 - baseGlide, frames);
        }

        const currentVector = this.automationPlaybackVector || this.clampLiveVector(
            this.reactivityController.getLiveVector()
        );

        const blended = {
            x: currentVector.x + (target.x - currentVector.x) * smoothing,
            y: currentVector.y + (target.y - currentVector.y) * smoothing
        };

        this.automationPlaybackVector = blended;
        return this.commitLiveVector(blended, { updatePad: true });
    }

    promptAutomationImport() {
        if (this.isRecordingAutomation) {
            this.updateStatus('Stop recording before importing automation', 'warning');
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                try {
                    const payload = JSON.parse(loadEvent.target.result);
                    this.ingestAutomationPayload(payload, file.name);
                } catch (error) {
                    console.error('Failed to import automation data', error);
                    this.updateStatus('Failed to import automation data', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    ingestAutomationPayload(payload, label = 'automation') {
        try {
            const points = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.points)
                ? payload.points
                : null;

            if (!points || !points.length) {
                throw new Error('No automation points found');
            }

            const meta = {
                source: payload?.source ?? 'import',
                label: payload?.label ?? label,
                mode: payload?.mode,
                duration: payload?.duration,
                glide: Number.isFinite(payload?.glide) ? payload.glide : undefined,
                updatePad: true
            };

            if (Number.isFinite(payload?.glide)) {
                this.setAutomationGlide(payload.glide, {
                    updateSlider: true,
                    updateLabel: true,
                    announce: false
                });
            }

            const prepared = this.prepareAutomationPlayback(points, meta);

            if (!prepared) {
                throw new Error('Automation dataset was empty after normalization');
            }

            this.updateStatus(`Loaded automation from ${label}`, 'success');
        } catch (error) {
            console.error('Automation payload ingestion failed', error);
            this.updateStatus('Failed to parse automation payload', 'error');
        }
    }

    async loadAudioFile(file) {
        if (!file) return;

        const url = URL.createObjectURL(file);
        if (this.currentAudioObjectUrl) {
            URL.revokeObjectURL(this.currentAudioObjectUrl);
        }
        this.currentAudioObjectUrl = url;
        this.audio.src = url;
        this.audio.load();

        if (!this.sourceNode) {
            this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }

        if (this.dom.playButton) this.dom.playButton.disabled = false;
        if (this.dom.pauseButton) this.dom.pauseButton.disabled = false;
        if (this.dom.stopButton) this.dom.stopButton.disabled = false;

        this.resetAutomationState();
        this.automationPlaybackIndex = 0;
        this.updateStatus(`Loaded: ${file.name}`, 'success');
        console.log('🎵 Audio file loaded:', file.name);
    }

    async switchSystem(systemName) {
        if (!systemName) return;

        if (this.pendingSystemSwitch) {
            await this.pendingSystemSwitch;
        }

        const performSwitch = async () => {
            if (this.currentEngine && typeof this.currentEngine.destroy === 'function') {
                try {
                    this.currentEngine.destroy();
                } catch (error) {
                    console.warn('Engine destroy failed', error);
                }
            }

            const container = document.getElementById('vib34dLayers');
            if (container) {
                container.innerHTML = '';
            }

            const createCanvas = (id) => {
                const canvas = document.createElement('canvas');
                canvas.id = id;
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                container?.appendChild(canvas);
            };

            if (systemName === 'faceted') {
                ['background', 'shadow', 'content', 'highlight', 'accent'].forEach((layer) => {
                    createCanvas(`${layer}-canvas`);
                });
                this.currentEngine = new VIB34DIntegratedEngine();
            } else if (systemName === 'quantum') {
                ['background', 'shadow', 'content', 'highlight', 'accent'].forEach((layer) => {
                    createCanvas(`quantum-${layer}-canvas`);
                });
                this.currentEngine = new QuantumEngine();
            } else if (systemName === 'holographic') {
                for (let i = 0; i < 5; i += 1) {
                    createCanvas(`holo-layer-${i}`);
                }
                this.currentEngine = new RealHolographicSystem();
            } else {
                console.warn(`Unknown system: ${systemName}`);
                return;
            }

            this.currentSystem = systemName;
            this.reactivityController.reset();

            if (this.dom.systemButtons) {
                this.dom.systemButtons.forEach((btn) => {
                    btn.classList.toggle('active', btn.dataset.system === systemName);
                });
            }

            if (this.lastReactiveParameters && Object.keys(this.lastReactiveParameters).length) {
                this.applyParameters(this.lastReactiveParameters);
            }
            this.applyLiveVector();

            this.updateStatus(`Switched to ${systemName.toUpperCase()} system`, 'success');
        };

        this.pendingSystemSwitch = performSwitch();
        try {
            await this.pendingSystemSwitch;
        } finally {
            this.pendingSystemSwitch = null;
        }
    }

    async generateDefaultChoreography() {
        this.sequences = [
            {
                time: 0,
                duration: 15,
                effects: {
                    system: 'faceted',
                    geometry: 'cycle',
                    rotation: 'smooth',
                    chaos: 0.1,
                    speed: 0.5,
                    colorShift: 'slow',
                    densityBoost: 0
                }
            },
            {
                time: 15,
                duration: 15,
                effects: {
                    system: 'faceted',
                    geometry: 'morph',
                    rotation: 'accelerate',
                    chaos: 0.3,
                    speed: 1.0,
                    colorShift: 'medium',
                    densityBoost: 10
                }
            },
            {
                time: 30,
                duration: 20,
                effects: {
                    system: 'quantum',
                    geometry: 'random',
                    rotation: 'chaos',
                    chaos: 0.8,
                    speed: 2.0,
                    colorShift: 'fast',
                    densityBoost: 20
                }
            },
            {
                time: 50,
                duration: 10,
                effects: {
                    system: 'holographic',
                    geometry: 'explosive',
                    rotation: 'extreme',
                    chaos: 0.9,
                    speed: 2.5,
                    colorShift: 'rainbow',
                    densityBoost: 30
                }
            },
            {
                time: 60,
                duration: 15,
                effects: {
                    system: 'faceted',
                    geometry: 'hold',
                    rotation: 'minimal',
                    chaos: 0.05,
                    speed: 0.3,
                    colorShift: 'freeze',
                    baseHue: 240,
                    densityBoost: -5
                }
            },
            {
                time: 75,
                duration: 999,
                effects: {
                    system: 'quantum',
                    geometry: 'explosive',
                    rotation: 'extreme',
                    chaos: 1.0,
                    speed: 3.0,
                    colorShift: 'rainbow',
                    densityBoost: 40
                }
            }
        ];

        this.renderSequenceList();
        this.updateStatus('Default choreography generated', 'info');
    }

    renderSequenceList() {
        const list = this.dom.sequenceList || document.getElementById('sequence-list');
        if (!list) return;
        this.dom.sequenceList = list;

        list.innerHTML = this.sequences.map((seq, index) => `
            <div class="sequence-item">
                <h4>Sequence ${index + 1} (${seq.time}s - ${seq.time + seq.duration}s)</h4>
                <div class="sequence-controls">
                    <label>Start Time (s)</label>
                    <input type="number" value="${seq.time}" onchange="choreographer.updateSequence(${index}, 'time', this.value)">

                    <label>Duration (s)</label>
                    <input type="number" value="${seq.duration}" onchange="choreographer.updateSequence(${index}, 'duration', this.value)">

                    <label>🎨 System</label>
                    <select onchange="choreographer.updateSequence(${index}, 'system', this.value)" style="grid-column: span 2;">
                        <option value="faceted" ${seq.effects.system === 'faceted' ? 'selected' : ''}>🔷 Faceted</option>
                        <option value="quantum" ${seq.effects.system === 'quantum' ? 'selected' : ''}>🌌 Quantum</option>
                        <option value="holographic" ${seq.effects.system === 'holographic' ? 'selected' : ''}>✨ Holographic</option>
                    </select>

                    <label>Geometry</label>
                    <select onchange="choreographer.updateSequence(${index}, 'geometry', this.value)">
                        <option value="hold" ${seq.effects.geometry === 'hold' ? 'selected' : ''}>Hold</option>
                        <option value="cycle" ${seq.effects.geometry === 'cycle' ? 'selected' : ''}>Cycle</option>
                        <option value="morph" ${seq.effects.geometry === 'morph' ? 'selected' : ''}>Morph</option>
                        <option value="random" ${seq.effects.geometry === 'random' ? 'selected' : ''}>Random</option>
                        <option value="explosive" ${seq.effects.geometry === 'explosive' ? 'selected' : ''}>Explosive</option>
                    </select>

                    <label>Rotation</label>
                    <select onchange="choreographer.updateSequence(${index}, 'rotation', this.value)">
                        <option value="minimal" ${seq.effects.rotation === 'minimal' ? 'selected' : ''}>Minimal</option>
                        <option value="smooth" ${seq.effects.rotation === 'smooth' ? 'selected' : ''}>Smooth</option>
                        <option value="accelerate" ${seq.effects.rotation === 'accelerate' ? 'selected' : ''}>Accelerate</option>
                        <option value="chaos" ${seq.effects.rotation === 'chaos' ? 'selected' : ''}>Chaos</option>
                        <option value="extreme" ${seq.effects.rotation === 'extreme' ? 'selected' : ''}>Extreme</option>
                    </select>

                    <label>Chaos Base</label>
                    <input type="number" step="0.1" min="0" max="1" value="${seq.effects.chaos || 0.5}" onchange="choreographer.updateSequence(${index}, 'chaos', this.value)">

                    <label>Speed Base</label>
                    <input type="number" step="0.1" min="0.1" max="3" value="${seq.effects.speed || 1.0}" onchange="choreographer.updateSequence(${index}, 'speed', this.value)">

                    <label>Color Shift</label>
                    <select onchange="choreographer.updateSequence(${index}, 'colorShift', this.value)">
                        <option value="freeze" ${seq.effects.colorShift === 'freeze' ? 'selected' : ''}>Freeze</option>
                        <option value="slow" ${seq.effects.colorShift === 'slow' ? 'selected' : ''}>Slow</option>
                        <option value="medium" ${seq.effects.colorShift === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="fast" ${seq.effects.colorShift === 'fast' ? 'selected' : ''}>Fast</option>
                        <option value="rainbow" ${seq.effects.colorShift === 'rainbow' ? 'selected' : ''}>Rainbow</option>
                    </select>
                </div>
                <div style="font-size: 9px; color: #666; margin-top: 5px; padding: 5px; background: rgba(0,255,255,0.05); border-radius: 3px;">
                    ℹ️ Audio reactivity is ALWAYS active - these are base values that audio and the XY pad modulate
                </div>
                <button onclick="choreographer.deleteSequence(${index})" style="margin-top: 10px; background: #f44; font-size: 10px; padding: 5px;">Delete</button>
            </div>
        `).join('');
    }

    updateSequence(index, property, value) {
        const seq = this.sequences[index];
        if (!seq) return;

        if (property === 'time' || property === 'duration') {
            seq[property] = parseFloat(value);
        } else if (property === 'chaos' || property === 'speed') {
            seq.effects[property] = parseFloat(value);
        } else {
            seq.effects[property] = value;
        }

        console.log(`Updated sequence ${index}:`, seq);
    }

    deleteSequence(index) {
        this.sequences.splice(index, 1);
        this.renderSequenceList();
    }

    addSequenceToTimeline(newSeq) {
        this.sequences.push(newSeq);
        this.sequences.sort((a, b) => a.time - b.time);
        this.renderSequenceList();
    }

    play() {
        if (!this.audioContext) return;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.audio.play();
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.startVisualization();
        this.updateStatus('Playback started', 'success');
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.updateStatus('Paused', 'info');
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.updateTimeline();
        this.updateStatus('Stopped', 'info');
    }

    startVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        const render = () => {
            if (!this.isPlaying) {
                this.animationId = null;
                return;
            }

            this.analyser.getByteFrequencyData(this.dataArray);
            const audioData = this.processAudioData(this.dataArray);

            const now = performance.now();
            const deltaTime = (now - this.lastFrameTime) / 1000;
            this.lastFrameTime = now;

            this.detectBeat(audioData, now);

            const frameContext = {
                time: this.audio.currentTime,
                deltaTime,
                mode: this.mode,
                isPlaying: this.isPlaying
            };

            this.applyAutomationPlayback(frameContext.time, deltaTime);
            this.updateSceneTransition(deltaTime);
            this.updateSceneTimeline(frameContext.time, deltaTime);

            if (this.mode === 'choreographed') {
                this.applyChoreography(audioData, frameContext);
            } else {
                this.applyReactiveMode(audioData, frameContext);
            }

            this.updateInfoPanel(audioData);

            this.animationId = requestAnimationFrame(render);
        };

        this.animationId = requestAnimationFrame(render);
    }

    processAudioData(dataArray) {
        const bass = this.getAverage(dataArray, 0, 96) / 255;
        const lowMid = this.getAverage(dataArray, 96, 256) / 255;
        const mid = this.getAverage(dataArray, 256, 512) / 255;
        const high = this.getAverage(dataArray, 512, 1024) / 255;

        const energy = (bass + lowMid + mid + high) / 4;

        this.smoothedEnergy = this.smoothedEnergy * 0.85 + energy * 0.15;
        const transient = Math.max(0, energy - this.previousAudio.energy);
        this.energyMomentum = this.energyMomentum * 0.9 + transient;

        const brightness = (mid + high) / 2;
        const warmth = (bass + lowMid) / 2;
        const spectralTilt = brightness - warmth;

        const dynamics = Math.max(0, energy - this.smoothedEnergy);
        const momentum = Math.max(0, Math.min(1, this.energyMomentum));

        const data = {
            bass,
            lowMid,
            mid,
            high,
            energy,
            brightness,
            warmth,
            spectralTilt,
            transient: Math.max(0, Math.min(1, transient * 2)),
            dynamics,
            momentum
        };

        this.previousAudio = { energy, bass, mid, high, lowMid };
        this.lastAudioData = data;
        return data;
    }

    getAverage(array, start, end) {
        let sum = 0;
        for (let i = start; i < end; i += 1) {
            sum += array[i];
        }
        return sum / (end - start);
    }

    detectBeat(audioData, timestamp = performance.now()) {
        const sinceLast = timestamp - this.lastBeatTime;
        const liveVector = this.reactivityController.getLiveVector();
        const bassThreshold = 0.55 - liveVector.y * 0.1;
        const transientGate = audioData.transient > 0.25;
        const bassGate = audioData.bass > bassThreshold;
        const dynamicInterval = Math.max(this.minimumBeatInterval, 620 - audioData.energy * 220 - audioData.momentum * 180);

        if ((bassGate || transientGate) && sinceLast > dynamicInterval) {
            this.lastBeatTime = timestamp;
            if (this.previousBeatTimestamp) {
                const interval = timestamp - this.previousBeatTimestamp;
                if (interval > 0) {
                    this.detectedBPM = Math.round(60000 / interval);
                    this.reactivityController.setGlobalTempo(this.detectedBPM);
                    this.updateTempoLinkedControls();
                }
            }
            this.previousBeatTimestamp = timestamp;
            this.onBeat(audioData);
        }
    }

    onBeat(audioData) {
        const indicator = document.getElementById('beatIndicator');
        if (indicator) {
            indicator.classList.add('active');
            setTimeout(() => indicator.classList.remove('active'), 180);
        }

        if (this.currentEngine && typeof this.currentEngine.triggerClick === 'function') {
            this.currentEngine.triggerClick(1.0 + audioData.energy * 0.5);
        }

        this.reactivityController.handleBeat(1 + audioData.energy * 0.4);
    }

    applyParameters(paramMap) {
        if (!this.currentEngine || !paramMap) return;

        const entries = Object.entries(paramMap).filter(([, value]) => Number.isFinite(value));
        if (!entries.length) return;

        entries.forEach(([key, value]) => {
            this.lastReactiveParameters[key] = value;
        });

        const payload = Object.fromEntries(entries);

        this.renderReactivityTelemetry(this.lastReactiveParameters, this.reactivityController.getModulatorSnapshot());

        if (this.currentEngine.parameterManager && typeof this.currentEngine.parameterManager.setParameters === 'function') {
            this.currentEngine.parameterManager.setParameters(payload);
        } else if (typeof this.currentEngine.updateParameters === 'function') {
            this.currentEngine.updateParameters(payload);
        } else if (typeof this.currentEngine.updateParameter === 'function') {
            entries.forEach(([key, value]) => this.currentEngine.updateParameter(key, value));
        }
    }

    applyReactiveMode(audioData, context) {
        const params = this.reactivityController.compute(audioData, context);
        this.applyParameters(params);

        if (this.currentEngine && this.currentEngine.audioEnabled !== undefined) {
            this.currentEngine.audioEnabled = true;
        }
    }

    applyChoreography(audioData, context) {
        const currentTime = context.time;
        const activeSequence = this.sequences.find(
            (seq) => currentTime >= seq.time && currentTime < seq.time + seq.duration
        );

        if (!activeSequence) {
            this.applyReactiveMode(audioData, context);
            return;
        }

        const effects = activeSequence.effects || {};

        if (effects.system && effects.system !== this.currentSystem) {
            this.switchSystem(effects.system);
        }

        const baseParams = {};
        const geometryIndex = this.resolveGeometryIndex(effects.geometry, currentTime, activeSequence, audioData);
        if (geometryIndex !== null) {
            baseParams.geometry = geometryIndex;
        }

        const frameContext = {
            ...context,
            sequence: effects,
            geometryIndex: this.geometryState.index
        };

        const reactiveParams = this.reactivityController.compute(audioData, frameContext);
        const combinedParams = { ...baseParams, ...reactiveParams };

        this.applyParameters(combinedParams);

        if (this.currentEngine && this.currentEngine.audioEnabled !== undefined) {
            this.currentEngine.audioEnabled = true;
        }
    }

    resolveGeometryIndex(mode, currentTime, sequence, audioData) {
        if (!mode) {
            return this.geometryState.index;
        }

        const now = performance.now();

        if (mode === 'cycle') {
            const cycleDuration = Math.max(sequence.duration, 1);
            const progress = (currentTime - sequence.time) / cycleDuration;
            const index = Math.floor(progress * GEOMETRY_VARIATIONS) % GEOMETRY_VARIATIONS;
            this.geometryState.index = index;
            return index;
        }

        if (mode === 'morph') {
            const index = Math.floor((currentTime * 0.5) % GEOMETRY_VARIATIONS);
            this.geometryState.index = index;
            return index;
        }

        if (mode === 'random') {
            if (audioData.energy > 0.55 && now - this.geometryState.lastChange > 500) {
                this.geometryState.index = Math.floor(Math.random() * GEOMETRY_VARIATIONS);
                this.geometryState.lastChange = now;
            }
            return this.geometryState.index;
        }

        if (mode === 'explosive') {
            if ((audioData.transient > 0.35 || audioData.bass > 0.75) && now - this.geometryState.lastChange > 300) {
                this.geometryState.index = Math.floor(Math.random() * GEOMETRY_VARIATIONS);
                this.geometryState.lastChange = now;
            }
            return this.geometryState.index;
        }

        if (mode === 'hold') {
            return this.geometryState.index;
        }

        return this.geometryState.index;
    }

    updateTimeline() {
        if (!this.dom.timelineProgress) return;
        if (!this.audio.duration) {
            this.dom.timelineProgress.style.width = '0%';
            return;
        }
        const progress = (this.audio.currentTime / this.audio.duration) * 100;
        this.dom.timelineProgress.style.width = `${progress}%`;
    }

    updateInfoPanel(audioData) {
        if (this.dom.beatInfo) {
            this.dom.beatInfo.textContent = `BPM: ${this.detectedBPM || '--'} | Beat Momentum: ${(this.reactivityController.getBeatMomentum() * 100).toFixed(0)}%`;
        }
        if (this.dom.energyInfo) {
            this.dom.energyInfo.textContent = `Energy: ${(audioData.energy * 100).toFixed(0)}% | Bass: ${(audioData.bass * 100).toFixed(0)}% | Bright: ${(audioData.brightness * 100).toFixed(0)}%`;
        }
        if (this.dom.spectralInfo) {
            this.dom.spectralInfo.textContent = `Tilt: ${(audioData.spectralTilt * 100).toFixed(1)} | Transient: ${(audioData.transient * 100).toFixed(0)}%`;
        }
        if (this.dom.reactivityInfo) {
            const vector = this.reactivityController.getLiveVector();
            const automationState = this.isAutomationPlaybackEnabled
                ? `ON (${this.automationPlaybackMeta?.label ?? 'Automation'})`
                : 'OFF';
            const glideDisplay = Number.isFinite(this.automationPlaybackMeta?.glide)
                ? this.automationPlaybackMeta.glide
                : this.automationGlide;
            this.dom.reactivityInfo.textContent = `Pad X: ${vector.x.toFixed(2)} | Y: ${vector.y.toFixed(2)} | Momentum: ${(audioData.momentum * 100).toFixed(0)}% | Automation: ${automationState} | Glide: ${glideDisplay.toFixed(2)}`;
        }
    }

    updateStatus(message, type = 'info') {
        if (!this.statusManager) return;

        switch (type) {
            case 'success':
                this.statusManager.success(message);
                break;
            case 'error':
                this.statusManager.error(message);
                break;
            case 'warning':
                this.statusManager.warning(message);
                break;
            case 'loading':
                this.statusManager.loading(message);
                break;
            default:
                this.statusManager.info(message);
        }
    }

    exportChoreography() {
        const data = JSON.stringify(this.sequences, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'choreography.json';
        link.click();
        URL.revokeObjectURL(url);
        this.updateStatus('Choreography exported', 'success');
    }

    importChoreography() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                try {
                    const sequences = JSON.parse(loadEvent.target.result);
                    if (Array.isArray(sequences)) {
                        this.sequences = sequences;
                        this.renderSequenceList();
                        this.updateStatus('Choreography imported', 'success');
                    } else {
                        throw new Error('Invalid choreography format');
                    }
                } catch (error) {
                    console.error('Failed to import choreography', error);
                    this.updateStatus('Failed to import choreography', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
}
