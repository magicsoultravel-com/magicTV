/**
 * IndexedDBStore - Single-database, single-store async key-value storage.
 *
 * Uses one database (magictv_cache_db) with one object store (cache_store).
 * Each entry is { key: string, value: any }.
 *
 * Falls back to an in-memory Map if IndexedDB is unavailable (private mode,
 * disabled, etc.). Does NOT fall back to localStorage — that would re-introduce
 * the quota problem we're trying to solve.
 *
 * Migration: get(key, legacyKey?) checks if the old localStorage key exists
 * before reading from IndexedDB. If the legacy key is found, its value is
 * migrated to IndexedDB and the localStorage key is removed. This is
 * idempotent — after the first migration the legacy key is gone.
 *
 * Also one-time-copies TV-owned entries from the legacy shared DB
 * (magicnotes_cache_db) into magictv_cache_db under magictv_* key names.
 * Does not delete from the legacy DB (magiclists may still use it).
 */

const DB_NAME = 'magictv_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'cache_store';
const LEGACY_DB_NAME = 'magicnotes_cache_db';
const IDB_NAMESPACE_FLAG = 'magictv_idb_namespace_v1';

/**
 * Exact key renames when copying from the shared magicnotes_cache_db.
 * Prefix remaps are applied separately for dynamic EPG keys.
 */
const LEGACY_KEY_RENAMES = {
    matrix_tv_iptv_cache: 'magictv_iptv_cache',
    matrix_tv_frame_cache_v2: 'magictv_frame_cache_v2',
    matrix_tv_poster_cache_v1: 'magictv_poster_cache_v1',
    matrix_tv_epg_guides: 'magictv_epg_guides',
    matrix_tv_epg_guides_index: 'magictv_epg_guides_index'
};

const LEGACY_PREFIX_RENAMES = [
    ['matrix_tv_epg_feed:', 'magictv_epg_feed:'],
    ['matrix_tv_epg_index:', 'magictv_epg_index:'],
    ['matrix_tv_epg_map:', 'magictv_epg_map:'],
    ['matrix_tv_epg_cors:', 'magictv_epg_cors:'],
    ['matrix_tv_epg_prog:', 'magictv_epg_prog:']
];

/**
 * Legacy localStorage→IndexedDB migration guard. localStorage is capped near
 * 5MB per origin, so anything larger is not a legit legacy catalog — and a
 * monster/corrupt value must never be synchronously parsed on the boot path.
 */
const LEGACY_MIGRATE_MAX_CHARS = 4 * 1024 * 1024;

let dbPromise = null;
let memoryFallback = null;
let legacyDbMigratePromise = null;

function remapLegacyKey(key) {
    if (LEGACY_KEY_RENAMES[key]) return LEGACY_KEY_RENAMES[key];
    for (const [from, to] of LEGACY_PREFIX_RENAMES) {
        if (key.startsWith(from)) return to + key.slice(from.length);
    }
    return null;
}

function openNamedDb(name, version) {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    });
}

