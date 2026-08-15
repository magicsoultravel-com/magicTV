/**
 * FrameCache - Persistent storage for captured channel thumbnail frames.
 *
 * Uses IndexedDB to store frame data URLs, keyed by channel URL.
 * An in-memory Map mirrors the IDB blob so N tile lookups do not each
 * reload the entire cache entry.
 */

import { IndexedDBStore } from './indexedDbStore.js';

const FRAME_CACHE_KEY = 'matrix_tv_frame_cache';
const FRAME_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Serialize blob read-modify-write so concurrent captures don't clobber each other. */
let writeChain = Promise.resolve();

/** @type {Map<string, { cachedAt: number, dataUrl: string }>|null} */
let memoryEntries = null;

function enqueueWrite(fn) {
    const next = writeChain.then(fn, fn);
    // Keep the chain alive even if a write fails.
    writeChain = next.catch(() => {});
    return next;
}

function isFresh(entry) {
    return !!(entry?.dataUrl && Date.now() - entry.cachedAt <= FRAME_CACHE_TTL);
}

async function ensureMemory() {
    if (memoryEntries) return memoryEntries;
    const cache = await IndexedDBStore.get(FRAME_CACHE_KEY);
    memoryEntries = new Map();
    if (cache?.entries) {
        for (const [url, entry] of Object.entries(cache.entries)) {
            if (entry?.dataUrl) memoryEntries.set(url, entry);
        }
    }
    return memoryEntries;
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
 * @param {string} url - The channel/stream URL to look up.
 * @returns {Promise<string|null>} The cached data URL or null.
 */
async function getFrame(url) {
    if (!url) return null;
    try {
        const mem = await ensureMemory();
        const entry = mem.get(url);
        if (!entry?.dataUrl) return null;
        if (!isFresh(entry)) {
            await removeFrame(url);
            return null;
        }
        return entry.dataUrl;
    } catch {
        return null;
    }
}

/**
 * Batch-lookup cached frames (single IDB hydrate via the memory mirror).
 * @param {string[]} urls
 * @returns {Promise<Map<string, string>>} url → dataUrl for hits only
 */
async function getFrames(urls) {
    const out = new Map();
    if (!urls?.length) return out;
    try {
        const mem = await ensureMemory();
        const expired = [];
        for (const url of urls) {
            if (!url) continue;
            const entry = mem.get(url);
            if (!entry?.dataUrl) continue;
            if (!isFresh(entry)) {
                expired.push(url);
                continue;
            }
            out.set(url, entry.dataUrl);
        }
        for (const url of expired) {
            await removeFrame(url);
        }
    } catch {
        /* ignore */
    }
    return out;
}

/**
 * Store a captured frame in the cache.
 * @param {string} url - The channel/stream URL.
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True if stored successfully.
 */
async function setFrame(url, dataUrl) {
    if (!url || !dataUrl) return false;
    return enqueueWrite(async () => {
        try {
            const mem = await ensureMemory();
            mem.set(url, { cachedAt: Date.now(), dataUrl });
            await persistMemoryToStore();
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * Remove a frame from the cache.
 * @param {string} url - The channel/stream URL.
 * @returns {Promise<void>}
 */
async function removeFrame(url) {
    if (!url) return;
    return removeFrames([url]);
}

/**
 * Remove many frames in one write (avoids N full IndexedDB persists).
 * @param {string[]} urls
 * @returns {Promise<void>}
 */
async function removeFrames(urls) {
    const list = [...new Set((urls || []).filter(Boolean))];
    if (!list.length) return;
    return enqueueWrite(async () => {
        try {
            const mem = await ensureMemory();
            let changed = false;
            for (const url of list) {
                if (!mem.has(url)) continue;
                mem.delete(url);
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
            await IndexedDBStore.remove(FRAME_CACHE_KEY);
        } catch {
            // Ignore errors
        }
    });
}

/**
 * Preload frames for a list of URLs in parallel (up to limit).
 * Useful for prefetching channels in current view.
 * @param {string[]} urls - Array of channel URLs to preload.
 * @param {number} limit - Maximum concurrent fetches.
 * @returns {Promise<void>}
 */
async function preloadFrames(urls, limit = 3) {
    if (!urls || !urls.length) return;
    // Guard for non-browser environments (like Node.js tests)
    if (typeof document === 'undefined') return;

    // Filter out URLs we already have cached
    const toFetch = [];
    for (const url of urls) {
        const cached = await getFrame(url);
        if (!cached) {
            toFetch.push(url);
        }
    }

    if (toFetch.length === 0) return;

    // Fetch in batches
    let index = 0;
    while (index < toFetch.length) {
        const batch = toFetch.slice(index, index + limit);
        index += limit;

        await Promise.allSettled(
            batch.map(async (url) => {
                try {
                    // Create an offscreen image to load and convert to dataURL
                    const img = new Image();
                    img.crossOrigin = 'anonymous';

                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = url;
                    });

                    // Convert to data URL
                    const canvas = document.createElement('canvas');
                    canvas.width = 56;
                    canvas.height = 56;
                    canvas.getContext('2d').drawImage(img, 0, 0, 56, 56);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

                    await setFrame(url, dataUrl);
                } catch {
                    // Individual fetch failures are OK - skip this frame
                }
            })
        );
    }
}

export const FrameCache = {
    getFrame,
    getFrames,
    setFrame,
    removeFrame,
    removeFrames,
    clearFrames,
    preloadFrames
};
