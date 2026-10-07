/**
 * Shared mosaic tile travel: FLIP position + size after layout or channel moves.
 */
import { SettingsStore } from '../storage/settingsStore.js';
import { normalizeViewTransition } from '../ui/viewTransitions.js';
import { el } from '../tvUtils.js';
import { prefersReducedMotion, waitMs } from './constants.js';

export const TILE_TRAVEL_MS = 480;
export const TILE_TRAVEL_STAGGER_MS = 45;
export const TILE_TRAVEL_SETTLE_MS = 80;

const TRAVEL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * @typedef {{ durationMs?: number, staggerMs?: number, easing?: string, settleMs?: number }} TileTravelOpts
 */

/** Whether mosaic travel animations should run (does not consume random deck). */
export function travelAnimationsEnabled() {
    if (prefersReducedMotion()) return false;
    // Prefer stored preference — `random` still animates; only `instant` skips.
    return normalizeViewTransition(SettingsStore.getSwapTransition()) !== 'instant';
}

/**
 * Viewport rects for mosaic tiles. Returns null if any id is unmeasurable.
 * @param {string[]} slotIds
 * @returns {Map<string, DOMRect> | null}
 */
export function captureTileRects(slotIds) {
    if (typeof document === 'undefined' || !Array.isArray(slotIds) || !slotIds.length) return null;
    const rects = new Map();
    for (const id of slotIds) {
        const tile = el(`player-tile-${id}`);
        if (!tile || tile.classList.contains('is-hidden')) return null;
        const rect = tile.getBoundingClientRect?.() || null;
        if (!rect || rect.width < 8 || rect.height < 8) return null;
        rects.set(id, rect);
    }
    return rects;
}

/**
 * Invert a tile from `first` rect to its current box, then animate to identity.
 * @param {HTMLElement} tile
 * @param {DOMRect} first
 * @param {number} delayMs
 * @param {TileTravelOpts} [opts]
 * @returns {boolean}
 */
function applyFlipFromRect(tile, first, delayMs = 0, opts = {}) {
    if (!tile || !first) return false;
    const last = tile.getBoundingClientRect?.();
    if (!last || last.width < 8 || last.height < 8) return false;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5
        && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
        return false;
    }
    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : TILE_TRAVEL_MS;
    const easing = opts.easing || TRAVEL_EASING;
    tile.classList.add('is-tile-traveling');
    tile.style.transformOrigin = 'top left';
    tile.style.transition = 'none';
    tile.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    void tile.offsetWidth;
    tile.style.transition =
        `transform ${durationMs}ms ${easing} ${delayMs}ms`;
    tile.style.transform = '';
    return true;
}

function clearTravelStyles(tile) {
    if (!tile) return;
    tile.classList.remove('is-tile-traveling');
    tile.style.transition = '';
    tile.style.transform = '';
    tile.style.transformOrigin = '';
}

/**
 * After geometry change: FLIP each slot from its pre-change rect to the new box.
 * @param {string[]} slotIds
 * @param {Map<string, DOMRect> | null} firstRects
 * @param {TileTravelOpts} [opts]
 * @returns {Promise<void>}
 */
export async function flipTilesToCurrent(slotIds, firstRects, opts = {}) {
    if (!firstRects || !travelAnimationsEnabled()) return;
    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : TILE_TRAVEL_MS;
    const staggerMs = Number.isFinite(opts.staggerMs) ? opts.staggerMs : TILE_TRAVEL_STAGGER_MS;
    const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : TILE_TRAVEL_SETTLE_MS;
    const animated = [];
    let maxDelay = 0;
    slotIds.forEach((id, i) => {
        const first = firstRects.get(id);
        const tile = el(`player-tile-${id}`);
        if (!first || !tile || tile.classList.contains('is-hidden')) return;
        const delay = i * staggerMs;
        if (applyFlipFromRect(tile, first, delay, opts)) {
            animated.push(tile);
            maxDelay = Math.max(maxDelay, delay);
        }
    });
    if (!animated.length) return;
    try {
        await waitMs(durationMs + maxDelay + settleMs);
    } finally {
        animated.forEach(clearTravelStyles);
    }
}

/**
 * After player permute: content that lived at `from` is now on tile `to`.
 * FLIP each destination tile from the source's first rect.
 * @param {{ from: string, to: string }[]} moves
 * @param {Map<string, DOMRect> | null} firstRects
 * @param {TileTravelOpts} [opts]
 * @returns {Promise<void>}
 */
export async function flipContentMoves(moves, firstRects, opts = {}) {
    const forceOff = opts.durationMs === 0;
    if (!firstRects || forceOff || !Array.isArray(moves) || !moves.length) {
        return;
    }
    // When caller supplies timing (TV Travel), skip the global gate — they already decided.
    const hasExplicitTiming = Number.isFinite(opts.durationMs);
    if (!hasExplicitTiming && !travelAnimationsEnabled()) return;

    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : TILE_TRAVEL_MS;
    const staggerMs = Number.isFinite(opts.staggerMs) ? opts.staggerMs : TILE_TRAVEL_STAGGER_MS;
    const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : TILE_TRAVEL_SETTLE_MS;
    const animated = [];
    let maxDelay = 0;
    moves.forEach(({ from, to }, i) => {
        if (from === to) return;
        const first = firstRects.get(from);
        const tile = el(`player-tile-${to}`);
        if (!first || !tile || tile.classList.contains('is-hidden')) return;
        const delay = i * staggerMs;
        if (applyFlipFromRect(tile, first, delay, opts)) {
            animated.push(tile);
            maxDelay = Math.max(maxDelay, delay);
        }
    });
    if (!animated.length) return;
    try {
        await waitMs(durationMs + maxDelay + settleMs);
    } finally {
        animated.forEach(clearTravelStyles);
    }
}
