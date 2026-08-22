/**
 * EPG provider registry — ordered chain resolution.
 */
import { epgPwProvider, fetchEpgPwProgrammes } from './epgPwProvider.js';
import { xmltvIndexProvider } from './xmltvIndexProvider.js';
import { mjhFastProvider } from './mjhFastProvider.js';
import { programmesForDay, pickNowNext, localDayBounds } from '../xmltvParser.js';

/** @type {import('./types.js').EpgProvider[]} */
const PROVIDERS = [epgPwProvider, xmltvIndexProvider, mjhFastProvider];

/**
 * @param {object} channel
 * @returns {import('./types.js').EpgProvider[]}
 */
export function resolveProviderChain(channel) {
    return PROVIDERS.filter((p) => p.supports(channel));
}

/**
 * @param {object} channel
 * @param {{ dayOffset?: number, nowMs?: number }} [opts]
 * @returns {Promise<import('./types.js').EpgResult>}
 */
export async function fetchViaChain(channel, opts = {}) {
    if (!channel?.name && !channel?.channelId && !channel?.id) {
        return { status: 'miss', message: 'No channel', tried: [] };
    }

    const nowMs = opts.nowMs ?? Date.now();
    const tried = [];

    if (epgPwProvider.supports(channel)) {
        try {
            const pw = await fetchEpgPwProgrammes(channel, nowMs);
            if (pw.status === 'ok' && pw.programmes?.length) {
                return { ...pw, tried: pw.tried || ['epg-pw: ok'] };
            }
            tried.push(...(pw.tried || [`epg-pw: ${pw.status}`]));
        } catch (e) {
            tried.push(`epg-pw: error`);
        }
    } else {
        tried.push('epg-pw: no-source');
    }

    for (const provider of [xmltvIndexProvider, mjhFastProvider]) {
        if (!provider.supports(channel)) {
            tried.push(`${provider.id}: skip`);
            continue;
        }
        const result = await provider.resolveProgrammes(channel, opts);
        tried.push(...(result.tried || [`${provider.id}: ${result.status}`]));
        if (result.status === 'ok' && result.programmes?.length) {
            return { ...result, tried };
        }
        if (result.status === 'cors-blocked') {
            return { ...result, tried };
        }
    }

    const cc = channel.countrycode || '';
    const hasRegional = tried.some((t) => t.includes('xmltv-index') && !t.includes('skip'));
    const allNoSource = tried.every((t) => t.includes('no-source') || t.includes('skip'));

    if (allNoSource && cc) {
        return { status: 'no-source', message: `No guide source for ${cc}`, tried };
    }
    if (tried.some((t) => t.includes('cors-blocked'))) {
        return { status: 'cors-blocked', message: 'Guide source blocked (CORS)', tried };
    }
    return { status: 'miss', message: 'No guide for this channel', tried };
}

/**
 * @param {import('./types.js').EpgResult} result
 * @param {number} [nowMs]
 */
export function attachNowNext(result, nowMs = Date.now()) {
    if (result.status !== 'ok' || !result.programmes?.length) return result;
    const today = localDayBounds(nowMs, 0);
    const todayProgs = programmesForDay(result.programmes, today.start, today.end);
    const { current, next } = pickNowNext(todayProgs.length ? todayProgs : result.programmes, nowMs);
    return { ...result, current, next };
}

export { PROVIDERS };
