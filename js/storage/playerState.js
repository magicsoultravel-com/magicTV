/**
 * Player-relevant slice of matrix_tv_state (volume, buffer, last channel, lists).
 * Merges via shared persistedState so SettingsStore / registry patches survive.
 */
import { readPersistedState, patchPersistedState } from './persistedState.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';

export const DEFAULT_RECENTS_CAP = 20;
export const RECENTS_CAP_MIN = 0;
export const RECENTS_CAP_MAX = 100;


export const DEFAULT_VISITED_STYLE = 'accent-2';
export const VISITED_STYLES = ['undistinguished', 'accent-1', 'accent-2', 'accent-3'];
export const DEFAULT_NON_VISITED_STYLE = 'undistinguished';

export const DEFAULT_BUFFER_SIZE = 15;
export const MAX_BUFFER_SIZE = 120;
export const MIN_BUFFER_SIZE = 5;

export const DEFAULT_SORT_BY = Object.freeze({
    countries: 'stations',
    channels: 'name',
    favorites: 'custom',
    recents: 'recent'
});

export const DEFAULT_SORT_DIR = Object.freeze({
    countries: 'desc',
    channels: 'asc',
    favorites: 'asc',
    recents: 'desc'
});

export const DEFAULT_CATEGORY_FILTER = Object.freeze({
    channels: '',
    favorites: '',
    recents: ''
});

const SORT_BY_ALLOWED = {
    countries: new Set(['name', 'stations']),
    channels: new Set(['name', 'category']),
    favorites: new Set(['custom', 'name', 'country', 'category']),
    recents: new Set(['recent', 'name', 'country', 'category'])
};

const CATEGORY_FILTER_KEYS = ['channels', 'favorites', 'recents'];

function normalizeSortBy(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...DEFAULT_SORT_BY };
    for (const ctx of Object.keys(SORT_BY_ALLOWED)) {
        const value = src[ctx];
        if (SORT_BY_ALLOWED[ctx].has(value)) out[ctx] = value;
    }
    return out;
}

function normalizeSortDir(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...DEFAULT_SORT_DIR };
    for (const ctx of Object.keys(out)) {
        if (src[ctx] === 'asc' || src[ctx] === 'desc') out[ctx] = src[ctx];
    }
    return out;
}

function normalizeCategoryFilter(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...DEFAULT_CATEGORY_FILTER };
    for (const key of CATEGORY_FILTER_KEYS) {
        const value = src[key];
        if (typeof value === 'string') out[key] = value;
    }
    return out;
}

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

function normalizeFavoriteFolderEntry(entry, favKeys) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) return null;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const seen = new Set();
    const items = (Array.isArray(entry.items) ? entry.items : [])
        .map(migrateFavoriteRef)
        .filter((k) => k && favKeys.has(k) && !seen.has(k) && (seen.add(k), true));
    return { id, name: name || 'Folder', items };
}

function normalizeFavoriteFolders(favorites, rawFolders) {
    const favKeys = new Set(favorites);
    const seen = new Set();
    return (Array.isArray(rawFolders) ? rawFolders : [])
        .map((e) => normalizeFavoriteFolderEntry(e, favKeys))
        .filter((e) => e && !seen.has(e.id) && (seen.add(e.id), true));
}

/** Root-level channel key order only; folders live in favoriteFolders (always shown first). */
function normalizeFavoritesRootOrder(favorites, favoriteFolders, rawRootOrder) {
    const favKeys = new Set(favorites);
    const folderIds = new Set(favoriteFolders.map((f) => f.id));
    const keysInFolders = new Set(favoriteFolders.flatMap((f) => f.items));
    const seen = new Set();
    const out = [];

    const pushChannel = (ref) => {
        const key = migrateFavoriteRef(ref);
        if (!key || seen.has(key) || folderIds.has(key)) return;
        if (favKeys.has(key) && !keysInFolders.has(key)) {
            seen.add(key);
            out.push(key);
        }
    };

    if (Array.isArray(rawRootOrder) && rawRootOrder.length) {
        rawRootOrder.forEach(pushChannel);
    } else {
        favorites.forEach((k) => {
            if (!keysInFolders.has(k)) pushChannel(k);
        });
    }
    favorites.forEach((k) => {
        if (!keysInFolders.has(k)) pushChannel(k);
    });
    return out;
}

