/**
 * On-demand EPG service — multi-provider chain.
 */
import { fetchViaChain, attachNowNext } from './providers/registry.js';
import { programmesForDay, localDayBounds } from './xmltvParser.js';
import { warmEpgPwIndexForCountry } from './providers/epgPwProvider.js';
import { epgPwFeedCode, PRIORITY_COUNTRIES } from './countryFeedMap.js';
import { channelKey } from '../tvProviders/channelShape.js';

export const FEED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} channel
 * @returns {Promise<import('./providers/types.js').EpgResult>}
 */
export async function fetchChannelProgrammes(channel) {
    return fetchViaChain(channel);
}

/**
 * @param {object} channel
 * @param {number} [nowMs]
 */
export async function getNowNext(channel, nowMs = Date.now()) {
    const result = await fetchViaChain(channel, { nowMs });
    return attachNowNext(result, nowMs);
}

/**
 * @param {object} channel
 * @param {{ dayOffset?: number, nowMs?: number }} [opts]
 */
export async function getSchedule(channel, opts = {}) {
    const dayOffset = opts.dayOffset ?? 0;
    const nowMs = opts.nowMs ?? Date.now();
    const result = await fetchViaChain(channel, { nowMs, dayOffset });

    if (result.status !== 'ok' || !result.programmes) {
        return { ...result, dayProgrammes: [] };
    }

    const bounds = localDayBounds(nowMs, dayOffset);
    const dayProgrammes = programmesForDay(result.programmes, bounds.start, bounds.end);
    return { ...result, dayProgrammes, dayStart: bounds.start, dayEnd: bounds.end };
}

/**
 * @param {object[]} favorites
 * @param {{ onProgress?: (info: { done: number, total: number, channel: object, result: object }) => void }} [opts]
 */
export async function prefetchFavoritesGuides(favorites, opts = {}) {
    const list = Array.isArray(favorites) ? favorites : [];
    /** @type {Map<string, object[]>} */
    const byCountry = new Map();

    for (const fav of list) {
        const cc = (fav.country || fav.countrycode || '').toUpperCase() || '?';
        if (!byCountry.has(cc)) byCountry.set(cc, []);
        byCountry.get(cc).push(fav);
    }

    const sortedCountries = [...byCountry.keys()].sort((a, b) => {
        const ai = PRIORITY_COUNTRIES.indexOf(a);
        const bi = PRIORITY_COUNTRIES.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.localeCompare(b);
    });

    for (const cc of sortedCountries) {
        const feedCode = epgPwFeedCode(cc);
        if (feedCode) {
            try { await warmEpgPwIndexForCountry(feedCode); } catch { /* ignore */ }
        }
    }

    /** @type {object[]} */
    const results = [];
    let done = 0;
    const total = list.length;

    for (const cc of sortedCountries) {
        for (const fav of byCountry.get(cc) || []) {
            const channel = {
                channelId: fav.channelId || fav.id,
                name: fav.name,
                countrycode: fav.country || fav.countrycode || cc,
                providerId: fav.providerId
            };
            const result = await fetchViaChain(channel);
            results.push({
                channelKey: channelKey(channel),
                country: cc,
                name: channel.name,
                status: result.status,
                source: result.source,
                matchedName: result.matchedName,
                message: result.message,
                tried: result.tried
            });
            done++;
            opts.onProgress?.({ done, total, channel, result });
        }
    }

    return results;
}

export async function warmGuideIndex() {
    /* legacy no-op — epg.pw indexes load on demand */
}
