/**
 * Background warm-up of ±1 adjacent channels while a slot is playing.
 */
import { channelKey } from '../tvProviders/channelShape.js';
import { resolveAdjacentChannel } from '../channelNav.js';
import { ChannelPreloader } from './channelPreloader.js';

/** @typedef {{ preloader: ChannelPreloader, video: HTMLVideoElement, channel: object, key: string }} PrefetchEntry */

/** @type {Map<string, Map<string, PrefetchEntry>>} */
const slotCache = new Map();

/** @type {Map<string, number>} */
const slotGeneration = new Map();

const MAX_WARM_PER_SLOT = 2;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureSlotMap(slotId) {
    let map = slotCache.get(slotId);
    if (!map) {
        map = new Map();
        slotCache.set(slotId, map);
    }
    return map;
}

function destroyEntry(entry) {
    if (!entry) return;
    entry.preloader?.cancel();
    if (entry.video) {
        try {
            entry.video.pause();
            entry.video.removeAttribute('src');
            entry.video.load();
            entry.video.remove();
        } catch { /* ignore */ }
    }
}

function bumpSlotGeneration(slotId) {
    slotGeneration.set(slotId, (slotGeneration.get(slotId) || 0) + 1);
}

/**
 * @param {string} slotId
 */
export function cancelSlotPrefetch(slotId) {
    bumpSlotGeneration(slotId);
    const map = slotCache.get(slotId);
    if (!map) return;
    for (const entry of map.values()) {
        destroyEntry(entry);
    }
    map.clear();
}

export function cancelAllPrefetch() {
    for (const slotId of [...slotCache.keys()]) {
        cancelSlotPrefetch(slotId);
    }
}

/**
 * @param {string} slotId
 * @param {string} key
 * @returns {{ preloader: ChannelPreloader, video: HTMLVideoElement, channel: object, hls: object|null }|null}
 */
export function consumePrefetched(slotId, key) {
    const map = slotCache.get(slotId);
    if (!map || !key) return null;
    const entry = map.get(key);
    if (!entry?.preloader?.isReady()) return null;

    map.delete(key);
    const taken = entry.preloader.takeover();
    return {
        video: entry.video,
        channel: entry.channel,
        hls: taken.hls
    };
}

/**
 * @param {string} slotId
 * @param {object} player
 */
export async function refreshSlotPrefetch(slotId, player) {
    if (!slotId || !player?.playing || !player.channel || player.loading) return;

    const gen = (slotGeneration.get(slotId) || 0) + 1;
    slotGeneration.set(slotId, gen);
    const isStale = () => slotGeneration.get(slotId) !== gen;

    const directions = ['up', 'down'];
    const targets = [];

    for (const direction of directions) {
        try {
            const result = await resolveAdjacentChannel({ slotId, direction });
            if (result?.channel) {
                const key = channelKey(result.channel);
                if (key && key !== channelKey(player.channel)) {
                    targets.push({ key, channel: result.channel });
                }
            }
        } catch { /* ignore */ }
        if (isStale()) return;
    }

    const map = ensureSlotMap(slotId);
    const targetKeys = new Set(targets.map((t) => t.key));

    for (const [key, entry] of [...map.entries()]) {
        if (!targetKeys.has(key)) {
            destroyEntry(entry);
            map.delete(key);
        }
    }

    if (targets.length > MAX_WARM_PER_SLOT) {
        targets.length = MAX_WARM_PER_SLOT;
    }

    for (const { key, channel } of targets) {
        if (isStale()) return;
        if (map.has(key) && map.get(key)?.preloader?.isReady()) continue;

        if (map.has(key)) {
            destroyEntry(map.get(key));
            map.delete(key);
        }

        const video = document.createElement('video');
        video.className = 'tv-video tv-video--prefetch';
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'auto';
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:90px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);

        const preloader = new ChannelPreloader();
        const entry = { preloader, video, channel, key };
        map.set(key, entry);

        preloader.warmChannel(video, channel, { isStale }).then((ok) => {
            if (isStale() || !ok) {
                if (map.get(key) === entry) {
                    destroyEntry(entry);
                    map.delete(key);
                }
            }
        }).catch(() => {
            if (map.get(key) === entry) {
                destroyEntry(entry);
                map.delete(key);
            }
        });

        // Stagger second warm so both don't hammer the network at once.
        await sleep(120);
    }
}

/**
 * Debounced prefetch hook — call from player playing / commit events.
 * @param {string} slotId
 * @param {object} player
 */
export function scheduleSlotPrefetch(slotId, player) {
    if (!slotId || !player) return;
    const prev = scheduleSlotPrefetch._timers?.get(slotId);
    if (prev) clearTimeout(prev);
    if (!scheduleSlotPrefetch._timers) {
        scheduleSlotPrefetch._timers = new Map();
    }
    scheduleSlotPrefetch._timers.set(slotId, setTimeout(() => {
        scheduleSlotPrefetch._timers.delete(slotId);
        void refreshSlotPrefetch(slotId, player);
    }, 600));
}
