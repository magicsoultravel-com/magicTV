import { normalizeChannel, PROVIDER_IPTV_ORG } from './channelShape.js';
import { IndexedDBStore } from '../storage/indexedDbStore.js';

const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const IPTV_COUNTRIES_URL = 'https://iptv-org.github.io/api/countries.json';
const IPTV_CATEGORIES_URL = 'https://iptv-org.github.io/api/categories.json';
const IPTV_BLOCKLIST_URL = 'https://iptv-org.github.io/api/blocklist.json';
const CACHE_KEY = 'matrix_tv_iptv_cache';

/** Hard ceiling for any catalog fetch so boot/browse never hang on a stalled CDN. */
const DEFAULT_CATALOG_FETCH_TIMEOUT_MS = 12000;
let catalogFetchTimeoutMs = DEFAULT_CATALOG_FETCH_TIMEOUT_MS;

/** Test seam: shrink the timeout so unit/boot tests don't wait out the real value. */
export function setCatalogFetchTimeoutMs(ms) {
    catalogFetchTimeoutMs = Math.max(1, Number(ms) || DEFAULT_CATALOG_FETCH_TIMEOUT_MS);
}

/**
 * Race a fetch against a wall-clock deadline. A stalled connection (no bytes,
 * no headers, never resolving) must NOT hold the boot screen or a search host
 * hostage — the caller decides what to do once the deadline wins.
 */
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error(`Catalog fetch timed out after ${ms}ms: ${label}`));
        }, ms);
        promise.then(
            (value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/**
 * Empty catalog served when the network is unreachable. Callers must be able
 * to boot, browse an empty/offline state, and refresh manually — never throw.
 */
const EMPTY_CATALOG = Object.freeze({
    channels: [],
    countryList: [],
    byId: new Map(),
    byCountry: new Map()
});

// In-memory catalog + last successful (re)load timestamp. After the first
// load the catalog is served from memory for tab switches/searches — no
// IndexedDB reads, no hydration — so favorites/recents tiles render instantly.
let catalogMemory = null;
let lastRefreshedAt = 0;
/** Shared in-flight network load so overlapping refresh/boot calls do not race. */
let catalogNetworkPromise = null;
/** id → display name from categories.json */
let categoryNameMap = new Map();
let categoryMapPromise = null;

// Cache-first forever: the app boots straight from history (even when the
// cached catalog is stale) and only talks to the network when the user taps
// the refresh arrow in the tab bar. No auto-refetch on site reload.
async function loadCache() {
    try {
        const cached = await IndexedDBStore.get(CACHE_KEY, CACHE_KEY);
        if (cached) {
            lastRefreshedAt = cached.cachedAt || Date.now();
            return cached.data;
        }
        return null;
    } catch {
        return null;
    }
}

async function saveCachePayload(data) {
    try {
        await IndexedDBStore.set(CACHE_KEY, { cachedAt: Date.now(), data });
    } catch {
        /* quota or private mode — in-memory catalog still works this session */
    }
}

function isValidCachedData(data) {
    return data
        && Array.isArray(data.channels)
        && Array.isArray(data.countryList);
}

function applyCategoryNames(entries) {
    const map = new Map();
    (Array.isArray(entries) ? entries : []).forEach((c) => {
        if (c?.id) map.set(c.id, c.name || c.id);
    });
    categoryNameMap = map;
    return map;
}

async function ensureCategoryNameMap() {
    if (categoryNameMap.size) return categoryNameMap;
    if (categoryMapPromise) return categoryMapPromise;
    categoryMapPromise = (async () => {
        try {
            const res = await withTimeout(fetch(IPTV_CATEGORIES_URL), catalogFetchTimeoutMs, 'category-names');
            if (res.ok) applyCategoryNames(await res.json());
        } catch {
            /* keep empty map */
        }
        return categoryNameMap;
    })().finally(() => {
        categoryMapPromise = null;
    });
    return categoryMapPromise;
}

function channelMatchesQuery(s, q) {
    if ((s.name || '').toLowerCase().includes(q)) return true;
    if ((s.id || '').toLowerCase().includes(q)) return true;
    const cats = Array.isArray(s.categories) ? s.categories : [];
    for (const id of cats) {
        const sid = String(id || '').toLowerCase();
        if (sid.includes(q)) return true;
        const label = (categoryNameMap.get(id) || '').toLowerCase();
        if (label && label.includes(q)) return true;
    }
    return false;
}

function primaryCategoryId(s) {
    const cats = s?.categories;
    return Array.isArray(cats) && cats.length ? String(cats[0] || '') : '';
}

function sortChannelsList(list, order, reverse) {
    if (order === 'category') {
        list.sort((a, b) => {
            const ca = primaryCategoryId(a);
            const cb = primaryCategoryId(b);
            if (!ca && cb) return 1;
            if (ca && !cb) return -1;
            const la = (categoryNameMap.get(ca) || ca).toLowerCase();
            const lb = (categoryNameMap.get(cb) || cb).toLowerCase();
            const c = la.localeCompare(lb);
            if (c) return c;
            return (a.name || '').localeCompare(b.name || '');
        });
    } else {
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    if (reverse) list.reverse();
}

function hydrateCatalog(data) {
    if (!isValidCachedData(data)) return null;

    if (data.categoryNames && typeof data.categoryNames === 'object') {
        categoryNameMap = new Map(Object.entries(data.categoryNames));
    }

    const channels = data.channels;
    const byId = new Map(channels.map((s) => [s.id, s]));
    const byCountry = new Map();
    channels.forEach((s) => {
        if (!s.country) return;
        if (!byCountry.has(s.country)) byCountry.set(s.country, []);
        byCountry.get(s.country).push(s);
    });

    return {
        channels,
        countryList: data.countryList,
        byId,
        byCountry
    };
}

async function readCachedCatalog(refresh) {
    if (refresh) return null;
    const entry = await loadCache();
    if (!entry) return null;
    const catalog = hydrateCatalog(entry);
    if (!catalog) {
        await IndexedDBStore.remove(CACHE_KEY);
        return null;
    }
    return catalog;
}

async function fetchCatalogFromNetwork() {
    const [channelsRes, streamsRes, countriesRes, categoriesRes, blocklistRes] = await Promise.all([
        withTimeout(fetch(IPTV_CHANNELS_URL), catalogFetchTimeoutMs, 'channels'),
        withTimeout(fetch(IPTV_STREAMS_URL), catalogFetchTimeoutMs, 'streams'),
        withTimeout(fetch(IPTV_COUNTRIES_URL), catalogFetchTimeoutMs, 'countries'),
        withTimeout(fetch(IPTV_CATEGORIES_URL), catalogFetchTimeoutMs, 'categories'),
        withTimeout(fetch(IPTV_BLOCKLIST_URL), catalogFetchTimeoutMs, 'blocklist')
    ]);

    if (!channelsRes.ok || !streamsRes.ok) {
        throw new Error('Could not load iptv-org catalog');
    }

    const channels = await channelsRes.json();
    const streams = await streamsRes.json();
    const countries = countriesRes.ok ? await countriesRes.json() : [];
    const categories = categoriesRes.ok ? await categoriesRes.json() : [];
    const blocklistRaw = blocklistRes.ok ? await blocklistRes.json() : [];

    applyCategoryNames(categories);

    const blocklist = new Set();
    (Array.isArray(blocklistRaw) ? blocklistRaw : []).forEach((entry) => {
        const id = entry.channel || entry.id;
        if (id) blocklist.add(id);
    });

    const streamByChannel = new Map();
    (Array.isArray(streams) ? streams : []).forEach((s) => {
        const ch = s.channel || s.id;
        if (ch && s.url && !streamByChannel.has(ch)) {
            streamByChannel.set(ch, s.url);
        }
    });

    const countryNames = new Map(
        (Array.isArray(countries) ? countries : []).map((c) => [c.code, c.name])
    );

    const tvChannels = (Array.isArray(channels) ? channels : []).filter((ch) => {
        const cats = ch.categories || [];
        const isRadio = cats.some((c) => String(c).toLowerCase() === 'radio');
        if (isRadio) return false;
        if (ch.is_nsfw) return false;
        if (blocklist.has(ch.id)) return false;
        return true;
    });

    const channelsOut = tvChannels
        .map((ch) => {
            const url = streamByChannel.get(ch.id);
            if (!url) return null;
            return {
                id: ch.id,
                name: ch.name,
                country: ch.country || '',
                logo: ch.logo || '',
                categories: ch.categories || [],
                url_resolved: url
            };
        })
        .filter(Boolean);

    const countryCounts = new Map();
    channelsOut.forEach((s) => {
        if (!s.country) return;
        countryCounts.set(s.country, (countryCounts.get(s.country) || 0) + 1);
    });

    const countryList = [...countryCounts.entries()]
        .map(([code, stationcount]) => ({
            iso_3166_1: code,
            name: countryNames.get(code) || code,
            stationcount
        }))
        .sort((a, b) => b.stationcount - a.stationcount);

    const categoryNames = Object.fromEntries(categoryNameMap);
    const catalog = hydrateCatalog({ channels: channelsOut, countryList, categoryNames });
    await saveCachePayload({ channels: channelsOut, countryList, categoryNames });
    catalogMemory = catalog;
    lastRefreshedAt = Date.now();
    return catalog;
}

async function loadCatalog(refresh = false) {
    if (!refresh && catalogMemory) {
        if (!categoryNameMap.size) ensureCategoryNameMap();
        return catalogMemory;
    }

    const cached = await readCachedCatalog(refresh);
    if (cached) {
        catalogMemory = cached;
        if (!categoryNameMap.size) ensureCategoryNameMap();
        return cached;
    }

    if (catalogNetworkPromise) return catalogNetworkPromise;

    // The network must NEVER hang (or throw through) a boot / search path.
    // On any failure, serve an empty catalog so callers degrade to stubs and
    // empty states; the next manual refresh (refresh=true) retries the network.
    catalogNetworkPromise = (async () => {
        try {
            const catalog = await fetchCatalogFromNetwork();
            catalogMemory = catalog;
            return catalog;
        } catch (err) {
            console.warn('[magicTV] Catalog network load failed; using empty catalog:', err?.message || err);
            catalogMemory = EMPTY_CATALOG;
            return EMPTY_CATALOG;
        }
    })().finally(() => {
        catalogNetworkPromise = null;
    });
    return catalogNetworkPromise;
}

export const IptvOrgTvProvider = {
    id: PROVIDER_IPTV_ORG,
    label: 'iptv-org',

    getCategoryNameMap() {
        return categoryNameMap;
    },

    async getCountries({ refresh = false } = {}) {
        const catalog = await loadCatalog(refresh);
        return catalog.countryList;
    },

        async searchChannels({
        countrycode = '',
        query = '',
        category = '',
        limit = 100,
        offset = 0,
        order = 'name',
        reverse = false,
        refresh = false
    } = {}) {
        const catalog = await loadCatalog(refresh);
        let list = countrycode
            ? [...(catalog.byCountry.get(countrycode) || [])]
            : [...catalog.channels];

        // Whole-dataset filter: the catalog is fully resident (memory/IDB),
        // so filtering happens against every channel — not just the pages
        // already painted — and pagination scrolls the *filtered* results.
        // Channels without a resolved URL are dropped by normalizeChannel.
        const q = String(query || '').trim().toLowerCase();
        if (q) {
            if (!categoryNameMap.size) await ensureCategoryNameMap();
            list = list.filter((s) => channelMatchesQuery(s, q));
        }

        const cat = String(category || '').trim();
        if (cat) {
            list = list.filter((s) =>
                (s.categories || []).some((c) => String(c) === cat)
            );
        }

        if (order === 'name' || order === 'category') {
            if (order === 'category' && !categoryNameMap.size) await ensureCategoryNameMap();
            sortChannelsList(list, order, reverse);
        }

        return list
            .slice(offset, offset + limit)
            .map((s) => normalizeChannel(s, PROVIDER_IPTV_ORG))
            .filter(Boolean);
    },

    async getChannelById(channelId, { refresh = false } = {}) {
        const catalog = await loadCatalog(refresh);
        const raw = catalog.byId.get(channelId);
        return normalizeChannel(raw, PROVIDER_IPTV_ORG);
    },

    async getChannelsByIds(ids, opts = {}) {
        const catalog = await loadCatalog(opts.refresh);
        return ids
            .map((id) => normalizeChannel(catalog.byId.get(id), PROVIDER_IPTV_ORG))
            .filter(Boolean);
    },

    // When was the catalog data we're serving last fetched from the network?
    getLastRefreshed() {
        return lastRefreshedAt;
    },

    async invalidateCache() {
        catalogMemory = null;
        await IndexedDBStore.remove(CACHE_KEY);
    },

    async clearCache() {
        await IndexedDBStore.remove(CACHE_KEY);
    }
};
