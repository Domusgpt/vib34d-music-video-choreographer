# Document I — Live Reactivity & Performance Expansion Chronicle

## Purpose
Document I captures the end-to-end evolution of the music video choreographer refactor: every subsystem we introduced, how the engine now responds to performers, and the tooling layered into the UI for automation, scenes, and timelines.

## 1. Reactivity Architecture
### 1.1 Declarative Controller Core
- Centralises parameter mappings, beat handling, and modulator state while exposing snapshot import/export for scenes and automation.【F:src/core/ReactivityController.js†L1-L433】
- Supports flexible state capture (parameters, modulators, live vector) and selective application back into the controller to restore performances.【F:src/core/ReactivityController.js†L355-L433】

### 1.2 Modulator Engine
- Registers multiple modulator types (LFO, beat envelope, step sequencer, noise, custom) with tempo sync, beat retriggering, smoothing, and range constraints.【F:src/core/ReactivityController.js†L200-L336】【F:src/core/ReactivityController.js†L522-L734】
- Provides reusable waveform generation and tempo-aware frequency helpers so modulators stay phase-aligned with detected BPM or manual overrides.【F:src/core/ReactivityController.js†L522-L734】

### 1.3 Parameter Mapping Strategy
- Configures a rich set of holographic parameters (grid density, morph factor, chaos, speed, intensity, saturation, dimension, hue, rotations) that blend audio metrics, XY pad axes, beat surges, and modulators per parameter.【F:music-choreographer-engine.js†L309-L507】
- Applies sequence-aware transforms so timeline cues can bias morphing, rotation speed, and color palettes while retaining live control responsiveness.【F:music-choreographer-engine.js†L309-L507】

### 1.4 Live XY Pad Infrastructure
- Dedicated `ReactiveXYPad` component adds pointer+keyboard control, snapping, centering, and engagement callbacks for automation coordination.【F:src/ui/ReactiveXYPad.js†L1-L206】
- Engine routes pad movement through `commitLiveVector`, respecting axis locks, automation playback, and telemetry refreshes.【F:music-choreographer-engine.js†L4004-L4024】

### 1.5 Performer Utilities
- Axis lock buttons, pad reset, and telemetry lists initialise dynamically and stay in sync with reactivity updates, including disabled styling when modulators are muted.【F:music-choreographer-engine.js†L656-L770】
- Status messaging uses the lightweight `StatusManager` to surface success/warning/info events without blocking interaction.【F:src/ui/StatusManager.js†L1-L96】

## 2. Automation Workflow
### 2.1 Recording Pipeline
- Automation buttons toggle capture, disable conflicting playback states, and continuously log XY vectors with deduping plus timestamp rounding for clean datasets.【F:music-choreographer-engine.js†L574-L645】【F:music-choreographer-engine.js†L3967-L3989】

### 2.2 Playback & Blending
- Normalised automation sets feed `prepareAutomationPlayback`, which enforces clamped vectors, optional glide overrides, and metadata used by UI badges.【F:music-choreographer-engine.js†L4048-L4096】
- Runtime interpolator applies exponential glide toward target vectors while respecting axis locks and automation suspension windows when performers grab the pad.【F:music-choreographer-engine.js†L4233-L4270】【F:music-choreographer-engine.js†L4004-L4024】

### 2.3 Snapshot Management
- Automation snapshots capture datasets, glide, metadata, and persist to localStorage; load routines validate payloads, set glide controls, and update UI state accordingly.【F:music-choreographer-engine.js†L3606-L3683】
- UI reflects readiness via button states, meta readout, and warnings if playback is attempted without data or during recording.【F:music-choreographer-engine.js†L4130-L4158】

### 2.4 Import/Export Utilities
- Normalisation helpers de-duplicate imported points, enforce clamp bounds, and emit human-readable download payloads for external editing or archival.【F:music-choreographer-engine.js†L4027-L4058】【F:music-choreographer-engine.js†L3927-L3960】

