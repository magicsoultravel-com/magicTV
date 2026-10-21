/**
 * YouTube play queue (localStorage) — the offline-safe backbone of tile
 * next/previous navigation.
 *
 * Order is deterministic and cheap to build:
 *   current clip → same-author library clips → rest of the library →
 *   remotely fetched related clips → watch history.
 *
 * Related items are only ever appended at the tail, so the live index never
 * shifts while a video is playing. Everything here is pure except the storage
 * helpers.
 */
import { normalizeYouTubeId, youtubeThumbUrl } from './youtubeLinks.js';

export const YOUTUBE_QUEUE_KEY = 'magictv_youtube_queue_v1';
export const YOUTUBE_HISTORY_KEY = 'magictv_youtube_history_v1';
export const YOUTUBE_QUEUE_LIMIT = 60;
export const YOUTUBE_HISTORY_LIMIT = 40;

/** Where a queue entry came from (drives the tray's source dot). */
export const YOUTUBE_QUEUE_SOURCES = ['current', 'author', 'library', 'related', 'history'];

const QUEUE_SOURCE_SET = new Set(YOUTUBE_QUEUE_SOURCES);

function text(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clampLimit(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return YOUTUBE_QUEUE_LIMIT;
    return Math.min(YOUTUBE_QUEUE_LIMIT, n);
}

/**
 * One queue entry. Thumbnails always come from i.ytimg.com — provider payloads
 * carry instance-proxied or signed URLs that rot.
 * @param {any} raw
 * @returns {{ videoId: string, title: string, thumb: string, author: string, source: string } | null}
 */
export function normalizeYouTubeQueueItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const videoId = normalizeYouTubeId(raw.videoId || raw.id || raw.url || '');
    if (!videoId) return null;
    const source = QUEUE_SOURCE_SET.has(raw.source) ? raw.source : 'related';
    return {
        videoId,
        title: text(raw.title, 200) || `YouTube ${videoId}`,
        thumb: youtubeThumbUrl(videoId),
        author: text(raw.author || raw.uploaderName || raw.uploader, 120),
        source
    };
}

/**
 * @param {any} raw
 * @returns {{ videoId: string, index: number, items: ReturnType<typeof normalizeYouTubeQueueItem>[], updatedAt: number }}
 */
