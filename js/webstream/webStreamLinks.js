/**
 * Web Video helpers — pure, DOM-free URL logic shared by the picker, the
 * resolver, the sniffer, the hls.js proxy loader and the mosaic mixin.
 *
 * A "webstream" tile plays a direct media URL (HLS / progressive) that was
 * either pasted straight in or extracted, best-effort, from any web page.
 * Provider id `webstream` keeps these tiles out of iptv-org lookups, recents
 * and last-channel bookkeeping.
 */

import { isShieldLevel } from './webShield.js';

/** Provider id used in mosaic channel keys for Web Video tiles. */
export const WEBSTREAM_PROVIDER_ID = 'webstream';

/** Human label shown in chrome / pickers / toasts. */
export const WEBSTREAM_LABEL = 'Web Video';

/** Direct-playable extension → player kind. */
const MEDIA_EXTENSIONS = {
    '.m3u8': 'hls',
    '.m3u': 'hls',
    '.mp4': 'video',
    '.m4v': 'video',
    '.webm': 'video',
    '.ogv': 'video',
    '.ogg': 'video',
    '.mov': 'video'
};

/** Extensions we recognise but cannot play in a browser. */
const UNSUPPORTED_EXTENSIONS = ['.mpd', '.ism', '.f4m'];

function safeUrl(input) {
    if (typeof input !== 'string') return null;
    const raw = input.trim();
    if (!raw) return null;
    try {
        return new URL(raw.includes('://') ? raw : `https://${raw}`);
    } catch {
        return null;
    }
}

/**
 * Normalize a page URL typed/pasted by the user.
 * Accepts `example.com/watch`, adds https://, rejects non-http(s) schemes.
 * @param {string} input
 * @returns {string} absolute http(s) URL or ''
 */
export function parsePageUrl(input) {
    const url = safeUrl(input);
    if (!url) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname || !url.hostname.includes('.')) return '';
    url.hash = '';
    return url.toString();
}

/**
 * Normalize a media URL found in a page (strips HTML/JSON escaping).
 * @param {string} input
 * @returns {string}
 */
export function sanitizeStreamUrl(input) {
    if (typeof input !== 'string') return '';
    const raw = input
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/&amp;/g, '&');
    if (!raw) return '';
    if (/^(data|blob|javascript|file):/i.test(raw)) return '';
    let url;
    try {
        url = new URL(raw);
    } catch {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname) return '';
    return url.toString();
}

/**
 * Classify a URL by its extension: 'hls', 'video' or '' (unknown).
 * @param {string} input
 * @returns {'hls' | 'video' | ''}
 */
export function classifyStreamUrl(input) {
    const url = sanitizeStreamUrl(input);
    if (!url) return '';
    let pathname = '';
    try {
        pathname = new URL(url).pathname.toLowerCase();
    } catch {
        return '';
    }
    for (const ext of UNSUPPORTED_EXTENSIONS) {
        if (pathname.endsWith(ext)) return '';
    }
    for (const [ext, kind] of Object.entries(MEDIA_EXTENSIONS)) {
        if (pathname.endsWith(ext)) return kind;
    }
    // Some live endpoints hide the extension in a query parameter
    // (`/stream?format=.m3u8`, `?type=hls`).
    if (url.toLowerCase().includes('.m3u8')) return 'hls';
    return '';
}

/** True when the URL can be handed straight to the player. */
export function isDirectMediaUrl(input) {
    return classifyStreamUrl(input) !== '';
}

/**
 * True for manifest formats a browser tab cannot play (DASH / Smooth / HDS).
 * They would otherwise look like "a page" and get scraped pointlessly.
 * @param {string} input
 * @returns {boolean}
 */
export function isUnsupportedMediaUrl(input) {
    const url = sanitizeStreamUrl(input);
    if (!url) return false;
    let pathname = '';
    try {
        pathname = new URL(url).pathname.toLowerCase();
    } catch {
        return false;
    }
    return UNSUPPORTED_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

/** Host label for chrome / library rows (`www.` stripped). */
export function hostLabel(input) {
    const url = safeUrl(input);
    if (!url) return '';
    return url.hostname.replace(/^www\./i, '');
}

/** Short, stable FNV-1a hash (base36) used for channel ids. */
export function shortHash(input, length = 8) {
    const text = String(input || '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).padStart(length, '0').slice(-length);
}

/**
 * Stable channel id for a page/stream pair (survives reloads and re-resolution,
 * so a restored tile keeps the same slot entry).
 * @param {string} pageUrl
 * @param {string} [streamUrl]
 * @returns {string}
 */
export function webstreamChannelId(pageUrl, streamUrl = '') {
    const page = parsePageUrl(pageUrl) || sanitizeStreamUrl(pageUrl);
    const stream = sanitizeStreamUrl(streamUrl);
    const seed = page || stream;
    if (!seed) return '';
    return `ws_${shortHash(seed)}`;
}

/**
 * Mosaic channel key for a Web Video tile (`webstream:ws_xxxx`).
 * @param {string} pageUrl
 * @param {string} [streamUrl]
 * @returns {string}
 */
export function webstreamKey(pageUrl, streamUrl = '') {
    const id = webstreamChannelId(pageUrl, streamUrl);
    return id ? `${WEBSTREAM_PROVIDER_ID}:${id}` : '';
}

/**
 * Build the synthetic channel object the normal mosaic player consumes.
 * `providerId` is not in the TV registry, so no provider lookup happens; the
 * player only needs `channelId`, `name` and `url_resolved`.
 * @param {{ pageUrl?: string, streamUrl: string, kind?: string, name?: string, proxyTemplate?: string, proxied?: boolean }} spec
 * @returns {object | null}
 */
export function webstreamChannel({
    pageUrl = '',
    streamUrl,
    kind = '',
    name = '',
    proxyTemplate = '',
    proxied = false
} = {}) {
    const url = sanitizeStreamUrl(streamUrl);
    if (!url) return null;
    const page = parsePageUrl(pageUrl);
    const streamKind = kind || classifyStreamUrl(url);
    const id = webstreamChannelId(page || url, url);
    if (!id) return null;
    const label = (typeof name === 'string' && name.trim())
        || (page ? hostLabel(page) : '')
        || hostLabel(url)
        || WEBSTREAM_LABEL;
    const channel = {
        providerId: WEBSTREAM_PROVIDER_ID,
        channelId: id,
        channeluuid: `${WEBSTREAM_PROVIDER_ID}:${id}`,
        name: label,
        url_resolved: url,
        logo: '',
        countrycode: '',
        categories: [],
        tags: ''
    };
    if (streamKind) channel.streamKind = streamKind;
    if (page) channel.webStreamPageUrl = page;
    if (proxied && proxyTemplate) channel.proxyTemplate = proxyTemplate;
    return channel;
}

/** True for a mosaic slot entry that carries Web Video mode. */
export function isWebStreamEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.kind === 'webstream') return true;
    return entry.providerId === WEBSTREAM_PROVIDER_ID;
}

