/**
 * PosterCache — persistent mosaic pause posters (16:9 JPEGs).
 *
 * IndexedDB-backed, keyed by channel key (`providerId:channelId`).
 * Used so reload can show the last frame instantly without HLS recapture.
 */

import { IndexedDBStore } from './indexedDbStore.js';

const POSTER_CACHE_KEY = 'matrix_tv_poster_cache_v1';
const POSTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

let writeChain = Promise.resolve();

/** @type {Map<string, { cachedAt: number, dataUrl: string }>|null} */
let memoryEntries = null;

/** Shared hydrate so concurrent first readers do not overwrite each other's Map. */
let hydratePromise = null;

function enqueueWrite(fn) {
    const next = writeChain.then(fn, fn);
    writeChain = next.catch(() => {});
    return next;
}

function isFresh(entry) {
    return !!(entry?.dataUrl && Date.now() - entry.cachedAt <= POSTER_CACHE_TTL);
}

function normalizeKeys(keys) {
    return [...new Set((keys || []).map((k) => (k || '').trim()).filter(Boolean))];
}

async function ensureMemory() {
    if (memoryEntries) return memoryEntries;
    if (!hydratePromise) {
        hydratePromise = (async () => {
            const cache = await IndexedDBStore.get(POSTER_CACHE_KEY);
            const mem = new Map();
            if (cache?.entries) {
                for (const [key, entry] of Object.entries(cache.entries)) {
                    if (entry?.dataUrl) {
                        mem.set(key, {
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
    for (const [key, entry] of memoryEntries || []) {
        entries[key] = entry;
    }
    await IndexedDBStore.set(POSTER_CACHE_KEY, { entries });
}

/**
 * @param {string} channelKey
 * @returns {Promise<string|null>}
 */
async function getPoster(channelKey) {
    if (!channelKey) return null;
    try {
        const mem = await ensureMemory();
        const entry = mem.get(channelKey);
        if (!entry?.dataUrl) return null;
        if (!isFresh(entry)) {
            await removePoster(channelKey);
            return null;
        }
        return entry.dataUrl;
    } catch {
        return null;
    }
}

/**
 * @param {string[]} channelKeys
 * @returns {Promise<Map<string, string>>}
 */
async function getPosters(channelKeys) {
    const out = new Map();
    if (!channelKeys?.length) return out;
    try {
        const mem = await ensureMemory();
        const expired = [];
        for (const key of channelKeys) {
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
            await removePoster(key);
        }
    } catch {
        /* ignore */
    }
    return out;
}

/**
 * @param {string} channelKey
 * @param {string} dataUrl
 * @returns {Promise<boolean>}
 */
async function setPoster(channelKey, dataUrl) {
    const key = (channelKey || '').trim();
    if (!key || !dataUrl) return false;
    return enqueueWrite(async () => {
        try {
            const mem = await ensureMemory();
            mem.set(key, { cachedAt: Date.now(), dataUrl });
            await persistMemoryToStore();
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * @param {string} channelKey
 * @returns {Promise<void>}
 */
async function removePoster(channelKey) {
    const key = (channelKey || '').trim();
    if (!key) return;
    return removePosters([key]);
}

/**
 * @param {string[]} channelKeys
 * @returns {Promise<void>}
 */
async function removePosters(channelKeys) {
    const list = normalizeKeys(channelKeys);
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
            /* ignore */
        }
    });
}

/**
 * @returns {Promise<void>}
 */
async function clearPosters() {
    return enqueueWrite(async () => {
        try {
            memoryEntries = new Map();
            hydratePromise = Promise.resolve(memoryEntries);
            await IndexedDBStore.remove(POSTER_CACHE_KEY);
        } catch {
            /* ignore */
        }
    });
}

export const PosterCache = {
    getPoster,
    getPosters,
    setPoster,
    removePoster,
    removePosters,
    clearPosters
};
