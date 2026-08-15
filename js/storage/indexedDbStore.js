/**
 * IndexedDBStore - Single-database, single-store async key-value storage.
 *
 * Uses one database (magicnotes_cache_db) with one object store (cache_store).
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
 */

const DB_NAME = 'magicnotes_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'cache_store';

let dbPromise = null;
let memoryFallback = null;

function openDb() {
    if (memoryFallback) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            memoryFallback = new Map();
            dbPromise = null;
            resolve(null);
            return;
        }

        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            memoryFallback = new Map();
            dbPromise = null;
            resolve(null);
        };
    });

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
            if (raw !== null) {
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
    openDb
};
