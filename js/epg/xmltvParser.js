/**
 * XMLTV parsing — works in browser (DOMParser) and Node (regex fallback).
 */

/** @typedef {{ channelId: string, title: string, start: number, stop: number, desc?: string }} Programme */

/**
 * Parse XMLTV datetime: "20250822120000 +0000" or "20250822120000".
 * @param {string} raw
 * @returns {number}
 */
export function parseXmltvDate(raw) {
    if (!raw || typeof raw !== 'string') return NaN;
    const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
    if (!m) return NaN;
    const [, y, mo, d, h, mi, s, tz = '+0000'] = m;
    const sign = tz[0] === '-' ? -1 : 1;
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(3, 5), 10);
    const offsetMs = sign * (tzH * 60 + tzM) * 60 * 1000;
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMs;
    return utc;
}

/**
 * Local calendar day bounds [startMs, endMs).
 * @param {number} [refMs]
 * @param {number} [dayOffset] 0 = today, 1 = tomorrow
 */
export function localDayBounds(refMs = Date.now(), dayOffset = 0) {
    const d = new Date(refMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    const start = d.getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
}

/**
 * Programmes overlapping [dayStart, dayEnd).
 * @param {Programme[]} programmes
 * @param {number} dayStart
 * @param {number} dayEnd
 */
export function programmesForDay(programmes, dayStart, dayEnd) {
    if (!Array.isArray(programmes)) return [];
    return programmes.filter((p) => p.stop > dayStart && p.start < dayEnd);
}

/**
 * @param {Programme[]} programmes
 * @param {number} [nowMs]
 */
export function pickNowNext(programmes, nowMs = Date.now()) {
    const sorted = [...(programmes || [])].sort((a, b) => a.start - b.start);
    let current = null;
    let next = null;
    for (const p of sorted) {
        if (p.start <= nowMs && p.stop > nowMs) current = p;
        else if (p.start > nowMs && !next) {
            next = p;
            break;
        }
    }
    if (!next) {
        next = sorted.find((p) => p.start > nowMs) || null;
    }
    return { current, next };
}

function extractAttr(attrs, name) {
    const re = new RegExp(`${name}=["']([^"']*)["']`, 'i');
    const m = attrs.match(re);
    return m ? m[1] : '';
}

function extractTagContent(block, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(re);
    if (!m) return '';
    return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
}

/**
 * Regex-based XMLTV parse (Node-safe).
 * @param {string} xml
 * @returns {Map<string, Programme[]>}
 */
export function parseXmltvRegex(xml) {
    /** @type {Map<string, Programme[]>} */
    const byChannel = new Map();
    if (!xml || typeof xml !== 'string') return byChannel;

    const re = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const body = m[2];
        const channelId = extractAttr(attrs, 'channel');
        const start = parseXmltvDate(extractAttr(attrs, 'start'));
        const stop = parseXmltvDate(extractAttr(attrs, 'stop'));
        const title = extractTagContent(body, 'title');
        if (!channelId || !Number.isFinite(start) || !Number.isFinite(stop) || !title) continue;

        const prog = { channelId, title, start, stop, desc: extractTagContent(body, 'desc') || undefined };
        if (!byChannel.has(channelId)) byChannel.set(channelId, []);
        byChannel.get(channelId).push(prog);
    }

    for (const list of byChannel.values()) {
        list.sort((a, b) => a.start - b.start);
    }
    return byChannel;
}

/**
 * DOMParser-based parse (browser).
 * @param {string} xml
 * @returns {Map<string, Programme[]>}
 */
export function parseXmltvDom(xml) {
    /** @type {Map<string, Programme[]>} */
    const byChannel = new Map();
    if (typeof DOMParser === 'undefined') return parseXmltvRegex(xml);

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const nodes = doc.querySelectorAll('programme');
    nodes.forEach((node) => {
        const channelId = node.getAttribute('channel') || '';
        const start = parseXmltvDate(node.getAttribute('start') || '');
        const stop = parseXmltvDate(node.getAttribute('stop') || '');
        const titleEl = node.querySelector('title');
        const title = titleEl?.textContent?.trim() || '';
        const descEl = node.querySelector('desc');
        const desc = descEl?.textContent?.trim() || undefined;
        if (!channelId || !Number.isFinite(start) || !Number.isFinite(stop) || !title) return;

        const prog = { channelId, title, start, stop, desc };
        if (!byChannel.has(channelId)) byChannel.set(channelId, []);
        byChannel.get(channelId).push(prog);
    });

    for (const list of byChannel.values()) {
        list.sort((a, b) => a.start - b.start);
    }
    return byChannel;
}

/** @param {string} xml */
export function parseXmltv(xml) {
    return parseXmltvDom(xml);
}

/**
 * Resolve programmes for an iptv-org channel id using feed aliases.
 * @param {Map<string, Programme[]>} byChannel
 * @param {string} channelId
 * @param {string} [feed]
 */
export function programmesForChannel(byChannel, channelId, feed) {
    if (!byChannel || !channelId) return [];

    const candidates = [channelId];
    if (feed) {
        candidates.push(`${channelId}@${feed}`);
        candidates.push(`${channelId}.${feed}`);
    }

    for (const id of candidates) {
        const list = byChannel.get(id);
        if (list?.length) return list;
    }

    // Case-insensitive fallback
    const lower = channelId.toLowerCase();
    for (const [id, list] of byChannel.entries()) {
        if (id.toLowerCase() === lower || id.toLowerCase().startsWith(`${lower}@`)) {
            return list;
        }
    }
    return [];
}

/**
 * @param {number} ms
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
export function formatProgrammeTime(ms, opts = { hour: '2-digit', minute: '2-digit' }) {
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString(undefined, opts);
}
