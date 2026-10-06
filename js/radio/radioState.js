/**
 * Radio favorites / recents / prefs — isolated magictv localStorage key.
 */
import { migrateFavoriteRef } from './stationShape.js';

export const RADIO_STATE_KEY = 'magictv_radio_state';
/** @deprecated Prefer DEFAULT_RADIO_RECENTS_CAP / getRadioRecentsCap() */
export const RADIO_RECENTS_CAP = 20;
export const DEFAULT_RADIO_RECENTS_CAP = 20;
export const RADIO_RECENTS_CAP_MIN = 0;
export const RADIO_RECENTS_CAP_MAX = 500;
/** Sentinel: no trim on push. */
export const UNLIMITED_RADIO_RECENTS_CAP = -1;

export const DEFAULT_BROWSE_SORT = 'name';
export const DEFAULT_BROWSE_SORT_DIR = 'asc';
export const DEFAULT_COUNTRY_SORT = 'count';

const DEFAULT_STATION_BIND_SCOPE = Object.freeze({ mode: 'favorites' });

/**
 * @typedef {{ mode: 'favorites' }
 *   | { mode: 'folder', folderId: string }
 *   | { mode: 'country', countryCode: string }} StationBindScope
 */

export function isUnlimitedRadioRecentsCap(cap) {
    return Number(cap) === UNLIMITED_RADIO_RECENTS_CAP;
}

/** Clamp a user/settings value into a valid radio recents cap (including unlimited). */
export function clampRadioRecentsCap(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_RADIO_RECENTS_CAP;
    const rounded = Math.round(n);
    if (rounded === UNLIMITED_RADIO_RECENTS_CAP) return UNLIMITED_RADIO_RECENTS_CAP;
    return Math.min(RADIO_RECENTS_CAP_MAX, Math.max(RADIO_RECENTS_CAP_MIN, rounded));
}

/**
 * @param {unknown} raw
 * @param {Array<{ id?: string, items?: string[] }>|null|undefined} favoriteFolders
 * @returns {StationBindScope}
 */
export function normalizeStationBindScope(raw, favoriteFolders) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATION_BIND_SCOPE };
    if (raw.mode === 'folder' && typeof raw.folderId === 'string' && raw.folderId) {
        const exists = (favoriteFolders || []).some((f) => f && f.id === raw.folderId);
        if (exists) return { mode: 'folder', folderId: raw.folderId };
    }
    if (raw.mode === 'country') {
        const code = String(raw.countryCode || raw.countrycode || '').trim().toUpperCase();
        if (code) return { mode: 'country', countryCode: code };
    }
    return { ...DEFAULT_STATION_BIND_SCOPE };
}

