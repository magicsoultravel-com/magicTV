/**
 * Related-video lookup chain: Piped first, Invidious second.
 *
 * Both are public, key-less JSON APIs that answer with `Access-Control-Allow-
 * Origin: *`, which is what a static page needs (InnerTube `next` rejects
 * browser preflights and Data API v3 dropped `relatedToVideoId`).
 *
 * Guards kept here so the mosaic never stalls on a dead instance:
 *  - 6 h positive cache / 15 min negative cache, with in-flight de-dupe
 *  - per-host health memory (2 failures → 10 min cooldown, healthy hosts first)
 *  - every request is timeout-bounded and this module never throws
 */
import { normalizeYouTubeId, youtubeThumbUrl } from './youtubeLinks.js';

export const YOUTUBE_RELATED_HEALTH_KEY = 'magictv_youtube_related_health_v1';
export const YOUTUBE_PIPED_HOSTS = ['api.piped.private.coffee', 'pipedapi.ducks.party'];
export const DEFAULT_YOUTUBE_INVIDIOUS_INSTANCE = 'https://invidious.f5.si';
export const YOUTUBE_RELATED_PROVIDERS = ['auto', 'piped', 'invidious'];

export const RELATED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RELATED_NEGATIVE_TTL_MS = 15 * 60 * 1000;
export const RELATED_COOLDOWN_MS = 10 * 60 * 1000;
export const RELATED_FAIL_THRESHOLD = 2;
export const RELATED_TIMEOUT_MS = 6000;
export const RELATED_MAX_ITEMS = 24;
/** Session cache ceiling — FIFO eviction keeps long sessions bounded. */
export const RELATED_CACHE_MAX = 60;

const WATCH_ID_RE = /[?&]v=([A-Za-z0-9_-]{11})/;

/** @type {Map<string, { expiresAt: number, result: object }>} */
const relatedCache = new Map();
/** @type {Map<string, Promise<object>>} */
const relatedInFlight = new Map();

/** @param {unknown} value */
export function normalizeRelatedProvider(value) {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return YOUTUBE_RELATED_PROVIDERS.includes(id) ? id : 'auto';
}

/** Bare host from a pasted URL (`https://invidious.example/` → `invidious.example`). */
export function normalizePipedHost(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        return String(url.hostname || '').toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

/** `https://host` with no path/trailing slash; '' for junk. */
export function normalizeInvidiousInstance(value) {
    const host = normalizePipedHost(value);
    return host ? `https://${host}` : '';
}

function normalizeHostList(hosts) {
    const source = Array.isArray(hosts) ? hosts : YOUTUBE_PIPED_HOSTS;
    const seen = new Set();
    const list = [];
    for (const raw of source) {
        const host = normalizePipedHost(raw);
        if (!host || seen.has(host)) continue;
        seen.add(host);
        list.push(host);
    }
    return list;
}

function watchId(value) {
    if (typeof value !== 'string' || !value) return '';
    const direct = normalizeYouTubeId(value);
    if (direct) return direct;
    const match = WATCH_ID_RE.exec(value);
    return match ? match[1] : '';
}

function clampText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function relatedItem(videoId, title, author) {
    return {
        videoId,
        title: clampText(title, 200) || `YouTube ${videoId}`,
        // Always canonical: instance proxies and signed thumb URLs expire.
        thumb: youtubeThumbUrl(videoId),
        author: clampText(author, 120),
        source: 'related'
    };
}

/**
 * @param {any} payload Piped `/streams/{id}` response
 * @returns {ReturnType<typeof relatedItem>[]}
 */
export function parsePipedRelated(payload) {
    const list = Array.isArray(payload?.relatedStreams) ? payload.relatedStreams : [];
    const seen = new Set();
    const items = [];
    for (const raw of list) {
        const type = typeof raw?.type === 'string' ? raw.type : 'stream';
        // Piped tags entries `stream`; tolerate `video` from older instances.
        if (type !== 'stream' && type !== 'video') continue;
        const videoId = watchId(raw?.url) || normalizeYouTubeId(raw?.videoId || '');
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);
        items.push(relatedItem(videoId, raw?.title, raw?.uploaderName || raw?.uploader));
        if (items.length >= RELATED_MAX_ITEMS) break;
    }
    return items;
}

/**
 * @param {any} payload Invidious `/api/v1/videos/{id}` response
 * @returns {ReturnType<typeof relatedItem>[]}
 */
