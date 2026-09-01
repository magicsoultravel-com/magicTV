/**
 * Appearance settings (text size / tile width / list width / theme colors).
 * Persists into the shared matrix_tv_state blob alongside catalog prefs.
 */
import { readPersistedState, patchPersistedState } from './persistedState.js';
import {
    DEFAULT_THEME_ID,
    THEME_PRESETS,
    getPresetColors,
    getPresetFontId,
    normalizeFontId,
    sanitizeThemeColors
} from '../ui/themes.js';
import { normalizeViewTransition } from '../ui/viewTransitions.js';
import { normalizeRemoteTexture } from '../ui/remoteTextures.js';
import {
    DEFAULT_RECENTS_CAP,
    RECENTS_CAP_MIN,
    RECENTS_CAP_MAX,
    DEFAULT_VISITED_STYLE,
    DEFAULT_NON_VISITED_STYLE,
    normalizeVisitedStyle,
    getRecentsCap,
    loadPlayerState,
    savePlayerState
} from './playerState.js';

export {
    VIEW_TRANSITIONS,
    DEFAULT_VIEW_TRANSITION,
    normalizeViewTransition
} from '../ui/viewTransitions.js';

const DEFAULT_TEXT_SIZE = 12;
const DEFAULT_TILE_WIDTH = 120;
const DEFAULT_LIST_WIDTH = 120;
const DEFAULT_CATALOG_LAYOUT = 'tiles';
const DEFAULT_REMOTE_MODULE_OPACITY = 100;
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 18;
const TILE_WIDTH_MIN = 100;
const TILE_WIDTH_MAX = 300;
const TILE_WIDTH_STEP = 10;
const LIST_WIDTH_MIN = 100;
const LIST_WIDTH_MAX = 300;
const LIST_WIDTH_STEP = 10;
const REMOTE_MODULE_OPACITY_MIN = 33;
const REMOTE_MODULE_OPACITY_MAX = 100;
const DEFAULT_REMOTE_IDLE_FADE_ENABLED = true;
const DEFAULT_REMOTE_IDLE_DELAY_SEC = 10;
const DEFAULT_REMOTE_IDLE_FADE_SEC = 10;
const REMOTE_IDLE_DELAY_MIN = 0;
const REMOTE_IDLE_DELAY_MAX = 300;
const REMOTE_IDLE_FADE_MIN = 1;
const REMOTE_IDLE_FADE_MAX = 120;
const DEFAULT_REMOTE_TEXTURE = 'none';
const CATALOG_LAYOUTS = ['tiles', 'list'];
const DEFAULT_ACTIVE_TILE_STYLE = 'wave';
const ACTIVE_TILE_STYLES = ['none', 'wave', 'pulse', 'visualizer'];
export const CHAN_SWITCH_MODES = ['classic', 'safeLoading'];
const DEFAULT_CHAN_SWITCH_MODE = 'classic';

function normalizeChanSwitchMode(value) {
    return CHAN_SWITCH_MODES.includes(value) ? value : DEFAULT_CHAN_SWITCH_MODE;
}

function clampTextSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TEXT_SIZE;
    return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)));
}

function clampTileWidth(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TILE_WIDTH;
    const rounded = Math.round(n / TILE_WIDTH_STEP) * TILE_WIDTH_STEP;
    return Math.min(TILE_WIDTH_MAX, Math.max(TILE_WIDTH_MIN, rounded));
}

function clampListWidth(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_LIST_WIDTH;
    const rounded = Math.round(n / LIST_WIDTH_STEP) * LIST_WIDTH_STEP;
    return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, rounded));
}

function clampRemoteModuleOpacity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_REMOTE_MODULE_OPACITY;
    return Math.min(
        REMOTE_MODULE_OPACITY_MAX,
        Math.max(REMOTE_MODULE_OPACITY_MIN, Math.round(n))
    );
}

function clampRemoteIdleDelaySec(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_REMOTE_IDLE_DELAY_SEC;
    return Math.min(REMOTE_IDLE_DELAY_MAX, Math.max(REMOTE_IDLE_DELAY_MIN, Math.round(n)));
}