function normalizeHiddenMeta(hiddenChannels, hiddenChannelsMeta) {
    const hiddenKeys = new Set(hiddenChannels);
    const seen = new Set();
    return (Array.isArray(hiddenChannelsMeta) ? hiddenChannelsMeta : [])
        .map((e) => ({
            key: migrateFavoriteRef(typeof e === 'string' ? e : e?.key),
            name: (e && e.name) || '',
            logo: (e && e.logo) || '',
            countrycode: (e && e.countrycode) || ''
        }))
        .filter((e) => e.key && hiddenKeys.has(e.key) && !seen.has(e.key) && (seen.add(e.key), true));
}

function normalizeVisitedMeta(visitedChannels, visitedChannelsMeta) {
    const visitedKeys = new Set(visitedChannels);
    const seen = new Set();
    return (Array.isArray(visitedChannelsMeta) ? visitedChannelsMeta : [])
        .map((e) => ({
            key: migrateFavoriteRef(typeof e === 'string' ? e : e?.key),
            name: (e && e.name) || '',
            logo: (e && e.logo) || '',
            countrycode: (e && e.countrycode) || ''
        }))
        .filter((e) => e.key && visitedKeys.has(e.key) && !seen.has(e.key) && (seen.add(e.key), true));
}

export function normalizeWatchStatsMeta(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const key = migrateFavoriteRef(entry.key);
            if (!key || key.endsWith(':')) return null;
            const seconds = Number(entry.seconds);
            return {
                key,
                name: entry.name || '',
                logo: entry.logo || '',
                countrycode: entry.countrycode || '',
                seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0
            };
        })
        .filter((e) => e && e.seconds > 0 && !seen.has(e.key) && (seen.add(e.key), true));
}

const MOSAIC_SLOT_IDS = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

function normalizeMosaicSlots(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    MOSAIC_SLOT_IDS.forEach((id) => {
        const entry = raw[id];
        if (!entry) return;
        const key = migrateFavoriteRef(typeof entry === 'string' ? entry : entry.key);
        if (!key) return;
        const rawVol = typeof entry === 'object' ? Number(entry.volume) : NaN;
        out[id] = {
            key,
            name: (typeof entry === 'object' && entry.name) || '',
            muted: typeof entry === 'object' ? entry.muted !== false : true,
            volume: Number.isFinite(rawVol) ? Math.min(1, Math.max(0, rawVol)) : 1,
            url: (typeof entry === 'object' && (entry.url || entry.url_resolved)) || ''
        };
    });
    return out;
}

function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

/** Free-drag geometry per slot (fractions of mosaic size + z-order). */
function normalizeMosaicPlacement(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    MOSAIC_SLOT_IDS.forEach((id) => {
        const entry = raw[id];
        if (!entry || typeof entry !== 'object') return;
        const w = clamp01(Number(entry.w));
        const h = clamp01(Number(entry.h));
        if (w < 0.04 || h < 0.04) return;
        out[id] = {
            x: clamp01(Number(entry.x)),
            y: clamp01(Number(entry.y)),
            w,
            h,
            z: Number.isFinite(entry.z) ? Math.max(1, Math.round(entry.z)) : 1
        };
    });
    return out;
}

function normalizeModuleLayout(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const mode = raw.mode === 'split' ? 'split' : 'joined';
    const remoteHostKind = ['hidden', 'docked', 'undocked', 'os'].includes(raw.remoteHostKind)
        ? raw.remoteHostKind
        : null;
    let browserHostKind = raw.browserHostKind;
    if (mode === 'joined') browserHostKind = null;
    else if (!['docked', 'undocked', 'hidden', 'os'].includes(browserHostKind)) browserHostKind = 'undocked';
    const b = raw.browser && typeof raw.browser === 'object' ? raw.browser : {};
    const bl = Number(b.left);
    const bt = Number(b.top);
    const bw = Number(b.width);
    const bh = Number(b.height);
    const sheetW = Number(raw.browserSheetWidth);
    return {
        mode,
        remoteHostKind,
        browserHostKind,
        browser: {
            left: Number.isFinite(bl) ? bl : 300,
            top: Number.isFinite(bt) ? bt : 48,
            width: Number.isFinite(bw) && bw >= 240 ? bw : 320,
            height: Number.isFinite(bh) && bh >= 320 ? bh : 600,
            pinned: b.pinned === true
        },
        browserSheetWidth: Number.isFinite(sheetW)
            ? Math.min(0.55, Math.max(0.22, sheetW))
            : 0.36
    };
}

