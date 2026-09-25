/**
 * Export / import user data (localStorage only — excludes IndexedDB tile/catalog caches).
 */
import { readPersistedState, writePersistedState, STATE_KEY } from './persistedState.js';
import {
    loadPlayerState,
    savePlayerState,
    getRecentsCap,
    normalizeWatchStatsMeta,
    normalizeChanBindScopeBySlot
} from './playerState.js';
import { canonicalizePersistedState, CORRUPT_BACKUP_KEY } from './stateMigration.js';
import { IndexedDBStore } from './indexedDbStore.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';

export const EXPORT_FORMAT = 'magictv-user-data';
export const EXPORT_VERSION = 1;
export const APP_VERSION = '1.0.0';

const CLOCK_STYLE_KEY = 'magic_tv_clock_style';
const CLOCK_HIDDEN_KEY = 'magic_tv_clock_hidden';
const CAST_HOST_AUDIO_KEY = 'magicTV:castHostAudio';
const CAST_HOST_VIDEO_KEY = 'magicTV:castHostVideo';
const CAST_STATE_KEY = 'magicTV:castState';

/** localStorage keys covered by export / Flush user data. */
const USER_DATA_EXTRA_KEYS = [
    CLOCK_STYLE_KEY,
    CLOCK_HIDDEN_KEY,
    CAST_HOST_AUDIO_KEY,
    CAST_HOST_VIDEO_KEY,
    CAST_STATE_KEY,
    CORRUPT_BACKUP_KEY
];

function readExtra(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeExtra(key, value) {
    try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
    } catch { /* ignore */ }
}

/** Accept tvClock '1'/'0' and legacy 'true'/'false'. */
function readBoolExtra(key) {
    const v = readExtra(key);
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return null;
}

function writeBoolExtra(key, value) {
    if (value == null) {
        writeExtra(key, null);
        return;
    }
    // Match tvClock persistence ('1' / '0').
    writeExtra(key, value ? '1' : '0');
}

function writeCastBoolExtra(key, value) {
    writeExtra(key, value == null ? null : String(Boolean(value)));
}

function cloneFolders(folders) {
    return (folders || []).map((f) => ({ ...f, items: [...(f.items || [])] }));
}

function newFolderId(prefix = 'f_imp') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function mergeChannelMetaList(localMeta, importedMeta) {
    const map = new Map();
    const add = (entry) => {
        if (!entry) return;
        const key = migrateFavoriteRef(typeof entry === 'string' ? entry : entry.key);
        if (!key) return;
        const name = (entry && entry.name) || '';
        const logo = (entry && entry.logo) || '';
        const countrycode = (entry && entry.countrycode) || '';
        const prev = map.get(key);
        if (!prev) {
            map.set(key, { key, name, logo, countrycode });
            return;
        }
        map.set(key, {
            key,
            name: prev.name || name,
            logo: prev.logo || logo,
            countrycode: prev.countrycode || countrycode
        });
    };
    (localMeta || []).forEach(add);
    (importedMeta || []).forEach(add);
    return [...map.values()];
}

function unionKeys(...arrays) {
    const seen = new Set();
    const out = [];
    for (const arr of arrays) {
        for (const raw of arr || []) {
            const key = migrateFavoriteRef(raw);
            if (key && !seen.has(key)) {
                seen.add(key);
                out.push(key);
            }
        }
    }
    return out;
}

