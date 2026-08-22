/**
 * i.mjh.nz FAST bundle provider — global name-match fallback.
 */
import { FAST_FEEDS } from '../countryFeedMap.js';
import { matchChannelByName } from '../nameMatch.js';
import {
    parseChannelIndex,
    streamChannelSection,
    fetchFeedText,
    extractProgrammesForId
} from '../channelIndex.js';
import {
    getChannelIndexCache, setChannelIndexCache,
    getMappingCache, setMappingCache,
    getProgrammesCache, setProgrammesCache
} from '../epgStore.js';
import { channelKey } from '../../tvProviders/channelShape.js';

/** @type {Map<string, import('../nameMatch.js').ChannelIndexEntry[]>} */
const sessionIndex = new Map();

const FAST_HINTS = ['pluto', 'samsung', 'plex', 'roku', 'fast', 'free ad'];

function isFastChannel(channel) {
    const name = (channel?.name || '').toLowerCase();
    const cats = (channel?.categories || []).join(' ').toLowerCase();
    const tags = (channel?.tags || '').toLowerCase();
    const blob = `${name} ${cats} ${tags}`;
    return FAST_HINTS.some((h) => blob.includes(h));
}

/**
 * @param {{ url: string, label: string }} feed
 */
async function loadFastIndex(feed) {
    const cacheKey = `fast:${feed.url}`;
    if (sessionIndex.has(cacheKey)) return sessionIndex.get(cacheKey);

    const cached = await getChannelIndexCache(cacheKey);
    if (cached?.length) {
        sessionIndex.set(cacheKey, cached);
        return cached;
    }

    const head = await streamChannelSection(feed.url);
    const index = parseChannelIndex(head);
    sessionIndex.set(cacheKey, index);
    await setChannelIndexCache(cacheKey, index);
    return index;
}

async function loadFastProgrammes(feed, xmlId) {
    const progKey = `fast-prog:${feed.url}:${xmlId}`;
    const cached = await getProgrammesCache(progKey);
    if (cached?.length) return cached;

    const full = await fetchFeedText(feed.url, 'XML');
    const programmes = extractProgrammesForId(full, xmlId);
    if (programmes.length) await setProgrammesCache(progKey, programmes);
    return programmes;
}

export const mjhFastProvider = {
    id: 'mjh-fast',

    supports(channel) {
        return isFastChannel(channel) || Boolean(channel?.countrycode);
    },

    async resolveProgrammes(channel) {
        const key = channelKey(channel);
        const mapKey = `fast:${key}`;
        const tried = [];

        let mapping = await getMappingCache(mapKey);
        if (mapping?.xmlId && mapping?.feedUrl) {
            const feed = FAST_FEEDS.find((f) => f.url === mapping.feedUrl);
            if (feed) {
                const programmes = await loadFastProgrammes(feed, mapping.xmlId);
                if (programmes.length) {
                    return {
                        status: 'ok',
                        programmes,
                        source: mapping.source,
                        matchedName: mapping.matchedName,
                        tried: [`mjh-fast: ${mapping.source}`]
                    };
                }
            }
        }

        for (const feed of FAST_FEEDS) {
            try {
                const index = await loadFastIndex(feed);
                const hit = matchChannelByName(channel.name, index);
                if (!hit) {
                    tried.push(`${feed.label}: no name match`);
                    continue;
                }
                const programmes = await loadFastProgrammes(feed, hit.id);
                if (!programmes.length) {
                    tried.push(`${feed.label}: no programmes`);
                    continue;
                }
                await setMappingCache(mapKey, {
                    xmlId: hit.id,
                    matchedName: hit.matchedName,
                    feedUrl: feed.url,
                    source: feed.label
                });
                return {
                    status: 'ok',
                    programmes,
                    source: feed.label,
                    matchedName: hit.matchedName,
                    tried: [`mjh-fast: ${feed.label}`]
                };
            } catch {
                tried.push(`${feed.label}: error`);
            }
        }

        return { status: 'miss', tried };
    }
};
