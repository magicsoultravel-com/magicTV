/**
 * Boot-time rewrite of matrix_tv_state into the current canonical shape.
 * Keeps library + settings; strips legacy keys; can drop session chrome on quota.
 */
import {
    STATE_KEY,
    parsePersistedStateRaw,
    writePersistedState
} from './persistedState.js';
import { loadPlayerState } from './playerState.js';
import { migrateFavoriteRef } from '../tvProviders/channelShape.js';

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

/**
 * Build a canonical blob from the current store (or empty after corrupt reset).
 * @param {Record<string, any>} base
 */
function buildCanonicalState(base) {
    const player = loadPlayerState();
    const next = { ...base };

    next.favorites = player.favorites;
    next.favoritesMeta = player.favoritesMeta;
    next.favoriteFolders = player.favoriteFolders;
    next.favoritesRootOrder = player.favoritesRootOrder;
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

/**
 * Migrate legacy / unversioned matrix_tv_state once at boot.
 * @returns {{ migrated: boolean, repaired: boolean }}
 */
export function migratePersistedState() {
    let repaired = false;
    const parsed = parsePersistedStateRaw();

    if (!parsed.ok) {
        backupCorruptRaw();
        writePersistedState({}, { force: true });
        repaired = true;
    } else if (Number(parsed.value.stateSchemaVersion) >= STATE_SCHEMA_VERSION) {
        return { migrated: false, repaired: false };
    }

    const base = parsePersistedStateRaw().value;
    const next = buildCanonicalState(base);
    const written = writePersistedState(next, { force: true });
    if (written !== next) repaired = true;

    return { migrated: true, repaired };
}
