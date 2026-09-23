/**
 * Per-channel healthy watch-time accumulation (local only).
 * Credits seconds only when callers flush open accrual windows.
 */
import { loadPlayerState, savePlayerState, normalizeWatchStatsMeta } from './playerState.js';
import { channelKey, migrateFavoriteRef } from '../tvProviders/channelShape.js';

export const WATCH_STATS_CAP = 100;
const PERSIST_DEBOUNCE_MS = 45000;

/** @type {Map<string, { key: string, name: string, logo: string, countrycode: string, seconds: number }>} */
let cache = null;
let persistTimer = 0;
/** @type {Set<() => void>} */
const flushers = new Set();
/** @type {Set<() => void>} */
const aborters = new Set();

function ensureCache() {
    if (!cache) {
        cache = new Map(
            loadPlayerState().watchStatsMeta.map((e) => [e.key, { ...e }])
        );
    }
    return cache;
}

function toSortedMeta() {
    return [...ensureCache().values()].sort((a, b) => b.seconds - a.seconds);
}

function pruneCache() {
    const sorted = toSortedMeta();
    if (sorted.length <= WATCH_STATS_CAP) return;
    const keep = new Set(sorted.slice(0, WATCH_STATS_CAP).map((e) => e.key));
    for (const key of [...ensureCache().keys()]) {
        if (!keep.has(key)) ensureCache().delete(key);
    }
}

function persistNow() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = 0;
    }
    const meta = toSortedMeta();
    savePlayerState({ watchStatsMeta: meta });
    // Detect refuse-write / quota leaving disk behind in-memory totals.
    try {
        const disk = loadPlayerState().watchStatsMeta || [];
        const diskByKey = new Map(disk.map((e) => [e.key, e.seconds]));
        const drifted = meta.some((e) => {
            const d = diskByKey.get(e.key);
            return !Number.isFinite(d) || Math.abs(d - e.seconds) > 0.5;
        });
        if (drifted && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tv:watch_stats_persist_failed'));
        }
    } catch { /* ignore */ }
}

export function scheduleWatchStatsPersist(force = false) {
    if (force) {
        persistNow();
        return;
    }
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = 0;
        persistNow();
    }, PERSIST_DEBOUNCE_MS);
    if (typeof persistTimer?.unref === 'function') persistTimer.unref();
}

export function registerWatchAccrualFlusher(fn) {
    flushers.add(fn);
}

export function unregisterWatchAccrualFlusher(fn) {
    flushers.delete(fn);
}

export function registerWatchAccrualAborter(fn) {
    aborters.add(fn);
}

export function unregisterWatchAccrualAborter(fn) {
    aborters.delete(fn);
}

export function flushAllWatchAccruals() {
    flushers.forEach((fn) => {
        try { fn(); } catch { /* ignore */ }
    });
    scheduleWatchStatsPersist(true);
}

/** Drop open accrual windows without crediting (used before Clear). */
export function abortAllWatchAccruals() {
    aborters.forEach((fn) => {
        try { fn(); } catch { /* ignore */ }
    });
}

export function addWatchSeconds(key, seconds, channel = null) {
    const migrated = migrateFavoriteRef(key);
    if (!migrated || migrated.endsWith(':') || !Number.isFinite(seconds) || seconds <= 0) return;
    const map = ensureCache();
    const existing = map.get(migrated) || {
        key: migrated,
        name: '',
        logo: '',
        countrycode: '',
        seconds: 0
    };
    existing.seconds += seconds;
    if (channel && typeof channel === 'object') {
        if (channel.name) existing.name = channel.name;
        if (channel.logo) existing.logo = channel.logo;
        if (channel.countrycode) existing.countrycode = channel.countrycode;
    }
    map.set(migrated, existing);
    pruneCache();
    scheduleWatchStatsPersist();
}

export function reloadWatchStatsCache() {
    cache = new Map(
        loadPlayerState().watchStatsMeta.map((e) => [e.key, { ...e }])
    );
}

export function getWatchSeconds(key) {
    const migrated = migrateFavoriteRef(key);
    if (!migrated) return 0;
    const entry = ensureCache().get(migrated);
    return entry ? Number(entry.seconds) || 0 : 0;
}

/**
 * Live session + lifetime totals for a player, including the open accrual window.
 * @param {object|null|undefined} player
 * @returns {{ session: number, total: number, key: string }}
 */
export function getLiveWatchSeconds(player) {
    const key = player?.channel ? channelKey(player.channel) : '';
    const migrated = key ? migrateFavoriteRef(key) : '';
    if (!migrated || migrated.endsWith(':')) {
        return { session: 0, total: 0, key: '' };
    }

    let open = 0;
    if (player.watchAccrueKey === migrated && player.watchAccrueStartedAt) {
        const wall = Math.max(0, (Date.now() - player.watchAccrueStartedAt) / 1000);
        const mediaAt = Number(player.watchAccrueMediaAt);
        const nowMedia = Number(player.video?.currentTime);
        if (Number.isFinite(mediaAt) && Number.isFinite(nowMedia) && nowMedia >= mediaAt) {
            const mediaDelta = nowMedia - mediaAt;
            open = mediaDelta > 0.05 ? Math.min(wall, mediaDelta) : wall;
        } else {
            open = wall;
        }
    }

    const banked = getWatchSeconds(migrated);
    const sessionBanked = Number(player.watchSessionSeconds) || 0;
    return {
        key: migrated,
        session: sessionBanked + open,
        total: banked + open
    };
}

export function getTopWatched(limit = 20) {
    const n = Number.isFinite(limit) ? Math.max(0, Math.round(limit)) : 20;
    return toSortedMeta().slice(0, n);
}

export function clearWatchStats() {
    abortAllWatchAccruals();
    cache = new Map();
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = 0;
    }
    savePlayerState({ watchStatsMeta: [] });
}

/**
 * Compact human labels for Most watched and mosaic chrome.
 * Under 1h keeps seconds so mid-length totals stay honest.
 */
export function formatWatchDuration(totalSeconds) {
    const raw = Math.max(0, Number(totalSeconds) || 0);
    if (raw < 60) {
        if (raw < 10) return `${raw.toFixed(1)}s`;
        return `${Math.floor(raw)}s`;
    }
    const totalM = Math.floor(raw / 60);
    if (totalM < 60) {
        const s = Math.floor(raw % 60);
        return s ? `${totalM}m ${s}s` : `${totalM}m`;
    }
    const h = Math.floor(totalM / 60);
    const rm = totalM % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        flushAllWatchAccruals();
    });
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flushAllWatchAccruals());
}
