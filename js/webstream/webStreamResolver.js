/**
 * Client-only "find the video on this page" resolver.
 *
 * Ladder (best effort, no backend required):
 *   0. the pasted URL is already a direct .m3u8 / .mp4          → resolved
 *   1. same-origin (`fetch` + CORS) scrape of the page HTML      → resolved
 *   1b. the same scrape through an optional user proxy template  → resolved
 *   2. page still unreadable                                     → needs-sniff
 *   3. no media but an embeddable player iframe exists           → embed
 *   4. DRM-protected page                                        → drm (refuse)
 *
 * Nothing here touches the DOM, so it can be unit-tested in Node.
 */
import {
    applyProxyTemplate,
    classifyStreamUrl,
    isUnsupportedMediaUrl,
    parsePageUrl,
    pickBestStream,
    sanitizeStreamUrl,
    webStreamStatusMessage
} from './webStreamLinks.js';

/** Media-looking attribute values (`src`, `file`, `contentUrl`, …). */
const ATTR_RE = /(?:src|data-src|data-file|file|url|contentUrl|videoUrl)\s*[:=]\s*["']([^"']+)["']/gi;
/** Any absolute http(s) URL in the page source. */
const ABSOLUTE_RE = /https?:\/\/[^\s"'<>\\]+/gi;
/** `<iframe src>` — embed fallback. */
const IFRAME_RE = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
/** DRM markers that mean "a browser tab cannot play this". */
const DRM_RE = /widevine|playready|fairplay|clearkey|licenseurl|drmtoday|axinom/i;

function unescapeHtml(text) {
    return String(text || '')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x2F;/gi, '/');
}

function absoluteFrom(raw, baseUrl) {
    if (typeof raw !== 'string') return '';
    const value = raw.trim();
    if (!value || /^(data|blob|javascript|about|mailto):/i.test(value)) return '';
    try {
        return sanitizeStreamUrl(new URL(value, baseUrl).toString());
    } catch {
        return '';
    }
}

/**
 * Pull every plausible media URL out of a page's HTML.
 * @param {string} html
 * @param {string} baseUrl page URL (used to resolve relative src values)
 * @returns {{ url: string, kind: 'hls'|'video', source: string }[]}
 */
export function extractStreamCandidates(html, baseUrl) {
    const page = parsePageUrl(baseUrl) || sanitizeStreamUrl(baseUrl);
    if (!html || !page) return [];
    const text = unescapeHtml(html);
    const found = new Map();

    const add = (raw, source) => {
        const url = absoluteFrom(raw, page);
        if (!url) return;
        const kind = classifyStreamUrl(url);
        if (!kind) return;
        const key = url.split('#')[0];
        if (found.has(key)) return;
        found.set(key, { url, kind, source });
    };

    // `<video src>` / `<source src>` / inline player config (`file: "…"`).
    for (const match of text.matchAll(ATTR_RE)) add(match[1], 'page');
    // Bare absolute URLs (JSON blobs, escaped manifests, preload hints).
    for (const match of text.matchAll(ABSOLUTE_RE)) {
        add(match[0].replace(/[,;]+$/, ''), 'page');
        if (found.size > 400) break;
    }

    return [...found.values()].slice(0, 120);
}

/**
 * Embeddable page URLs (rung 4).
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function extractFrameCandidates(html, baseUrl) {
    const page = parsePageUrl(baseUrl) || sanitizeStreamUrl(baseUrl);
    if (!html || !page) return [];
    const text = unescapeHtml(html);
    const out = [];
    const seen = new Set();
    for (const match of text.matchAll(IFRAME_RE)) {
        const url = absoluteFrom(match[1], page);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
        if (out.length >= 8) break;
    }
    return out;
}

/** True when the page advertises a DRM system we cannot play. */
export function detectDrm(html) {
    if (typeof html !== 'string' || !html) return false;
    return DRM_RE.test(html);
}

function withTimeout(promise, timeoutMs) {
    if (!(timeoutMs > 0)) return promise;
    let timer = 0;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fetch a page as text (credentials omitted so no cookies leak cross-origin).
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, html: string, reason: 'network'|'http'|'' }>}
 */
export async function fetchPageHtml(url, { fetchImpl, timeoutMs = 8000 } = {}) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return { ok: false, status: 0, html: '', reason: 'network' };
    try {
        const response = await withTimeout(doFetch(url, {
            credentials: 'omit',
            redirect: 'follow',
            headers: { Accept: 'text/html,application/xhtml+xml' }
        }), timeoutMs);
        const status = Number(response?.status) || 0;
        if (!response?.ok) return { ok: false, status, html: '', reason: 'http' };
        const html = await withTimeout(Promise.resolve(response.text()), timeoutMs);
        return { ok: true, status, html: typeof html === 'string' ? html : '', reason: '' };
    } catch {
        // TypeError = CORS/network. Timeouts/aborts land here too.
        return { ok: false, status: 0, html: '', reason: 'network' };
    }
}

