/**
 * On-demand EPG service — multi-provider chain.
 */
import { fetchViaChain, attachNowNext } from './providers/registry.js';
import { programmesForDay, localDayBounds } from './xmltvParser.js';
import { channelKey } from '../tvProviders/channelShape.js';

export const FEED_TTL_MS = 6 * 60 * 60 * 1000;

const NOW_NEXT_TTL_MS = 45_000;
/** @type {Map<string, Promise<object>>} */
const inflightNowNext = new Map();
/** @type {Map<string, { at: number, result: object }>} */
const nowNextCache = new Map();

/**
 * @param {object} channel
 * @param {number} [nowMs]
 * @param {{ force?: boolean }} [opts]
 */
export async function getNowNext(channel, nowMs = Date.now(), opts = {}) {
    const force = opts.force === true;
    const key = channelKey(channel);

    if (!force && key) {
        const hit = nowNextCache.get(key);
        if (hit && Date.now() - hit.at < NOW_NEXT_TTL_MS) return hit.result;
        if (inflightNowNext.has(key)) return inflightNowNext.get(key);
    }

    const run = async () => {
        const result = attachNowNext(await fetchViaChain(channel, { nowMs }), nowMs);
        if (key && result.status === 'ok') {
            nowNextCache.set(key, { at: Date.now(), result });
        }
        return result;
    };

    if (force || !key) return run();

    const promise = run().finally(() => {
        if (inflightNowNext.get(key) === promise) inflightNowNext.delete(key);
    });
    inflightNowNext.set(key, promise);
    return promise;
}

/**
 * @param {object} channel
 * @returns {Promise<import('./providers/types.js').EpgResult>}
 */
export async function fetchChannelProgrammes(channel) {
    return fetchViaChain(channel);
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

export async function warmGuideIndex() {
    /* legacy no-op — epg.pw indexes load on demand */
}
