/**
 * ReactiveXYPad
 * -------------
 * Lightweight XY pad controller for live reactivity. Provides pointer &
 * keyboard interaction, snapping, and exposes change callbacks.
 */

export class ReactiveXYPad {
    constructor(element, options = {}) {
        if (!element) {
            throw new Error('ReactiveXYPad requires a container element');
        }

        this.element = element;
        this.options = {
            keyStep: 0.08,
            snap: options.snap ?? null,
            onChange: options.onChange ?? (() => {}),
            onRelease: options.onRelease ?? (() => {}),
            onEngage: options.onEngage ?? (() => {}),
            onActivity: options.onActivity ?? (() => {}),
            ...options
        };

        this.handle = element.querySelector('.xy-pad__handle');
        if (!this.handle) {
            this.handle = document.createElement('div');
            this.handle.className = 'xy-pad__handle';
            this.element.appendChild(this.handle);
        }

        this.value = { x: 0, y: 0 };
        this.isPointerDown = false;
        this.activePointerId = null;
        this.keyboardActiveUntil = 0;

        this.boundPointerDown = this.handlePointerDown.bind(this);
        this.boundPointerMove = this.handlePointerMove.bind(this);
        this.boundPointerUp = this.handlePointerUp.bind(this);
        this.boundPointerCancel = this.handlePointerCancel.bind(this);
        this.boundKeyDown = this.handleKeyDown.bind(this);
        this.boundDoubleClick = () => this.setValue({ x: 0, y: 0 });
        this.boundResize = () => this.updateHandlePosition();

        this.init();
    }

    init() {
        if (this.element.tabIndex < 0) {
            this.element.tabIndex = 0;
        }

        if (!this.element.style.touchAction) {
            this.element.style.touchAction = 'none';
        }

        this.element.classList.add('xy-pad--ready');
        this.element.addEventListener('pointerdown', this.boundPointerDown);
        this.element.addEventListener('keydown', this.boundKeyDown);
        this.element.addEventListener('dblclick', this.boundDoubleClick);
        window.addEventListener('resize', this.boundResize);

        this.updateHandlePosition();
    }

    destroy() {
        this.element.removeEventListener('pointerdown', this.boundPointerDown);
        this.element.removeEventListener('keydown', this.boundKeyDown);
        this.element.removeEventListener('dblclick', this.boundDoubleClick);
        window.removeEventListener('resize', this.boundResize);
    }

    getValue() {
        return { ...this.value };
    }

    setValue({ x = 0, y = 0 }, silent = false) {
        const clamp = (val) => Math.max(-1, Math.min(1, val));
        let nextX = clamp(x);
        let nextY = clamp(y);

        if (this.options.snap) {
            const snap = this.options.snap;
            nextX = Math.round(nextX / snap) * snap;
            nextY = Math.round(nextY / snap) * snap;
        }

        this.value = { x: nextX, y: nextY };
        this.updateHandlePosition();

        if (!silent) {
            this.options.onChange({ ...this.value });
        }
    }

    isEngaged() {
        return this.isPointerDown || this.getNow() < this.keyboardActiveUntil;
    }

    getNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    updateHandlePosition() {
        const percentX = ((this.value.x + 1) / 2) * 100;
        const percentY = ((1 - this.value.y) / 2) * 100;
        this.handle.style.transform = `translate(${percentX}%, ${percentY}%) translate(-50%, -50%)`;
    }

    handlePointerDown(event) {
        this.element.focus();
        this.isPointerDown = true;
        this.activePointerId = event.pointerId;
        this.element.setPointerCapture(event.pointerId);
        this.options.onEngage(this.getValue());
        this.updateFromPointer(event);

        this.element.addEventListener('pointermove', this.boundPointerMove);
        this.element.addEventListener('pointerup', this.boundPointerUp);
        this.element.addEventListener('pointercancel', this.boundPointerCancel);
    }

    handlePointerMove(event) {
        if (!this.isPointerDown || event.pointerId !== this.activePointerId) return;
        this.updateFromPointer(event);
    }

    handlePointerUp(event) {
        if (event.pointerId !== this.activePointerId) return;
        this.isPointerDown = false;
        this.activePointerId = null;
        this.element.releasePointerCapture(event.pointerId);
        this.element.removeEventListener('pointermove', this.boundPointerMove);
        this.element.removeEventListener('pointerup', this.boundPointerUp);
        this.element.removeEventListener('pointercancel', this.boundPointerCancel);
        this.keyboardActiveUntil = this.getNow() + 120;
        this.options.onRelease(this.getValue());
    }

    handlePointerCancel(event) {
        if (event.pointerId !== this.activePointerId) return;
        this.isPointerDown = false;
        this.activePointerId = null;
        this.element.releasePointerCapture(event.pointerId);
        this.element.removeEventListener('pointermove', this.boundPointerMove);
        this.element.removeEventListener('pointerup', this.boundPointerUp);
        this.element.removeEventListener('pointercancel', this.boundPointerCancel);
        this.keyboardActiveUntil = this.getNow() + 120;
        this.options.onRelease(this.getValue());
    }

    updateFromPointer(event) {
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const relativeX = (event.clientX - rect.left) / rect.width;
        const relativeY = (event.clientY - rect.top) / rect.height;

        const normalizedX = Math.max(-1, Math.min(1, relativeX * 2 - 1));
        const normalizedY = Math.max(-1, Math.min(1, (1 - relativeY) * 2 - 1));

        this.setValue({ x: normalizedX, y: normalizedY });
    }

    handleKeyDown(event) {
        const step = this.options.keyStep;
        let handled = false;
        let { x, y } = this.value;

        switch (event.key) {
            case 'ArrowLeft':
                x -= step;
                handled = true;
                break;
            case 'ArrowRight':
                x += step;
                handled = true;
                break;
            case 'ArrowUp':
                y += step;
                handled = true;
                break;
            case 'ArrowDown':
                y -= step;
                handled = true;
                break;
            case 'Home':
                x = 0;
                y = 0;
                handled = true;
                break;
            default:
                break;
        }

        if (handled) {
            event.preventDefault();
            this.setValue({ x, y });
            this.keyboardActiveUntil = this.getNow() + 360;
            this.options.onActivity(this.getValue());
        }
    }
}