/** Floating remote module geometry (CSS px) + mode / pin / open / target + shell layout. */
function normalizeRemoteModule(raw, legacyPicker) {
    const src = raw && typeof raw === 'object' ? raw : legacyPicker;
    if (!src || typeof src !== 'object') return null;
    const left = Number(src.left);
    const top = Number(src.top);
    const width = Number(src.width);
    const height = Number(src.height);
    if (![left, top, width, height].every(Number.isFinite)) return null;
    if (width < 200 || height < 160) return null;
    const target = typeof src.targetSlotId === 'string' && MOSAIC_SLOT_IDS.includes(src.targetSlotId)
        ? src.targetSlotId
        : 'center';
    let mode = src.mode;
    if (!mode) mode = src.open === true ? 'undocked' : 'hidden';
    if (!['hidden', 'docked', 'undocked'].includes(mode)) mode = 'hidden';
    const sheetHeight = Number.isFinite(Number(src.sheetHeight))
        ? Math.min(0.85, Math.max(0.25, Number(src.sheetHeight)))
        : 0.45;
    const layout = normalizeModuleLayout(src.layout);
    return {
        left,
        top,
        width,
        height,
        mode,
        pinned: src.pinned === true,
        open: src.open === true,
        targetSlotId: target,
        sheetHeight,
        sheetExpanded: src.sheetExpanded !== false,
        dockSide: src.dockSide === 'right' ? 'right' : 'left',
        ...(layout ? { layout } : {})
    };
}

function normalizeChannelPicker(raw) {
    return normalizeRemoteModule(null, raw);
}

export function normalizeVisitedStyle(value, fallback = DEFAULT_VISITED_STYLE) {
    return VISITED_STYLES.includes(value) ? value : fallback;
}

/** Recents history cap, clamped to the 0..100 range enforced in settings. */
export function getRecentsCap() {
    const raw = readPersistedState().recentsCap;
    if (raw == null || raw === '') return DEFAULT_RECENTS_CAP;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_RECENTS_CAP;
    return Math.min(RECENTS_CAP_MAX, Math.max(RECENTS_CAP_MIN, Math.round(n)));
}

