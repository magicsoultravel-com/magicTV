/**
 * Per-channel healthy watch-time accumulation (local only).
 * Credits seconds only when callers flush open accrual windows.
 */
import { loadPlayerState, savePlayerState, normalizeWatchStatsMeta } from './playerState.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';

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
    savePlayerState({ watchStatsMeta: toSortedMeta() });
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
    if (!migrated || !Number.isFinite(seconds) || seconds <= 0) return;
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

export function formatWatchDuration(totalSeconds) {
    const raw = Math.max(0, Number(totalSeconds) || 0);
    if (raw < 60) {
        if (raw < 10) return `${raw.toFixed(1)}s`;
        return `${Math.floor(raw)}s`;
    }
    const m = Math.floor(raw / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
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