export function parseInvidiousRelated(payload) {
    const list = Array.isArray(payload?.recommendedVideos) ? payload.recommendedVideos : [];
    const seen = new Set();
    const items = [];
    for (const raw of list) {
        const videoId = normalizeYouTubeId(raw?.videoId || '');
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);
        items.push(relatedItem(videoId, raw?.title, raw?.author || raw?.authorId));
        if (items.length >= RELATED_MAX_ITEMS) break;
    }
    return items;
}

// ---- host health memory ---------------------------------------------------

/** @returns {{ hosts: Record<string, { fails: number, cooldownUntil: number, lastOkAt: number }> }} */
export function readYouTubeRelatedHealth() {
    try {
        const raw = localStorage.getItem(YOUTUBE_RELATED_HEALTH_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const hosts = parsed && typeof parsed.hosts === 'object' && parsed.hosts ? parsed.hosts : {};
        const out = {};
        for (const [host, state] of Object.entries(hosts)) {
            if (!host || !state || typeof state !== 'object') continue;
            out[host] = {
                fails: Math.max(0, Math.floor(Number(state.fails)) || 0),
                cooldownUntil: Math.max(0, Number(state.cooldownUntil) || 0),
                lastOkAt: Math.max(0, Number(state.lastOkAt) || 0)
            };
        }
        return { hosts: out };
    } catch {
        return { hosts: {} };
    }
}

function writeYouTubeRelatedHealth(health) {
    try {
        localStorage.setItem(YOUTUBE_RELATED_HEALTH_KEY, JSON.stringify(health));
        return true;
    } catch {
        return false;
    }
}

export function clearYouTubeRelatedHealth() {
    try {
        localStorage.removeItem(YOUTUBE_RELATED_HEALTH_KEY);
    } catch { /* ignore */ }
}

/**
 * Remember one attempt. Two consecutive failures park a host for 10 minutes so
 * the next lookup does not burn a timeout on it.
 * @param {string} host
 * @param {boolean} ok
 * @param {() => number} [now]
 */
export function noteRelatedHostResult(host, ok, now = Date.now) {
    const key = normalizePipedHost(host);
    if (!key) return null;
    const stamp = Math.max(0, Number(now()) || 0);
    const health = readYouTubeRelatedHealth();
    const current = health.hosts[key] || { fails: 0, cooldownUntil: 0, lastOkAt: 0 };
    const next = ok
        ? { fails: 0, cooldownUntil: 0, lastOkAt: stamp }
        : {
            fails: current.fails + 1,
            cooldownUntil: current.fails + 1 >= RELATED_FAIL_THRESHOLD
                ? stamp + RELATED_COOLDOWN_MS
                : current.cooldownUntil,
            lastOkAt: current.lastOkAt
        };
    health.hosts[key] = next;
    writeYouTubeRelatedHealth(health);
    return next;
}

/** @param {string} host @param {number} [now] */
export function relatedHostCooldownRemaining(host, now = Date.now()) {
    const key = normalizePipedHost(host);
    if (!key) return 0;
    const state = readYouTubeRelatedHealth().hosts[key];
    if (!state) return 0;
    return Math.max(0, state.cooldownUntil - (Number(now) || 0));
}

function isCooling(state, stamp) {
    return Boolean(state && Number(state.cooldownUntil) > stamp);
}

// ---- provider chain -------------------------------------------------------

/**
 * Ordered fetch attempts for one video. Cooling hosts are demoted, never
 * dropped: when every host is cooling we still try rather than fail offline.
 * @param {string} videoId
 * @param {{
 *   provider?: string,
 *   pipedHosts?: string[],
 *   invidiousInstance?: string,
 *   health?: { hosts?: Record<string, any> },
 *   now?: () => number
 * }} [opts]
 * @returns {{ provider: 'piped' | 'invidious', host: string, url: string }[]}
 */
export function youtubeRelatedAttempts(videoId, {
    provider = 'auto',
    pipedHosts = YOUTUBE_PIPED_HOSTS,
    invidiousInstance = '',
    health = null,
    now = Date.now
} = {}) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return [];
    const mode = normalizeRelatedProvider(provider);
    const stamp = Math.max(0, Number(now()) || 0);
    const states = (health && typeof health === 'object' && health.hosts) || readYouTubeRelatedHealth().hosts;

    const attempts = [];
    if (mode !== 'invidious') {
        for (const host of normalizeHostList(pipedHosts)) {
            attempts.push({ provider: 'piped', host, url: `https://${host}/streams/${id}` });
        }
    }
    if (mode !== 'piped') {
        const instance = normalizeInvidiousInstance(invidiousInstance) || DEFAULT_YOUTUBE_INVIDIOUS_INSTANCE;
        attempts.push({
            provider: 'invidious',
            host: normalizePipedHost(instance),
            url: `${instance}/api/v1/videos/${id}`
        });
    }

    return attempts
        .map((attempt, order) => ({
            ...attempt,
            order,
            cooling: isCooling(states[attempt.host], stamp)
        }))
        .sort((a, b) => {
            if (a.cooling !== b.cooling) return a.cooling ? 1 : -1;
            return a.order - b.order;
        })
        .map(({ order, cooling, ...attempt }) => attempt);
}