function migrateRecentsMeta(raw) {
    if (Array.isArray(raw.recentsMeta) && raw.recentsMeta.length) {
        return raw.recentsMeta.map((entry) => {
            if (typeof entry === 'string') {
                return { key: migrateFavoriteRef(entry), name: '', favicon: '', countrycode: '', at: 0 };
            }
            return {
                key: migrateFavoriteRef(entry.key),
                name: entry.name || '',
                favicon: entry.favicon || '',
                countrycode: entry.countrycode || '',
                at: Number.isFinite(entry.at) ? entry.at : 0
            };
        }).filter((e) => e.key);
    }
    if (Array.isArray(raw.recents)) {
        return raw.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            favicon: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

function emptyState() {
    return {
        favorites: [],
        recents: [],
        recentsMeta: [],
        radioRecentsCap: DEFAULT_RADIO_RECENTS_CAP,
        stationBindScope: { ...DEFAULT_STATION_BIND_SCOPE },
        volume: 0.85,
        muted: false,
        lastStationKey: null,
        lastStationName: '',
        lastStationFavicon: '',
        lastStationCountrycode: '',
        wasPlaying: false,
        catalogProvider: 'radio-browser',
        radioBrowserMirror: null,
        hideOfflineStations: true,
        browseSort: DEFAULT_BROWSE_SORT,
        browseSortDir: DEFAULT_BROWSE_SORT_DIR,
        countrySort: DEFAULT_COUNTRY_SORT,
        castHostAudio: false
    };
}

/** Pure read + normalize of persisted radio state. */
export function loadRadioState() {
    try {
        const raw = JSON.parse(localStorage.getItem(RADIO_STATE_KEY) || '{}');
        const favorites = Array.isArray(raw.favorites)
            ? raw.favorites.map(migrateFavoriteRef).filter(Boolean)
            : [];
        const recentsMeta = migrateRecentsMeta(raw);
        const recents = recentsMeta.map((e) => e.key);
        const lastKey = raw.lastStationKey ? migrateFavoriteRef(raw.lastStationKey) : null;
        const browseSortDir = raw.browseSortDir === 'asc' || raw.browseSortDir === 'desc'
            ? raw.browseSortDir
            : DEFAULT_BROWSE_SORT_DIR;
        const favoriteFolders = Array.isArray(raw.favoriteFolders) ? raw.favoriteFolders : null;

        const state = {
            favorites,
            recents,
            recentsMeta,
            radioRecentsCap: clampRadioRecentsCap(
                raw.radioRecentsCap == null || raw.radioRecentsCap === ''
                    ? DEFAULT_RADIO_RECENTS_CAP
                    : raw.radioRecentsCap
            ),
            stationBindScope: normalizeStationBindScope(raw.stationBindScope, favoriteFolders || []),
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            muted: raw.muted === true,
            lastStationKey: lastKey || null,
            lastStationName: raw.lastStationName || '',
            lastStationFavicon: raw.lastStationFavicon || '',
            lastStationCountrycode: raw.lastStationCountrycode || '',
            wasPlaying: raw.wasPlaying === true,
            catalogProvider: raw.catalogProvider || 'radio-browser',
            radioBrowserMirror: raw.radioBrowserMirror || null,
            hideOfflineStations: raw.hideOfflineStations !== false,
            browseSort: raw.browseSort || DEFAULT_BROWSE_SORT,
            browseSortDir,
            countrySort: raw.countrySort || DEFAULT_COUNTRY_SORT,
            castHostAudio: raw.castHostAudio === true
        };
        // Pass-through for parallel folders work — do not invent schema here.
        if (favoriteFolders) state.favoriteFolders = favoriteFolders;
        return state;
    } catch {
        return emptyState();
    }
}

/** Merge a patch into normalized radio state and persist. */
export function patchRadioState(patch) {
    const current = loadRadioState();
    const next = { ...current, ...patch };
    if (next.recentsMeta) {
        next.recents = next.recentsMeta.map((e) => e.key);
    }
    if (patch.stationBindScope != null) {
        next.stationBindScope = normalizeStationBindScope(
            patch.stationBindScope,
            next.favoriteFolders || []
        );
    }
    if (patch.radioRecentsCap != null) {
        next.radioRecentsCap = clampRadioRecentsCap(patch.radioRecentsCap);
    }
    localStorage.setItem(RADIO_STATE_KEY, JSON.stringify(next));
    return next;
}

/** @returns {StationBindScope} */
export function getStationBindScope() {
    const state = loadRadioState();
    return normalizeStationBindScope(state.stationBindScope, state.favoriteFolders || []);
}

/** @param {StationBindScope|object} scope */
export function setStationBindScope(scope) {
    const state = loadRadioState();
    const normalized = normalizeStationBindScope(scope, state.favoriteFolders || []);
    patchRadioState({ stationBindScope: normalized });
    return normalized;
}

export function getRadioRecentsCap() {
    return clampRadioRecentsCap(loadRadioState().radioRecentsCap);
}

export function setRadioRecentsCap(value) {
    const next = clampRadioRecentsCap(value);
    const state = loadRadioState();
    const patch = { radioRecentsCap: next };
    if (!isUnlimitedRadioRecentsCap(next) && Array.isArray(state.recentsMeta) && state.recentsMeta.length > next) {
        patch.recentsMeta = state.recentsMeta.slice(0, next);
    }
    patchRadioState(patch);
    return next;
}
