/**
 * LiveMacroManager
 * -----------------
 * Stores expressive macro snapshots for the live XY pad and reactivity system.
 * Each macro slot can capture the current pad vector, most recent parameter map,
 * and audio metrics. When recalled, the manager emits a smooth morph toward the
 * stored state so the transition feels musical on stage.
 */

export class LiveMacroManager {
    constructor(options = {}) {
        this.slotCount = Math.max(1, Number(options.slotCount) || 4);
        this.blendDuration = Math.max(120, Number(options.blendDuration) || 1600);
        this.easeFunction = typeof options.ease === 'function' ? options.ease : this.defaultEase;
        this.slots = Array.from({ length: this.slotCount }, (_, index) => this.createEmptySlot(index, options.labels));
        this.transition = null;
    }

    createEmptySlot(index, labels = []) {
        const label = Array.isArray(labels) && labels[index] ? String(labels[index]) : `Macro ${index + 1}`;
        return {
            id: index,
            label,
            vector: { x: 0, y: 0 },
            parameters: {},
            audioMetrics: {},
            captured: false,
            updatedAt: null
        };
    }

    defaultEase(t) {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    clampVector(vector = {}) {
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

    sanitizeSnapshot(data = {}) {
        const sanitized = {};
        Object.entries(data).forEach(([key, value]) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                sanitized[key] = numeric;
            }
        });
        return sanitized;
    }

    getSlot(index) {
        return this.slots[index] || null;
    }

    renameSlot(index, label) {
        const slot = this.getSlot(index);
        if (!slot) return null;
        const nextLabel = typeof label === 'string' && label.trim() ? label.trim() : slot.label;
        slot.label = nextLabel;
        return slot;
    }

    setBlendDuration(durationMs) {
        const next = Number(durationMs);
        if (Number.isFinite(next) && next > 0) {
            this.blendDuration = Math.max(120, next);
        }
        return this.blendDuration;
    }

    getBlendDuration() {
        return this.blendDuration;
    }

    capture(index, snapshot = {}, meta = {}) {
        const slot = this.getSlot(index);
        if (!slot) return null;

        const vector = this.clampVector(snapshot.vector ?? snapshot);
        const parameters = this.sanitizeSnapshot(snapshot.parameters ?? {});
        const audioMetrics = this.sanitizeSnapshot(snapshot.audioMetrics ?? meta.audioMetrics ?? {});
        const label = typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : slot.label;

        Object.assign(slot, {
            label,
            vector,
            parameters,
            audioMetrics,
            captured: true,
            updatedAt: meta.timestamp ?? new Date().toISOString()
        });

        if (this.transition && this.transition.slotId === index) {
            this.transition.toVector = { ...vector };
            this.transition.toParameters = { ...parameters };
        }

        return slot;
    }

    recall(index, currentState = {}, timestamp = this.getNow()) {
        const slot = this.getSlot(index);
        if (!slot || !slot.captured) {
            return null;
        }

        const fromVector = this.clampVector(currentState.vector ?? {});
        const fromParameters = this.sanitizeSnapshot(currentState.parameters ?? {});

        this.transition = {
            slotId: index,
            label: slot.label,
            startedAt: timestamp,
            duration: Math.max(120, this.blendDuration),
            fromVector,
            toVector: { ...slot.vector },
            fromParameters,
            toParameters: { ...slot.parameters }
        };

        return { ...slot };
    }

    cancelTransition() {
        this.transition = null;
    }

    getActiveTransition() {
        return this.transition ? { ...this.transition } : null;
    }

    update(timestamp = this.getNow()) {
        if (!this.transition) {
            return null;
        }

        const elapsed = Math.max(0, timestamp - this.transition.startedAt);
        const progress = Math.min(1, elapsed / this.transition.duration);
        const eased = this.easeFunction(progress);
        const { fromVector, toVector, fromParameters, toParameters, slotId, label } = this.transition;

        const vector = {
            x: fromVector.x + (toVector.x - fromVector.x) * eased,
            y: fromVector.y + (toVector.y - fromVector.y) * eased
        };

        const parameters = {};
        const keys = new Set([...Object.keys(fromParameters), ...Object.keys(toParameters)]);
        keys.forEach((key) => {
            const fromValue = fromParameters[key] ?? fromVector[key];
            const toValue = toParameters[key] ?? fromValue;
            const numericFrom = Number(fromValue);
            const numericTo = Number(toValue);
            if (Number.isFinite(numericFrom) && Number.isFinite(numericTo)) {
                parameters[key] = numericFrom + (numericTo - numericFrom) * eased;
            }
        });

        const payload = {
            slotId,
            label,
            progress,
            easedProgress: eased,
            vector,
            parameters,
            isComplete: progress >= 1
        };

        if (progress >= 1) {
            this.transition = null;
        }

        return payload;
    }

    getNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}
