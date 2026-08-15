/**
 * FrameCache - Persistent storage for captured channel thumbnail frames.
 * 
 * Uses IndexedDB to store frame data URLs, keyed by channel URL.
 * Frames persist until user reloads the site (or IndexedDB is cleared).
 */

import { IndexedDBStore } from './indexedDbStore.js';

const FRAME_CACHE_KEY = 'matrix_tv_frame_cache';
const FRAME_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get a cached frame data URL.
 * @param {string} url - The channel/stream URL to look up.
 * @returns {Promise<string|null>} The cached data URL or null.
 */
async function getFrame(url) {
    if (!url) return null;
    try {
        const cache = await IndexedDBStore.get(FRAME_CACHE_KEY);
        if (!cache?.entries) return null;
        
        const entry = cache.entries[url];
        if (!entry || !entry.dataUrl) return null;
        
        // Check TTL
        if (Date.now() - entry.cachedAt > FRAME_CACHE_TTL) {
            await removeFrame(url); // Expire old entry
            return null;
        }
        return entry.dataUrl;
    } catch {
        return null;
    }
}

/**
 * Store a captured frame in the cache.
 * @param {string} url - The channel/stream URL.
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True if stored successfully.
 */
async function setFrame(url, dataUrl) {
    if (!url || !dataUrl) return false;
    try {
        let cache = await IndexedDBStore.get(FRAME_CACHE_KEY);
        if (!cache || !cache.entries) {
            cache = { entries: {} };
        }
        cache.entries[url] = {
            cachedAt: Date.now(),
            dataUrl
        };
        await IndexedDBStore.set(FRAME_CACHE_KEY, cache);
        return true;
    } catch {
        return false;
    }
}

/**
 * Remove a frame from the cache.
 * @param {string} url - The channel/stream URL.
 * @returns {Promise<void>}
 */
async function removeFrame(url) {
    if (!url) return;
    try {
        const cache = await IndexedDBStore.get(FRAME_CACHE_KEY);
        if (cache?.entries && cache.entries[url]) {
            delete cache.entries[url];
            await IndexedDBStore.set(FRAME_CACHE_KEY, cache);
        }
    } catch {
        // Ignore errors
    }
}

/**
 * Clear all cached frames (expires entire cache).
 * @returns {Promise<void>}
 */
async function clearFrames() {
    try {
        await IndexedDBStore.remove(FRAME_CACHE_KEY);
    } catch {
        // Ignore errors
    }
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
    setFrame,
    removeFrame,
    clearFrames,
    preloadFrames
};