function importedRecentsMeta(imported) {
    if (Array.isArray(imported.recentsMeta) && imported.recentsMeta.length) {
        return imported.recentsMeta.map((e) => ({
            key: migrateFavoriteRef(e?.key),
            name: e?.name || '',
            logo: e?.logo || '',
            countrycode: e?.countrycode || '',
            at: Number.isFinite(e?.at) ? e.at : 0
        })).filter((e) => e.key);
    }
    if (Array.isArray(imported.recents)) {
        return imported.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            logo: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

function mergeRecentsMetaList(localMeta, importedMeta, cap) {
    const map = new Map();
    const add = (entry) => {
        if (!entry?.key) return;
        const key = migrateFavoriteRef(entry.key);
        if (!key) return;
        const at = Number.isFinite(entry.at) ? entry.at : 0;
        const prev = map.get(key);
        if (!prev || at > prev.at) {
            map.set(key, {
                key,
                name: (prev?.name || entry.name) || '',
                logo: (prev?.logo || entry.logo) || '',
                countrycode: (prev?.countrycode || entry.countrycode) || '',
                at: Math.max(prev?.at || 0, at)
            });
        } else if (prev) {
            map.set(key, {
                ...prev,
                name: prev.name || entry.name || '',
                logo: prev.logo || entry.logo || '',
                countrycode: prev.countrycode || entry.countrycode || ''
            });
        }
    };
    (localMeta || []).forEach(add);
    (importedMeta || []).forEach(add);
    return [...map.values()]
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, cap);
}

function mergeFavoriteFoldersList(localFolders, importedFolders, favKeys) {
    const merged = cloneFolders(localFolders);
    const usedIds = new Set(merged.map((f) => f.id));
    for (const folder of importedFolders || []) {
        if (!folder || typeof folder !== 'object') continue;
        let id = typeof folder.id === 'string' ? folder.id.trim() : '';
        if (!id || usedIds.has(id)) id = newFolderId();
        usedIds.add(id);
        const seen = new Set();
        const items = (Array.isArray(folder.items) ? folder.items : [])
            .map(migrateFavoriteRef)
            .filter((k) => k && favKeys.has(k) && !seen.has(k) && (seen.add(k), true));
        merged.push({
            id,
            name: (folder.name || '').trim() || 'Folder',
            items
        });
    }
    return merged;
}

function mergeRootOrderList(localOrder, importedOrder, folders, favorites) {
    const folderIds = new Set(folders.map((f) => f.id));
    const favSet = new Set(favorites);
    const seen = new Set();
    const out = [];
    const push = (ref) => {
        const key = migrateFavoriteRef(ref);
        if (!key || seen.has(key)) return;
        if (folderIds.has(key) || favSet.has(key)) {
            seen.add(key);
            out.push(key);
        }
    };
    (localOrder || []).forEach(push);
    (importedOrder || []).forEach(push);
    favorites.forEach((k) => push(k));
    folders.forEach((f) => {
        if (!seen.has(f.id)) {
            seen.add(f.id);
            out.unshift(f.id);
        }
    });
    return out;
}

function mergeWatchStatsList(localMeta, importedMeta) {
    const map = new Map();
    const add = (entry) => {
        if (!entry?.key) return;
        const key = migrateFavoriteRef(entry.key);
        if (!key) return;
        const seconds = Number(entry.seconds);
        const sec = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        if (!sec) return;
        const prev = map.get(key);
        if (!prev) {
            map.set(key, {
                key,
                name: entry.name || '',
                logo: entry.logo || '',
                countrycode: entry.countrycode || '',
                seconds: sec
            });
            return;
        }
        map.set(key, {
            key,
            name: prev.name || entry.name || '',
            logo: prev.logo || entry.logo || '',
            countrycode: prev.countrycode || entry.countrycode || '',
            seconds: prev.seconds + sec
        });
    };
    (localMeta || []).forEach(add);
    (importedMeta || []).forEach(add);
    return normalizeWatchStatsMeta([...map.values()]);
}

function readExtras() {
    return {
        clockStyle: readExtra(CLOCK_STYLE_KEY),
        clockHidden: readBoolExtra(CLOCK_HIDDEN_KEY),
        castHostAudio: readBoolExtra(CAST_HOST_AUDIO_KEY),
        castHostVideo: readBoolExtra(CAST_HOST_VIDEO_KEY)
    };
}

export function buildUserDataExport() {
    const extras = readExtras();
    return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        state: canonicalizePersistedState(readPersistedState()),
        extras: {
            clockStyle: extras.clockStyle,
            clockHidden: extras.clockHidden === true,
            castHostAudio: extras.castHostAudio === true,
            castHostVideo: extras.castHostVideo === true
        }
    };
}

export function parseUserDataImport(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Invalid JSON file.');
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid backup file.');
    }
    if (parsed.format !== EXPORT_FORMAT) {
        throw new Error('Not a magicTV user data file.');
    }
    if (parsed.version !== EXPORT_VERSION) {
        throw new Error(`Unsupported backup version (${parsed.version}).`);
    }
    if (!parsed.state || typeof parsed.state !== 'object') {
        throw new Error('Backup is missing user state.');
    }
    return parsed;
}

