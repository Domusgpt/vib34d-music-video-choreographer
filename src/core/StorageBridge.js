const storageModeListenerRegistry = new WeakMap();
const storageChangeListenerRegistry = new WeakMap();

function createMemoryAdapter(prefix) {
    const store = new Map();
    return {
        mode: 'memory',
        getItem(key) {
            const actualKey = `${prefix}${key}`;
            return store.has(actualKey) ? store.get(actualKey) : null;
        },
        setItem(key, value) {
            const actualKey = `${prefix}${key}`;
            store.set(actualKey, String(value));
        },
        removeItem(key) {
            store.delete(`${prefix}${key}`);
        },
        clearPrefixed() {
            for (const key of Array.from(store.keys())) {
                if (key.startsWith(prefix)) {
                    store.delete(key);
                }
            }
        },
        getPrefixedEntries() {
            const entries = [];
            for (const [key, value] of store.entries()) {
                if (key.startsWith(prefix)) {
                    entries.push([key.slice(prefix.length), value]);
                }
            }
            return entries;
        },
        importEntries(entries) {
            if (!Array.isArray(entries)) {
                return;
            }
            for (const [key, value] of entries) {
                if (typeof key !== 'string') {
                    continue;
                }
                store.set(`${prefix}${key}`, String(value));
            }
        }
    };
}

