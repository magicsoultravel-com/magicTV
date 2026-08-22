/**
 * Regional XMLTV provider — curated country feeds with name matching.
 */
import { regionalFeedsFor } from '../countryFeedMap.js';
import { matchChannelByName } from '../nameMatch.js';
import {
    parseChannelIndex,
    streamChannelSection,
    fetchFeedText,
    extractProgrammesForId,
    isCorsError
} from '../channelIndex.js';
import {
    getChannelIndexCache, setChannelIndexCache,
    getMappingCache, setMappingCache,
    getCorsCache, setCorsCache,
    getProgrammesCache, setProgrammesCache
} from '../epgStore.js';
import { channelKey } from '../../tvProviders/channelShape.js';

/** @type {Map<string, import('../nameMatch.js').ChannelIndexEntry[]>} */
const sessionIndex = new Map();

/**
 * @param {{ url: string, format: string, label: string, indexOnly?: boolean }} feed
 */
async function loadFeedIndex(feed) {
    const cacheKey = `xmltv:${feed.url}`;
    if (sessionIndex.has(cacheKey)) return sessionIndex.get(cacheKey);

    const cors = await getCorsCache(feed.url);
    if (cors && cors.corsOk === false) throw new Error('cors-blocked');

    const cached = await getChannelIndexCache(cacheKey);
    if (cached?.length) {
        sessionIndex.set(cacheKey, cached);
        return cached;
    }

    try {
        let head;
        if (feed.indexOnly || feed.format === 'XML') {
            head = await streamChannelSection(feed.url);
        } else {
            const full = await fetchFeedText(feed.url, feed.format);
            const idx = full.indexOf('<programme');
            head = idx > 0 ? full.slice(0, idx) : full.slice(0, 500000);
            await setProgrammesCache(`full:${feed.url}`, null);
        }
        const index = parseChannelIndex(head);
        sessionIndex.set(cacheKey, index);
        await setChannelIndexCache(cacheKey, index);
        await setCorsCache(feed.url, true);
        return index;
    } catch (e) {
        if (isCorsError(e)) {
            await setCorsCache(feed.url, false);
            throw new Error('cors-blocked');
        }
        throw e;
    }
}

/**
 * @param {{ url: string, format: string }} feed
 * @param {string} xmlId
 */
async function loadProgrammes(feed, xmlId) {
    const progKey = `prog:${feed.url}:${xmlId}`;
    const cached = await getProgrammesCache(progKey);
    if (cached?.length) return cached;

    const full = await fetchFeedText(feed.url, feed.format);
    const programmes = extractProgrammesForId(full, xmlId);
    if (programmes.length) await setProgrammesCache(progKey, programmes);
    return programmes;
}

export const xmltvIndexProvider = {
    id: 'xmltv-index',

    supports(channel) {
        const feeds = regionalFeedsFor(channel?.countrycode);
        return feeds.length > 0;
    },

    async resolveProgrammes(channel, opts = {}) {
        const feeds = regionalFeedsFor(channel?.countrycode);
        if (!feeds.length) return { status: 'no-source', tried: ['xmltv-index: no regional feed'] };

        const key = channelKey(channel);
        const mapKey = `xmltv:${key}`;
        const tried = [];

        let mapping = await getMappingCache(mapKey);
        if (mapping?.xmlId && mapping?.feedUrl) {
            try {
                const programmes = await loadProgrammes(
                    { url: mapping.feedUrl, format: mapping.format || 'GZIP' },
                    mapping.xmlId
                );
                if (programmes.length) {
                    return {
                        status: 'ok',
                        programmes,
                        source: mapping.source || mapping.label,
                        matchedName: mapping.matchedName,
                        tried: [`xmltv-index: ${mapping.label}`]
                    };
                }
            } catch (e) {
                if (e?.message === 'cors-blocked') {
                    tried.push(`${mapping.label}: cors-blocked`);
                }
            }
        }

        for (const feed of feeds) {
            try {
                const cors = await getCorsCache(feed.url);
                if (cors && cors.corsOk === false) {
                    tried.push(`${feed.label}: cors-blocked`);
                    continue;
                }

                const index = await loadFeedIndex(feed);
                const hit = matchChannelByName(channel.name, index);
                if (!hit) {
                    tried.push(`${feed.label}: no name match`);
                    continue;
                }

                const programmes = await loadProgrammes(feed, hit.id);
                if (!programmes.length) {
                    tried.push(`${feed.label}: no programmes`);
                    continue;
                }

                await setMappingCache(mapKey, {
                    xmlId: hit.id,
                    matchedName: hit.matchedName,
                    feedUrl: feed.url,
                    format: feed.format,
                    label: feed.label,
                    source: feed.label
                });

                return {
                    status: 'ok',
                    programmes,
                    source: feed.label,
                    matchedName: hit.matchedName,
                    tried: [`xmltv-index: ${feed.label}`]
                };
            } catch (e) {
                if (e?.message === 'cors-blocked') {
                    tried.push(`${feed.label}: cors-blocked`);
                } else {
                    tried.push(`${feed.label}: error`);
                }
            }
        }

        if (tried.some((t) => t.includes('cors-blocked'))) {
            return { status: 'cors-blocked', message: 'Guide source blocked (CORS)', tried };
        }
        return { status: 'miss', tried };
    }
};

export { loadFeedIndex as warmRegionalIndexForCountry };