function normalizeVisitedChannels(raw) {
    if (!Array.isArray(raw.visitedChannels)) return [];
    const seen = new Set();
    const out = [];
    for (const key of raw.visitedChannels) {
        const migrated = migrateFavoriteRef(key);
        if (migrated && !seen.has(migrated)) {
            seen.add(migrated);
            out.push(migrated);
        }
    }
    return out;
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
        const visitedChannels = normalizeVisitedChannels(raw);
        const visitedChannelsMeta = normalizeVisitedMeta(visitedChannels, raw.visitedChannelsMeta);
        const hiddenChannels = Array.isArray(raw.hiddenChannels)
            ? raw.hiddenChannels.map(migrateFavoriteRef)
            : [];
        const hiddenChannelsMeta = normalizeHiddenMeta(hiddenChannels, raw.hiddenChannelsMeta);
        const favoriteFolders = normalizeFavoriteFolders(favorites, raw.favoriteFolders);
        const favoritesRootOrder = normalizeFavoritesRootOrder(
            favorites,
            favoriteFolders,
            raw.favoritesRootOrder
        );
        const watchStatsMeta = normalizeWatchStatsMeta(raw.watchStatsMeta);

        return {
            favorites,
            favoritesMeta,
            favoriteFolders,
            favoritesRootOrder,
            recents,
            recentsMeta,
            visitedChannels,
            visitedChannelsMeta,
            hiddenChannels,
            hiddenChannelsMeta,
            watchStatsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastChannelKey: raw.lastChannelKey || null,
            lastChannelName: raw.lastChannelName || '',
            wasPlaying: raw.wasPlaying === true,
            bufferSize: Number.isFinite(raw.bufferSize)
                ? Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, raw.bufferSize))
                : DEFAULT_BUFFER_SIZE,
            mosaicSlots: normalizeMosaicSlots(raw.mosaicSlots),
            mosaicPlacement: normalizeMosaicPlacement(raw.mosaicPlacement),
            remoteModule: normalizeRemoteModule(raw.remoteModule, raw.channelPicker),
            channelPicker: normalizeChannelPicker(raw.channelPicker),
            sortBy: normalizeSortBy(raw.sortBy),
            sortDir: normalizeSortDir(raw.sortDir),
            categoryFilter: normalizeCategoryFilter(raw.categoryFilter)
        };
    } catch {
        return {
            favorites: [],
            favoritesMeta: [],
            favoriteFolders: [],
            favoritesRootOrder: [],
            recents: [],
            recentsMeta: [],
            visitedChannels: [],
            visitedChannelsMeta: [],
            hiddenChannels: [],
            hiddenChannelsMeta: [],
            watchStatsMeta: [],
            volume: 0.85,
            lastChannelKey: null,
            lastChannelName: '',
            wasPlaying: false,
            bufferSize: DEFAULT_BUFFER_SIZE,
            mosaicSlots: {},
            mosaicPlacement: {},
            remoteModule: null,
            channelPicker: null,
            sortBy: { ...DEFAULT_SORT_BY },
            sortDir: { ...DEFAULT_SORT_DIR },
            categoryFilter: { ...DEFAULT_CATEGORY_FILTER }
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
    if (merged.favorites || merged.favoriteFolders || merged.favoritesRootOrder) {
        merged.favoriteFolders = normalizeFavoriteFolders(merged.favorites, merged.favoriteFolders);
        merged.favoritesRootOrder = normalizeFavoritesRootOrder(
            merged.favorites,
            merged.favoriteFolders,
            merged.favoritesRootOrder
        );
    }
    if (merged.hiddenChannels) {
        merged.hiddenChannelsMeta = normalizeHiddenMeta(merged.hiddenChannels, merged.hiddenChannelsMeta);
    }
    if (merged.visitedChannels) {
        merged.visitedChannels = normalizeVisitedChannels({ visitedChannels: merged.visitedChannels });
        merged.visitedChannelsMeta = normalizeVisitedMeta(merged.visitedChannels, merged.visitedChannelsMeta);
    }
    const sortBy = normalizeSortBy(merged.sortBy);
    const sortDir = normalizeSortDir(merged.sortDir);
    const categoryFilter = normalizeCategoryFilter(merged.categoryFilter);
    const payload = {
        favorites: merged.favorites,
        favoritesMeta: merged.favoritesMeta,
        favoriteFolders: merged.favoriteFolders,
        favoritesRootOrder: merged.favoritesRootOrder,
        recents: merged.recents,
        recentsMeta: merged.recentsMeta,
        visitedChannels: merged.visitedChannels,
        visitedChannelsMeta: merged.visitedChannelsMeta,
        hiddenChannels: merged.hiddenChannels,
        hiddenChannelsMeta: merged.hiddenChannelsMeta,
        volume: merged.volume,
        lastChannelKey: merged.lastChannelKey,
        lastChannelName: merged.lastChannelName,
        wasPlaying: merged.wasPlaying,
        bufferSize: merged.bufferSize,
        mosaicSlots: merged.mosaicSlots || {},
        mosaicPlacement: merged.mosaicPlacement || {},
        remoteModule: normalizeRemoteModule(merged.remoteModule, merged.channelPicker),
        channelPicker: normalizeChannelPicker(merged.channelPicker),
        sortBy,
        sortDir,
        categoryFilter
    };
    if ('watchStatsMeta' in patch) {
        payload.watchStatsMeta = normalizeWatchStatsMeta(merged.watchStatsMeta);
    }
    return patchPersistedState({
        ...payload,
        ...Object.fromEntries(
            Object.entries(patch).filter(([k]) => !(
                k === 'favorites' || k === 'favoritesMeta' || k === 'favoriteFolders'
                || k === 'favoritesRootOrder' || k === 'recents'
                || k === 'recentsMeta' || k === 'visitedChannels' || k === 'visitedChannelsMeta'
                || k === 'hiddenChannels' || k === 'hiddenChannelsMeta' || k === 'watchStatsMeta'
                || k === 'volume' || k === 'lastChannelKey'
                || k === 'lastChannelName' || k === 'wasPlaying' || k === 'bufferSize'
                || k === 'mosaicSlots' || k === 'mosaicPlacement' || k === 'remoteModule' || k === 'channelPicker'
                || k === 'sortBy' || k === 'sortDir' || k === 'categoryFilter'
            ))
        )
    });
}