export function summarizeUserData(payload) {
    const state = payload?.state || {};
    const favorites = Array.isArray(state.favorites) ? state.favorites.length : 0;
    const folders = Array.isArray(state.favoriteFolders) ? state.favoriteFolders.length : 0;
    const rootOrder = Array.isArray(state.favoritesRootOrder) ? state.favoritesRootOrder.length : 0;
    const recentsLen = Array.isArray(state.recentsMeta)
        ? state.recentsMeta.length
        : (Array.isArray(state.recents) ? state.recents.length : 0);
    const warnings = [];
    if (favorites > 0 && folders === 0) {
        warnings.push('Favorites present but no folders — replace will leave a flat library.');
    }
    if (favorites > 0 && rootOrder === 0 && folders === 0) {
        warnings.push('No favorites root order in this backup.');
    }
    if (state.stateSchemaVersion == null) {
        warnings.push('Backup has no stateSchemaVersion (older or sparse export).');
    }
    return {
        favorites,
        folders,
        recents: recentsLen,
        hidden: Array.isArray(state.hiddenChannels) ? state.hiddenChannels.length : 0,
        visited: Array.isArray(state.visitedChannels) ? state.visitedChannels.length : 0,
        watchStats: Array.isArray(state.watchStatsMeta) ? state.watchStatsMeta.length : 0,
        exportedAt: payload?.exportedAt || null,
        appVersion: payload?.appVersion || null,
        sparse: warnings.length > 0,
        warnings
    };
}

export function applyUserDataReplace(payload) {
    const next = canonicalizePersistedState(payload.state);
    writePersistedState(next, { force: true });
    const extras = payload.extras || {};
    if (extras.clockStyle != null) writeExtra(CLOCK_STYLE_KEY, extras.clockStyle);
    if (extras.clockHidden != null) writeBoolExtra(CLOCK_HIDDEN_KEY, extras.clockHidden);
    if (extras.castHostAudio != null) writeCastBoolExtra(CAST_HOST_AUDIO_KEY, extras.castHostAudio);
    if (extras.castHostVideo != null) writeCastBoolExtra(CAST_HOST_VIDEO_KEY, extras.castHostVideo);
}

export function applyUserDataMergeLibrary(payload) {
    const imported = payload.state || {};
    const local = loadPlayerState();

    const favorites = unionKeys(local.favorites, imported.favorites);
    const favKeys = new Set(favorites);
    const favoritesMeta = mergeChannelMetaList(local.favoritesMeta, imported.favoritesMeta);
    const favoriteFolders = mergeFavoriteFoldersList(
        local.favoriteFolders,
        imported.favoriteFolders,
        favKeys
    );
    const favoritesRootOrder = mergeRootOrderList(
        local.favoritesRootOrder,
        imported.favoritesRootOrder,
        favoriteFolders,
        favorites
    );

    const recentsMeta = mergeRecentsMetaList(
        local.recentsMeta,
        importedRecentsMeta(imported),
        getRecentsCap()
    );

    const hiddenChannels = unionKeys(local.hiddenChannels, imported.hiddenChannels);
    const hiddenChannelsMeta = mergeChannelMetaList(local.hiddenChannelsMeta, imported.hiddenChannelsMeta);

    const visitedChannels = unionKeys(local.visitedChannels, imported.visitedChannels);
    const visitedChannelsMeta = mergeChannelMetaList(local.visitedChannelsMeta, imported.visitedChannelsMeta);

    const watchStatsMeta = mergeWatchStatsList(local.watchStatsMeta, imported.watchStatsMeta);

    const chanBindScopeBySlot = normalizeChanBindScopeBySlot(
        {
            ...(local.chanBindScopeBySlot || {}),
            ...(imported.chanBindScopeBySlot || {})
        },
        favoriteFolders,
        imported.chanBindScopeBySlot ? null : imported.chanBindScope
    );

    savePlayerState({
        favorites,
        favoritesMeta,
        favoriteFolders,
        favoritesRootOrder,
        recentsMeta,
        hiddenChannels,
        hiddenChannelsMeta,
        visitedChannels,
        visitedChannelsMeta,
        watchStatsMeta,
        chanBindScopeBySlot
    });
}

export function downloadUserDataExport() {
    const payload = buildUserDataExport();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `magictv-user-data-${date}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Wipe exportable user data only (localStorage blob + extras).
 * Leaves IndexedDB tile/catalog caches alone.
 */
export function clearAllUserData() {
    try {
        localStorage.removeItem(STATE_KEY);
    } catch { /* ignore */ }
    for (const key of USER_DATA_EXTRA_KEYS) {
        writeExtra(key, null);
    }
}

function removeLocalStorageByPrefix(prefixes) {
    let keys = [];
    try {
        keys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key) keys.push(key);
        }
    } catch {
        return;
    }
    for (const key of keys) {
        if (prefixes.some((p) => key === p || key.startsWith(p))) {
            try {
                localStorage.removeItem(key);
            } catch { /* ignore */ }
        }
    }
}

/**
 * Last-resort wipe: all magicTV localStorage keys + IndexedDB caches.
 * Tile previews and catalog caches must be rebuilt after this.
 */
export async function factoryResetUserData() {
    clearAllUserData();
    removeLocalStorageByPrefix(['matrix_tv_', 'magic_tv_', 'magicTV:']);
    await IndexedDBStore.clear();
}
