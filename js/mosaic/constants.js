/**
 * Shared mosaic constants and small DOM helpers.
 */

export const CORNER_IDS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
export const SLOT_IDS = ['topLeft', 'center', 'topRight', 'bottomLeft', 'bottomRight'];
/** Fill order for batch play: primary first, then corners. */
export const MAX_MOSAIC_SLOTS = 5;
export const PLAY_FILL_ORDER = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

export const DRAG_THRESHOLD_PX = 6;
export const RESIZE_MIN_W = 72;
export const RESIZE_MIN_H = 64;
export const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']);

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
        'tv-swap--smooth',
        'tv-swap--slide',
        'tv-swap--fade',
        'tv-swap--spring',
        'tv-swap--crossfade',
        'tv-swap--flip',
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
