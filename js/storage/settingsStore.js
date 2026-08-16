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
import {
    VIEW_TRANSITIONS,
    DEFAULT_VIEW_TRANSITION,
    normalizeViewTransition
} from '../ui/viewTransitions.js';

export {
    VIEW_TRANSITIONS,
    DEFAULT_VIEW_TRANSITION,
    normalizeViewTransition
} from '../ui/viewTransitions.js';

/** @deprecated Use VIEW_TRANSITIONS — kept for older imports. */
export const SWAP_TRANSITIONS = VIEW_TRANSITIONS;
/** @deprecated Use VIEW_TRANSITIONS — kept for older imports. */
export const CATALOG_TRANSITIONS = VIEW_TRANSITIONS;

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TILE_WIDTH = 180;
const DEFAULT_LIST_WIDTH = 300;
const DEFAULT_CATALOG_LAYOUT = 'tiles';
const DEFAULT_CHANNEL_PICKER_OPACITY = 100;
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 18;
const TILE_WIDTH_MIN = 100;
const TILE_WIDTH_MAX = 300;
const TILE_WIDTH_STEP = 10;
const LIST_WIDTH_MIN = 100;
const LIST_WIDTH_MAX = 300;
const LIST_WIDTH_STEP = 10;
const CHANNEL_PICKER_OPACITY_MIN = 33;
const CHANNEL_PICKER_OPACITY_MAX = 100;
const CATALOG_LAYOUTS = ['tiles', 'list'];

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

function clampChannelPickerOpacity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_CHANNEL_PICKER_OPACITY;
    return Math.min(
        CHANNEL_PICKER_OPACITY_MAX,
        Math.max(CHANNEL_PICKER_OPACITY_MIN, Math.round(n))
    );
}

function normalizeCatalogLayout(value) {
    return CATALOG_LAYOUTS.includes(value) ? value : DEFAULT_CATALOG_LAYOUT;
}

function normalizeThemeId(value) {
    if (typeof value === 'string' && THEME_PRESETS[value]) return value;
    return DEFAULT_THEME_ID;
}

/** Read a screen flag with legacy left/right migration into topLeft/topRight. */
function readScreenFlag(primaryKey, legacyKey) {
    const raw = readPersistedState();
    if (Object.prototype.hasOwnProperty.call(raw, primaryKey)) {
        return Boolean(raw[primaryKey]);
    }
    if (legacyKey && Object.prototype.hasOwnProperty.call(raw, legacyKey)) {
        return Boolean(raw[legacyKey]);
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

    getTextSizeOptions() {
        return Array.from(
            { length: TEXT_SIZE_MAX - TEXT_SIZE_MIN + 1 },
            (_, i) => TEXT_SIZE_MIN + i
        );
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

    getTileWidthOptions() {
        return Array.from(
            { length: (TILE_WIDTH_MAX - TILE_WIDTH_MIN) / TILE_WIDTH_STEP + 1 },
            (_, i) => TILE_WIDTH_MIN + i * TILE_WIDTH_STEP
        );
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

    getListWidthOptions() {
        return Array.from(
            { length: (LIST_WIDTH_MAX - LIST_WIDTH_MIN) / LIST_WIDTH_STEP + 1 },
            (_, i) => LIST_WIDTH_MIN + i * LIST_WIDTH_STEP
        );
    },

    getChannelPickerOpacity() {
        const raw = readPersistedState();
        return raw.channelPickerOpacity != null
            ? clampChannelPickerOpacity(raw.channelPickerOpacity)
            : DEFAULT_CHANNEL_PICKER_OPACITY;
    },

    setChannelPickerOpacity(value) {
        const clampedValue = clampChannelPickerOpacity(value);
        patchPersistedState({ channelPickerOpacity: clampedValue });
        return clampedValue;
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
        const channelPickerOpacity = this.setChannelPickerOpacity(DEFAULT_CHANNEL_PICKER_OPACITY);
        const catalogLayout = this.setCatalogLayout(DEFAULT_CATALOG_LAYOUT);
        const colors = this.setThemeColors(getPresetColors(themeId));
        const fontId = this.setFontId(getPresetFontId(themeId));
        return {
            themeId,
            textSize,
            tileWidth,
            listWidth,
            channelPickerOpacity,
            catalogLayout,
            colors,
            fontId
        };
    },

    getScreenTopLeft() {
        return readScreenFlag('screenTopLeft', 'screenLeft');
    },

    setScreenTopLeft(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenTopLeft: next, screenLeft: next });
        return next;
    },

    getScreenTopRight() {
        return readScreenFlag('screenTopRight', 'screenRight');
    },

    setScreenTopRight(enabled) {
        const next = Boolean(enabled);
        patchPersistedState({ screenTopRight: next, screenRight: next });
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

    getSwapTransition() {
        return normalizeViewTransition(readPersistedState().swapTransition);
    },

    setSwapTransition(value) {
        const next = normalizeViewTransition(value);
        patchPersistedState({ swapTransition: next });
        return next;
    },

    getSwapTransitionOptions() {
        return VIEW_TRANSITIONS.slice();
    },

    getCatalogCollapsed() {
        return Boolean(readPersistedState().catalogCollapsed);
    },

    setCatalogCollapsed(collapsed) {
        const next = Boolean(collapsed);
        patchPersistedState({ catalogCollapsed: next });
        return next;
    },

    getContentSplit() {
        const raw = readPersistedState().contentSplit;
        const n = Number(raw);
        if (!Number.isFinite(n)) return 50;
        return Math.min(85, Math.max(15, Math.round(n)));
    },

    setContentSplit(value) {
        const n = Number(value);
        const next = Number.isFinite(n)
            ? Math.min(85, Math.max(15, Math.round(n)))
            : 50;
        patchPersistedState({ contentSplit: next });
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

    getCatalogTransitionOptions() {
        return VIEW_TRANSITIONS.slice();
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
    }
};