function createLocalStorageAdapter(prefix) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }

    const storage = window.localStorage;
    const probeKey = `${prefix}__probe__${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;

    try {
        storage.setItem(probeKey, '1');
        storage.removeItem(probeKey);
    } catch (error) {
        console.warn('[StorageBridge] Local storage probe failed, using in-memory fallback.', error);
        return null;
    }

    return {
        mode: 'localStorage',
        getItem(key) {
            return storage.getItem(`${prefix}${key}`);
        },
        setItem(key, value) {
            storage.setItem(`${prefix}${key}`, value);
        },
        removeItem(key) {
            storage.removeItem(`${prefix}${key}`);
        },
        clearPrefixed() {
            const removalKeys = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key && key.startsWith(prefix)) {
                    removalKeys.push(key);
                }
            }
            removalKeys.forEach((key) => storage.removeItem(key));
        },
        getPrefixedEntries() {
            const entries = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (!key || !key.startsWith(prefix)) {
                    continue;
                }
                try {
                    entries.push([key.slice(prefix.length), storage.getItem(key)]);
                } catch (error) {
                    console.warn('[StorageBridge] Failed to read key during export', key, error);
                }
            }
            return entries;
        },
        importEntries(entries) {
            if (!Array.isArray(entries)) {
                return;
            }
            for (const [key, value] of entries) {
                if (typeof key !== 'string') {
                    continue;
                }
                storage.setItem(`${prefix}${key}`, value);
            }
        }
    };
}

function notifyModeChange(bridge, mode) {
    const listeners = storageModeListenerRegistry.get(bridge);
    if (!listeners) {
        return;
    }
    listeners.forEach((callback) => {
        try {
            callback(mode);
        } catch (error) {
            console.error('[StorageBridge] Mode listener failed', error);
        }
    });
}

function notifyChange(bridge, payload) {
    if (!payload) {
        return;
    }
    const listeners = storageChangeListenerRegistry.get(bridge);
    if (!listeners || !listeners.size) {
        return;
    }
    listeners.forEach((callback) => {
        try {
            callback(payload);
        } catch (error) {
            console.error('[StorageBridge] Change listener failed', error);
        }
    });
}

function copyAdapterEntries(source, target) {
    if (!source || !target || source === target) {
        return;
    }

    if (typeof source.getPrefixedEntries !== 'function' || typeof target.importEntries !== 'function') {
        return;
    }

    const entries = source.getPrefixedEntries();
    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    target.importEntries(entries);
}

export function createStorageBridge(namespace = '') {
    const prefix = namespace ? `${namespace}::` : '';
    const memoryAdapter = createMemoryAdapter(prefix);
    let activeAdapter = createLocalStorageAdapter(prefix) || memoryAdapter;
    let mode = activeAdapter.mode;
    const modeListeners = new Set();
    const changeListeners = new Set();
    let detachStorageListener = null;

    const bridge = {
        getMode() {
            return mode;
        },
        isPersistent() {
            return mode === 'localStorage';
        },
        isEphemeral() {
            return mode !== 'localStorage';
        },
        isAvailable() {
            return Boolean(activeAdapter);
        },
        get(key) {
            if (!activeAdapter) {
                return null;
            }
            try {
                const value = activeAdapter.getItem(key);
                return value === undefined ? null : value;
            } catch (error) {
                console.warn('[StorageBridge] Read failed, switching to in-memory storage.', error);
                downgradeToMemory('read');
                return activeAdapter.getItem(key);
            }
        },
        getItem(key) {
            return this.get(key);
        },
        set(key, value) {
            if (!activeAdapter) {
                return;
            }
            try {
                activeAdapter.setItem(key, value);
                notifyChange(bridge, {
                    type: 'set',
                    key,
                    value,
                    origin: 'local',
                    mode
                });
            } catch (error) {
                console.warn('[StorageBridge] Write failed, switching to in-memory storage.', error);
                downgradeToMemory('write');
                activeAdapter.setItem(key, value);
                notifyChange(bridge, {
                    type: 'set',
                    key,
                    value,
                    origin: 'local',
                    mode
                });
            }
        },
        setItem(key, value) {
            this.set(key, value);
        },
        remove(key) {
            if (!activeAdapter) {
                return;
            }
            try {
                activeAdapter.removeItem(key);
                notifyChange(bridge, {
                    type: 'remove',
                    key,
                    value: null,
                    origin: 'local',
                    mode
                });
            } catch (error) {
                console.warn('[StorageBridge] Remove failed, switching to in-memory storage.', error);
                downgradeToMemory('remove');
                activeAdapter.removeItem(key);
                notifyChange(bridge, {
                    type: 'remove',
                    key,
                    value: null,
                    origin: 'local',
                    mode
                });
            }
        },
        removeItem(key) {
            this.remove(key);
        },
        clearAll() {
            if (!activeAdapter) {
                return;
            }
            try {
                activeAdapter.clearPrefixed();
                notifyChange(bridge, {
                    type: 'clear',
                    key: null,
                    value: null,
                    origin: 'local',
                    mode
                });
            } catch (error) {
                console.warn('[StorageBridge] Clear failed, switching to in-memory storage.', error);
                downgradeToMemory('clear');
                activeAdapter.clearPrefixed();
                notifyChange(bridge, {
                    type: 'clear',
                    key: null,
                    value: null,
                    origin: 'local',
                    mode
                });
            }
        },
        clear() {
            this.clearAll();
        },
        subscribe(callback, options = {}) {
            if (typeof callback !== 'function') {
                return () => {};
            }

            const { fireImmediately = true } = options;
            modeListeners.add(callback);
            if (fireImmediately) {
                try {
                    callback(mode);
                } catch (error) {
                    console.error('[StorageBridge] Mode listener failed', error);
                }
            }
            return () => {
                modeListeners.delete(callback);
            };
        },
        subscribeChanges(callback) {
            if (typeof callback !== 'function') {
                return () => {};
            }

            changeListeners.add(callback);
            return () => {
                changeListeners.delete(callback);
            };
        },
        tryRestorePersistence(options = {}) {
            if (mode === 'localStorage') {
                return true;
            }

            const {
                copyMemory = true,
                onError
            } = options;

            const nextAdapter = createLocalStorageAdapter(prefix);
            if (!nextAdapter) {
                return false;
            }

            try {
                if (copyMemory) {
                    copyAdapterEntries(memoryAdapter, nextAdapter);
                }
                activeAdapter = nextAdapter;
                if (mode !== nextAdapter.mode) {
                    mode = nextAdapter.mode;
                    notifyModeChange(bridge, mode);
                }
                return true;
            } catch (error) {
                console.warn('[StorageBridge] Persistence restore failed, staying in memory.', error);
                if (typeof onError === 'function') {
                    try {
                        onError(error);
                    } catch (listenerError) {
                        console.error('[StorageBridge] Persistence restore error handler failed', listenerError);
                    }
                }
                activeAdapter = memoryAdapter;
                mode = memoryAdapter.mode;
                return false;
            }
        },
        syncFromPersistent() {
            if (mode === 'localStorage') {
                return true;
            }

            const persistentAdapter = createLocalStorageAdapter(prefix);
            if (!persistentAdapter) {
                return false;
            }

            try {
                copyAdapterEntries(persistentAdapter, memoryAdapter);
                return true;
            } catch (error) {
                console.warn('[StorageBridge] Failed to synchronise persistent data to memory.', error);
                return false;
            }
        },
        dispose() {
            if (detachStorageListener) {
                try {
                    detachStorageListener();
                } catch (error) {
                    console.warn('[StorageBridge] Failed to detach storage listener', error);
                }
                detachStorageListener = null;
            }
            modeListeners.clear();
            changeListeners.clear();
            storageModeListenerRegistry.delete(bridge);
            storageChangeListenerRegistry.delete(bridge);
        }
    };
    storageModeListenerRegistry.set(bridge, modeListeners);
    storageChangeListenerRegistry.set(bridge, changeListeners);

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const storageHandler = (event) => {
            if (!event) {
                return;
            }
            if (event.storageArea && event.storageArea !== window.localStorage) {
                return;
            }
            const rawKey = event.key;
            if (rawKey && !rawKey.startsWith(prefix)) {
                return;
            }

            if (!rawKey) {
                try {
                    memoryAdapter.clearPrefixed();
                } catch (error) {
                    console.warn('[StorageBridge] Failed to clear memory adapter after external clear.', error);
                }
                notifyChange(bridge, {
                    type: 'clear',
                    key: null,
                    value: null,
                    origin: 'external',
                    mode
                });
                return;
            }

            const key = rawKey.slice(prefix.length);
            const value = event.newValue;
            if (mode !== 'localStorage' && value !== undefined) {
                try {
                    if (value === null) {
                        memoryAdapter.removeItem(key);
                    } else {
                        memoryAdapter.setItem(key, value);
                    }
                } catch (error) {
                    console.warn('[StorageBridge] Failed to mirror external storage change.', error);
                }
            }
            notifyChange(bridge, {
                type: value === null ? 'remove' : 'set',
                key,
                value,
                origin: 'external',
                mode
            });
        };

        window.addEventListener('storage', storageHandler);
        detachStorageListener = () => {
            window.removeEventListener('storage', storageHandler);
        };
    }

    function downgradeToMemory(reason) {
        if (activeAdapter === memoryAdapter) {
            return;
        }
        console.warn(`[StorageBridge] Downgrading to in-memory storage after ${reason} failure.`);
        try {
            copyAdapterEntries(activeAdapter, memoryAdapter);
        } catch (error) {
            console.warn('[StorageBridge] Failed to synchronise data while downgrading to memory.', error);
        }
        activeAdapter = memoryAdapter;
        if (mode !== 'memory') {
            mode = 'memory';
            notifyModeChange(bridge, mode);
        }
    }

    return bridge;
}
