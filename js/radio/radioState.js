/**
 * Radio favorites / recents / prefs — isolated magictv localStorage key.
 */
import { migrateFavoriteRef } from './stationShape.js';

export const RADIO_STATE_KEY = 'magictv_radio_state';
export const RADIO_RECENTS_CAP = 20;
export const DEFAULT_BROWSE_SORT = 'name';
export const DEFAULT_BROWSE_SORT_DIR = 'asc';
export const DEFAULT_COUNTRY_SORT = 'count';

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
        volume: 0.85,
        muted: false,
        lastStationKey: null,
        lastStationName: '',
        lastStationFavicon: '',
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

        return {
            favorites,
            recents,
            recentsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            muted: raw.muted === true,
            lastStationKey: lastKey || null,
            lastStationName: raw.lastStationName || '',
            lastStationFavicon: raw.lastStationFavicon || '',
            wasPlaying: raw.wasPlaying === true,
            catalogProvider: raw.catalogProvider || 'radio-browser',
            radioBrowserMirror: raw.radioBrowserMirror || null,
            hideOfflineStations: raw.hideOfflineStations !== false,
            browseSort: raw.browseSort || DEFAULT_BROWSE_SORT,
            browseSortDir,
            countrySort: raw.countrySort || DEFAULT_COUNTRY_SORT,
            castHostAudio: raw.castHostAudio === true
        };
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
    localStorage.setItem(RADIO_STATE_KEY, JSON.stringify(next));
    return next;
}