function clampRemoteIdleFadeSec(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_REMOTE_IDLE_FADE_SEC;
    return Math.min(REMOTE_IDLE_FADE_MAX, Math.max(REMOTE_IDLE_FADE_MIN, Math.round(n)));
}

function normalizeCatalogLayout(value) {
    return CATALOG_LAYOUTS.includes(value) ? value : DEFAULT_CATALOG_LAYOUT;
}

function normalizeActiveTileStyle(value) {
    return ACTIVE_TILE_STYLES.includes(value) ? value : DEFAULT_ACTIVE_TILE_STYLE;
}

function clampRecentsCap(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_RECENTS_CAP;
    return Math.min(RECENTS_CAP_MAX, Math.max(RECENTS_CAP_MIN, Math.round(n)));
}

function normalizeThemeId(value) {
    if (typeof value === 'string' && THEME_PRESETS[value]) return value;
    return DEFAULT_THEME_ID;
}

/** Read a screen flag; migrate legacy left/right keys into topLeft/topRight once. */
function readScreenFlag(primaryKey, legacyKey) {
    const raw = readPersistedState();
    if (Object.prototype.hasOwnProperty.call(raw, primaryKey)) {
        return Boolean(raw[primaryKey]);
    }
    if (legacyKey && Object.prototype.hasOwnProperty.call(raw, legacyKey)) {
        const value = Boolean(raw[legacyKey]);
        patchPersistedState({ [primaryKey]: value, [legacyKey]: undefined });
        return value;
    }
    return false;
}

