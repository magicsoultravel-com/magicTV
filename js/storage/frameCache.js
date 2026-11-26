/**
 * FrameCache - Persistent storage for captured channel thumbnail frames.
 *
 * Backed by IndexedDB with ONE RECORD PER KEY (`magictv_frame_v3:<key>`), so a
 * capture writes only that tile's frame instead of rewriting the whole library,
 * and N tile lookups prime with a single transaction instead of a full hydrate.
 * Keys are stream URLs and/or channel keys (`providerId:channelId`) so
 * favorites/recents skeletons can restore a prior play frame before
 * `url_resolved` hydrates.
 *
 * The in-memory Map is a read-through mirror for the hot path — it is NOT the
 * source of truth. A failed IndexedDB write returns `false` (and reports once),
 * because a session-only cache looks healthy until the next reload, when every
 * preview is captured from the network again.
 *
 * Migration: the pre-v3 single-blob record (`magictv_frame_cache_v2`) is split
 * into per-key records once, then deleted. Safe to interrupt — the blob is only
 * removed after every record was written.
 */

import { IndexedDBStore } from './indexedDbStore.js';

const FRAME_PREFIX = 'magictv_frame_v3:';
const LEGACY_FRAME_CACHE_KEY = 'magictv_frame_cache_v2';
const FRAME_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Serialize writes so concurrent captures don't interleave transactions. */
let writeChain = Promise.resolve();

/** @type {Map<string, { cachedAt: number, dataUrl: string }>} */
let memoryEntries = new Map();

/** Shared one-time guard: legacy split finished (or failed) before first use. */
let readyPromise = null;

/** @type {((err: unknown) => void)|null} */
let storageErrorHandler = null;
let storageErrorWarned = false;

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

/**
 * Report a persistence problem instead of silently degrading to a session-only
 * cache. Warns once per session, then forwards to an optional subscriber.
 * @param {unknown} err
 */