function readAllFromDb(db) {
    return new Promise((resolve) => {
        if (!db || !db.objectStoreNames.contains(STORE_NAME)) {
            resolve([]);
            return;
        }
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

function namespaceAlreadyMigrated() {
    try {
        return localStorage.getItem(IDB_NAMESPACE_FLAG) === '1';
    } catch {
        return false;
    }
}

function markNamespaceMigrated() {
    try {
        localStorage.setItem(IDB_NAMESPACE_FLAG, '1');
    } catch {
        /* ignore */
    }
}

/**
 * Copy TV-owned entries from magicnotes_cache_db into magictv_cache_db once.
 * Leaves the legacy DB intact for magiclists.
 */
async function migrateLegacyDbOnce(targetDb) {
    if (namespaceAlreadyMigrated()) return;
    if (legacyDbMigratePromise) return legacyDbMigratePromise;

    legacyDbMigratePromise = (async () => {
        let legacyDb = null;
        try {
            legacyDb = await openNamedDb(LEGACY_DB_NAME, 1);
            // magiclists may have opened at v2 — try without forcing version if v1 failed
            if (!legacyDb) {
                legacyDb = await new Promise((resolve) => {
                    if (typeof indexedDB === 'undefined') {
                        resolve(null);
                        return;
                    }
                    const req = indexedDB.open(LEGACY_DB_NAME);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                    req.onblocked = () => resolve(null);
                });
            }
            if (!legacyDb) {
                markNamespaceMigrated();
                return;
            }
            const entries = await readAllFromDb(legacyDb);
            for (const entry of entries) {
                const key = entry?.key;
                if (!key) continue;
                const newKey = remapLegacyKey(key);
                if (!newKey) continue;
                try {
                    const tx = targetDb.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put({ key: newKey, value: entry.value });
                    await new Promise((resolve) => {
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => resolve();
                    });
                } catch {
                    /* skip individual entry */
                }
            }
            markNamespaceMigrated();
        } catch {
            markNamespaceMigrated();
        } finally {
            try {
                legacyDb?.close?.();
            } catch {
                /* ignore */
            }
        }
    })();

    return legacyDbMigratePromise;
}

function openDb() {
    if (memoryFallback) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        if (typeof indexedDB === 'undefined') {
            memoryFallback = new Map();
            dbPromise = null;
            return null;
        }

        const db = await new Promise((resolve) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const result = req.result;
                if (!result.objectStoreNames.contains(STORE_NAME)) {
                    result.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => {
                memoryFallback = new Map();
                dbPromise = null;
                resolve(null);
            };
            req.onblocked = () => {
                // A pending version change on another connection (e.g. a stale tab
                // holding an old DB version) can block this open forever. Treat it
                // like a failure and fall back to in-memory so boot/cache reads
                // never hang on an IndexedDB open that will never resolve.
                memoryFallback = new Map();
                dbPromise = null;
                resolve(null);
            };
        });

        if (db) {
            await migrateLegacyDbOnce(db);
        }
        return db;
    })();

    return dbPromise;
}

function getFromMemory(key) {
    if (!memoryFallback) return undefined;
    return memoryFallback.has(key) ? memoryFallback.get(key) : undefined;
}

function setInMemory(key, value) {
    if (!memoryFallback) memoryFallback = new Map();
    memoryFallback.set(key, value);
}

function removeFromMemory(key) {
    if (memoryFallback) memoryFallback.delete(key);
}

function clearMemory() {
    if (memoryFallback) memoryFallback.clear();
}

function getAllFromMemory() {
    if (!memoryFallback) return [];
    return Array.from(memoryFallback, ([key, value]) => ({ key, value }));
}

/**
 * Get a value from IndexedDB (or in-memory fallback).
 *
 * @param {string} key - The cache key to read.
 * @param {string} [legacyKey] - Optional old localStorage key to migrate from.
 *   If provided and the localStorage key exists, its value is read, written
 *   to IndexedDB, and the localStorage key is removed. Idempotent.
 * @returns {Promise<any|null>} The stored value, or null if not found.
 */
async function get(key, legacyKey) {
    // Migration: check localStorage first if a legacy key is provided
    if (legacyKey && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(legacyKey);
            // Skip absurdly large values entirely — a >4MB localStorage entry is
            // not a legit legacy cache (quota is ~5MB/origin), and JSON-parsing /
            // writing it synchronously on every boot would stall the boot path.
            if (raw !== null && raw.length <= LEGACY_MIGRATE_MAX_CHARS) {
                let value;
                try {
                    value = JSON.parse(raw);
                } catch {
                    value = raw;
                }
                // Write to IndexedDB (or memory fallback)
                await set(key, value);
                // Remove the old localStorage key
                try {
                    localStorage.removeItem(legacyKey);
                } catch {
                    /* ignore — migration already happened in IndexedDB */
                }
                return value;
            }
        } catch {
            /* localStorage access failed — proceed to IndexedDB */
        }
    }

    const db = await openDb();
    if (!db) {
        return getFromMemory(key) ?? null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(getFromMemory(key) ?? null);
    });
}

/**
 * Set a value in IndexedDB (or in-memory fallback).
 *
 * @param {string} key - The cache key to write.
 * @param {any} value - The value to store (will be JSON-serialized by IndexedDB).
 * @returns {Promise<boolean>} True if written successfully, false if quota/storage error.
 */
async function set(key, value) {
    const db = await openDb();
    if (!db) {
        setInMemory(key, value);
        return true;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key, value });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
            // If IndexedDB fails, fall back to in-memory for this session
            setInMemory(key, value);
            resolve(false);
        };
    });
}

/**
 * Remove a value from IndexedDB (or in-memory fallback).
 *
 * @param {string} key - The cache key to remove.
 * @returns {Promise<void>}
 */
async function remove(key) {
    const db = await openDb();
    if (!db) {
        removeFromMemory(key);
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            removeFromMemory(key);
            resolve();
        };
    });
}

/**
 * Get all entries from IndexedDB (or in-memory fallback).
 *
 * @returns {Promise<Array<{key: string, value: any}>>} All stored records,
 *   or an empty array if no fallback is available.
 */
async function getAll() {
    const db = await openDb();
    if (!db) {
        return getAllFromMemory();
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(getAllFromMemory());
    });
}

/**
 * Clear all entries from IndexedDB (or in-memory fallback).
 * Only clears magictv_cache_db — never touches magicnotes_cache_db.
 *
 * @returns {Promise<void>}
 */
async function clear() {
    const db = await openDb();
    if (!db) {
        clearMemory();
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            clearMemory();
            resolve();
        };
    });
}

export const IndexedDBStore = {
    get,
    set,
    remove,
    clear,
    getAll,
    openDb,
    /** @internal test seam */
    _DB_NAME: DB_NAME,
    _LEGACY_DB_NAME: LEGACY_DB_NAME,
    _IDB_NAMESPACE_FLAG: IDB_NAMESPACE_FLAG,
    _remapLegacyKey: remapLegacyKey
};
