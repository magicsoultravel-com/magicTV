/**
 * FrameCache - Persistent storage for captured channel thumbnail frames.
 *
 * Uses IndexedDB to store frame data URLs. Keys are stream URLs and/or
 * channel keys (`providerId:channelId`) so favorites/recents skeletons can
 * restore a prior play frame before `url_resolved` hydrates.
 * An in-memory Map mirrors the IDB blob so N tile lookups do not each
 * reload the entire cache entry.
 */

import { IndexedDBStore } from './indexedDbStore.js';

const FRAME_CACHE_KEY = 'matrix_tv_frame_cache_v2';
const FRAME_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Serialize blob read-modify-write so concurrent captures don't clobber each other. */
let writeChain = Promise.resolve();

/** @type {Map<string, { cachedAt: number, dataUrl: string }>|null} */
let memoryEntries = null;

/** Shared hydrate so concurrent first readers do not overwrite each other's Map. */
let hydratePromise = null;

function enqueueWrite(fn) {
    const next = writeChain.then(fn, fn);
    // Keep the chain alive even if a write fails.
    writeChain = next.catch(() => {});
    return next;
}

function isFresh(entry) {
    return !!(entry?.dataUrl && Date.now() - entry.cachedAt <= FRAME_CACHE_TTL);
}

function normalizeKeys(keys) {
    return [...new Set((keys || []).map((k) => (k || '').trim()).filter(Boolean))];
}

async function ensureMemory() {
    if (memoryEntries) return memoryEntries;
    if (!hydratePromise) {
        hydratePromise = (async () => {
            const cache = await IndexedDBStore.get(FRAME_CACHE_KEY);
            const mem = new Map();
            if (cache?.entries) {
                for (const [url, entry] of Object.entries(cache.entries)) {
                    if (entry?.dataUrl) {
                        mem.set(url, {
                            cachedAt: entry.cachedAt,
                            dataUrl: entry.dataUrl
                        });
                    }
                }
            }
            memoryEntries = mem;
            return mem;
        })().catch((err) => {
            hydratePromise = null;
            throw err;
        });
    }
    return hydratePromise;
}

async function persistMemoryToStore() {
    const entries = {};
    for (const [url, entry] of memoryEntries || []) {
        entries[url] = entry;
    }
    await IndexedDBStore.set(FRAME_CACHE_KEY, { entries });
}

/**
 * Get a cached frame data URL.
 * @param {string} key - Stream URL or channel key (`providerId:channelId`).
 * @returns {Promise<string|null>} The cached data URL or null.
 */
async function getFrame(key) {
    if (!key) return null;
    try {
        const mem = await ensureMemory();
        const entry = mem.get(key);
        if (!entry?.dataUrl) return null;
        if (!isFresh(entry)) {
            await removeFrame(key);
            return null;
        }
        return entry.dataUrl;
    } catch {
        return null;
    }
}

/**
 * Batch-lookup cached frames (single IDB hydrate via the memory mirror).
 * @param {string[]} keys — stream URLs and/or channel keys
 * @returns {Promise<Map<string, string>>} key → dataUrl for hits only
 */
async function getFrames(keys) {
    const out = new Map();
    if (!keys?.length) return out;
    try {
        const mem = await ensureMemory();
        const expired = [];
        for (const key of keys) {
            if (!key) continue;
            const entry = mem.get(key);
            if (!entry?.dataUrl) continue;
            if (!isFresh(entry)) {
                expired.push(key);
                continue;
            }
            out.set(key, entry.dataUrl);
        }
        for (const key of expired) {
            await removeFrame(key);
        }
    } catch {
        /* ignore */
    }
    return out;
}

/**
 * Store a captured frame under one or more keys (stream URL and/or channel key).
 * @param {string|string[]} keys
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True if stored successfully.
 */
async function setFrames(keys, dataUrl) {
    const list = normalizeKeys(Array.isArray(keys) ? keys : [keys]);
    if (!list.length || !dataUrl) return false;
    return enqueueWrite(async () => {
        try {
            const mem = await ensureMemory();
            const cachedAt = Date.now();
            for (const key of list) {
                mem.set(key, { cachedAt, dataUrl });
            }
            await persistMemoryToStore();
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * Store a captured frame in the cache.
 * @param {string} key - Stream URL or channel key.
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True if stored successfully.
 */
async function setFrame(key, dataUrl) {
    return setFrames(key, dataUrl);
}

/**
 * Remove a frame from the cache.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function removeFrame(key) {
    if (!key) return;
    return removeFrames([key]);
}

/**
 * Remove many frames in one write (avoids N full IndexedDB persists).
 * @param {string[]} keys
 * @returns {Promise<void>}
 */
async function removeFrames(keys) {
    const list = normalizeKeys(keys);
    if (!list.length) return;
    return enqueueWrite(async () => {
        try {
            const mem = await ensureMemory();
            let changed = false;
            for (const key of list) {
                if (!mem.has(key)) continue;
                mem.delete(key);
                changed = true;
            }
            if (changed) await persistMemoryToStore();
        } catch {
            // Ignore errors
        }
    });
}

/**
 * Clear all cached frames (expires entire cache).
 * @returns {Promise<void>}
 */
async function clearFrames() {
    return enqueueWrite(async () => {
        try {
            memoryEntries = new Map();
            hydratePromise = Promise.resolve(memoryEntries);
            await IndexedDBStore.remove(FRAME_CACHE_KEY);
        } catch {
            // Ignore errors
        }
    });
}

export const FrameCache = {
    getFrame,
    getFrames,
    setFrame,
    setFrames,
    removeFrame,
    removeFrames,
    clearFrames
};
