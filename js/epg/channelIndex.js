/**
 * Parse XMLTV channel index and stream-fetch helpers.
 */
import { parseXmltvDate } from './xmltvParser.js';

/**
 * @typedef {{ id: string, names: string[] }} ChannelIndexEntry
 */

/**
 * @param {string} xml
 * @returns {ChannelIndexEntry[]}
 */
export function parseChannelIndex(xml) {
    /** @type {ChannelIndexEntry[]} */
    const out = [];
    if (!xml) return out;
    const re = /<channel\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/channel>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const id = m[1];
        const names = [...m[2].matchAll(/<display-name[^>]*>([^<]+)/gi)]
            .map((x) => x[1].replace(/&amp;/g, '&').trim())
            .filter(Boolean);
        if (id && names.length) out.push({ id, names });
    }
    return out;
}

/**
 * Stream-fetch XML until first programme tag; returns channel-section text.
 * @param {string} url
 * @param {{ gzip?: boolean }} [opts] When true, the response body is gunzipped
 *   on the fly (DecompressionStream) before scanning — e.g. epg.pw's
 *   `epg_CC.xml.gz` index files, which are raw .gz payloads (not
 *   HTTP-level compression, so fetch will not decompress them itself).
 * @returns {Promise<string>}
 */
export async function streamChannelSection(url, { gzip = false } = {}) {
    const controller = new AbortController();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
        controller.abort();
        throw new Error(`HTTP ${res.status}`);
    }
    if (!res.body) {
        const text = await maybeDecompress(await res.arrayBuffer(), gzip ? 'GZIP' : '');
        const idx = text.indexOf('<programme');
        return idx > 0 ? text.slice(0, idx) : text;
    }

    let stream = res.body;
    if (gzip) {
        if (typeof DecompressionStream === 'undefined') throw new Error('gzip not supported');
        stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const idx = buf.indexOf('<programme');
            if (idx >= 0) return buf.slice(0, idx);
        }
        return buf;
    } finally {
        // Stop reading as soon as we have the channel section — abort the fetch
        // itself so the connection is torn down deterministically (a bare
        // reader.cancel() can leave the socket streaming in the background).
        try { controller.abort(); } catch { /* ignore */ }
        try { reader.cancel(); } catch { /* ignore */ }
    }
}

/**
 * @param {ArrayBuffer} buf
 * @param {string} [format]
 * @returns {Promise<string>}
 */
export async function maybeDecompress(buf, format) {
    const fmt = String(format || '').toUpperCase();
    if (fmt !== 'GZIP') return new TextDecoder('utf-8').decode(buf);
    if (typeof DecompressionStream === 'undefined') throw new Error('gzip not supported');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).text();
}

function extractTag(body, tag) {
    const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

/**
 * Extract programmes for one channel id from XMLTV text.
 * @param {string} xml
 * @param {string} channelXmlId
 * @returns {import('./xmltvParser.js').Programme[]}
 */
export function extractProgrammesForId(xml, channelXmlId) {
    if (!xml || !channelXmlId) return [];
    const escaped = channelXmlId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
        `<programme\\s+([^>]*channel=["']${escaped}["'][^>]*)>([\\s\\S]*?)<\\/programme>`,
        'gi'
    );
    /** @type {import('./xmltvParser.js').Programme[]} */
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const body = m[2];
        const startM = attrs.match(/start=["']([^"']+)["']/i);
        const stopM = attrs.match(/stop=["']([^"']+)["']/i);
        const title = extractTag(body, 'title');
        if (!startM || !stopM || !title) continue;
        const start = parseXmltvDate(startM[1]);
        const stop = parseXmltvDate(stopM[1]);
        if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
        out.push({
            channelId: channelXmlId,
            title,
            start,
            stop,
            desc: extractTag(body, 'desc') || undefined
        });
    }
    out.sort((a, b) => a.start - b.start);
    return out;
}

/**
 * Load full feed text (decompress if gzip).
 * @param {string} url
 * @param {string} format
 */
export async function fetchFeedText(url, format) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return maybeDecompress(buf, format);
}

/**
 * @param {Error|unknown} err
 */
export function isCorsError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return err instanceof TypeError
        || msg.includes('failed to fetch')
        || msg.includes('networkerror')
        || msg.includes('cors');
}
