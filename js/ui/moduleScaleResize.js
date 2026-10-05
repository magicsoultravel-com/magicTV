/**
 * Shared scale / corner-resize math for Magic Remote, Browser, and Radio floats.
 * Remote + Radio: uniform scale 0.5–1.5. Browser: free W×H; tiles shrink only below 100%.
 */

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.5;

export const REMOTE_BASE_W = 260;
export const REMOTE_BASE_H = 560;
export const RADIO_BASE_W = 340;
export const RADIO_BASE_H = 260;
export const BROWSER_BASE_W = 320;
export const BROWSER_BASE_H = 600;

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
 * Clamp a floating dialog into the viewport.
 * @param {{ left: number, top: number, width: number, height: number }} geom
 * @param {{ minW: number, minH: number, viewPad?: number, vw?: number, vh?: number }} opts
 */
export function clampFloatGeometry(geom, { minW, minH, viewPad = 8, vw, vh }) {
    const viewW = vw ?? (typeof window !== 'undefined'
        ? (window.innerWidth || document.documentElement.clientWidth || 800)
        : 800);
    const viewH = vh ?? (typeof window !== 'undefined'
        ? (window.innerHeight || document.documentElement.clientHeight || 600)
        : 600);
    let w = Math.max(minW, Math.min(Number(geom.width) || minW, viewW - viewPad * 2));
    let h = Math.max(minH, Math.min(Number(geom.height) || minH, viewH - viewPad * 2));
    let x = Math.min(Math.max(viewPad, Number(geom.left) || viewPad), viewW - viewPad - Math.min(w, 80));
    let y = Math.min(Math.max(viewPad, Number(geom.top) || viewPad), viewH - viewPad - 40);
    if (x + w > viewW - viewPad) w = Math.max(minW, viewW - viewPad - x);
    if (y + h > viewH - viewPad) h = Math.max(minH, viewH - viewPad - y);
    return {
        left: Math.round(x),
        top: Math.round(y),
        width: Math.round(w),
        height: Math.round(h)
    };
}
