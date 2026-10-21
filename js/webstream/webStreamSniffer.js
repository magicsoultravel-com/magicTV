/**
 * Sniff tab — reads the media URLs a site actually requests, from inside that
 * site's own origin (so CORS and cookie walls do not apply).
 *
 * Flow: the picker opens the target page in a popup and hands the user a
 * bookmarklet. Clicking it on the target page reports every `.m3u8` / `.mp4`
 * resource back here via `postMessage` (and copies the same JSON to the
 * clipboard as a manual fallback).
 */
import { classifyStreamUrl } from './webStreamLinks.js';

export const SNIFF_MESSAGE_TYPE = 'magictv:webstream-sniff';
export const SNIFF_MESSAGE_VERSION = 1;

/** Media URL filter used inside the target page. */
const SNIFF_URL_RE = /\.m3u8|\.mp4|\.webm|\.m4v|\.ogv|\.m3u(?:$|\?)/i;

/**
 * Source of the bookmarklet. Deliberately ES5 so it survives old site CSP and
 * minification-free pasting into a bookmark URL field.
 */
const SNIFFER_SOURCE = `(function(){var TYPE='${SNIFF_MESSAGE_TYPE}';var found=[];function push(u){if(u)found.push(String(u));}
try{performance.getEntriesByType('resource').forEach(function(e){push(e.name);});}catch(e){}
try{var media=document.querySelectorAll('video,audio,source');for(var i=0;i<media.length;i++){push(media[i].currentSrc);push(media[i].src);}}catch(e){}
try{var frames=document.querySelectorAll('iframe');for(var j=0;j<frames.length;j++){push(frames[j].src);}}catch(e){}
var seen={},urls=[];for(var k=0;k<found.length;k++){var u=found[k];if(!u||!${SNIFF_URL_RE.toString()}.test(u))continue;if(seen[u])continue;seen[u]=1;urls.push(u);}
var payload={type:TYPE,version:${SNIFF_MESSAGE_VERSION},pageUrl:location.href,title:document.title||'',urls:urls};
try{if(window.opener&&!window.opener.closed)window.opener.postMessage(payload,'*');}catch(e){}
try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(JSON.stringify(payload));}catch(e){}
alert('magicTV sniff: '+urls.length+' media URL'+(urls.length===1?'':'s')+' found'+(urls.length?' (also copied to the clipboard).':' — press play on the page first, then sniff again.'));})();`;

/** `javascript:` URL for a bookmark / drag target. */
export function buildSnifferBookmarklet() {
    return `javascript:${encodeURIComponent(SNIFFER_SOURCE)}`;
}

/** Raw bookmarklet source (tests / copy-to-clipboard). */
export function snifferSource() {
    return SNIFFER_SOURCE;
}

/**
 * Parse a `postMessage` payload from the sniffer.
 * @param {any} data
 * @returns {{ pageUrl: string, title: string, candidates: { url: string, kind: string }[] } | null}
 */
export function parseSniffMessage(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.type !== SNIFF_MESSAGE_TYPE) return null;
    if (Number(data.version) !== SNIFF_MESSAGE_VERSION) return null;
    const urls = Array.isArray(data.urls) ? data.urls : [];
    const seen = new Set();
    const candidates = [];
    for (const raw of urls) {
        if (typeof raw !== 'string') continue;
        const kind = classifyStreamUrl(raw);
        if (!kind) continue;
        const url = raw.trim();
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push({ url, kind });
        if (candidates.length >= 60) break;
    }
    return {
        pageUrl: typeof data.pageUrl === 'string' ? data.pageUrl : '',
        title: typeof data.title === 'string' ? data.title.trim().slice(0, 160) : '',
        candidates
    };
}

/**
 * Pull media URLs out of pasted text / clipboard JSON (manual fallback).
 * @param {string} text
 * @returns {{ url: string, kind: string }[]}
 */
export function parseSniffText(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const seen = new Set();
    const out = [];
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
        const url = match[0].replace(/[,;]+$/, '');
        const kind = classifyStreamUrl(url);
        if (!kind || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, kind });
        if (out.length >= 60) break;
    }
    return out;
}

/** @type {{ pageUrl: string, title: string, candidates: { url: string, kind: string }[] } | null} */
let lastReport = null;
/** @type {((report: ReturnType<typeof parseSniffMessage>) => void)[]} */
const listeners = [];
/** Popup we opened for sniffing — only it may post reports back. */
let sniffWindow = null;
let bound = false;

function onMessage(event) {
    // When we opened the popup, ignore reports from any other source.
    if (sniffWindow && event?.source && event.source !== sniffWindow) return;
    const report = parseSniffMessage(event?.data);
    if (!report || !report.candidates.length) return;
    lastReport = report;
    for (const fn of listeners.slice()) {
        try { fn(report); } catch { /* ignore */ }
    }
}

/**
 * Listen for sniffer reports (once per page load).
 * @param {(report: NonNullable<ReturnType<typeof parseSniffMessage>>) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onSniffReport(fn) {
    if (typeof fn !== 'function') return () => {};
    if (!bound && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        bound = true;
        window.addEventListener('message', onMessage);
    }
    listeners.push(fn);
    return () => {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
    };
}

/** Latest report received this session (used when the picker reopens). */
export function lastSniffReport() {
    return lastReport;
}

/**
 * Open the target page in a popup that keeps `window.opener`, so the
 * bookmarklet can post back. Returns false when the popup was blocked.
 * @param {string} pageUrl
 * @returns {boolean}
 */
export function openSniffTarget(pageUrl) {
    if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
    if (!pageUrl) return false;
    try {
        const win = window.open(pageUrl, 'magictv_webstream_sniff');
        if (!win) return false;
        sniffWindow = win;
        try { win.focus?.(); } catch { /* ignore */ }
        return true;
    } catch {
        return false;
    }
}
