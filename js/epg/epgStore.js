/**
 * IndexedDB persistence for EPG caches.
 */
import { IndexedDBStore } from '../storage/indexedDbStore.js';

const FEED_PREFIX = 'matrix_tv_epg_feed:';
const INDEX_PREFIX = 'matrix_tv_epg_index:';
const MAP_PREFIX = 'matrix_tv_epg_map:';
const CORS_PREFIX = 'matrix_tv_epg_cors:';
const PROG_PREFIX = 'matrix_tv_epg_prog:';

const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROG_TTL_MS = 6 * 60 * 60 * 1000;
/** Negative CORS results expire — one transient failure must not block a feed forever. */
const CORS_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

function safeKey(s) {
    return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export async function getFeedCache(url) {
    return IndexedDBStore.get(`${FEED_PREFIX}${safeKey(url)}`);
}

export async function setFeedCache(url, payload) {
    await IndexedDBStore.set(`${FEED_PREFIX}${safeKey(url)}`, payload);
}

export async function getChannelIndexCache(key) {
    const hit = await IndexedDBStore.get(`${INDEX_PREFIX}${safeKey(key)}`);
    if (!hit?.cachedAt || Date.now() - hit.cachedAt > INDEX_TTL_MS) return null;
    return hit.data || null;
}

export async function setChannelIndexCache(key, data) {
    await IndexedDBStore.set(`${INDEX_PREFIX}${safeKey(key)}`, { cachedAt: Date.now(), data });
}

export async function getMappingCache(channelKey) {
    return IndexedDBStore.get(`${MAP_PREFIX}${safeKey(channelKey)}`);
}

export async function setMappingCache(channelKey, mapping) {
    await IndexedDBStore.set(`${MAP_PREFIX}${safeKey(channelKey)}`, { ...mapping, cachedAt: Date.now() });
}

export async function getCorsCache(url) {
    const hit = await IndexedDBStore.get(`${CORS_PREFIX}${safeKey(url)}`);
    if (!hit) return null;
    if (hit.corsOk === false && hit.cachedAt && Date.now() - hit.cachedAt > CORS_NEGATIVE_TTL_MS) {
        return null;
    }
    return hit;
}

export async function setCorsCache(url, corsOk) {
    await IndexedDBStore.set(`${CORS_PREFIX}${safeKey(url)}`, { corsOk, cachedAt: Date.now() });
}

export async function getProgrammesCache(cacheKey) {
    const hit = await IndexedDBStore.get(`${PROG_PREFIX}${safeKey(cacheKey)}`);
    if (!hit?.cachedAt || Date.now() - hit.cachedAt > PROG_TTL_MS) return null;
    return hit.programmes || null;
}

export async function setProgrammesCache(cacheKey, programmes) {
    await IndexedDBStore.set(`${PROG_PREFIX}${safeKey(cacheKey)}`, {
        cachedAt: Date.now(),
        programmes
    });
}
