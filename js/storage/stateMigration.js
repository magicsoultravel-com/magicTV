/**
 * Boot-time rewrite of matrix_tv_state into the current canonical shape.
 * Keeps library + settings; strips legacy keys; can drop session chrome on quota.
 * Recovers favorite folders from library mirror / corrupt backup when possible.
 */
import {
    STATE_KEY,
    parsePersistedStateRaw,
    writePersistedState
} from './persistedState.js';
import { loadPlayerState } from './playerState.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';
import {
    mergeLibraryMirrorIntoState,
    writeLibraryMirror,
    hasFavoriteFolders,
    tryParseLibraryFromCorruptBackup,
    readLibraryMirror
} from './libraryMirror.js';

export const STATE_SCHEMA_VERSION = 1;
export const CORRUPT_BACKUP_KEY = 'matrix_tv_state_corrupt_backup';

const HEADER_MODES = new Set(['full', 'colorMark', 'greyMark', 'greyMarkBehind']);
const HEADER_MARK_MODES = new Set(['colorMark', 'greyMark', 'greyMarkBehind']);
const REMOTE_MODULE_OPACITY_MIN = 33;
const REMOTE_MODULE_OPACITY_MAX = 100;

function normalizeHeaderMode(value) {
    return HEADER_MODES.has(value) ? value : 'colorMark';
}

function clampRemoteModuleOpacity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 100;
    return Math.min(REMOTE_MODULE_OPACITY_MAX, Math.max(REMOTE_MODULE_OPACITY_MIN, Math.round(n)));
}

function backupCorruptRaw() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw == null || raw === '') return;
        localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
    } catch {
        /* ignore — best-effort */
    }
}

function applySettingsMigrations(next) {
    if (next.channelPickerOpacity != null && next.remoteModuleOpacity == null) {
        next.remoteModuleOpacity = clampRemoteModuleOpacity(next.channelPickerOpacity);
    }
    delete next.channelPickerOpacity;

    if (next.screenLeft != null && next.screenTopLeft == null) {
        next.screenTopLeft = Boolean(next.screenLeft);
    }
    if (next.screenRight != null && next.screenTopRight == null) {
        next.screenTopRight = Boolean(next.screenRight);
    }
    delete next.screenLeft;
    delete next.screenRight;

    if (next.headerMode == null && typeof next.headerCollapsed === 'boolean') {
        next.headerMode = next.headerCollapsed ? 'colorMark' : 'full';
    }
    if (next.headerMode != null) {
        next.headerMode = normalizeHeaderMode(next.headerMode);
        next.headerCollapsed = next.headerMode !== 'full';
        if (HEADER_MARK_MODES.has(next.headerMode)) {
            next.lastHeaderMark = next.headerMode;
        }
    }

    if (next.lastChannelKey) {
        next.lastChannelKey = migrateFavoriteRef(next.lastChannelKey) || null;
    }

    return next;
}

function pickLibraryFields(player, base) {
    const baseFolders = Array.isArray(base.favoriteFolders) ? base.favoriteFolders : [];
    const playerFolders = Array.isArray(player.favoriteFolders) ? player.favoriteFolders : [];

    // Never let empty load defaults overwrite non-empty base folders.
    if (!hasFavoriteFolders(playerFolders) && hasFavoriteFolders(baseFolders)) {
        const favorites = Array.isArray(player.favorites) && player.favorites.length
            ? player.favorites
            : (Array.isArray(base.favorites) ? base.favorites.map(migrateFavoriteRef) : []);
        return {
            favorites,
            favoritesMeta: Array.isArray(player.favoritesMeta) && player.favoritesMeta.length
                ? player.favoritesMeta
                : (base.favoritesMeta || []),
            favoriteFolders: baseFolders,
            favoritesRootOrder: Array.isArray(player.favoritesRootOrder)
                && player.favoritesRootOrder.length
                ? player.favoritesRootOrder
                : (base.favoritesRootOrder || [])
        };
    }

    return {
        favorites: player.favorites,
        favoritesMeta: player.favoritesMeta,
        favoriteFolders: playerFolders,
        favoritesRootOrder: player.favoritesRootOrder
    };
}

/**
 * Build a canonical blob from the current store (or empty after corrupt reset).
 * @param {Record<string, any>} base
 */
function buildCanonicalState(base) {
    const player = loadPlayerState();
    const next = { ...base };
    const library = pickLibraryFields(player, base);

    next.favorites = library.favorites;
    next.favoritesMeta = library.favoritesMeta;
    next.favoriteFolders = library.favoriteFolders;
    next.favoritesRootOrder = library.favoritesRootOrder;
    next.chanBindScopeBySlot = player.chanBindScopeBySlot;
    next.recents = player.recents;
    next.recentsMeta = player.recentsMeta;
    next.visitedChannels = player.visitedChannels;
    next.visitedChannelsMeta = player.visitedChannelsMeta;
    next.hiddenChannels = player.hiddenChannels;
    next.hiddenChannelsMeta = player.hiddenChannelsMeta;
    next.watchStatsMeta = player.watchStatsMeta;
    next.volume = player.volume;
    next.lastChannelKey = player.lastChannelKey;
    next.lastChannelName = player.lastChannelName;
    next.wasPlaying = player.wasPlaying;
    next.bufferSize = player.bufferSize;
    next.reattemptInterval = player.reattemptInterval;
    next.reattempts = player.reattempts;
    next.mosaicSlots = player.mosaicSlots;
    next.mosaicPlacement = player.mosaicPlacement;
    next.mosaicLayoutMode = player.mosaicLayoutMode;
    next.remoteModule = player.remoteModule;
    next.sortBy = player.sortBy;
    next.sortDir = player.sortDir;
    next.categoryFilter = player.categoryFilter;

    delete next.channelPicker;
    delete next.chanBindScope;

    applySettingsMigrations(next);
    next.stateSchemaVersion = STATE_SCHEMA_VERSION;
    return next;
}

