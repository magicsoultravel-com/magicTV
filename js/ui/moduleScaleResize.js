/**
 * Shared geometry for the three floating module windows (remote / radio / browser).
 *
 * One contract, three window models:
 *  - Remote + Radio are uniform-scale boxes: an aspect-locked design box scaled
 *    by a single scalar (`--remote-scale` / `--radio-scale`).
 *  - Browser is a free W×H content surface; its catalog tiles only shrink below
 *    the 100% baseline (`--browser-tile-scale`).
 *
 * Everything here is pure math (no DOM reads) so it stays unit-testable. Two
 * rules keep drag and resize from fighting each other:
 *
 *  1. Size and position are clamped by two *separate* functions — dragging a
 *     window never changes its size. (The old combined clamp shrank the box at
 *     the screen edge, which is what read as a "bounce".)
 *  2. Size is *intent* (what the user resized to), fitted to the host viewport
 *     only while painting. Intent is what gets persisted, so a temporary
 *     shrink (small window / zoom) self-heals when the viewport grows back.
 */

/** Uniform scale range for the remote (also the shared default range). */
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.5;

/** Remote design box at scale 1 — every other module derives from it. */
export const REMOTE_BASE_W = 260;
export const REMOTE_BASE_H = 560;

/** Radio = 1× remote width → 260×200 at scale 1. */
export const RADIO_BASE_W = REMOTE_BASE_W;
export const RADIO_BASE_H = 200;
/** The radio carries readable text + tap targets: below 65% it stops working. */
export const RADIO_SCALE_MIN = 0.65;
export const RADIO_SCALE_RANGE = Object.freeze({ min: RADIO_SCALE_MIN, max: SCALE_MAX });
/**
 * Pre-unification radio design width. Only used to read *width-only* persisted
 * saves (which never stored a scale); new state always carries `scale`.
 */
export const LEGACY_RADIO_BASE_W = 340;

/** Browser = 2× remote width × 1× remote height → 520×560 at 100% tiles. */
export const BROWSER_BASE_W = REMOTE_BASE_W * 2;
export const BROWSER_BASE_H = REMOTE_BASE_H;
/** Free-resize floors (the docked sheet floors at the full base width instead). */
export const BROWSER_MIN_W = REMOTE_BASE_W;
export const BROWSER_MIN_H = Math.round(REMOTE_BASE_H * 0.75);

/** First-open browser box; `left/top` are a hint, clamped on paint. */
export const BROWSER_DEFAULT_BOX = Object.freeze({
    left: 300,
    top: 48,
    width: BROWSER_BASE_W,
    height: BROWSER_BASE_H,
    pinned: false
});

/** Gap between a floating window and the viewport edge (mirrored by CSS). */
export const VIEW_PAD = 24;
/** Distance the docked sheet sits from the dock edge. */
export const EDGE_INSET = 24;
/** How much of a floating window must stay on screen while it is dragged. */
export const DRAG_GRIP = 80;

/** Docked sheet height as a fraction of the viewport, plus its bar-only variant. */
export const DEFAULT_SHEET_HEIGHT = 0.62;
export const SHEET_BAR_RATIO = 3 / 8;
export const SHEET_HEIGHT_MIN = 0.25;
export const SHEET_HEIGHT_MAX = 0.85;

/**
 * @param {unknown} scale
 * @param {{ min?: number, max?: number }} [opts]
 */
export function clampModuleScale(scale, { min = SCALE_MIN, max = SCALE_MAX } = {}) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return 1;
    return Math.min(max, Math.max(min, n));
}

/**
 * Infer scale from a stored width relative to a design baseline.
 * @param {number} width
 * @param {number} baseW
 * @param {{ min?: number, max?: number }} [opts]
 */
export function scaleFromWidth(width, baseW, opts) {
    const w = Number(width);
    const base = Number(baseW) || 1;
    if (!Number.isFinite(w) || base <= 0) return 1;
    return clampModuleScale(w / base, opts);
}


/**
 * Uniform scale from a corner drag (preserves aspect of base box).
 * @param {{
 *   originLeft: number, originTop: number, originW: number, originH: number,
 *   originScale: number, baseW: number, baseH: number,
 *   dx: number, dy: number, edge: string,
 *   minScale?: number, maxScale?: number
 * }} args
 */
export function uniformScaleFromCorner({
    originLeft,
    originTop,
    originW,
    originH,
    originScale,
    baseW,
    baseH,
    dx,
    dy,
    edge = 'se',
    minScale = SCALE_MIN,
    maxScale = SCALE_MAX
}) {
    let signedDx = 0;
    let signedDy = 0;
    if (edge.includes('e')) signedDx = dx;
    if (edge.includes('w')) signedDx = -dx;
    if (edge.includes('s')) signedDy = dy;
    if (edge.includes('n')) signedDy = -dy;

    const originDist = Math.hypot(originW, originH) || 1;
    const nextDist = Math.max(1, Math.hypot(originW + signedDx, originH + signedDy));
    const scale = clampModuleScale(originScale * (nextDist / originDist), {
        min: minScale,
        max: maxScale
    });
    const width = Math.round(baseW * scale);
    const height = Math.round(baseH * scale);
    let left = originLeft;
    let top = originTop;
    if (edge.includes('w')) left = originLeft + originW - width;
    if (edge.includes('n')) top = originTop + originH - height;
    return { left, top, width, height, scale };
}

/**
 * Free W×H corner resize (browser). Floors at minW/minH.
 * @param {{
 *   originLeft: number, originTop: number, originW: number, originH: number,
 *   dx: number, dy: number, edge: string, minW: number, minH: number
 * }} args
 */
