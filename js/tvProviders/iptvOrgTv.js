import { normalizeChannel, PROVIDER_IPTV_ORG } from './channelShape.js';
import { IndexedDBStore } from '../storage/indexedDbStore.js';

const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const IPTV_COUNTRIES_URL = 'https://iptv-org.github.io/api/countries.json';
const IPTV_BLOCKLIST_URL = 'https://iptv-org.github.io/api/blocklist.json';
const CACHE_KEY = 'matrix_tv_iptv_cache';
const TTL = 24 * 60 * 60 * 1000;

async function loadCache() {
    try {
        const cached = await IndexedDBStore.get(CACHE_KEY, CACHE_KEY);
        if (!cached) return null;
        if (!isFresh(cached)) return null;
        return cached.data;
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

function isFresh(entry) {
    return entry && Number.isFinite(entry.cachedAt) && (Date.now() - entry.cachedAt) < TTL;
}

function isValidCachedData(data) {
    return data
        && Array.isArray(data.channels)
        && Array.isArray(data.countryList);
}

function hydrateCatalog(data) {
    if (!isValidCachedData(data)) return null;

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

async function loadCatalog(refresh = false) {
    const cached = await readCachedCatalog(refresh);
    if (cached) return cached;

    const [channelsRes, streamsRes, countriesRes, blocklistRes] = await Promise.all([
        fetch(IPTV_CHANNELS_URL),
        fetch(IPTV_STREAMS_URL),
        fetch(IPTV_COUNTRIES_URL),
        fetch(IPTV_BLOCKLIST_URL)
    ]);

    if (!channelsRes.ok || !streamsRes.ok) {
        throw new Error('Could not load iptv-org catalog');
    }

    const channels = await channelsRes.json();
    const streams = await streamsRes.json();
    const countries = countriesRes.ok ? await countriesRes.json() : [];
    const blocklistRaw = blocklistRes.ok ? await blocklistRes.json() : [];

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

    const catalog = hydrateCatalog({ channels: channelsOut, countryList });
    await saveCachePayload(catalog);
    return catalog;
}

export const IptvOrgTvProvider = {
    id: PROVIDER_IPTV_ORG,
    label: 'iptv-org',

    async getCountries({ refresh = false } = {}) {
        const catalog = await loadCatalog(refresh);
        return catalog.countryList;
    },

    async searchChannels({
        countrycode = '',
        limit = 100,
        offset = 0,
        order = 'name',
        reverse = false,
        refresh = false,
        hideOffline = true
    } = {}) {
        const catalog = await loadCatalog(refresh);
        let list = countrycode
            ? [...(catalog.byCountry.get(countrycode) || [])]
            : [...catalog.channels];

        if (hideOffline) {
            list = list.filter((s) => s.url_resolved);
        }

        if (order === 'name') {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            if (reverse) list.reverse();
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
        const results = await Promise.all(
            ids.map((id) => this.getChannelById(id, opts))
        );
        return results.filter(Boolean);
    },

    async invalidateCache() {
        await IndexedDBStore.remove(CACHE_KEY);
    },

    async clearCache() {
        await IndexedDBStore.remove(CACHE_KEY);
    }
};
