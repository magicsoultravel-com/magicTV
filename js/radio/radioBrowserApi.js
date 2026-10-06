import { IndexedDBStore } from '../storage/indexedDbStore.js';

const CACHE_KEY = 'magictv_radio_cache';
const API_BASE_SESSION_KEY = 'magictv_radio_api_base';
const USER_AGENT = 'magictv/1.0';

/** Per-mirror fetch timeout (ms). */
const FETCH_TIMEOUT_MS = 4000;
/** Cap sequential mirror failover attempts. */
const MAX_MIRROR_ATTEMPTS = 3;

const TTL = {
    countries: 7 * 24 * 60 * 60 * 1000,
    tags: 24 * 60 * 60 * 1000,
    queries: 24 * 60 * 60 * 1000,
    stations: 24 * 60 * 60 * 1000,
    apiBase: 24 * 60 * 60 * 1000
};

const QUERY_CACHE_MAX = 20;

const SERVER_DISCOVERY_URL = 'http://all.api.radio-browser.info/json/servers';
const FALLBACK_SERVERS = [
    'de1.api.radio-browser.info',
    'de2.api.radio-browser.info',
    'nl1.api.radio-browser.info',
    'at1.api.radio-browser.info'
];

async function loadCache() {
    try {
        const cached = await IndexedDBStore.get(CACHE_KEY, CACHE_KEY);
        return cached || {};
    } catch {
        return {};
    }
}

async function saveCache(cache) {
    try {
        await IndexedDBStore.set(CACHE_KEY, cache);
    } catch {
        /* quota or storage error — cache is non-critical, in-memory fallback handles it */
    }
}

function isFresh(entry, ttl) {
    return entry && Number.isFinite(entry.cachedAt) && (Date.now() - entry.cachedAt) < ttl;
}

function hashQuery(params) {
    return JSON.stringify({
        name: params.name || '',
        countrycode: params.countrycode || '',
        tag: params.tag || '',
        hideOffline: params.hideOffline !== false,
        offset: params.offset || 0,
        order: params.order || 'clickcount',
        reverse: params.reverse !== false
    });
}

function trimQueryCache(queries) {
    const keys = Object.keys(queries || {});
    if (keys.length <= QUERY_CACHE_MAX) return queries;
    const sorted = keys.sort((a, b) => (queries[b].cachedAt || 0) - (queries[a].cachedAt || 0));
    const next = {};
    sorted.slice(0, QUERY_CACHE_MAX).forEach((key) => {
        next[key] = queries[key];
    });
    return next;
}