export function freeCornerResize({
    originLeft,
    originTop,
    originW,
    originH,
    dx,
    dy,
    edge = 'se',
    minW,
    minH
}) {
    let left = originLeft;
    let top = originTop;
    let width = originW;
    let height = originH;
    if (edge.includes('e')) width = originW + dx;
    if (edge.includes('s')) height = originH + dy;
    if (edge.includes('w')) {
        width = originW - dx;
        left = originLeft + dx;
    }
    if (edge.includes('n')) {
        height = originH - dy;
        top = originTop + dy;
    }
    if (width < minW) {
        if (edge.includes('w')) left = originLeft + originW - minW;
        width = minW;
    }
    if (height < minH) {
        if (edge.includes('n')) top = originTop + originH - minH;
        height = minH;
    }
    return { left, top, width, height };
}

/**
 * Browser tile scale: shrink only when geom is below baseline (cap at 1).
 * @param {{ width: number, height: number, baseW?: number, baseH?: number }} args
 */
export function browserTileScaleFromGeom({
    width,
    height,
    baseW = BROWSER_BASE_W,
    baseH = BROWSER_BASE_H
}) {
    const sx = Number(width) / (baseW || 1);
    const sy = Number(height) / (baseH || 1);
    if (![sx, sy].every(Number.isFinite)) return 1;
    return clampModuleScale(Math.min(sx, sy), { min: SCALE_MIN, max: 1 });
}

/**
 * Viewport box for `position: fixed` overlays.
 *
 * `documentElement.clientWidth/Height` is the containing block that fixed
 * elements actually lay out against; `innerWidth/innerHeight` include a classic
 * scrollbar, which leaves a dead strip (and a one-frame jump when a scrollbar
 * appears) between what JS thinks the edge is and where the window stops.
 * @returns {{ w: number, h: number }}
 */
export function readViewportSize() {
    const doc = typeof document !== 'undefined' ? document.documentElement : null;
    const win = typeof window !== 'undefined' ? window : null;
    return {
        w: doc?.clientWidth || win?.innerWidth || 800,
        h: doc?.clientHeight || win?.innerHeight || 600
    };
}

/**
 * Fit a window's *size* into the host viewport.
 *
 * Never goes below the caller's design floor (`minW`/`minH`): a floor that the
 * clamp is allowed to violate is what makes content (keypad, cassette, tiles)
 * scroll or clip inside its own frame.
 *
 * @param {{ width: number, height: number }} box
 * @param {{ vw?: number, vh?: number, pad?: number, minW?: number, minH?: number }} [opts]
 * @returns {{ width: number, height: number }}
 */
export function fitBoxToHost({ width, height }, { vw, vh, pad = VIEW_PAD, minW = 1, minH = 1 } = {}) {
    const viewW = Number(vw) || 800;
    const viewH = Number(vh) || 600;
    const availW = Math.max(1, viewW - pad * 2);
    const availH = Math.max(1, viewH - pad * 2);
    const floorW = Math.max(1, Number(minW) || 1);
    const floorH = Math.max(1, Number(minH) || 1);
    const w = Math.max(floorW, Math.min(Number(width) || floorW, availW));
    const h = Math.max(floorH, Math.min(Number(height) || floorH, availH));
    return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Clamp a window's *position*, leaving its size untouched.
 *
 * Native-window rule: the leading edges never leave the padded viewport, and a
 * trailing edge may hang off-screen only until `grip` px of the window remains
 * visible. That keeps the header (the drag handle) reachable no matter how the
 * user threw the window at an edge, and it can never resize the window.
 *
 * @param {{ left: number, top: number, width: number, height: number }} box
 * @param {{ grip?: number, pad?: number, vw?: number, vh?: number }} [opts]
 * @returns {{ left: number, top: number }}
 */
export function clampFloatPosition({ left, top, width, height }, { grip = DRAG_GRIP, pad = VIEW_PAD, vw, vh } = {}) {
    const viewW = Number(vw) || 800;
    const viewH = Number(vh) || 600;
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const gripX = Math.min(Math.max(1, grip), w);
    const gripY = Math.min(Math.max(1, grip), h);
    // Oversized windows pin their trailing edge instead of their leading one.
    const minLeft = Math.min(pad, viewW - pad - w);
    const minTop = Math.min(pad, viewH - pad - h);
    const maxLeft = Math.max(minLeft, viewW - pad - gripX);
    const maxTop = Math.max(minTop, viewH - pad - gripY);
    const x = Math.min(Math.max(minLeft, Number(left) || 0), maxLeft);
    const y = Math.min(Math.max(minTop, Number(top) || 0), maxTop);
    return { left: Math.round(x), top: Math.round(y) };
}

/**
 * Normalise a persisted `{ left, top, width, height, pinned }` window box.
 *
 * Shared by the player-state reader and the layout store so the two normalisers
 * cannot drift apart (they used to carry the same literals twice).
 *
 * @param {unknown} raw
 * @param {{ fallback: { left: number, top: number, width: number, height: number }, minW?: number, minH?: number }} opts
 */
export function normalizeFloatBox(raw, { fallback, minW = 1, minH = 1 }) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const num = (value, fallbackValue) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallbackValue;
    };
    const width = num(src.width, fallback.width);
    const height = num(src.height, fallback.height);
    return {
        left: num(src.left, fallback.left),
        top: num(src.top, fallback.top),
        width: width >= minW ? width : fallback.width,
        height: height >= minH ? height : fallback.height,
        pinned: src.pinned === true
    };
}

