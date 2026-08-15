/**
 * Player-relevant slice of matrix_tv_state (volume, buffer, last channel, lists).
 * Merges via shared persistedState so SettingsStore / registry patches survive.
 */
import { readPersistedState, patchPersistedState } from './persistedState.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';

export const RECENTS_CAP = 20;
export const DEFAULT_BUFFER_SIZE = 15;
export const MAX_BUFFER_SIZE = 120;
export const MIN_BUFFER_SIZE = 5;

function migrateRecentsMeta(raw) {
    if (Array.isArray(raw.recentsMeta) && raw.recentsMeta.length) {
        return raw.recentsMeta.map((entry) => {
            if (typeof entry === 'string') {
                return { key: migrateFavoriteRef(entry), name: '', logo: '', countrycode: '', at: 0 };
            }
            return {
                key: migrateFavoriteRef(entry.key),
                name: entry.name || '',
                logo: entry.logo || '',
                countrycode: entry.countrycode || '',
                at: Number.isFinite(entry.at) ? entry.at : 0
            };
        }).filter((e) => e.key);
    }
    if (Array.isArray(raw.recents)) {
        return raw.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            logo: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

function normalizeFavoritesMeta(favorites, favoritesMeta) {
    const favKeys = new Set(favorites);
    const seen = new Set();
    return (Array.isArray(favoritesMeta) ? favoritesMeta : [])
        .map((e) => ({
            key: migrateFavoriteRef(typeof e === 'string' ? e : e?.key),
            name: (e && e.name) || '',
            logo: (e && e.logo) || '',
            countrycode: (e && e.countrycode) || ''
        }))
        .filter((e) => e.key && favKeys.has(e.key) && !seen.has(e.key) && (seen.add(e.key), true));
}

/** Parsed player fields from the shared blob (does not strip sibling keys). */
export function loadPlayerState() {
    try {
        const raw = readPersistedState();
        const favorites = Array.isArray(raw.favorites)
            ? raw.favorites.map(migrateFavoriteRef)
            : [];
        const favoritesMeta = normalizeFavoritesMeta(favorites, raw.favoritesMeta);
        const recentsMeta = migrateRecentsMeta(raw);
        const recents = recentsMeta.map((e) => e.key);

        return {
            favorites,
            favoritesMeta,
            recents,
            recentsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastChannelKey: raw.lastChannelKey || null,
            lastChannelName: raw.lastChannelName || '',
            wasPlaying: raw.wasPlaying === true,
            bufferSize: Number.isFinite(raw.bufferSize)
                ? Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, raw.bufferSize))
                : DEFAULT_BUFFER_SIZE
        };
    } catch {
        return {
            favorites: [],
            favoritesMeta: [],
            recents: [],
            recentsMeta: [],
            volume: 0.85,
            lastChannelKey: null,
            lastChannelName: '',
            wasPlaying: false,
            bufferSize: DEFAULT_BUFFER_SIZE
        };
    }
}

/**
 * Patch player fields onto the shared blob. Re-derives recents keys and
 * filters favoritesMeta to match favorites when those fields are present.
 */
export function savePlayerState(patch) {
    const current = loadPlayerState();
    const merged = { ...current, ...patch };
    if (merged.recentsMeta) {
        merged.recents = merged.recentsMeta.map((e) => e.key);
    }
    if (merged.favorites) {
        merged.favoritesMeta = normalizeFavoritesMeta(merged.favorites, merged.favoritesMeta);
    }
    return patchPersistedState({
        favorites: merged.favorites,
        favoritesMeta: merged.favoritesMeta,
        recents: merged.recents,
        recentsMeta: merged.recentsMeta,
        volume: merged.volume,
        lastChannelKey: merged.lastChannelKey,
        lastChannelName: merged.lastChannelName,
        wasPlaying: merged.wasPlaying,
        bufferSize: merged.bufferSize,
        ...Object.fromEntries(
            Object.entries(patch).filter(([k]) => !(
                k === 'favorites' || k === 'favoritesMeta' || k === 'recents'
                || k === 'recentsMeta' || k === 'volume' || k === 'lastChannelKey'
                || k === 'lastChannelName' || k === 'wasPlaying' || k === 'bufferSize'
            ))
        )
    });
}