/**
 * Read a persisted Web Video slot entry.
 * @param {any} entry
 * @returns {{ pageUrl: string, streamUrl: string, kind: string, name: string, channelId: string } | null}
 */
export function webStreamEntryConfig(entry) {
    if (!isWebStreamEntry(entry)) return null;
    const pageUrl = parsePageUrl(entry.pageUrl || entry.webStreamPageUrl || '');
    const streamUrl = sanitizeStreamUrl(entry.streamUrl || entry.url_resolved || '');
    if (!pageUrl && !streamUrl) return null;
    return {
        pageUrl,
        streamUrl,
        kind: typeof entry.streamKind === 'string' ? entry.streamKind : classifyStreamUrl(streamUrl),
        name: typeof entry.name === 'string' ? entry.name : '',
        // '' = no per-page override, the global setting decides.
        shield: isShieldLevel(entry.shield) ? entry.shield : '',
        channelId: typeof entry.channelId === 'string' && entry.channelId
            ? entry.channelId
            : webstreamChannelId(pageUrl || streamUrl, streamUrl)
    };
}

/**
 * Validate a user-supplied proxy template.
 * Supported tokens: `{url}` (raw) and `{url_encoded}` (URI-encoded).
 * @param {string} input
 * @returns {string} normalized template or ''
 */
export function normalizeProxyTemplate(input) {
    if (typeof input !== 'string') return '';
    const template = input.trim();
    if (!template) return '';
    if (!template.includes('{url}') && !template.includes('{url_encoded}')) return '';
    const probe = template
        .replace(/\{url_encoded\}/g, encodeURIComponent('https://example.com/a.m3u8'))
        .replace(/\{url\}/g, 'https://example.com/a.m3u8');
    const url = safeUrl(probe);
    if (!url) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return template;
}

/**
 * Wrap a media/page URL with the proxy template.
 * @param {string} template
 * @param {string} url
 * @returns {string}
 */
export function applyProxyTemplate(template, url) {
    const normalized = normalizeProxyTemplate(template);
    const target = sanitizeStreamUrl(url);
    if (!normalized || !target) return '';
    return normalized
        .replace(/\{url_encoded\}/g, encodeURIComponent(target))
        .replace(/\{url\}/g, target);
}

/**
 * Best candidate from a mixed list, best first.
 * HLS wins (multi-quality / live), then progressive video. `master` /
 * `playlist` / `index` names get a nudge over raw segment lists.
 * @param {Array<{ url: string, kind?: string } | string>} candidates
 * @returns {{ url: string, kind: string } | null}
 */
export function pickBestStream(candidates) {
    if (!Array.isArray(candidates)) return null;
    const seen = new Set();
    let best = null;
    let bestScore = -Infinity;
    for (const entry of candidates) {
        const url = sanitizeStreamUrl(typeof entry === 'string' ? entry : entry?.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const kind = classifyStreamUrl(url) || (entry?.kind === 'hls' ? 'hls' : '');
        if (!kind) continue;
        let score = kind === 'hls' ? 6 : 3;
        if (url.startsWith('https://')) score += 1;
        if (/master|playlist|index/i.test(url)) score += 1;
        if (/\/seg|chunk|frag/i.test(url)) score -= 2;
        if (score > bestScore) {
            bestScore = score;
            best = { url, kind };
        }
    }
    return best;
}

/**
 * Human-readable reason for a resolver status.
 * @param {'resolved'|'embed'|'needs-sniff'|'blocked'|'drm'|'unsupported'|'invalid'} status
 * @returns {string}
 */
export function webStreamStatusMessage(status) {
    switch (status) {
        case 'resolved':
            return '';
        case 'embed':
            return 'No direct video file was found — the page can still be embedded below.';
        case 'needs-sniff':
            return 'This site blocks in-app requests (CORS). Use the sniffer to read its media URLs.';
        case 'blocked':
            return 'The page refused the request. Try the sniffer or paste a direct .m3u8 / .mp4 link.';
        case 'drm':
            return 'This stream is DRM-protected (Widevine/PlayReady/FairPlay). Browsers cannot play it outside its own app.';
        case 'unsupported':
            return 'That link type is not playable in a browser tab. Paste a direct .m3u8 or .mp4 URL.';
        case 'invalid':
            return 'Paste a full page URL (https://…) or a direct .m3u8 / .mp4 link.';
        default:
            return 'Could not resolve this link.';
    }
}