export const SettingsStore = {
    getTextSize() {
        const raw = readPersistedState();
        return raw.textSize != null ? clampTextSize(raw.textSize) : DEFAULT_TEXT_SIZE;
    },

    setTextSize(value) {
        const clampedValue = clampTextSize(value);
        patchPersistedState({ textSize: clampedValue });
        return clampedValue;
    },

    getTileWidth() {
        const raw = readPersistedState();
        return raw.tileWidth != null ? clampTileWidth(raw.tileWidth) : DEFAULT_TILE_WIDTH;
    },

    setTileWidth(value) {
        const clampedValue = clampTileWidth(value);
        patchPersistedState({ tileWidth: clampedValue });
        return clampedValue;
    },

    getListWidth() {
        const raw = readPersistedState();
        return raw.listWidth != null ? clampListWidth(raw.listWidth) : DEFAULT_LIST_WIDTH;
    },

    setListWidth(value) {
        const clampedValue = clampListWidth(value);
        patchPersistedState({ listWidth: clampedValue });
        return clampedValue;
    },

    getRemoteModuleOpacity() {
        const raw = readPersistedState();
        if (raw.remoteModuleOpacity != null) {
            return clampRemoteModuleOpacity(raw.remoteModuleOpacity);
        }
        if (raw.channelPickerOpacity != null) {
            const migrated = clampRemoteModuleOpacity(raw.channelPickerOpacity);
            patchPersistedState({
                remoteModuleOpacity: migrated,
                channelPickerOpacity: undefined
            });
            return migrated;
        }
        return DEFAULT_REMOTE_MODULE_OPACITY;
    },

    setRemoteModuleOpacity(value) {
        const clampedValue = clampRemoteModuleOpacity(value);
        patchPersistedState({
            remoteModuleOpacity: clampedValue,
            channelPickerOpacity: undefined
        });
        return clampedValue;
    },

    getRemoteIdleFadeEnabled() {
        const raw = readPersistedState();
        return raw.remoteIdleFadeEnabled != null
            ? raw.remoteIdleFadeEnabled === true
            : DEFAULT_REMOTE_IDLE_FADE_ENABLED;
    },

    setRemoteIdleFadeEnabled(value) {
        const next = value === true;
        patchPersistedState({ remoteIdleFadeEnabled: next });
        return next;
    },

    getRemoteIdleDelaySec() {
        const raw = readPersistedState();
        return raw.remoteIdleDelaySec != null
            ? clampRemoteIdleDelaySec(raw.remoteIdleDelaySec)
            : DEFAULT_REMOTE_IDLE_DELAY_SEC;
    },

    setRemoteIdleDelaySec(value) {
        const clampedValue = clampRemoteIdleDelaySec(value);
        patchPersistedState({ remoteIdleDelaySec: clampedValue });
        return clampedValue;
    },

    getRemoteIdleFadeSec() {
        const raw = readPersistedState();
        return raw.remoteIdleFadeSec != null
            ? clampRemoteIdleFadeSec(raw.remoteIdleFadeSec)
            : DEFAULT_REMOTE_IDLE_FADE_SEC;
    },

    setRemoteIdleFadeSec(value) {
        const clampedValue = clampRemoteIdleFadeSec(value);
        patchPersistedState({ remoteIdleFadeSec: clampedValue });
        return clampedValue;
    },

    getRemoteTexture() {
        const raw = readPersistedState();
        return normalizeRemoteTexture(raw.remoteTexture);
    },

    setRemoteTexture(value) {
        const next = normalizeRemoteTexture(value);
        patchPersistedState({ remoteTexture: next });
        return next;
    },

    getCatalogLayout() {
        const raw = readPersistedState();
        return normalizeCatalogLayout(raw.catalogLayout);
    },

    setCatalogLayout(value) {
        const next = normalizeCatalogLayout(value);
        patchPersistedState({ catalogLayout: next });
        return next;
    },

    getThemeId() {
        const raw = readPersistedState();
        return normalizeThemeId(raw.themeId);
    },

    setThemeId(themeId, { resetColors = true } = {}) {
        const id = normalizeThemeId(themeId);
        if (resetColors) {
            patchPersistedState({
                themeId: id,
                themeColors: getPresetColors(id),
                fontId: getPresetFontId(id)
            });
        } else {
            patchPersistedState({ themeId: id });
        }
        return id;
    },

    getFontId() {
        const raw = readPersistedState();
        if (raw.fontId != null) return normalizeFontId(raw.fontId);
        return getPresetFontId(normalizeThemeId(raw.themeId));
    },

    setFontId(fontId) {
        const id = normalizeFontId(fontId);
        patchPersistedState({ fontId: id });
        return id;
    },

    getThemeColors() {
        const raw = readPersistedState();
        const themeId = normalizeThemeId(raw.themeId);
        return sanitizeThemeColors(raw.themeColors, themeId);
    },

    setThemeColor(key, value) {
        const themeId = this.getThemeId();
        const colors = sanitizeThemeColors(
            { ...this.getThemeColors(), [key]: value },
            themeId
        );
        patchPersistedState({ themeColors: colors });
        return colors;
    },

    setThemeColors(colors) {
        const themeId = this.getThemeId();
        const next = sanitizeThemeColors(colors, themeId);
        patchPersistedState({ themeColors: next });
        return next;
    },

    resetAppearance() {
        const themeId = this.getThemeId();
        const textSize = this.setTextSize(DEFAULT_TEXT_SIZE);
        const tileWidth = this.setTileWidth(DEFAULT_TILE_WIDTH);
        const listWidth = this.setListWidth(DEFAULT_LIST_WIDTH);
        const remoteModuleOpacity = this.setRemoteModuleOpacity(DEFAULT_REMOTE_MODULE_OPACITY);
        const remoteIdleFadeEnabled = this.setRemoteIdleFadeEnabled(DEFAULT_REMOTE_IDLE_FADE_ENABLED);
        const remoteIdleDelaySec = this.setRemoteIdleDelaySec(DEFAULT_REMOTE_IDLE_DELAY_SEC);
        const remoteIdleFadeSec = this.setRemoteIdleFadeSec(DEFAULT_REMOTE_IDLE_FADE_SEC);
        const remoteTexture = this.setRemoteTexture(DEFAULT_REMOTE_TEXTURE);
        const catalogLayout = this.setCatalogLayout(DEFAULT_CATALOG_LAYOUT);
        const activeTileStyle = this.setActiveTileStyle(DEFAULT_ACTIVE_TILE_STYLE);
        const visitedStyle = this.setVisitedStyle(DEFAULT_VISITED_STYLE);
        const nonVisitedStyle = this.setNonVisitedStyle(DEFAULT_NON_VISITED_STYLE);
        const colors = this.setThemeColors(getPresetColors(themeId));
        const fontId = this.setFontId(getPresetFontId(themeId));
        return {
            themeId,
            textSize,
            tileWidth,
            listWidth,
            remoteModuleOpacity,
            remoteIdleFadeEnabled,
            remoteIdleDelaySec,
            remoteIdleFadeSec,
            remoteTexture,
            catalogLayout,
            activeTileStyle,
            visitedStyle,
            nonVisitedStyle,
            colors,
            fontId
        };
    },

    getScreenTopLeft() {
        return readScreenFlag('screenTopLeft', 'screenLeft');
    },

    setScreenTopLeft(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenTopLeft: next, screenLeft: undefined });
        return next;
    },

    getScreenTopRight() {
        return readScreenFlag('screenTopRight', 'screenRight');
    },

    setScreenTopRight(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenTopRight: next, screenRight: undefined });
        return next;
    },

    getScreenBottomLeft() {
        return readScreenFlag('screenBottomLeft', null);
    },

    setScreenBottomLeft(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenBottomLeft: next });
        return next;
    },

    getScreenBottomRight() {
        return readScreenFlag('screenBottomRight', null);
    },

    setScreenBottomRight(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenBottomRight: next });
        return next;
    },

    getScreenBottomCenter() {
        return readScreenFlag('screenBottomCenter', null);
    },

    setScreenBottomCenter(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenBottomCenter: next });
        return next;
    },

    getSwapTransition() {
        return normalizeViewTransition(readPersistedState().swapTransition);
    },

    setSwapTransition(value) {
        const next = normalizeViewTransition(value);
        patchPersistedState({ swapTransition: next });
        return next;
    },

    getChanSwitchMode() {
        return normalizeChanSwitchMode(readPersistedState().chanSwitchMode);
    },

    setChanSwitchMode(value) {
        const next = normalizeChanSwitchMode(value);
        patchPersistedState({ chanSwitchMode: next });
        return next;
    },

    getCatalogTransition() {
        return normalizeViewTransition(readPersistedState().catalogTransition);
    },

    setCatalogTransition(value) {
        const next = normalizeViewTransition(value);
        patchPersistedState({ catalogTransition: next });
        return next;
    },

    getActiveTileStyle() {
        return normalizeActiveTileStyle(readPersistedState().activeTileStyle);
    },

    setActiveTileStyle(value) {
        const next = normalizeActiveTileStyle(value);
        patchPersistedState({ activeTileStyle: next });
        return next;
    },

    getRecentsCap() {
        return getRecentsCap();
    },

    setRecentsCap(value) {
        const next = clampRecentsCap(value);
        patchPersistedState({ recentsCap: next });
        // Trim any recents already recorded beyond the new cap.
        const { recentsMeta } = loadPlayerState();
        if (recentsMeta.length > next) {
            savePlayerState({ recentsMeta: recentsMeta.slice(0, next) });
        }
        return next;
    },

    getVisitedStyle() {
        return normalizeVisitedStyle(readPersistedState().visitedStyle, DEFAULT_VISITED_STYLE);
    },

    setVisitedStyle(value) {
        const next = normalizeVisitedStyle(value, DEFAULT_VISITED_STYLE);
        patchPersistedState({ visitedStyle: next });
        return next;
    },

    getNonVisitedStyle() {
        return normalizeVisitedStyle(readPersistedState().nonVisitedStyle, DEFAULT_NON_VISITED_STYLE);
    },

    setNonVisitedStyle(value) {
        const next = normalizeVisitedStyle(value, DEFAULT_NON_VISITED_STYLE);
        patchPersistedState({ nonVisitedStyle: next });
        return next;
    },

    /** Last-channel fields used by the shell header / resume path. */
    loadLastChannelMeta() {
        const raw = readPersistedState();
        if (!raw.lastChannelKey) {
            return { lastKey: null, lastName: '', lastCountry: '' };
        }
        return {
            lastKey: raw.lastChannelKey,
            lastName: raw.lastChannelName || 'Last channel',
            lastCountry: ''
        };
    },

    getHeaderCollapsed() {
        const raw = readPersistedState();
        return raw.headerCollapsed === true;
    },

    setHeaderCollapsed(value) {
        const next = value === true;
        patchPersistedState({ headerCollapsed: next });
        return next;
    }
};
