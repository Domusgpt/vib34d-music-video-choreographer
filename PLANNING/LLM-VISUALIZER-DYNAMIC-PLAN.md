# LLM-Driven Dynamic Visualizer Strategy

## 1. Vision and Experience Goals
- **Conversational conductor**: Allow creators to describe mood shifts, camera moves, and cross-system transitions in natural language, with the platform translating prompts into parameter curves, choreography edits, and effect triggers in real time.
- **Adaptive performance mode**: Enable live VJ usage where an operator (human or autonomous LLM agent) can adjust pacing, color palettes, and system emphasis mid-performance without pausing playback.
- **Co-creative authoring**: Treat the LLM as a collaborator that can propose timelines, visual motifs, and refinements, with transparent previews and user-overridable suggestions.

## 2. Current Capabilities to Leverage
- **Multi-system render architecture** already exposes a shared `visualizers` array and per-layer update hooks inside the faceted/quantum/holographic engines, making it possible to inject generated parameter deltas at render time.【F:src/core/Engine.js†L18-L210】【F:src/core/PolychoraSystem.js†L523-L1028】
- **Hybrid timeline + audio modulation** allows choreography sequences (system switches, geometry presets, rotations) to blend with audio-reactive overlays, providing a foundation for LLM-authored base curves that music then modulates.【F:HYBRID-MODE-GUIDE.md†L1-L122】
- **Existing LLM parameter interface** already translates free-form descriptions into JSON parameter sets and routes them back to the UI, proving the prompt-to-parameter pattern and storage of API credentials.【F:src/llm/LLMParameterInterface.js†L1-L148】【F:src/llm/LLMParameterUI.js†L1-L124】

## 3. Target Interaction Model
1. **Declarative prompts** ("give me an aurora build into a prismatic drop at 1:30") produce structured actions: timeline edits, parameter envelopes, camera motions.
2. **Procedural control**: Live chat commands like "increase quantum chaos" or "sync accent layer with snare" trigger incremental adjustments with safety bounds.
3. **Autonomous scenes**: Agents can monitor audio + visual state, then proactively suggest transitions or variations.

## 4. Architecture Additions
### 4.1 Prompt Orchestration Layer
- **LLM Command Router**: Interprets natural language into typed intents (`SetParameters`, `EditTimeline`, `ScheduleEvent`, `QueryState`). Maintains conversation context, including current system, active sequence, and audio metrics.
- **Domain Grammar**: Define JSON schema for intents (e.g., `{"action":"setParameter","target":"faceted.speed","valueCurve":{"type":"ease","start":0.8,"end":1.6,"duration":12}}`). Provide as tool specification to LLM to ensure structured output.

### 4.2 Dynamic Control Engine
- **State Mutation Bus**: Central async queue where intents are validated and applied to underlying managers (`ParameterManager`, `VariationManager`, timeline store). Supports optimistic updates with rollback.
- **Live Envelope Manager**: Applies time-based curves to parameters by injecting per-frame modifiers before `visualizer.render()` calls. Uses easing functions, LFOs, or audio-follow modifiers.
- **Safety & Constraints**: Clamp values to engine-supported ranges, resolve conflicts when simultaneous commands affect the same property, and throttle update rates to avoid UI thrash.

### 4.3 Feedback Loop & UX
- **Conversational Diff UI**: Show pending changes (e.g., "LLM will switch to Quantum at 90s, increase chaos to 0.9") with accept/adjust/reject controls. Provide quick sliders for manual overrides.
- **State Summaries**: LLM can query `getCurrentState()` for canonical snapshot (active system, parameter values, timeline sequences). Mirror these in UI for transparency.
- **Audit & Replay**: Log every LLM action with timestamp + prompt for undo and for training future agents.

## 5. Implementation Phases
### Phase 0 – Foundations (1-2 sprints)
- Extract parameter/timeline mutation APIs into a documented service layer to avoid direct DOM manipulation.
- Define JSON schemas for intents and build zod/TypeScript validators (or vanilla validators) to guard runtime.
- Extend LLM prompt instructions to describe available tools, return format, and safety rules.

### Phase 1 – Assisted Authoring (2 sprints)
- Enable prompts that generate complete timeline blueprints: sequences with start/duration/system/geometry. Render preview diff and allow one-click commit.
- Allow static parameter presets and gradient animations (e.g., "fade hue from 180 to 320 over the chorus"). Apply by writing to timeline metadata so audio reactivity still layers on top.
- Persist accepted LLM edits in choreography JSON exports so sessions are reproducible.

### Phase 2 – Live Adaptive Control (2-3 sprints)
- Build real-time command console with streaming responses. Support incremental parameter nudges (`+/-` adjustments) and automated cooldown to respect render loop.
- Integrate audio analytics feed (energy, beats, spectral centroid) into prompt context so LLM can reference current musical intensity.
- Implement `LLMAgentWatchers` that monitor thresholds (e.g., energy spikes) and ask permission before enacting pre-scripted transitions.

### Phase 3 – Autonomous Collaborator (ongoing)
- Introduce multi-agent setup: a **Composer Agent** plans macro arcs, a **Performer Agent** handles live adjustments, and a **Critic Agent** evaluates visual balance, surfacing suggestions.
- Add reinforcement via user feedback (thumbs up/down) to fine-tune prompts or choose between multiple LLM proposals.
- Explore offline heuristic fallback (rule-based) when LLM unavailable, ensuring show continuity.

## 6. Technical Considerations
- **Latency**: Pre-fetch or cache LLM responses during low-activity windows; use streaming APIs to begin applying long-running envelopes sooner.
- **Scalability**: Allow remote LLM hosting (e.g., serverless function) plus local inference adapters for air-gapped shows.
- **Security**: Sanitize commands, enforce API rate limits, encrypt stored keys, and provide offline manual override switch.
- **Testing**: Build scenario scripts (prompt → expected parameter diff) and visual regression captures to validate outcomes. Include simulation harness that feeds prerecorded audio + scripted prompts.

## 7. Productization & Offering Strategy
- **Pro Tier Add-on**: Market the LLM control as a premium "AI Conductor" module, bundled with priority support and template libraries.
- **Creator Playlists**: Offer curated prompt packs ("Neon Cyberpunk Set", "Ethereal Ambient Journey") that instantiate ready-made timelines users can tweak.
- **Agency/Live Services**: Provide managed performances where Clear Seas Solutions runs an autonomous LLM VJ, capturing logs for post-event highlight reels.
- **API Access**: Expose REST/WebSocket endpoints so third-party tools (e.g., Ableton scripts, stage automation) can trigger the same intent schema without direct UI usage.

## 8. Next Steps Checklist
1. Document current parameter/timeline mutation points and expose them through a consolidated controller API.
2. Draft intent schema + tool description, then prototype prompt → JSON conversion with Gemini to validate reliability.
3. Implement guarded mutation bus and envelope manager with unit tests.
4. Ship assisted authoring UI with diff preview and rollback.
5. Pilot live control in a rehearsal, logging latency, failure cases, and user overrides.
6. Iterate on prompt engineering + agent roles based on pilot feedback.
