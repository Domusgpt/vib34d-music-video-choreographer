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
        this.lastReactiveParameters = {};
        this.pendingSystemSwitch = null;

        this.init();
    }

    async init() {
        console.log(`🎵 Initializing Music Video Choreographer in ${this.mode.toUpperCase()} mode`);

        this.cacheDomReferences();
        this.configureReactivitySystem();
        this.setupEventListeners();
        this.setupReactivityPad();

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
            sequenceList: document.getElementById('sequence-list')
        };
    }

    configureReactivitySystem() {
        this.reactivityController
            .registerParameter('gridDensity', {
                base: 18,
                sources: [
                    { band: 'bass', weight: 28 },
                    { band: 'lowMid', weight: 16 }
                ],
                liveAxes: { x: 22, y: 12 },
                range: [8, 96],
                smoothing: 0.22,
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
                smoothing: 0.15
            })
            .registerParameter('saturation', {
                base: 0.62,
                sources: [
                    { band: 'bass', weight: 0.45 },
                    { band: 'warmth', weight: 0.3 }
                ],
                liveAxes: { y: 0.2 },
                range: [0.2, 1],
                smoothing: 0.2
            })
            .registerParameter('dimension', {
                base: 3.35,
                sources: [
                    { band: 'energy', weight: 0.4 }
                ],
                liveAxes: { y: 0.35 },
                range: [3.1, 4.4],
                smoothing: 0.3,
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
                    return Math.sin(t * baseFreq) * amplitude + meta.liveVector.y * 0.9;
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
                    return Math.cos(t * baseFreq) * amplitude + meta.liveVector.x * 0.6;
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
                    return Math.sin(t * baseFreq + meta.audio.high * Math.PI) * amplitude + meta.liveVector.y * 0.4;
                }
            })
            .registerParameter('hue', {
                wrap: 360,
                smoothing: 0.12,
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
            exportAutomationBtn
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

        this.audio.addEventListener('ended', () => this.stop());
        this.audio.addEventListener('timeupdate', () => this.updateTimeline());
    }

    setupReactivityPad() {
        const padElement = this.dom.reactivityPad;
        if (!padElement) return;

        this.xyPad = new ReactiveXYPad(padElement, {
            snap: 0.02,
            onEngage: () => this.recordAutomationPoint(this.reactivityController.getLiveVector()),
            onChange: (vector) => {
                this.reactivityController.setLiveVector(vector);
                this.updateReactivityReadout(vector);
                this.recordAutomationPoint(vector);
                this.applyLiveVector();
            },
            onRelease: (vector) => {
                this.recordAutomationPoint(vector);
                this.applyLiveVector();
            }
        });

        this.updateReactivityReadout(this.xyPad.getValue());
    }

    updateReactivityReadout(vector) {
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

    resetAutomationState() {
        this.isRecordingAutomation = false;
        this.automationData = [];
        this.lastAutomationTimestamp = -1;

        if (this.dom.recordAutomationBtn) {
            this.dom.recordAutomationBtn.textContent = '● Start Recording';
            this.dom.recordAutomationBtn.classList.remove(RECORD_BUTTON_ACTIVE_CLASS);
        }
        if (this.dom.exportAutomationBtn) {
            this.dom.exportAutomationBtn.disabled = true;
        }
    }

    toggleAutomationRecording() {
        this.isRecordingAutomation = !this.isRecordingAutomation;

        if (this.isRecordingAutomation) {
            this.automationData = [];
            this.lastAutomationTimestamp = -1;
            this.updateStatus('Automation recording armed', 'info');
            if (this.dom.recordAutomationBtn) {
                this.dom.recordAutomationBtn.textContent = '■ Stop Recording';
                this.dom.recordAutomationBtn.classList.add(RECORD_BUTTON_ACTIVE_CLASS);
            }
            if (this.dom.exportAutomationBtn) {
                this.dom.exportAutomationBtn.disabled = true;
            }
        } else {
            const hasData = this.automationData.length > 0;
            this.updateStatus('Automation recording stopped', hasData ? 'success' : 'info');
            if (this.dom.recordAutomationBtn) {
                this.dom.recordAutomationBtn.textContent = '● Start Recording';
                this.dom.recordAutomationBtn.classList.remove(RECORD_BUTTON_ACTIVE_CLASS);
            }
            if (this.dom.exportAutomationBtn) {
                this.dom.exportAutomationBtn.disabled = !hasData;
            }
        }
    }

    exportAutomationData() {
        if (!this.automationData.length) {
            this.updateStatus('No automation data to export', 'warning');
            return;
        }

        const payload = {
            createdAt: new Date().toISOString(),
            duration: this.audio.duration,
            mode: this.mode,
            system: this.currentSystem,
            points: this.automationData
        };

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

        const time = this.audio.currentTime || 0;
        const roundedTime = Number(time.toFixed(3));
        if (this.lastAutomationTimestamp === roundedTime) {
            const last = this.automationData[this.automationData.length - 1];
            if (last) {
                last.x = Number(vector.x.toFixed(3));
                last.y = Number(vector.y.toFixed(3));
            }
            return;
        }

        this.lastAutomationTimestamp = roundedTime;
        this.automationData.push({
            time: roundedTime,
            x: Number(vector.x.toFixed(3)),
            y: Number(vector.y.toFixed(3))
        });

        if (this.dom.exportAutomationBtn) {
            this.dom.exportAutomationBtn.disabled = false;
        }
    }

    async loadAudioFile(file) {
        if (!file) return;

        const url = URL.createObjectURL(file);
        this.audio.src = url;

        if (!this.sourceNode) {
            this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }

        if (this.dom.playButton) this.dom.playButton.disabled = false;
        if (this.dom.pauseButton) this.dom.pauseButton.disabled = false;
        if (this.dom.stopButton) this.dom.stopButton.disabled = false;

        this.resetAutomationState();
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
            this.dom.reactivityInfo.textContent = `Pad X: ${vector.x.toFixed(2)} | Y: ${vector.y.toFixed(2)} | Momentum: ${(audioData.momentum * 100).toFixed(0)}%`;
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
