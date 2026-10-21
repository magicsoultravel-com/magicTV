/**
 * Per-user Web Video library (localStorage).
 *
 * Each entry remembers the page that was pasted plus the last stream URL that
 * actually worked, so the picker can offer one-click replay without resolving
 * the page again.
 */
import {
    classifyStreamUrl,
    hostLabel,
    parsePageUrl,
    sanitizeStreamUrl,
    webstreamKey
} from './webStreamLinks.js';
import { isShieldLevel } from './webShield.js';

export const WEBSTREAM_LIBRARY_KEY = 'magictv_webstream_library_v1';
export const WEBSTREAM_LIBRARY_LIMIT = 80;

function readRaw() {
    try {
        return localStorage.getItem(WEBSTREAM_LIBRARY_KEY);
    } catch {
        return null;
    }
}

function writeRaw(value) {
    try {
        localStorage.setItem(WEBSTREAM_LIBRARY_KEY, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {any} raw
 * @returns {{ pageUrl: string, streamUrl: string, kind: string, title: string, host: string, mode: 'media'|'embed', shield: string, addedAt: number } | null}
 */
export function normalizeWebStreamItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const pageUrl = parsePageUrl(raw.pageUrl || raw.url || '');
    const streamUrl = sanitizeStreamUrl(raw.streamUrl || '');
    if (!pageUrl && !streamUrl) return null;
    const host = hostLabel(pageUrl || streamUrl);
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 160) : '';
    return {
        pageUrl,
        streamUrl,
        kind: typeof raw.kind === 'string' && raw.kind
            ? raw.kind
            : classifyStreamUrl(streamUrl),
        title: title || host || 'Web video',
        host,
        mode: raw.mode === 'embed' ? 'embed' : 'media',
        // Only a per-page override is stored; '' means "use the global level".
        shield: isShieldLevel(raw.shield) ? raw.shield : '',
        addedAt: Number.isFinite(Number(raw.addedAt)) ? Number(raw.addedAt) : 0
    };
}

/** @param {any} raw */
export function normalizeWebStreamLibrary(raw) {
    const source = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : []);
    const seen = new Set();
    const items = [];
    for (const entry of source) {
        const item = normalizeWebStreamItem(entry);
        if (!item) continue;
        const id = webstreamKey(item.pageUrl || item.streamUrl, item.streamUrl);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push(item);
        if (items.length >= WEBSTREAM_LIBRARY_LIMIT) break;
    }
    return { items };
}

/** @returns {{ items: ReturnType<typeof normalizeWebStreamItem>[] }} */
export function loadWebStreamLibrary() {
    const raw = readRaw();
    if (!raw) return { items: [] };
    try {
        return normalizeWebStreamLibrary(JSON.parse(raw));
    } catch {
        return { items: [] };
    }
}

/** @param {{ items?: any[] } | any[]} library */
export function saveWebStreamLibrary(library) {
    const normalized = normalizeWebStreamLibrary(library);
    writeRaw(JSON.stringify(normalized));
    return normalized;
}

/** Newest first. */
export function listWebStreamItems() {
    return loadWebStreamLibrary().items
        .slice()
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

/**
 * Insert / refresh an entry.
 * @param {{ pageUrl?: string, streamUrl?: string, kind?: string, title?: string, mode?: string, shield?: string }} entry
 */
export function addWebStreamItem(entry) {
    const item = normalizeWebStreamItem({ ...entry, addedAt: Date.now() });
    if (!item) return null;
    const { items } = loadWebStreamLibrary();
    const id = webstreamKey(item.pageUrl || item.streamUrl, item.streamUrl);
    const next = [item, ...items.filter((existing) => (
        webstreamKey(existing.pageUrl || existing.streamUrl, existing.streamUrl) !== id
    ))];
    saveWebStreamLibrary({ items: next });
    return item;
}

/**
 * Remember a per-page shield level without reordering the library.
 * `''` clears the override (the page falls back to the global setting).
 * @param {{ pageUrl?: string, streamUrl?: string }} ref
 * @param {string} shield
 * @returns {boolean} true when a matching entry was updated
 */
export function setWebStreamItemShield(ref, shield) {
    const pageUrl = parsePageUrl(ref?.pageUrl || '');
    const streamUrl = sanitizeStreamUrl(ref?.streamUrl || '');
    const id = webstreamKey(pageUrl || streamUrl, streamUrl);
    const level = isShieldLevel(shield) ? shield : '';
    if (!id) return false;
    const { items } = loadWebStreamLibrary();
    let changed = false;
    const next = items.map((item) => {
        if (webstreamKey(item.pageUrl || item.streamUrl, item.streamUrl) !== id) return item;
        if (item.shield === level) return item;
        changed = true;
        return { ...item, shield: level };
    });
    if (changed) saveWebStreamLibrary({ items: next });
    return changed;
}

/**
 * @param {{ pageUrl?: string, streamUrl?: string }} ref
 * @returns {boolean} true when an entry was removed
 */
export function removeWebStreamItem(ref) {
    const pageUrl = parsePageUrl(ref?.pageUrl || '');
    const streamUrl = sanitizeStreamUrl(ref?.streamUrl || '');
    const id = webstreamKey(pageUrl || streamUrl, streamUrl);
    if (!id) return false;
    const { items } = loadWebStreamLibrary();
    const next = items.filter((item) => (
        webstreamKey(item.pageUrl || item.streamUrl, item.streamUrl) !== id
    ));
    if (next.length === items.length) return false;
    saveWebStreamLibrary({ items: next });
    return true;
}
