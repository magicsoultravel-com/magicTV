import { IndexedDBStore } from '../storage/indexedDbStore.js';

const CACHE_KEY = 'magictv_radio_cache';
const API_BASE_SESSION_KEY = 'magictv_radio_api_base';
const USER_AGENT = 'magictv/1.0';

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

async function apiFetch(path, { method = 'GET', skipCache = false } = {}) {
    let lastError = null;
    const bases = [];

    try {
        bases.push(await resolveApiBase(skipCache));
    } catch (e) {
        lastError = e;
    }

    if (skipCache) {
        try {
            const servers = await discoverServers();
            servers.forEach((name) => bases.push(`https://${name}/json`));
        } catch (e) {
            lastError = e;
        }
    }

    const uniqueBases = [...new Set(bases)];
    if (!uniqueBases.length) throw lastError || new Error('No radio API base available');

    for (const base of uniqueBases) {
        try {
            const res = await fetch(`${base}${path}`, {
                method,
                headers: { 'User-Agent': USER_AGENT }
            });
            if (!res.ok) throw new Error(`Radio API ${res.status}`);
            const data = await res.json();
            if (base !== sessionStorage.getItem(API_BASE_SESSION_KEY)) {
                sessionStorage.setItem(API_BASE_SESSION_KEY, base);
                const cache = await loadCache();
                cache.apiBase = { cachedAt: Date.now(), data: base };
                await saveCache(cache);
            }
            return data;
        } catch (e) {
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
    async getCountries({ refresh = false } = {}) {
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
        const data = await apiFetch('/countries', { skipCache: refresh });
        const written = await writeCachedBucket('countries', null, data, TTL.countries);
        countriesMemory = written;
        countriesMemoryAt = Date.now();
        return written;
    },

    async getTags({ refresh = false } = {}) {
        if (!refresh) {
            const cached = await readCachedBucket('tags', null, TTL.tags);
            if (cached) return cached;
        }
        const data = await apiFetch('/tags?limit=80&order=stationcount&reverse=true', { skipCache: refresh });
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
        hideOffline = true
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

        const data = await apiFetch(path, { skipCache: refresh });
        const cache = await loadCache();
        if (!cache.queries) cache.queries = {};
        cache.queries[key] = { cachedAt: Date.now(), data };
        cache.queries = trimQueryCache(cache.queries);
        await saveCache(cache);
        return data;
    },

    async getStationByUuid(uuid, { refresh = false, forPlay = false } = {}) {
        if (!uuid) return null;

        if (!forPlay && !refresh) {
            const cached = await readCachedBucket('stations', uuid, TTL.stations);
            if (cached) return cached;
        }

        const data = await apiFetch(`/stations/byuuid/${encodeURIComponent(uuid)}`, { skipCache: refresh || forPlay });
        const station = Array.isArray(data) ? data[0] : data;
        if (station) {
            await writeCachedBucket('stations', uuid, station, TTL.stations);
        }
        return station || null;
    },

    async getStationsByUuids(uuids, { refresh = false } = {}) {
        const results = await Promise.all(
            uuids.map((uuid) => this.getStationByUuid(uuid, { refresh }))
        );
        return results.filter(Boolean);
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