async function discoverServers() {
    try {
        const res = await fetch(SERVER_DISCOVERY_URL, {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (!res.ok) throw new Error('Failed to discover radio API servers');
        const servers = await res.json();
        const names = (Array.isArray(servers) ? servers : [])
            .map((s) => s.name)
            .filter(Boolean);
        if (names.length) return names;
    } catch {
        // mixed content or offline — use known HTTPS mirrors
    }
    return [...FALLBACK_SERVERS];
}

async function resolveApiBase(force = false) {
    const cache = await loadCache();
    if (!force && isFresh(cache.apiBase, TTL.apiBase) && cache.apiBase?.data) {
        sessionStorage.setItem(API_BASE_SESSION_KEY, cache.apiBase.data);
        return cache.apiBase.data;
    }

    const sessionBase = sessionStorage.getItem(API_BASE_SESSION_KEY);
    if (!force && sessionBase) return sessionBase;

    const servers = await discoverServers();
    const shuffled = [...servers].sort(() => Math.random() - 0.5);
    const base = `https://${shuffled[0]}/json`;

    cache.apiBase = { cachedAt: Date.now(), data: base };
    await saveCache(cache);
    sessionStorage.setItem(API_BASE_SESSION_KEY, base);
    return base;
}

/**
 * Merge an optional external AbortSignal with a per-attempt timeout.
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
function attemptSignal(external, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onExternalAbort = () => ctrl.abort();
    if (external) {
        if (external.aborted) ctrl.abort();
        else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    return {
        signal: ctrl.signal,
        cleanup() {
            clearTimeout(timer);
            external?.removeEventListener?.('abort', onExternalAbort);
        }
    };
}

async function apiFetch(path, { method = 'GET', signal, body } = {}) {
    if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
    }

    let lastError = null;
    const bases = [];

    try {
        bases.push(await resolveApiBase(false));
    } catch (e) {
        lastError = e;
    }

    // Failover only — never rediscover/enumerate every mirror on each request.
    for (const name of FALLBACK_SERVERS) {
        bases.push(`https://${name}/json`);
    }

    const uniqueBases = [...new Set(bases)].slice(0, MAX_MIRROR_ATTEMPTS);
    if (!uniqueBases.length) throw lastError || new Error('No radio API base available');

    for (const base of uniqueBases) {
        if (signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        }
        const attempt = attemptSignal(signal, FETCH_TIMEOUT_MS);
        try {
            const headers = { 'User-Agent': USER_AGENT };
            if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
            const res = await fetch(`${base}${path}`, {
                method,
                headers,
                body: body != null ? body : undefined,
                signal: attempt.signal
            });
            if (!res.ok) throw new Error(`Radio API ${res.status}`);
            const data = await res.json();
            if (base !== sessionStorage.getItem(API_BASE_SESSION_KEY)) {
                sessionStorage.setItem(API_BASE_SESSION_KEY, base);
                const cache = await loadCache();
                cache.apiBase = { cachedAt: Date.now(), data: base };
                await saveCache(cache);
            }
            attempt.cleanup();
            return data;
        } catch (e) {
            attempt.cleanup();
            if (e?.name === 'AbortError' && signal?.aborted) throw e;
            lastError = e;
        }
    }

    throw lastError || new Error('Radio API request failed');
}

async function readCachedBucket(bucket, key, ttl) {
    const cache = await loadCache();
    const entry = key ? cache[bucket]?.[key] : cache[bucket];
    if (isFresh(entry, ttl)) return entry.data;
    return null;
}

async function writeCachedBucket(bucket, key, data, ttlBucket) {
    const cache = await loadCache();
    if (key) {
        if (!cache[bucket]) cache[bucket] = {};
        cache[bucket][key] = { cachedAt: Date.now(), data };
    } else {
        cache[bucket] = { cachedAt: Date.now(), data };
    }
    if (bucket === 'queries') {
        cache.queries = trimQueryCache(cache.queries);
    }
    await saveCache(cache);
    return data;
}

let countriesMemory = null;
let countriesMemoryAt = 0;

export const RadioBrowserApi = {
    FETCH_TIMEOUT_MS,
    MAX_MIRROR_ATTEMPTS,

    async getCountries({ refresh = false, signal } = {}) {
        if (!refresh && countriesMemory && isFresh({ cachedAt: countriesMemoryAt }, TTL.countries)) {
            return countriesMemory;
        }
        if (!refresh) {
            const cached = await readCachedBucket('countries', null, TTL.countries);
            if (cached) {
                countriesMemory = cached;
                countriesMemoryAt = Date.now();
                return cached;
            }
        }
        const data = await apiFetch('/countries', { signal });
        const written = await writeCachedBucket('countries', null, data, TTL.countries);
        countriesMemory = written;
        countriesMemoryAt = Date.now();
        return written;
    },

    async getTags({ refresh = false, signal } = {}) {
        if (!refresh) {
            const cached = await readCachedBucket('tags', null, TTL.tags);
            if (cached) return cached;
        }
        const data = await apiFetch('/tags?limit=80&order=stationcount&reverse=true', { signal });
        return writeCachedBucket('tags', null, data, TTL.tags);
    },

    async searchStations({
        name = '',
        countrycode = '',
        tag = '',
        limit = 100,
        offset = 0,
        order = 'clickcount',
        reverse = true,
        refresh = false,
        hideOffline = true,
        signal
    } = {}) {
        const params = { name: name.trim(), countrycode, tag };
        const key = hashQuery({ ...params, hideOffline, offset, order, reverse });

        if (!refresh) {
            const cached = await readCachedBucket('queries', key, TTL.queries);
            if (cached) return cached;
        }

        const qs = new URLSearchParams();
        qs.set('limit', String(limit));
        qs.set('offset', String(offset));
        qs.set('hidebroken', 'true');
        qs.set('order', order);
        qs.set('reverse', reverse ? 'true' : 'false');
        if (hideOffline) qs.set('lastcheckok', 'true');
        if (params.name) qs.set('name', params.name);
        if (params.countrycode) qs.set('countrycode', params.countrycode);
        if (params.tag) qs.set('tag', params.tag);

        let path;
        if (!params.name && !params.tag && params.countrycode) {
            path = `/stations/bycountrycodeexact/${encodeURIComponent(params.countrycode)}?${qs.toString()}`;
        } else {
            path = `/stations/search?${qs.toString()}`;
        }

        const data = await apiFetch(path, { signal });
        const cache = await loadCache();
        if (!cache.queries) cache.queries = {};
        cache.queries[key] = { cachedAt: Date.now(), data };
        cache.queries = trimQueryCache(cache.queries);
        await saveCache(cache);
        return data;
    },

    async getStationByUuid(uuid, { refresh = false, signal } = {}) {
        if (!uuid) return null;

        if (!refresh) {
            const cached = await readCachedBucket('stations', uuid, TTL.stations);
            if (cached) return cached;
        }

        const data = await apiFetch(`/stations/byuuid/${encodeURIComponent(uuid)}`, { signal });
        const station = Array.isArray(data) ? data[0] : data;
        if (station) {
            await writeCachedBucket('stations', uuid, station, TTL.stations);
        }
        return station || null;
    },

    /** @returns {Promise<number|null>} cachedAt ms, or null if not in IDB */
    async getStationCachedAt(uuid) {
        if (!uuid) return null;
        const cache = await loadCache();
        const entry = cache.stations?.[uuid];
        return Number.isFinite(entry?.cachedAt) ? entry.cachedAt : null;
    },

    /**
     * Resolve many station UUIDs: IDB hits + one bulk POST for misses.
     * API returns matches only — missing UUIDs are omitted (not tombstoned).
     */
    async getStationsByUuidsBulk(uuids, { refresh = false, signal } = {}) {
        const list = [...new Set((uuids || []).map((u) => String(u || '').trim()).filter(Boolean))];
        if (!list.length) return [];

        const cache = await loadCache();
        if (!cache.stations) cache.stations = {};

        const hits = [];
        const missing = [];
        for (const uuid of list) {
            if (!refresh) {
                const entry = cache.stations[uuid];
                if (isFresh(entry, TTL.stations)) {
                    hits.push(entry.data);
                    continue;
                }
            }
            missing.push(uuid);
        }

        if (!missing.length) return hits;

        const data = await apiFetch('/stations/byuuid', {
            method: 'POST',
            body: `uuids=${encodeURIComponent(missing.join(','))}`,
            signal
        });
        const returned = Array.isArray(data) ? data : (data ? [data] : []);

        if (returned.length) {
            const next = await loadCache();
            if (!next.stations) next.stations = {};
            const now = Date.now();
            for (const station of returned) {
                const id = station?.stationuuid;
                if (!id) continue;
                next.stations[id] = { cachedAt: now, data: station };
            }
            await saveCache(next);
        }

        // Partial responses: only returned stations are included (no placeholders here).
        return hits.concat(returned);
    },

    async getStationsByUuids(uuids, { refresh = false, signal } = {}) {
        return this.getStationsByUuidsBulk(uuids, { refresh, signal });
    },

    async reportClick(uuid) {
        if (!uuid) return;
        try {
            await apiFetch(`/url/${encodeURIComponent(uuid)}`, { method: 'POST' });
        } catch {
            // non-critical
        }
    },

    async invalidateQueryCache() {
        const cache = await loadCache();
        delete cache.queries;
        await saveCache(cache);
    },

    async discoverServers() {
        return discoverServers();
    },

    async clearCache() {
        await IndexedDBStore.remove(CACHE_KEY);
        sessionStorage.removeItem(API_BASE_SESSION_KEY);
        countriesMemory = null;
        countriesMemoryAt = 0;
    },

    async setMirrorHost(hostname) {
        if (!hostname) {
            sessionStorage.removeItem(API_BASE_SESSION_KEY);
            const cache = await loadCache();
            delete cache.apiBase;
            await saveCache(cache);
            return;
        }
        const base = `https://${hostname}/json`;
        sessionStorage.setItem(API_BASE_SESSION_KEY, base);
        const cache = await loadCache();
        cache.apiBase = { cachedAt: Date.now(), data: base };
        await saveCache(cache);
    }
};
