/**
 * Appearance settings (text size / tile width).
 * Persists into the shared matrix_tv_state blob alongside catalog prefs.
 */
import { readPersistedState, patchPersistedState } from './persistedState.js';

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TILE_WIDTH = 180;
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 18;
const TILE_WIDTH_MIN = 100;
const TILE_WIDTH_MAX = 300;
const TILE_WIDTH_STEP = 10;

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
