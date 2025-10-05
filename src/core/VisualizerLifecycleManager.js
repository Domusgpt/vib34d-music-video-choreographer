export class VisualizerLifecycleManager {
    constructor({
        root,
        rootId = 'visualizer-container',
        containerMap,
        canvasClass = 'visualization-canvas',
        devicePixelRatioCap = 2
    } = {}) {
        if (typeof document === 'undefined') {
            return;
        }

        this.canvasClass = canvasClass;
        this.devicePixelRatioCap = devicePixelRatioCap;
        this.root = this.resolveRoot(root, rootId);
        this.containerIds = {
            faceted: 'vib34dLayers',
            quantum: 'quantumLayers',
            holographic: 'holographicLayers',
            polychora: 'polychoraLayers',
            ...(containerMap || {})
        };
        this.layerContainers = new Map();
        this.globalKeyMap = {
            faceted: 'engine',
            quantum: 'quantumEngine',
            holographic: 'holographicSystem',
            polychora: 'polychoraSystem'
        };
        this.currentSystem = null;
        this.currentEngine = null;
        this.resizeRaf = null;
        this.resizeObserver = null;
        this.boundResize = () => this.queueResize();

        Object.keys(this.containerIds).forEach((systemName) => {
            this.ensureSystemContainer(systemName);
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.boundResize, { passive: true });
            window.addEventListener('orientationchange', this.boundResize);
        }

        if (typeof ResizeObserver !== 'undefined' && this.root) {
            this.resizeObserver = new ResizeObserver(() => this.queueResize());
            this.resizeObserver.observe(this.root);
        }
    }

    resolveRoot(root, rootId) {
        if (root) return root;
        if (rootId && typeof document !== 'undefined') {
            return document.getElementById(rootId) || null;
        }
        return null;
    }

    ensureSystemContainer(systemName) {
        if (typeof document === 'undefined') return null;

        const containerId = this.containerIds[systemName] || this.containerIds.faceted;
        let container = this.layerContainers.get(systemName);

        if (container && !document.body.contains(container)) {
            container = null;
        }

        if (!container) {
            container = containerId ? document.getElementById(containerId) : null;
        }

        if (!container && this.root) {
            container = document.createElement('div');
            container.id = containerId || `visualizer-${systemName}-layers`;
            container.dataset.system = systemName;
            container.className = 'visualizer-layer-group';
            this.root.appendChild(container);
        }

        if (container) {
            container.dataset.system = systemName;
            container.classList.add('visualizer-layer-group');
        }

        if (container) {
            this.layerContainers.set(systemName, container);
        }

        return container;
    }

    async switchSystem(systemName, engineFactory) {
        if (!systemName || typeof engineFactory !== 'function' || typeof document === 'undefined') {
            return null;
        }

        if (this.currentSystem === systemName && this.currentEngine) {
            this.showActiveContainer(systemName);
            this.queueResize();
            return this.currentEngine;
        }

        const previousSystem = this.currentSystem;
        const previousContainer = previousSystem ? this.layerContainers.get(previousSystem) : null;

        await this.destroyCurrentEngine();

        if (previousContainer) {
            this.clearContainer(previousContainer);
        }

        const targetContainer = this.ensureSystemContainer(systemName);
        this.showActiveContainer(systemName);
        this.clearContainer(targetContainer);
        this.createCanvasStack(systemName, targetContainer);

        let engine;
        try {
            engine = await engineFactory();
        } catch (error) {
            this.clearContainer(targetContainer);
            this.showActiveContainer(previousSystem);
            throw error;
        }

        if (!engine) {
            this.clearContainer(targetContainer);
            this.showActiveContainer(previousSystem);
            throw new Error('Engine factory returned no engine instance');
        }

        this.currentEngine = engine;
        this.currentSystem = systemName;
        this.assignEngineGlobal(systemName, engine);

        if (typeof engine.setActive === 'function') {
            try {
                engine.setActive(true);
            } catch (error) {
                console.warn('Failed to activate engine after switch', error);
            }
        }

        this.queueResize();
        return engine;
    }

    async destroyCurrentEngine() {
        if (!this.currentEngine) {
            return;
        }

        const engine = this.currentEngine;
        const systemName = this.currentSystem;
        this.currentEngine = null;
        this.currentSystem = null;

        try {
            if (typeof engine.setActive === 'function') {
                engine.setActive(false);
            }
        } catch (error) {
            console.warn('Failed to deactivate engine before destroy', error);
        }

        try {
            if (typeof engine.destroy === 'function') {
                await Promise.resolve(engine.destroy());
            }
        } catch (error) {
            console.warn('Engine destroy failed', error);
        }

        this.assignEngineGlobal(systemName, null);
    }

    assignEngineGlobal(systemName, engine) {
        if (typeof window === 'undefined') return;
        const key = this.globalKeyMap[systemName];
        if (!key) return;
        window[key] = engine || null;
    }

    showActiveContainer(systemName) {
        this.layerContainers.forEach((container, key) => {
            if (!container) return;
            const isActive = key === systemName;
            container.classList.toggle('is-active', isActive);
            container.style.display = isActive ? 'block' : 'none';
            container.style.visibility = isActive ? 'visible' : 'hidden';
            container.style.opacity = isActive ? '1' : '0';
        });
    }

    createCanvasStack(systemName, container) {
        if (!container) return;

        const layers = this.getCanvasSpec(systemName);
        layers.forEach(({ id, role }, index) => {
            const canvas = document.createElement('canvas');
            canvas.id = id;
            canvas.dataset.layerRole = role;
            canvas.className = this.canvasClass;
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.zIndex = index + 1;
            container.appendChild(canvas);
        });

        this.updateCanvasDimensions(container);
    }

    getCanvasSpec(systemName) {
        const roles = ['background', 'shadow', 'content', 'highlight', 'accent'];
        const prefixMap = {
            faceted: '',
            quantum: 'quantum-',
            holographic: 'holo-',
            polychora: 'polychora-'
        };
        const prefix = prefixMap[systemName] ?? `${systemName}-`;
        return roles.map((role) => ({
            id: `${prefix}${role}-canvas`,
            role
        }));
    }

    clearContainer(container) {
        if (!container) return;
        this.releaseWebGLContexts(container);
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

    releaseWebGLContexts(container) {
        if (!container) return;
        const canvases = Array.from(container.querySelectorAll('canvas'));
        canvases.forEach((canvas) => {
            try {
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (gl) {
                    const loseContext = gl.getExtension && gl.getExtension('WEBGL_lose_context');
                    if (loseContext) {
                        loseContext.loseContext();
                    }
                }
                canvas.width = 0;
                canvas.height = 0;
            } catch (error) {
                console.warn('Failed to release WebGL context', error);
            }
        });
    }

    updateCanvasDimensions(container) {
        if (typeof window === 'undefined') return;
        const target = container || (this.currentSystem ? this.layerContainers.get(this.currentSystem) : null);
        if (!target) return;

        const rect = (this.root || target).getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, this.devicePixelRatioCap);
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));

        target.querySelectorAll('canvas').forEach((canvas, index) => {
            canvas.style.zIndex = index + 1;
            if (canvas.width !== width) {
                canvas.width = width;
            }
            if (canvas.height !== height) {
                canvas.height = height;
            }
        });
    }

    queueResize() {
        if (typeof window === 'undefined') return;
        if (this.resizeRaf) {
            cancelAnimationFrame(this.resizeRaf);
        }
        this.resizeRaf = requestAnimationFrame(() => {
            this.resizeRaf = null;
            this.updateCanvasDimensions();
        });
    }

    ensureCanvasDimensions() {
        this.queueResize();
    }

    async destroy() {
        if (typeof document === 'undefined') {
            return;
        }

        await this.destroyCurrentEngine();

        this.layerContainers.forEach((container) => {
            this.clearContainer(container);
            if (container) {
                container.classList.remove('is-active');
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                container.style.opacity = '0';
            }
        });

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.boundResize);
            window.removeEventListener('orientationchange', this.boundResize);
        }

        if (this.resizeRaf) {
            cancelAnimationFrame(this.resizeRaf);
            this.resizeRaf = null;
        }
    }
}