export function normalizeYouTubeQueue(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const seen = new Set();
    const items = [];
    for (const entry of Array.isArray(source.items) ? source.items : []) {
        const item = normalizeYouTubeQueueItem(entry);
        if (!item || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        items.push(item);
        if (items.length >= YOUTUBE_QUEUE_LIMIT) break;
    }
    if (!items.length) return { videoId: '', index: -1, items: [], updatedAt: 0 };

    let videoId = normalizeYouTubeId(source.videoId);
    if (!videoId) videoId = items[0].videoId;
    let index = items.findIndex((item) => item.videoId === videoId);
    if (index < 0) {
        const rawIndex = Math.floor(Number(source.index));
        index = Number.isFinite(rawIndex) ? Math.min(items.length - 1, Math.max(0, rawIndex)) : 0;
        videoId = items[index].videoId;
    }
    const updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : 0;
    return { videoId, index, items, updatedAt };
}

function readRaw(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeRaw(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function readJson(key) {
    const raw = readRaw(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** @returns {ReturnType<typeof normalizeYouTubeQueue>} */
export function loadYouTubeQueue() {
    return normalizeYouTubeQueue(readJson(YOUTUBE_QUEUE_KEY));
}

/** @param {any} queue */
export function saveYouTubeQueue(queue) {
    const normalized = normalizeYouTubeQueue(queue);
    writeRaw(YOUTUBE_QUEUE_KEY, JSON.stringify(normalized));
    return normalized;
}

export function clearYouTubeQueue() {
    try {
        localStorage.removeItem(YOUTUBE_QUEUE_KEY);
    } catch { /* ignore */ }
}

/**
 * Deterministic queue for a freshly opened clip.
 * @param {{
 *   current: { videoId: string, title?: string, author?: string },
 *   library?: any[],
 *   related?: any[],
 *   history?: any[],
 *   limit?: number
 * }} input
 */
export function buildYouTubeQueue({
    current,
    library = [],
    related = [],
    history = [],
    limit = YOUTUBE_QUEUE_LIMIT
} = {}) {
    const currentItem = normalizeYouTubeQueueItem({ ...current, source: 'current' });
    if (!currentItem) return { videoId: '', index: -1, items: [], updatedAt: 0 };

    const author = currentItem.author.toLowerCase();
    const sameAuthor = [];
    const restLibrary = [];
    for (const entry of Array.isArray(library) ? library : []) {
        const item = normalizeYouTubeQueueItem({ ...entry, source: 'library' });
        if (!item || item.videoId === currentItem.videoId) continue;
        if (author && item.author.toLowerCase() === author) sameAuthor.push(item);
        else restLibrary.push(item);
    }

    const seen = new Set([currentItem.videoId]);
    const items = [currentItem];
    const append = (entry, source) => {
        const item = normalizeYouTubeQueueItem({ ...entry, source });
        if (!item || seen.has(item.videoId)) return;
        seen.add(item.videoId);
        items.push(item);
    };

    sameAuthor.forEach((item) => append(item, 'author'));
    restLibrary.forEach((item) => append(item, 'library'));
    for (const entry of Array.isArray(related) ? related : []) append(entry, 'related');
    for (const entry of Array.isArray(history) ? history : []) append(entry, 'history');

    const cap = clampLimit(limit);
    return {
        videoId: currentItem.videoId,
        index: 0,
        items: items.slice(0, cap),
        updatedAt: Date.now()
    };
}

/**
 * Append unseen related clips at the tail. Existing entries never move, so the
 * live index stays valid; over-limit trimming only drops items after the index.
 * @param {any} queue
 * @param {any[]} related
 * @param {{ limit?: number }} [opts]
 */
export function appendYouTubeRelated(queue, related, { limit = YOUTUBE_QUEUE_LIMIT } = {}) {
    const base = normalizeYouTubeQueue(queue);
    if (!base.items.length) return base;

    const seen = new Set(base.items.map((item) => item.videoId));
    const incoming = [];
    for (const entry of Array.isArray(related) ? related : []) {
        const item = normalizeYouTubeQueueItem({ ...entry, source: 'related' });
        if (!item || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        incoming.push(item);
    }
    if (!incoming.length) return base;

    const cap = clampLimit(limit);
    const items = base.items.slice();
    // Make room at the tail first (never behind the cursor) so a full queue
    // replaces its farthest suggestions instead of discarding the new ones.
    const room = Math.max(1, cap - incoming.length);
    while (items.length > room && items.length - 1 > base.index) items.pop();
    items.push(...incoming);
    while (items.length > cap && items.length - 1 > base.index) items.pop();
    return { ...base, items, updatedAt: Date.now() };
}

/**
 * @param {any} queue
 * @param {number} index
 * @returns {ReturnType<typeof normalizeYouTubeQueueItem> | null}
 */
export function queueItemAt(queue, index) {
    const i = Math.floor(Number(index));
    if (!Number.isFinite(i) || i < 0) return null;
    return queue?.items?.[i] || null;
}

/** @param {any} queue @param {string} videoId */
export function queueIndexOf(queue, videoId) {
    const id = normalizeYouTubeId(videoId);
    if (!id || !Array.isArray(queue?.items)) return -1;
    return queue.items.findIndex((item) => item.videoId === id);
}

/**
 * Resolve a relative step without mutating anything. Returns null at either end.
 * @param {any} queue
 * @param {number} delta
 * @returns {{ index: number, item: ReturnType<typeof normalizeYouTubeQueueItem> } | null}
 */
export function resolveYouTubeQueueStep(queue, delta) {
    const normalized = normalizeYouTubeQueue(queue);
    if (!normalized.items.length) return null;
    const step = Math.trunc(Number(delta)) || 0;
    const index = normalized.index + step;
    if (index < 0 || index >= normalized.items.length) return null;
    return { index, item: normalized.items[index] };
}

/**
 * Point the queue at one entry (manual pick or step).
 * @param {any} queue
 * @param {number} index
 */
export function selectYouTubeQueueIndex(queue, index) {
    const normalized = normalizeYouTubeQueue(queue);
    const i = Math.floor(Number(index));
    if (!Number.isFinite(i) || i < 0 || i >= normalized.items.length) return normalized;
    return {
        ...normalized,
        index: i,
        videoId: normalized.items[i].videoId,
        updatedAt: Date.now()
    };
}

/**
 * Move the queue to a manually picked clip (already-queued clips jump in place).
 * @param {any} queue
 * @param {{ videoId: string, title?: string, author?: string }} clip
 */
export function retargetYouTubeQueue(queue, clip) {
    const item = normalizeYouTubeQueueItem({ ...clip, source: 'current' });
    if (!item) return normalizeYouTubeQueue(queue);
    const normalized = normalizeYouTubeQueue(queue);
    const at = queueIndexOf(normalized, item.videoId);
    if (at >= 0) return selectYouTubeQueueIndex(normalized, at);
    return {
        ...normalized,
        videoId: item.videoId,
        index: 0,
        items: [item, ...normalized.items],
        updatedAt: Date.now()
    };
}

/** @returns {ReturnType<typeof normalizeYouTubeQueueItem>[]} newest first */
export function listYouTubeHistory() {
    const raw = readJson(YOUTUBE_HISTORY_KEY);
    const source = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    const seen = new Set();
    const items = [];
    for (const entry of source) {
        const item = normalizeYouTubeQueueItem({ ...entry, source: 'history' });
        if (!item || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        items.push(item);
        if (items.length >= YOUTUBE_HISTORY_LIMIT) break;
    }
    return items;
}

/**
 * Record a played clip (newest first, de-duplicated by move-to-front).
 * @param {{ videoId: string, title?: string, author?: string }} clip
 */
export function recordYouTubeHistory(clip) {
    const item = normalizeYouTubeQueueItem({ ...clip, source: 'history' });
    if (!item) return null;
    const history = listYouTubeHistory();
    const previous = history.find((entry) => entry.videoId === item.videoId);
    // A bare re-record (title only) keeps the author we already knew.
    if (previous?.author && !item.author) item.author = previous.author;
    const items = [item, ...history.filter((entry) => entry.videoId !== item.videoId)]
        .slice(0, YOUTUBE_HISTORY_LIMIT);
    writeRaw(YOUTUBE_HISTORY_KEY, JSON.stringify({ items }));
    return item;
}

export function clearYouTubeHistory() {
    try {
        localStorage.removeItem(YOUTUBE_HISTORY_KEY);
    } catch { /* ignore */ }
}
