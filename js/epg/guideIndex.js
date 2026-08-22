/**
 * Fetch and index iptv-org guides.json for channel → guide metadata lookup.
 */
import { IndexedDBStore } from '../storage/indexedDbStore.js';

const GUIDES_URL = 'https://iptv-org.github.io/api/guides.json';
const CACHE_KEY = 'matrix_tv_epg_guides';
const INDEX_CACHE_KEY = 'matrix_tv_epg_guides_index';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, object[]>|null} */
let indexMemory = null;
/** @type {Promise<Map<string, object[]>>|null} */
let loadPromise = null;

/**
 * @param {object[]} guides
 * @returns {Map<string, object[]>}
 */
export function buildGuideIndex(guides) {
    /** @type {Map<string, object[]>} */
    const byChannel = new Map();
    for (const entry of guides || []) {
        const ch = entry?.channel;
        if (!ch) continue;
        if (!byChannel.has(ch)) byChannel.set(ch, []);
        byChannel.get(ch).push(entry);
    }
    return byChannel;
}

/** Persist index as plain object for faster cold start. */
function indexToObject(map) {
    /** @type {Record<string, object[]>} */
    const obj = Object.create(null);
    for (const [k, v] of map.entries()) obj[k] = v;
    return obj;
}

function objectToIndex(obj) {
    const map = new Map();
    if (!obj || typeof obj !== 'object') return map;
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) map.set(k, v);
    }
    return map;
}

async function fetchGuidesRaw() {
    const res = await fetch(GUIDES_URL);
    if (!res.ok) throw new Error(`guides.json HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('guides.json invalid');
    return data;
}

/**
 * @returns {Promise<Map<string, object[]>>}
 */
export async function ensureGuideIndex() {
    if (indexMemory) return indexMemory;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const cachedIndex = await IndexedDBStore.get(INDEX_CACHE_KEY);
        if (cachedIndex?.cachedAt && Date.now() - cachedIndex.cachedAt < CACHE_TTL_MS && cachedIndex.data) {
            indexMemory = objectToIndex(cachedIndex.data);
            return indexMemory;
        }

        let guides = null;
        const cachedGuides = await IndexedDBStore.get(CACHE_KEY);
        if (cachedGuides?.cachedAt && Date.now() - cachedGuides.cachedAt < CACHE_TTL_MS && Array.isArray(cachedGuides.data)) {
            guides = cachedGuides.data;
        } else {
            guides = await fetchGuidesRaw();
            await IndexedDBStore.set(CACHE_KEY, { cachedAt: Date.now(), data: guides });
        }

        indexMemory = buildGuideIndex(guides);
        await IndexedDBStore.set(INDEX_CACHE_KEY, {
            cachedAt: Date.now(),
            data: indexToObject(indexMemory)
        });
        return indexMemory;
    })().finally(() => {
        loadPromise = null;
    });

    return loadPromise;
}

/**
 * @param {string} channelId
 * @returns {Promise<object[]>}
 */
export async function getGuideEntries(channelId) {
    if (!channelId) return [];
    const index = await ensureGuideIndex();
    return index.get(channelId) || [];
}

export async function warmGuideIndex() {
    try {
        await ensureGuideIndex();
    } catch {
        /* optional background warm */
    }
}
