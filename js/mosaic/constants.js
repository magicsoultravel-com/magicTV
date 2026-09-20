/**
 * Shared mosaic constants and small DOM helpers.
 */

import { TILE_SWAP_DURATIONS } from '../ui/viewTransitions.js';

/** Absolute hard cap for mosaic screens (settings may lower this). */
export const HARD_MAX_MOSAIC_SLOTS = 9;
/** Default user-facing max until they change Settings → Max TVs. */
export const DEFAULT_MAX_MOSAIC_SLOTS = 6;

export const CORNER_IDS = [
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'bottomCenter',
    'topCenter',
    'midLeft',
    'midRight'
];
export const SLOT_IDS = [
    'topLeft',
    'center',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'bottomCenter',
    'topCenter',
    'midLeft',
    'midRight'
];
/** Fill order for batch play: primary first, then satellites. */
export const MAX_MOSAIC_SLOTS = HARD_MAX_MOSAIC_SLOTS;
export const PLAY_FILL_ORDER = [
    'center',
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'bottomCenter',
    'topCenter',
    'midLeft',
    'midRight'
];

/** 1-based TV labels matching remote/guide screen numbering. */
export const SLOT_SCREEN_LABELS = Object.freeze({
    center: '1',
    topLeft: '2',
    topRight: '3',
    bottomLeft: '4',
    bottomRight: '5',
    bottomCenter: '6',
    topCenter: '7',
    midLeft: '8',
    midRight: '9'
});

/**
 * Outline / accent index 1–3 cycling by screen label (TV1→1, TV2→2, TV3→3, TV4→1, …).
 * @param {string} slotId
 * @returns {1|2|3}
 */
export function slotOutlineAccent(slotId) {
    const label = Number(SLOT_SCREEN_LABELS[slotId] || '1');
    const n = Number.isFinite(label) && label > 0 ? label : 1;
    return /** @type {1|2|3} */ (((n - 1) % 3) + 1);
}

/**
 * Outline intensity band by screen label: 1–3 full, 4–6 soft, 7–9 softer.
 * @param {string} slotId
 * @returns {'full'|'soft'|'softer'}
 */
export function slotOutlineIntensity(slotId) {
    const label = Number(SLOT_SCREEN_LABELS[slotId] || '1');
    const n = Number.isFinite(label) && label > 0 ? label : 1;
    if (n <= 3) return 'full';
    if (n <= 6) return 'soft';
    return 'softer';
}

/**
 * Stamp mosaic / strip outline attrs from slot id.
 * @param {HTMLElement | null | undefined} el
 * @param {string} slotId
 */
export function applySlotOutlineAttrs(el, slotId) {
    if (!el) return;
    el.dataset.outlineAccent = String(slotOutlineAccent(slotId));
    el.dataset.outlineIntensity = slotOutlineIntensity(slotId);
}

export const DRAG_THRESHOLD_PX = 6;
export const RESIZE_MIN_W = 72;
export const RESIZE_MIN_H = 64;
export const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']);

/** Mode classes applied during CSS tile swaps — keep in sync with TILE_SWAP_DURATIONS. */
const SWAP_MODE_CLASSES = Object.keys(TILE_SWAP_DURATIONS).map((mode) => `tv-swap--${mode}`);

export function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearSwapClasses(tile) {
    if (!tile) return;
    tile.classList.remove(
        'tv-swap-out',
        'tv-swap-in',
        ...SWAP_MODE_CLASSES,
        'is-swapping'
    );
}

export function clearTilePlacementStyle(tile) {
    if (!tile) return;
    tile.style.left = '';
    tile.style.top = '';
    tile.style.width = '';
    tile.style.height = '';
    tile.style.zIndex = '';
    tile.classList.remove('is-placed');
}

/**
 * A slot is occupied if it has a live channel OR a remembered mosaicSlots key.
 * @param {object | null | undefined} playerChannel
 * @param {string | null | undefined} rememberedKey
 */
export function slotIsOccupied(playerChannel, rememberedKey) {
    return Boolean(playerChannel) || Boolean(rememberedKey);
}