/**
 * @typedef {object} WebStreamResolution
 * @property {'resolved'|'embed'|'needs-sniff'|'blocked'|'drm'|'unsupported'|'invalid'} status
 * @property {string} pageUrl
 * @property {string} url        best playable URL ('' unless resolved)
 * @property {'hls'|'video'|''} kind
 * @property {{ url: string, kind: string, source: string }[]} candidates
 * @property {string[]} frames   embeddable iframe URLs
 * @property {boolean} viaProxy
 * @property {string} message
 */

/**
 * Resolve a pasted link all the way down the ladder.
 * @param {string} input
 * @param {{ fetchImpl?: typeof fetch, proxyTemplate?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<WebStreamResolution>}
 */
export async function resolveWebStream(input, { fetchImpl, proxyTemplate = '', timeoutMs = 8000 } = {}) {
    const direct = sanitizeStreamUrl(input);
    const directKind = classifyStreamUrl(direct);

    // Rung 0 — the pasted string is already a media file.
    if (direct && directKind) {
        return {
            status: 'resolved',
            pageUrl: '',
            url: direct,
            kind: directKind,
            candidates: [{ url: direct, kind: directKind, source: 'direct' }],
            frames: [],
            viaProxy: false,
            message: ''
        };
    }

    const pageUrl = parsePageUrl(input);
    if (isUnsupportedMediaUrl(direct)) {
        return {
            status: 'unsupported',
            pageUrl: '',
            url: '',
            kind: '',
            candidates: [],
            frames: [],
            viaProxy: false,
            message: webStreamStatusMessage('unsupported')
        };
    }
    if (!pageUrl) {
        const status = direct ? 'unsupported' : 'invalid';
        return {
            status,
            pageUrl: '',
            url: '',
            kind: '',
            candidates: [],
            frames: [],
            viaProxy: false,
            message: webStreamStatusMessage(status)
        };
    }

    // Rung 1 / 1b — scrape it ourselves (direct first, then through the proxy).
    const attempts = [{ url: pageUrl, viaProxy: false }];
    const proxied = applyProxyTemplate(proxyTemplate, pageUrl);
    if (proxied && proxied !== pageUrl) attempts.push({ url: proxied, viaProxy: true });

    let blocked = false;
    for (const attempt of attempts) {
        const result = await fetchPageHtml(attempt.url, { fetchImpl, timeoutMs });
        if (!result.ok) {
            if (result.reason === 'http') blocked = true;
            continue;
        }
        const html = result.html;
        const candidates = extractStreamCandidates(html, pageUrl);
        const frames = extractFrameCandidates(html, pageUrl);
        if (detectDrm(html)) {
            return {
                status: 'drm',
                pageUrl,
                url: '',
                kind: '',
                candidates,
                frames,
                viaProxy: attempt.viaProxy,
                message: webStreamStatusMessage('drm')
            };
        }
        const best = pickBestStream(candidates);
        if (best) {
            return {
                status: 'resolved',
                pageUrl,
                url: best.url,
                kind: best.kind,
                candidates,
                frames,
                viaProxy: attempt.viaProxy,
                message: ''
            };
        }
        // Rung 4 — no media, but the page's own player can be embedded.
        if (frames.length) {
            return {
                status: 'embed',
                pageUrl,
                url: '',
                kind: '',
                candidates,
                frames,
                viaProxy: attempt.viaProxy,
                message: webStreamStatusMessage('embed')
            };
        }
    }

    // Rung 2 — hand off to the sniffer (it runs inside the page's own origin).
    const status = blocked ? 'blocked' : 'needs-sniff';
    return {
        status,
        pageUrl,
        url: '',
        kind: '',
        candidates: [],
        frames: [],
        viaProxy: false,
        message: webStreamStatusMessage(status)
    };
}

/**
 * Turn a resolved candidate into the arguments `playWebStream()` expects,
 * optionally routing playback through the proxy (with an explicit HLS hint so
 * the player does not have to guess from the proxy URL's extension).
 * @param {{ pageUrl?: string, url: string, kind?: string }} candidate
 * @param {{ proxyTemplate?: string, useProxy?: boolean, title?: string }} [opts]
 */
export function buildPlaybackSpec(candidate, { proxyTemplate = '', useProxy = false, title = '' } = {}) {
    const original = sanitizeStreamUrl(candidate?.url);
    if (!original) return null;
    const kind = candidate?.kind || classifyStreamUrl(original);
    const proxied = useProxy ? applyProxyTemplate(proxyTemplate, original) : '';
    return {
        pageUrl: parsePageUrl(candidate?.pageUrl || ''),
        streamUrl: proxied || original,
        kind,
        title: typeof title === 'string' ? title : '',
        proxyTemplate: proxied ? proxyTemplate : '',
        proxied: Boolean(proxied)
    };
}