## 3. Modulator Lab
- Dynamic control grid renders cards per modulator with enable toggles, live sliders tied to controller updates, beat-resync action, and live telemetry readouts.【F:music-choreographer-engine.js†L835-L1160】【F:music-choreographer-engine.js†L3600-L3603】
- Modulator metadata highlights tempo sync vs free-run behaviour and uses controller snapshots to restore per-scene parameterisations.【F:music-choreographer-engine.js†L1179-L1543】【F:src/core/ReactivityController.js†L298-L336】

## 4. Scene Lab & Performance Sets
### 4.1 Scene Capture & Recall
- UI provides capture, apply, save, load, clear, rename, duplicate, delete, reordering, and keyboard-triggered activation (1–9) with accessibility metadata.【F:music-choreographer-engine.js†L1200-L1499】【F:music-choreographer-engine.js†L2105-L2148】
- Captured scenes store live vectors, modulator configs, automation snapshots, and axis locks for faithful restoration with optional easing crossfades.【F:music-choreographer-engine.js†L2150-L2230】【F:src/core/ReactivityController.js†L369-L433】

### 4.2 Crossfade Engine
- Scene transitions blend modulator configs and automation state over configurable durations using smoothstep easing to avoid abrupt jumps.【F:music-choreographer-engine.js†L2150-L2230】

### 4.3 Persistence & Dirty Tracking
- Scene sets persist to localStorage with dirty-state badges, storage availability checks, before-unload protection, and storage status messaging.【F:music-choreographer-engine.js†L1237-L1256】【F:music-choreographer-engine.js†L1736-L1817】

## 5. Performance Timeline
### 5.1 Timeline UI Shell
- Toolbar hosts arm/follow/loop toggles, quantize, snap, BPM override input, grid division select, cue list, and contextual hints.【F:index.html†L1455-L1482】
- Engine binds controls to handler suite for add/clear cues, toggles, quantization, BPM changes, and grid snap persistence.【F:music-choreographer-engine.js†L1259-L1319】【F:music-choreographer-engine.js†L2526-L2607】

### 5.2 Cue Editing & Sequencing
- Cue cards expose scene selection, time, crossfade, label, notes, plus preview, playhead alignment, transport jump, and deletion actions.【F:music-choreographer-engine.js†L2446-L2523】
- Runtime keeps cues sorted, tracks next trigger, and syncs with audio playback respecting follow/loop switches.【F:music-choreographer-engine.js†L2994-L3059】【F:music-choreographer-engine.js†L3099-L3204】

### 5.3 Beat Grid & Quantization
- Timeline maintains snap state, manual tempo overrides, beat divisions, and quantization routines that align cues to detected/manual BPM while emitting status updates.【F:music-choreographer-engine.js†L2800-L2944】
- Beat hint text clarifies whether grid uses detected tempo, manual override, or fallback BPM, keeping performers informed.【F:music-choreographer-engine.js†L2567-L2597】

## 6. Interface Enhancements
- Reactivity panel layers XY pad, automation buttons, glide slider, snapshot controls, modulator lab, scene lab, and timeline controls with responsive layout adjustments.【F:index.html†L1373-L1484】
- Info panel now reports pad coordinates, beat data, and energy metrics aligned with reactivity telemetry updates.【F:index.html†L1339-L1345】

## 7. Operational Feedback
- Status bar surfaces contextual success/info/warning/error messages whenever automation, scene, or timeline events occur, ensuring performers know system state changes.【F:src/ui/StatusManager.js†L21-L96】【F:music-choreographer-engine.js†L2814-L2919】

## 8. Summary of Capabilities
- Live pad performance with automation recording/playback, glide blending, and snapshots.
- Tempo-synced modulators with UI tuning controls and telemetry visibility.
- Scene capture lab with crossfades, ordering, persistence, and hotkeys.
- Performance timeline sequencing with beat grid, quantization, follow/loop, and cue editing.
- Cohesive UI exposing all tools alongside responsive status messaging for live shows or studio production.【F:index.html†L1373-L1484】【F:music-choreographer-engine.js†L309-L507】【F:music-choreographer-engine.js†L1200-L3059】
