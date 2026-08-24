/**
 * Resolve cached mosaic preview frames from PosterCache + FrameCache.
 */
import { PosterCache } from '../storage/posterCache.js';
import { FrameCache } from '../storage/frameCache.js';
import { SLOT_IDS } from './constants.js';

/**
 * @param {{ key?: string, url?: string } | null | undefined} entry
 * @param {{ url_resolved?: string, url?: string } | null | undefined} [channel]
 * @returns {string[]}
 */
export function collectFrameLookupKeys(entry, channel) {
    const keys = new Set();
    if (entry?.key) keys.add(entry.key);
    if (entry?.url) keys.add(entry.url);
    if (channel?.url_resolved) keys.add(channel.url_resolved);
    if (channel?.url) keys.add(channel.url);
    return [...keys];
}

/**
 * @param {string} chKey
 * @param {string[]} lookupKeys
 * @param {Map<string, string>} posterMap
 * @param {Map<string, string>} frameMap
 * @returns {string | null}
 */
export function resolveStoredFrameDataUrl(chKey, lookupKeys, posterMap, frameMap) {
    if (chKey && posterMap.get(chKey)) return posterMap.get(chKey);
    for (const key of lookupKeys) {
        const hit = frameMap.get(key);
        if (hit) return hit;
    }
    if (chKey && frameMap.get(chKey)) return frameMap.get(chKey);
    return null;
}

/**
 * Load cached frames for all mosaic slot entries.
 * @param {Record<string, { key?: string, url?: string }>} mosaic
 * @param {Record<string, { player?: { channel?: object } | null }>} slots
 */
export async function fetchStoredFramesForMosaic(mosaic, slots) {
    const posterKeys = [];
    const frameKeySet = new Set();
    /** @type {{ id: string, chKey: string, lookupKeys: string[] }[]} */
    const slotsMeta = [];

    SLOT_IDS.forEach((id) => {
        const entry = mosaic[id];
        if (!entry?.key) return;
        posterKeys.push(entry.key);
        const lookupKeys = collectFrameLookupKeys(entry, slots[id]?.player?.channel);
        lookupKeys.forEach((k) => frameKeySet.add(k));
        slotsMeta.push({ id, chKey: entry.key, lookupKeys });
    });

    const [posterMap, frameMap] = await Promise.all([
        PosterCache.getPosters(posterKeys).catch(() => new Map()),
        FrameCache.getFrames([...frameKeySet]).catch(() => new Map())
    ]);

    return { posterMap, frameMap, slotsMeta };
}

/**
 * Apply cached frames onto slot players (PosterCache first, then FrameCache).
 * @param {Record<string, { player?: { posterDataUrl?: string | null, channel?: object } | null }>} slots
 * @param {{ posterMap: Map<string, string>, frameMap: Map<string, string>, slotsMeta: { id: string, chKey: string, lookupKeys: string[] }[] }} cached
 * @returns {boolean} true when any player received a poster
 */
export function applyStoredFramesToSlots(slots, cached) {
    const { posterMap, frameMap, slotsMeta } = cached;
    let painted = false;

    for (const { id, chKey, lookupKeys } of slotsMeta) {
        const player = slots[id]?.player;
        if (!player || player.posterDataUrl) continue;
        const dataUrl = resolveStoredFrameDataUrl(chKey, lookupKeys, posterMap, frameMap);
        if (!dataUrl) continue;
        player.posterDataUrl = dataUrl;
        painted = true;
    }

    return painted;
}