function reportStorageError(err) {
    if (!storageErrorWarned) {
        storageErrorWarned = true;
        try {
            console.warn(
                '[FrameCache] preview cache write failed - previews will not survive a reload',
                err
            );
        } catch {
            /* ignore */
        }
    }
    if (typeof storageErrorHandler === 'function') {
        try {
            storageErrorHandler(err);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Split the legacy single-blob cache into one record per key. Idempotent: the
 * blob is only deleted after the batch committed, so a failed run retries on
 * the next boot with no data loss.
 * @returns {Promise<void>}
 */
async function migrateLegacyBlob() {
    let legacy = null;
    try {
        legacy = await IndexedDBStore.get(LEGACY_FRAME_CACHE_KEY);
    } catch {
        return; // storage unavailable - nothing to migrate yet
    }
    if (legacy == null) return;

    const entries = legacy.entries;
    if (!entries || typeof entries !== 'object') {
        await IndexedDBStore.remove(LEGACY_FRAME_CACHE_KEY).catch(() => {});
        return;
    }

    const pairs = [];
    for (const [key, entry] of Object.entries(entries)) {
        if (!key || !entry?.dataUrl) continue;
        pairs.push([
            FRAME_PREFIX + key,
            { cachedAt: Number(entry.cachedAt) || Date.now(), dataUrl: entry.dataUrl }
        ]);
    }

    if (pairs.length) {
        const ok = await IndexedDBStore.setMany(pairs).catch(() => false);
        if (!ok) {
            // Keep the blob and try again next boot; the mirror still serves
            // whatever the app captures this session.
            reportStorageError(new Error('legacy frame cache migration write failed'));
            return;
        }
    }

    await IndexedDBStore.remove(LEGACY_FRAME_CACHE_KEY).catch(() => {});
}

/**
 * Resolve once per session, guaranteeing the legacy split ran before first use.
 * @returns {Promise<void>}
 */
function ensureReady() {
    if (!readyPromise) {
        readyPromise = migrateLegacyBlob().catch(() => {});
    }
    return readyPromise;
}

/**
 * Get a cached frame data URL.
 * @param {string} key - Stream URL or channel key (`providerId:channelId`).
 * @returns {Promise<string|null>} The cached data URL or null.
 */
async function getFrame(key) {
    if (!key) return null;
    const hits = await getFrames([key]);
    return hits.get(key) || null;
}

/**
 * Batch-lookup cached frames (memory mirror first, then one IDB transaction).
 * @param {string[]} keys - Stream URLs and/or channel keys
 * @returns {Promise<Map<string, string>>} key → dataUrl for hits only
 */
async function getFrames(keys) {
    const out = new Map();
    const list = normalizeKeys(keys);
    if (!list.length) return out;

    try {
        await ensureReady();
        /** @type {string[]} */
        const misses = [];
        /** @type {string[]} */
        const expired = [];

        for (const key of list) {
            const entry = memoryEntries.get(key);
            if (!entry?.dataUrl) {
                misses.push(key);
                continue;
            }
            if (!isFresh(entry)) {
                expired.push(key);
                continue;
            }
            out.set(key, entry.dataUrl);
        }

        if (misses.length) {
            const stored = await IndexedDBStore.getMany(
                misses.map((key) => FRAME_PREFIX + key)
            ).catch(() => new Map());
            for (const key of misses) {
                const record = stored.get(FRAME_PREFIX + key);
                if (!record?.dataUrl) continue;
                const entry = {
                    cachedAt: Number(record.cachedAt) || 0,
                    dataUrl: record.dataUrl
                };
                if (!isFresh(entry)) {
                    expired.push(key);
                    continue;
                }
                memoryEntries.set(key, entry);
                out.set(key, entry.dataUrl);
            }
        }

        if (expired.length) {
            // Fire-and-forget: an expired entry must never delay the caller.
            removeFrames(expired).catch(() => {});
        }
    } catch {
        /* ignore - a miss just triggers a fresh capture */
    }

    return out;
}

/**
 * Store a captured frame under one or more keys (stream URL and/or channel key).
 * @param {string|string[]} keys
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True only if the write is durable (survives reload).
 */
async function setFrames(keys, dataUrl) {
    const list = normalizeKeys(Array.isArray(keys) ? keys : [keys]);
    if (!list.length || !dataUrl) return false;
    return enqueueWrite(async () => {
        try {
            await ensureReady();
            const cachedAt = Date.now();
            const pairs = list.map((key) => [FRAME_PREFIX + key, { cachedAt, dataUrl }]);
            const ok = await IndexedDBStore.setMany(pairs);
            // Mirror regardless: the session must keep showing what it captured.
            for (const key of list) {
                memoryEntries.set(key, { cachedAt, dataUrl });
            }
            if (ok) {
                storageErrorWarned = false;
            } else {
                reportStorageError(new Error('frame cache write failed (quota or aborted transaction)'));
            }
            return ok;
        } catch (err) {
            reportStorageError(err);
            return false;
        }
    });
}

/**
 * Store a captured frame in the cache.
 * @param {string} key - Stream URL or channel key.
 * @param {string} dataUrl - The data URL (base64 image).
 * @returns {Promise<boolean>} True only if the write is durable (survives reload).
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
 * Remove many frames in one transaction (one delete per key, no rewrite).
 * @param {string[]} keys
 * @returns {Promise<void>}
 */
async function removeFrames(keys) {
    const list = normalizeKeys(keys);
    if (!list.length) return;
    return enqueueWrite(async () => {
        try {
            await ensureReady();
            for (const key of list) memoryEntries.delete(key);
            await IndexedDBStore.removeMany(list.map((key) => FRAME_PREFIX + key));
        } catch {
            /* ignore - a stale record still expires via the TTL check */
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
            const allKeys = await IndexedDBStore.getAllKeys().catch(() => []);
            const stale = allKeys.filter(
                (key) => typeof key === 'string' && key.startsWith(FRAME_PREFIX)
            );
            if (stale.length) await IndexedDBStore.removeMany(stale);
            await IndexedDBStore.remove(LEGACY_FRAME_CACHE_KEY);
            storageErrorWarned = false;
        } catch {
            /* ignore */
        }
    });
}

/**
 * Subscribe to persistence failures (quota exceeded, aborted transaction...).
 * Intended for a single app-level listener that can surface one message.
 * @param {(err: unknown) => void} handler
 * @returns {() => void} unsubscribe
 */
function onStorageError(handler) {
    storageErrorHandler = typeof handler === 'function' ? handler : null;
    return () => {
        if (storageErrorHandler === handler) storageErrorHandler = null;
    };
}

/** @internal test seam — drop all module state so a "restart" can be simulated. */
function _resetForTests() {
    writeChain = Promise.resolve();
    memoryEntries = new Map();
    readyPromise = null;
    storageErrorHandler = null;
    storageErrorWarned = false;
}

export const FrameCache = {
    getFrame,
    getFrames,
    setFrame,
    setFrames,
    removeFrame,
    removeFrames,
    clearFrames,
    onStorageError,
    /** @internal test seam */
    _resetForTests,
    /** @internal test seam */
    _FRAME_PREFIX: FRAME_PREFIX,
    /** @internal test seam */
    _LEGACY_FRAME_CACHE_KEY: LEGACY_FRAME_CACHE_KEY
};