function syncMirrorFromState(state) {
    if (!state || typeof state !== 'object') return;
    writeLibraryMirror({
        favorites: state.favorites,
        favoritesMeta: state.favoritesMeta,
        favoriteFolders: state.favoriteFolders,
        favoritesRootOrder: state.favoritesRootOrder
    });
}

/**
 * Recover a base object after corrupt main blob.
 * Prefer library mirror, then parseable corrupt backup library fields.
 * @returns {{ base: Record<string, any>, libraryRestored: boolean }}
 */
function recoverAfterCorrupt() {
    const fromMirror = mergeLibraryMirrorIntoState({});
    if (fromMirror.restored) {
        return { base: fromMirror.state, libraryRestored: true };
    }

    let corruptRaw = null;
    try {
        corruptRaw = localStorage.getItem(CORRUPT_BACKUP_KEY);
    } catch {
        corruptRaw = null;
    }
    const fromBackup = tryParseLibraryFromCorruptBackup(corruptRaw);
    if (fromBackup) {
        return { base: { ...fromBackup }, libraryRestored: true };
    }

    // Mirror may have favorites without folders — still better than empty.
    const mirror = readLibraryMirror();
    if (mirror && Array.isArray(mirror.favorites) && mirror.favorites.length) {
        return {
            base: {
                favorites: mirror.favorites,
                favoritesMeta: mirror.favoritesMeta || [],
                favoriteFolders: mirror.favoriteFolders || [],
                favoritesRootOrder: mirror.favoritesRootOrder || []
            },
            libraryRestored: hasFavoriteFolders(mirror.favoriteFolders)
        };
    }

    return { base: {}, libraryRestored: false };
}

/**
 * @param {Record<string, any>} state
 * @returns {{ state: Record<string, any>, restored: boolean } | null}
 *   null when no write needed
 */
function maybeReconcileFolders(state) {
    const { state: next, restored } = mergeLibraryMirrorIntoState(state);
    if (!restored) return null;
    return { state: next, restored: true };
}

/**
 * Migrate legacy / unversioned matrix_tv_state once at boot.
 * Also reconciles empty favoriteFolders from the library mirror.
 * @returns {{
 *   migrated: boolean,
 *   repaired: boolean,
 *   libraryRestored?: boolean,
 *   libraryWiped?: boolean
 * }}
 */
export function migratePersistedState() {
    let repaired = false;
    let libraryRestored = false;
    let libraryWiped = false;
    const parsed = parsePersistedStateRaw();

    if (!parsed.ok) {
        backupCorruptRaw();
        const recovered = recoverAfterCorrupt();
        writePersistedState(recovered.base, { force: true });
        repaired = true;
        libraryRestored = recovered.libraryRestored;
        libraryWiped = !recovered.libraryRestored;
    } else if (Number(parsed.value.stateSchemaVersion) >= STATE_SCHEMA_VERSION) {
        const reconciled = maybeReconcileFolders(parsed.value);
        if (reconciled) {
            const next = { ...reconciled.state, stateSchemaVersion: STATE_SCHEMA_VERSION };
            writePersistedState(next, { force: true });
            syncMirrorFromState(next);
            return {
                migrated: false,
                repaired: true,
                libraryRestored: true,
                libraryWiped: false
            };
        }
        return { migrated: false, repaired: false, libraryRestored: false, libraryWiped: false };
    }

    let base = parsePersistedStateRaw().value;
    const reconciled = maybeReconcileFolders(base);
    if (reconciled) {
        base = reconciled.state;
        libraryRestored = true;
        repaired = true;
        libraryWiped = false;
    }

    // Ensure storage matches base before loadPlayerState inside buildCanonicalState.
    if (reconciled || repaired) {
        writePersistedState(base, { force: true });
    }

    const next = buildCanonicalState(base);
    const written = writePersistedState(next, { force: true });
    if (written !== next) repaired = true;

    syncMirrorFromState(written);

    if (repaired && !libraryRestored && !hasFavoriteFolders(written.favoriteFolders)) {
        // Corrupt path with no recoverable library.
        libraryWiped = libraryWiped || !hasFavoriteFolders(written.favoriteFolders);
    }

    return {
        migrated: true,
        repaired,
        libraryRestored,
        libraryWiped: libraryWiped && !libraryRestored
    };
}
