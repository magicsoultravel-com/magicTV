/**
 * Bind-scope station index and station up/down navigation (single radio player).
 */
import { stationKey, parseStationKey } from './stationShape.js';
import { RadioProviderRegistry } from './radioProviders/registry.js';
import {
    getHideOfflineStations,
    getStationBindScope,
    loadRadioState
} from './radioState.js';
import { RadioPlayer } from './radioPlayer.js';

/**
 * @typedef {{ mode: 'favorites' }
 *   | { mode: 'folder', folderId: string }
 *   | { mode: 'country', countryCode: string }} StationBindScope
 */

/** Cap country bind lists — radio catalogs can be huge. */
export const STATION_COUNTRY_BIND_LIMIT = 200;

/** @type {Map<string, { keys: string[], numberByKey: Map<string, number> }>} */
const countryIndexCache = new Map();

export function clearCountryStationIndexCache() {
    countryIndexCache.clear();
}

/**
 * @param {StationBindScope | null | undefined} scope
 * @returns {string}
 */
export function bindScopeCacheKey(scope) {
    if (scope?.mode === 'folder') return `folder:${scope.folderId || ''}`;
    if (scope?.mode === 'country') return `country:${scope.countryCode || ''}`;
    return 'favorites';
}

/**
 * @param {StationBindScope | null | undefined} bindScope
 * @returns {{ keys: string[], numberByKey: Map<string, number> }}
 */
export function buildStationIndex(bindScope) {
    const scope = bindScope || { mode: 'favorites' };
    const keys = [];
    const numberByKey = new Map();

    if (scope.mode === 'country') {
        // Sync callers must use peek / await resolveStationIndex for country.
        return { keys, numberByKey };
    }

    const state = loadRadioState();

    if (scope.mode === 'folder') {
        const folder = (state.favoriteFolders || []).find((f) => f && f.id === scope.folderId);
        if (folder) {
            for (const key of folder.items || []) {
                if (key) keys.push(key);
            }
        }
    } else {
        for (const key of state.favorites || []) {
            if (key) keys.push(key);
        }
    }

    keys.forEach((key, i) => numberByKey.set(key, i + 1));
    return { keys, numberByKey };
}

/**
 * @param {string} countryCode
 * @returns {{ keys: string[], numberByKey: Map<string, number> } | null}
 */
export function peekCountryStationIndex(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return null;
    return countryIndexCache.get(code) || null;
}

/**
 * @param {string} countryCode
 * @returns {Promise<{ keys: string[], numberByKey: Map<string, number> }>}
 */
export async function buildCountryStationIndex(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return { keys: [], numberByKey: new Map() };
    const cached = countryIndexCache.get(code);
    if (cached) return cached;

    const provider = RadioProviderRegistry.getActive();
    const hideOffline = getHideOfflineStations();
    const batch = await provider.searchStations({
        countrycode: code,
        limit: STATION_COUNTRY_BIND_LIMIT,
        offset: 0,
        order: 'name',
        reverse: false,
        hideOffline
    });
    const keys = [];
    const numberByKey = new Map();
    for (const station of Array.isArray(batch) ? batch : []) {
        const key = stationKey(station);
        if (!key || numberByKey.has(key)) continue;
        keys.push(key);
        numberByKey.set(key, keys.length);
    }
    const result = { keys, numberByKey };
    countryIndexCache.set(code, result);
    return result;
}

/**
 * Sync peek for UI: favorites/folder always; country only if cached.
 * @param {StationBindScope | null | undefined} bindScope
 * @returns {{ keys: string[], numberByKey: Map<string, number> }}
 */
export function stationIndexForScope(bindScope) {
    const scope = bindScope || { mode: 'favorites' };
    if (scope.mode === 'country') {
        return peekCountryStationIndex(scope.countryCode)
            || { keys: [], numberByKey: new Map() };
    }
    return buildStationIndex(scope);
}

/**
 * @param {StationBindScope | null | undefined} bindScope
 * @returns {Promise<{ keys: string[], numberByKey: Map<string, number> }>}
 */
export async function resolveStationIndex(bindScope) {
    const scope = bindScope || { mode: 'favorites' };
    if (scope.mode === 'country') {
        return buildCountryStationIndex(scope.countryCode);
    }
    return buildStationIndex(scope);
}

function currentStationKey() {
    return stationKey(RadioPlayer.station) || loadRadioState().lastStationKey || '';
}

/**
 * @param {{ direction: 'up' | 'down', bindScope?: StationBindScope }} opts
 * @returns {Promise<{ key: string, number: number, station: object } | null>}
 */
export async function resolveAdjacentStation({ direction, bindScope } = {}) {
    const scope = bindScope || getStationBindScope();
    const { keys, numberByKey } = await resolveStationIndex(scope);
    if (!keys.length) return null;

    const currentKey = currentStationKey();
    let startIdx = keys.indexOf(currentKey);
    if (startIdx < 0) {
        startIdx = direction === 'up' ? -1 : 0;
    }

    const step = direction === 'up' ? 1 : -1;
    const len = keys.length;

    for (let n = 1; n <= len; n += 1) {
        const idx = ((startIdx + step * n) % len + len) % len;
        const key = keys[idx];

        let station = null;
        try {
            station = await RadioPlayer.resolveStation(key);
        } catch {
            station = null;
        }
        if (station?.url_resolved) {
            return { key, number: numberByKey.get(key) || idx + 1, station };
        }

        // Fallback: try provider directly if player stubbed in tests
        const parsed = parseStationKey(key);
        if (parsed?.stationId) {
            try {
                const provider = RadioProviderRegistry.get(parsed.providerId);
                station = await provider.getStationById(parsed.stationId);
            } catch {
                station = null;
            }
            if (station?.url_resolved) {
                return { key, number: numberByKey.get(key) || idx + 1, station };
            }
        }
    }
    return null;
}

/**
 * Navigate station up/down on the radio player.
 * @param {'up' | 'down'} direction
 * @param {{ showToast?: Function }} [options]
 * @returns {Promise<boolean>}
 */
export async function navigateStation(direction, { showToast = null } = {}) {
    const showAppToast = showToast || (await import('../ui/toast.js')).showAppToast;
    const scope = getStationBindScope();
    const result = await resolveAdjacentStation({ direction, bindScope: scope });
    if (!result) {
        const { keys } = await resolveStationIndex(scope);
        if (!keys.length) {
            showAppToast('No stations bound');
        } else {
            showAppToast('No other stations available');
        }
        return false;
    }
    await RadioPlayer.playStation(result.station);
    return true;
}
