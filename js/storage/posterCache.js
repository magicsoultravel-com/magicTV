/**
 * PosterCache — persistent mosaic pause posters (16:9 JPEGs).
 *
 * IndexedDB-backed with ONE RECORD PER CHANNEL KEY (`magictv_poster_v2:<key>`).
 * Posters are ~50-120 KB each, so the old single-blob record rewrote the entire
 * library on every capture and blew the storage quota - which then failed
 * silently and made every poster vanish on reload. Per-key records write only
 * the poster that changed.
 *
 * Used so a reload can show the last frame instantly without HLS recapture.
 */

import { IndexedDBStore } from './indexedDbStore.js';

const POSTER_PREFIX = 'magictv_poster_v2:';
const LEGACY_POSTER_CACHE_KEY = 'magictv_poster_cache_v1';
const POSTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    writeChain = next.catch(() => {});
    return next;
}

function isFresh(entry) {
    return !!(entry?.dataUrl && Date.now() - entry.cachedAt <= POSTER_CACHE_TTL);
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
                '[PosterCache] poster write failed - posters will not survive a reload',
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
 * Split the legacy single-blob poster cache into one record per key. Idempotent:
 * the blob is only deleted after the batch committed.
 * @returns {Promise<void>}
 */
async function migrateLegacyBlob() {
    let legacy = null;
    try {
        legacy = await IndexedDBStore.get(LEGACY_POSTER_CACHE_KEY);
    } catch {
        return; // storage unavailable - nothing to migrate yet
    }
    if (legacy == null) return;

    const entries = legacy.entries;
    if (!entries || typeof entries !== 'object') {
        await IndexedDBStore.remove(LEGACY_POSTER_CACHE_KEY).catch(() => {});
        return;
    }

    const pairs = [];
    for (const [key, entry] of Object.entries(entries)) {
        if (!key || !entry?.dataUrl) continue;
        pairs.push([
            POSTER_PREFIX + key,
            { cachedAt: Number(entry.cachedAt) || Date.now(), dataUrl: entry.dataUrl }
        ]);
    }

    if (pairs.length) {
        const ok = await IndexedDBStore.setMany(pairs).catch(() => false);
        if (!ok) {
            reportStorageError(new Error('legacy poster cache migration write failed'));
            return;
        }
    }

    await IndexedDBStore.remove(LEGACY_POSTER_CACHE_KEY).catch(() => {});
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
 * @param {string} channelKey
 * @returns {Promise<string|null>}
 */
async function getPoster(channelKey) {
    if (!channelKey) return null;
    const hits = await getPosters([channelKey]);
    return hits.get(channelKey) || null;
}

/**
 * @param {string[]} channelKeys
 * @returns {Promise<Map<string, string>>}
 */
async function getPosters(channelKeys) {
    const out = new Map();
    const list = normalizeKeys(channelKeys);
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
                misses.map((key) => POSTER_PREFIX + key)
            ).catch(() => new Map());
            for (const key of misses) {
                const record = stored.get(POSTER_PREFIX + key);
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
            removePosters(expired).catch(() => {});
        }
    } catch {
        /* ignore - a miss just triggers a fresh capture */
    }

    return out;
}

/**
 * @param {string} channelKey
 * @param {string} dataUrl
 * @returns {Promise<boolean>} True only if the write is durable (survives reload).
 */
async function setPoster(channelKey, dataUrl) {
    const key = (channelKey || '').trim();
    if (!key || !dataUrl) return false;
    return enqueueWrite(async () => {
        try {
            await ensureReady();
            const cachedAt = Date.now();
            const ok = await IndexedDBStore.setMany([
                [POSTER_PREFIX + key, { cachedAt, dataUrl }]
            ]);
            // Mirror regardless: the session must keep showing what it captured.
            memoryEntries.set(key, { cachedAt, dataUrl });
            if (ok) {
                storageErrorWarned = false;
            } else {
                reportStorageError(new Error('poster cache write failed (quota or aborted transaction)'));
            }
            return ok;
        } catch (err) {
            reportStorageError(err);
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
            await ensureReady();
            for (const key of list) memoryEntries.delete(key);
            await IndexedDBStore.removeMany(list.map((key) => POSTER_PREFIX + key));
        } catch {
            /* ignore - a stale record still expires via the TTL check */
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
            const allKeys = await IndexedDBStore.getAllKeys().catch(() => []);
            const stale = allKeys.filter(
                (key) => typeof key === 'string' && key.startsWith(POSTER_PREFIX)
            );
            if (stale.length) await IndexedDBStore.removeMany(stale);
            await IndexedDBStore.remove(LEGACY_POSTER_CACHE_KEY);
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

export const PosterCache = {
    getPoster,
    getPosters,
    setPoster,
    removePoster,
    removePosters,
    clearPosters,
    onStorageError,
    /** @internal test seam */
    _resetForTests,
    /** @internal test seam */
    _POSTER_PREFIX: POSTER_PREFIX,
    /** @internal test seam */
    _LEGACY_POSTER_CACHE_KEY: LEGACY_POSTER_CACHE_KEY
};