async function fetchJson(url, doFetch, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = 0;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            try { controller?.abort(); } catch { /* ignore */ }
            resolve(null);
        }, Math.max(500, Number(timeoutMs) || RELATED_TIMEOUT_MS));
    });

    const request = (async () => {
        try {
            const response = await doFetch(url, {
                signal: controller?.signal,
                credentials: 'omit',
                headers: { Accept: 'application/json' }
            });
            if (!response?.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    })();

    try {
        return await Promise.race([request, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function clearYouTubeRelatedCache() {
    relatedCache.clear();
    relatedInFlight.clear();
}

function cacheSet(key, entry) {
    relatedCache.set(key, entry);
    while (relatedCache.size > RELATED_CACHE_MAX) {
        const oldest = relatedCache.keys().next().value;
        relatedCache.delete(oldest);
    }
}

/**
 * Related clips for one video. Resolves `{ videoId, items, provider, host }`;
 * `items` is empty (never a throw) when every provider fails.
 * @param {string} videoId
 * @param {{
 *   provider?: string,
 *   pipedHosts?: string[],
 *   invidiousInstance?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   now?: () => number,
 *   cache?: boolean,
 *   maxItems?: number
 * }} [opts]
 * @returns {Promise<{ videoId: string, items: object[], provider: string, host: string }>}
 */
export async function fetchYouTubeRelated(videoId, {
    provider = 'auto',
    pipedHosts = YOUTUBE_PIPED_HOSTS,
    invidiousInstance = '',
    fetchImpl = null,
    timeoutMs = RELATED_TIMEOUT_MS,
    now = Date.now,
    cache = true,
    maxItems = RELATED_MAX_ITEMS
} = {}) {
    const id = normalizeYouTubeId(videoId);
    const empty = { videoId: id || '', items: [], provider: '', host: '' };
    if (!id) return empty;

    const clock = typeof now === 'function' ? now : Date.now;
    const cacheKey = [
        id,
        normalizeRelatedProvider(provider),
        normalizeInvidiousInstance(invidiousInstance) || DEFAULT_YOUTUBE_INVIDIOUS_INSTANCE,
        normalizeHostList(pipedHosts).join(',')
    ].join('|');
    const stamp = Number(clock()) || 0;

    if (cache) {
        const hit = relatedCache.get(cacheKey);
        if (hit && hit.expiresAt > stamp) return hit.result;
    }
    const pending = relatedInFlight.get(cacheKey);
    if (pending) return pending;

    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return empty;

    const task = (async () => {
        const attempts = youtubeRelatedAttempts(id, { provider, pipedHosts, invidiousInstance, now: clock });
        for (const attempt of attempts) {
            const payload = await fetchJson(attempt.url, doFetch, timeoutMs);
            if (!payload) {
                noteRelatedHostResult(attempt.host, false, clock);
                continue;
            }
            const items = attempt.provider === 'piped'
                ? parsePipedRelated(payload)
                : parseInvidiousRelated(payload);
            if (!items.length) {
                noteRelatedHostResult(attempt.host, false, clock);
                continue;
            }
            noteRelatedHostResult(attempt.host, true, clock);
            const result = {
                videoId: id,
                items: items.slice(0, Math.max(1, Math.floor(Number(maxItems)) || RELATED_MAX_ITEMS)),
                provider: attempt.provider,
                host: attempt.host
            };
            if (cache) {
                cacheSet(cacheKey, {
                    expiresAt: (Number(clock()) || 0) + RELATED_CACHE_TTL_MS,
                    result
                });
            }
            return result;
        }

        // Negative cache stops a dead video from re-running the whole chain
        // on every chrome refresh.
        if (cache) {
            cacheSet(cacheKey, {
                expiresAt: (Number(clock()) || 0) + RELATED_NEGATIVE_TTL_MS,
                result: empty
            });
        }
        return empty;
    })();

    relatedInFlight.set(cacheKey, task);
    try {
        return await task;
    } finally {
        relatedInFlight.delete(cacheKey);
    }
}
