/**
 * epg.pw provider — stream channel index + per-channel JSON API.
 */
import { epgPwFeedCode } from '../countryFeedMap.js';
import { matchChannelByName } from '../nameMatch.js';
import { parseChannelIndex, streamChannelSection } from '../channelIndex.js';
import {
    getChannelIndexCache, setChannelIndexCache,
    getMappingCache, setMappingCache
} from '../epgStore.js';
import { programmesForDay, localDayBounds } from '../xmltvParser.js';
import { channelKey } from '../../tvProviders/channelShape.js';

/** @type {Map<string, import('../nameMatch.js').ChannelIndexEntry[]>} */
const sessionIndex = new Map();
/** @type {Map<string, Promise<import('../nameMatch.js').ChannelIndexEntry[]>>>} */
const inflightIndex = new Map();

function dateStrFromMs(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${mo}${day}`;
}

/**
 * @param {string} feedCode
 */
async function loadIndex(feedCode) {
    const cacheKey = `epg-pw:${feedCode}`;
    if (sessionIndex.has(cacheKey)) return sessionIndex.get(cacheKey);

    const cached = await getChannelIndexCache(cacheKey);
    if (cached?.length) {
        sessionIndex.set(cacheKey, cached);
        return cached;
    }

    if (inflightIndex.has(cacheKey)) return inflightIndex.get(cacheKey);

    const promise = (async () => {
        const url = `https://epg.pw/xmltv/epg_${feedCode}.xml`;
        const head = await streamChannelSection(url);
        const index = parseChannelIndex(head);
        sessionIndex.set(cacheKey, index);
        await setChannelIndexCache(cacheKey, index);
        return index;
    })().finally(() => inflightIndex.delete(cacheKey));

    inflightIndex.set(cacheKey, promise);
    return promise;
}

/**
 * @param {string} epgPwId
 * @param {string} dateStr
 */
async function fetchEpgPwDay(epgPwId, dateStr) {
    const url = `https://epg.pw/api/epg.json?channel_id=${encodeURIComponent(epgPwId)}&date=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`epg.pw API HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.epg_list) ? data.epg_list : [];
    /** @type {import('../xmltvParser.js').Programme[]} */
    const programmes = list.map((item, i) => {
        const start = new Date(item.start_date).getTime();
        const next = list[i + 1];
        const stop = next
            ? new Date(next.start_date).getTime()
            : start + 3600000;
        return {
            channelId: String(epgPwId),
            title: item.title || 'Unknown',
            start,
            stop,
            desc: item.desc || undefined
        };
    }).filter((p) => Number.isFinite(p.start));
    return programmes;
}

/**
 * @param {object} channel
 * @param {number} dayOffset
 * @param {number} nowMs
 */
async function resolveForChannel(channel, dayOffset, nowMs) {
    const feedCode = epgPwFeedCode(channel.countrycode);
    if (!feedCode) return { status: 'no-source', tried: ['epg-pw: no feed for country'] };

    const key = channelKey(channel);
    const mapKey = `epg-pw:${key}`;
    let mapping = await getMappingCache(mapKey);

    if (!mapping?.epgPwId) {
        const index = await loadIndex(feedCode);
        const hit = matchChannelByName(channel.name, index);
        if (!hit) return { status: 'miss', tried: ['epg-pw: no name match'] };
        mapping = {
            epgPwId: hit.id,
            matchedName: hit.matchedName,
            source: 'epg.pw',
            feedCode
        };
        await setMappingCache(mapKey, mapping);
    }

    const bounds = localDayBounds(nowMs, dayOffset);
    const dateStr = dateStrFromMs(bounds.start);
    const dayProgs = await fetchEpgPwDay(mapping.epgPwId, dateStr);

    return {
        status: 'ok',
        programmes: dayProgs,
        source: 'epg.pw',
        matchedName: mapping.matchedName,
        tried: ['epg-pw: ok']
    };
}

export const epgPwProvider = {
    id: 'epg-pw',

    supports(channel) {
        return Boolean(epgPwFeedCode(channel?.countrycode));
    },

    async resolveProgrammes(channel, opts = {}) {
        const nowMs = opts.nowMs ?? Date.now();
        const dayOffset = opts.dayOffset ?? 0;
        try {
            const result = await resolveForChannel(channel, dayOffset, nowMs);
            if (result.status !== 'ok') return result;

            if (dayOffset === 0) {
                const allDays = [];
                const today = await resolveForChannel(channel, 0, nowMs);
                if (today.status === 'ok') allDays.push(...today.programmes);
                return { ...result, programmes: allDays.length ? allDays : result.programmes };
            }
            return result;
        } catch (e) {
            return { status: 'error', message: e?.message || 'epg.pw failed', tried: ['epg-pw: error'] };
        }
    }
};

/** Fetch today + tomorrow programmes merged (for schedule views). */
export async function fetchEpgPwProgrammes(channel, nowMs = Date.now()) {
    const feedCode = epgPwFeedCode(channel?.countrycode);
    if (!feedCode) return { status: 'no-source' };

    const key = channelKey(channel);
    const mapKey = `epg-pw:${key}`;
    let mapping = await getMappingCache(mapKey);

    if (!mapping?.epgPwId) {
        const index = await loadIndex(feedCode);
        const hit = matchChannelByName(channel.name, index);
        if (!hit) return { status: 'miss', tried: ['epg-pw: no name match'] };
        mapping = { epgPwId: hit.id, matchedName: hit.matchedName, source: 'epg.pw', feedCode };
        await setMappingCache(mapKey, mapping);
    }

    const todayStr = dateStrFromMs(localDayBounds(nowMs, 0).start);
    const tomorrowStr = dateStrFromMs(localDayBounds(nowMs, 1).start);
    const [today, tomorrow] = await Promise.all([
        fetchEpgPwDay(mapping.epgPwId, todayStr),
        fetchEpgPwDay(mapping.epgPwId, tomorrowStr)
    ]);

    const programmes = [...today, ...tomorrow];
    return {
        status: 'ok',
        programmes,
        source: 'epg.pw',
        matchedName: mapping.matchedName,
        tried: ['epg-pw: ok']
    };
}

export { loadIndex as warmEpgPwIndexForCountry };
