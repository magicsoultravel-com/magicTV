/**
 * Shared motion styles for Channel switch (mosaic) and View transition (catalog).
 * Each consumer adapts the same ids to its own surface.
 */
import { el } from '../tvUtils.js';

export const VIEW_TRANSITIONS = [
    'instant',
    'smooth',
    'slide',
    'fade',
    'spring',
    'crossfade',
    'flip',
    'dissolve',
    'grain',
    'matrix',
    'glitch',
    'slideleft',
    'slideright',
    'spiralin',
    'spiralout',
    'random'
];

export const VIEW_TRANSITION_LABELS = {
    instant: 'Instant',
    smooth: 'Smooth',
    slide: 'Slide',
    fade: 'Fade',
    spring: 'Spring',
    crossfade: 'Crossfade',
    flip: 'Flip',
    dissolve: 'Dissolve',
    grain: 'Grain',
    matrix: 'Matrix',
    glitch: 'Glitch',
    slideleft: 'Slide Left',
    slideright: 'Slide Right',
    spiralin: 'Spiral In',
    spiralout: 'Spiral Out',
    random: 'Random'
};

export const DEFAULT_VIEW_TRANSITION = 'random';

/** Concrete effects used by Random (visible modes only — no instant/random). */
export const VIEW_TRANSITION_POOL = VIEW_TRANSITIONS.filter(
    (id) => id !== 'random' && id !== 'instant'
);

/** Per-mode timing used by wipe / height / tile animations. */
export const VIEW_MOTION = {
    instant: { duration: 0, easing: 'linear' },
    smooth: { duration: 360, easing: 'ease-in-out' },
    slide: { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    fade: { duration: 380, easing: 'ease' },
    spring: { duration: 620, easing: 'cubic-bezier(0.34, 1.55, 0.64, 1)' },
    crossfade: { duration: 280, easing: 'ease' },
    flip: { duration: 420, easing: 'ease-in-out' },
    dissolve: { duration: 280, easing: 'ease-in-out' },
    grain: { duration: 520, easing: 'ease-in-out' },
    matrix: { duration: 1100, easing: 'ease-in-out' },
    glitch: { duration: 480, easing: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)' },
    slideleft: { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    slideright: { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    spiralin: { duration: 700, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' },
    spiralout: { duration: 700, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' }
};

/** Half-phase durations for mosaic tile CSS swap animations. */
export const TILE_SWAP_DURATIONS = {
    smooth: 320,
    slide: 340,
    fade: 240,
    spring: 420,
    crossfade: 240,
    flip: 380,
    glitch: 480,
    slideleft: 380,
    slideright: 380,
    spiralin: 700,
    spiralout: 700
};

/** @type {Record<string, string[]>} */
const randomDecks = Object.create(null);

function shuffleInPlace(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
}

export function normalizeViewTransition(value) {
    return VIEW_TRANSITIONS.includes(value) ? value : DEFAULT_VIEW_TRANSITION;
}

/**
 * Resolve a stored preference to a concrete effect.
 * When mode is `random`, draws without replacement from the pool (per bag),
 * then reshuffles when the bag is empty.
 * @param {string} mode
 * @param {string} [bag] separate decks for channel switch vs catalog
 */
export function resolveViewTransition(mode, bag = 'default') {
    const normalized = normalizeViewTransition(mode);
    if (normalized !== 'random') return normalized;
    let deck = randomDecks[bag];
    if (!deck || deck.length === 0) {
        deck = shuffleInPlace(VIEW_TRANSITION_POOL.slice());
        randomDecks[bag] = deck;
    }
    return deck.pop() || 'fade';
}

export function fillViewTransitionSelect(select, selected) {
    if (!select) return;
    const current = normalizeViewTransition(selected ?? select.value);
    select.innerHTML = VIEW_TRANSITIONS.map((id) => (
        `<option value="${id}">${VIEW_TRANSITION_LABELS[id] || id}</option>`
    )).join('');
    select.value = current;
}

/** WAAPI keyframes for browser-catalog panel swaps (#browser-shell). */
export function getCatalogViewTransitionFrames(mode) {
    const fadeOut = [{ opacity: 1 }, { opacity: 0 }];
    const fadeIn = [{ opacity: 0 }, { opacity: 1 }];

    switch (mode) {
        case 'fade':
        case 'crossfade':
            return { outFrames: fadeOut, inFrames: fadeIn, needsPerspective: false };
        case 'slide':
            return {
                outFrames: [
                    { opacity: 1, transform: 'translateY(0)' },
                    { opacity: 0, transform: 'translateY(40px)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'translateY(-40px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ],
                needsPerspective: false
            };
        case 'slideleft':
            return {
                outFrames: [
                    { opacity: 1, transform: 'translateX(0)' },
                    { opacity: 0, transform: 'translateX(-15%)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'translateX(15%)' },
                    { opacity: 1, transform: 'translateX(0)' }
                ],
                needsPerspective: false
            };
        case 'slideright':
            return {
                outFrames: [
                    { opacity: 1, transform: 'translateX(0)' },
                    { opacity: 0, transform: 'translateX(15%)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'translateX(-15%)' },
                    { opacity: 1, transform: 'translateX(0)' }
                ],
                needsPerspective: false
            };
        case 'smooth':
            return {
                outFrames: [
                    { opacity: 1, transform: 'scale(1)' },
                    { opacity: 0, transform: 'scale(0.92)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'scale(1.06)' },
                    { opacity: 1, transform: 'scale(1)' }
                ],
                needsPerspective: false
            };
        case 'spring':
            return {
                outFrames: [
                    { opacity: 1, transform: 'scale(1)' },
                    { opacity: 0, transform: 'scale(0.88)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'scale(1.08)' },
                    { opacity: 1, transform: 'scale(1)' }
                ],
                needsPerspective: false
            };
        case 'flip':
            return {
                outFrames: [
                    { opacity: 1, transform: 'rotateY(0deg)' },
                    { opacity: 0, transform: 'rotateY(90deg)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'rotateY(-90deg)' },
                    { opacity: 1, transform: 'rotateY(0deg)' }
                ],
                needsPerspective: true
            };
        case 'glitch':
            return {
                outFrames: [
                    { opacity: 1, transform: 'scale(1) translateX(0) skewY(0deg)', filter: 'hue-rotate(0deg) contrast(1) saturate(1)' },
                    { opacity: 0.8, transform: 'scale(1.05) translateX(-10%) skewY(5deg)', filter: 'hue-rotate(90deg) contrast(1.5) saturate(2)', offset: 0.2 },
                    { opacity: 0.6, transform: 'scale(0.95) translateX(10%) skewY(-5deg)', filter: 'hue-rotate(180deg) contrast(0.5) saturate(0.5)', offset: 0.4 },
                    { opacity: 0.4, transform: 'scale(1.1) translateX(-15%) skewY(10deg)', filter: 'hue-rotate(270deg) contrast(2) saturate(3)', offset: 0.6 },
                    { opacity: 0.2, transform: 'scale(0.9) translateX(15%) skewY(-10deg)', filter: 'hue-rotate(360deg) contrast(0.7) saturate(0.7)', offset: 0.8 },
                    { opacity: 0, transform: 'scale(1.2) translateX(0) skewY(0deg)', filter: 'hue-rotate(0deg) contrast(1) saturate(1)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'scale(1.2) translateX(0) skewY(0deg)', filter: 'hue-rotate(0deg) contrast(1) saturate(1)' },
                    { opacity: 0.2, transform: 'scale(0.9) translateX(-15%) skewY(10deg)', filter: 'hue-rotate(360deg) contrast(0.7) saturate(0.7)', offset: 0.2 },
                    { opacity: 0.4, transform: 'scale(1.1) translateX(15%) skewY(-10deg)', filter: 'hue-rotate(270deg) contrast(2) saturate(3)', offset: 0.4 },
                    { opacity: 0.6, transform: 'scale(0.95) translateX(-10%) skewY(5deg)', filter: 'hue-rotate(180deg) contrast(0.5) saturate(0.5)', offset: 0.6 },
                    { opacity: 0.8, transform: 'scale(1.05) translateX(10%) skewY(-5deg)', filter: 'hue-rotate(90deg) contrast(1.5) saturate(2)', offset: 0.8 },
                    { opacity: 1, transform: 'scale(1) translateX(0) skewY(0deg)', filter: 'hue-rotate(0deg) contrast(1) saturate(1)' }
                ],
                needsPerspective: false
            };
        case 'spiralin':
            return {
                outFrames: [
                    { opacity: 1, transform: 'scale(1) rotate(0deg)' },
                    { opacity: 0, transform: 'scale(0.5) rotate(180deg)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'scale(0.5) rotate(-180deg)' },
                    { opacity: 1, transform: 'scale(1) rotate(0deg)' }
                ],
                needsPerspective: false
            };
        case 'spiralout':
            return {
                outFrames: [
                    { opacity: 1, transform: 'scale(1) rotate(0deg)' },
                    { opacity: 0, transform: 'scale(1.5) rotate(180deg)' }
                ],
                inFrames: [
                    { opacity: 0, transform: 'scale(1.5) rotate(-180deg)' },
                    { opacity: 1, transform: 'scale(1) rotate(0deg)' }
                ],
                needsPerspective: false
            };
        default:
            return { outFrames: fadeOut, inFrames: fadeIn, needsPerspective: false };
    }
}

function clearCatalogSurfaceStyles(surface, perspectiveParent) {
    if (!surface) return;
    surface.style.opacity = '';
    surface.style.transform = '';
    surface.style.filter = '';
    if (perspectiveParent) perspectiveParent.style.perspective = '';
}

/**
 * Animate a browser-catalog panel swap on #browser-shell (or fallback surface).
 * @param {HTMLElement | null} surface
 * @param {string} mode resolved transition id
 * @param {() => void} mutate DOM update at midpoint
 */
export async function runCatalogPanelTransition(surface, mode, mutate) {
    if (!surface || typeof surface.animate !== 'function') {
        mutate?.();
        return;
    }

    if (mode === 'dissolve' || mode === 'grain' || mode === 'matrix') {
        await runWipeTransition(mode, mutate, {
            scope: 'catalog',
            fadeTarget: surface,
            grainHost: surface
        });
        return;
    }

    const cfg = VIEW_MOTION[mode] || VIEW_MOTION.fade;
    const opts = { duration: cfg.duration, easing: cfg.easing, fill: 'forwards' };
    const { outFrames, inFrames, needsPerspective } = getCatalogViewTransitionFrames(mode);
    const perspectiveParent = needsPerspective ? surface.parentElement : null;

    if (needsPerspective && perspectiveParent) {
        perspectiveParent.style.perspective = '1200px';
    }

    try {
        const out = surface.animate(outFrames, opts);
        await out.finished;
        mutate?.();
        const inn = surface.animate(inFrames, opts);
        await inn.finished;
        try {
            out.cancel();
            inn.cancel();
        } catch { /* ignore */ }
    } catch {
        mutate?.();
    } finally {
        clearCatalogSurfaceStyles(surface, perspectiveParent);
    }
}

let grainPaintStops = [];

function stopAllGrainPaint() {
    grainPaintStops.forEach((stop) => {
        try { stop(); } catch { /* ignore */ }
    });
    grainPaintStops = [];
}

function ensureGrainOverlay(scope, host) {
    if (!host) return null;
    const id = scope === 'catalog'
        ? 'catalog-grain-overlay-scoped'
        : scope === 'tiles'
            ? `catalog-grain-overlay-tile-${host.id || 'anon'}`
            : scope === 'mosaic'
                ? 'catalog-grain-overlay-mosaic'
                : 'catalog-grain-overlay';
    let overlay = el(id);
    if (overlay && !overlay.querySelector('canvas.catalog-grain-overlay__canvas')) {
        overlay.remove();
        overlay = null;
    }
    if (overlay) {
        if (overlay.parentElement !== host) host.appendChild(overlay);
        return overlay;
    }

    const scopedClass = scope === 'full'
        ? 'catalog-grain-overlay'
        : 'catalog-grain-overlay catalog-grain-overlay--scoped';
    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = scopedClass;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="catalog-grain-overlay__veil"></div>
        <canvas class="catalog-grain-overlay__canvas"></canvas>
    `;
    host.appendChild(overlay);
    return overlay;
}

function startGrainPaint(canvas, hostEl) {
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return () => {};

    const resize = () => {
        const box = hostEl?.getBoundingClientRect?.() || {
            width: window.innerWidth,
            height: window.innerHeight
        };
        canvas.width = Math.max(80, Math.floor((box.width || window.innerWidth) / 2));
        canvas.height = Math.max(60, Math.floor((box.height || window.innerHeight) / 2));
        canvas.style.width = '100%';
        canvas.style.height = '100%';
    };
    resize();

    let raf = 0;
    let alive = true;
    const tick = () => {
        if (!alive) return;
        const w = canvas.width;
        const h = canvas.height;
        const img = ctx.createImageData(w, h);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
            const n = (Math.random() * 255) | 0;
            data[i] = n;
            data[i + 1] = n;
            data[i + 2] = n;
            data[i + 3] = n > 140 ? 220 : (n > 70 ? 120 : 40);
        }
        ctx.putImageData(img, 0, 0);
        raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
    };
}

export function stopBootGrainPaint() {
    stopAllGrainPaint();
}

const MATRIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MATRIX_COL_W = 10;
const MATRIX_HEAD = '#00ff41';
const MATRIX_TRAIL = '#008f11';
const MATRIX_BG = '#000000';

/** @type {Array<() => void>} */
let matrixPaintStops = [];

function stopAllMatrixPaint() {
    matrixPaintStops.forEach((stop) => {
        try { stop(); } catch { /* ignore */ }
    });
    matrixPaintStops = [];
}

function ensureMatrixOverlay(scope, host) {
    if (!host) return null;
    const id = scope === 'catalog'
        ? 'catalog-matrix-overlay-scoped'
        : scope === 'tiles'
            ? `catalog-matrix-overlay-tile-${host.id || 'anon'}`
            : scope === 'mosaic'
                ? 'catalog-matrix-overlay-mosaic'
                : 'catalog-matrix-overlay';
    let overlay = el(id);
    if (overlay && !overlay.querySelector('canvas.catalog-matrix-overlay__canvas')) {
        overlay.remove();
        overlay = null;
    }
    if (overlay) {
        if (overlay.parentElement !== host) host.appendChild(overlay);
        return overlay;
    }

    const scopedClass = scope === 'full'
        ? 'catalog-matrix-overlay'
        : 'catalog-matrix-overlay catalog-matrix-overlay--scoped';
    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = scopedClass;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<canvas class="catalog-matrix-overlay__canvas"></canvas>';
    host.appendChild(overlay);
    return overlay;
}

/**
 * Digital-rain canvas painter. Progress 0–1 controls how many columns are active
 * and how long trails grow (cover fills; reveal retreats).
 * @returns {{ stop: () => void, setProgress: (p: number) => void }}
 */
function startMatrixPaint(canvas, hostEl) {
    if (!canvas) return { stop: () => {}, setProgress: () => {} };
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return { stop: () => {}, setProgress: () => {} };

    /** @type {Array<{ x: number, y: number, speed: number, trail: string[] }>} */
    let columns = [];
    let progress = 0;
    let fontSize = MATRIX_COL_W;

    const randChar = () => MATRIX_CHARS[(Math.random() * MATRIX_CHARS.length) | 0];

    const rebuild = () => {
        const box = hostEl?.getBoundingClientRect?.() || {
            width: window.innerWidth,
            height: window.innerHeight
        };
        const cssW = Math.max(80, Math.floor(box.width || window.innerWidth));
        const cssH = Math.max(60, Math.floor(box.height || window.innerHeight));
        // Keep resolution high enough that narrow columns stay dense.
        const scale = Math.min(1, 720 / Math.max(cssW, 1));
        canvas.width = Math.max(80, Math.floor(cssW * scale));
        canvas.height = Math.max(60, Math.floor(cssH * scale));
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        fontSize = Math.max(8, Math.floor(MATRIX_COL_W * scale));
        const colCount = Math.max(1, Math.floor(canvas.width / fontSize));
        columns = Array.from({ length: colCount }, (_, i) => ({
            x: i * fontSize + fontSize * 0.1,
            y: Math.random() * canvas.height,
            speed: 1.1 + Math.random() * 2.4,
            trail: Array.from({ length: 18 + ((Math.random() * 22) | 0) }, randChar)
        }));
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textBaseline = 'top';
        // Hard clear so the first dense frame starts clean.
        ctx.fillStyle = MATRIX_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    rebuild();

    let raf = 0;
    let alive = true;
    const tick = () => {
        if (!alive) return;
        const w = canvas.width;
        const h = canvas.height;
        // Soft clear leaves ghost trails — denser, more intense rain.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(0, 0, w, h);

        // Ramp columns in quickly so coverage feels thick early.
        const density = Math.pow(progress, 0.55);
        const activeCount = Math.floor(density * columns.length);
        const trailScale = 0.55 + density * 0.9;
        const maxTrail = Math.max(4, Math.floor((h / fontSize) * trailScale));

        for (let i = 0; i < activeCount; i++) {
            const col = columns[i];
            const trailLen = Math.min(col.trail.length, maxTrail);
            for (let t = 0; t < trailLen; t++) {
                const cy = col.y - t * fontSize;
                if (cy < -fontSize || cy > h) continue;
                if (t === 0) {
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = MATRIX_HEAD;
                } else {
                    const fade = 1 - t / trailLen;
                    ctx.globalAlpha = 0.35 + fade * 0.65;
                    ctx.fillStyle = MATRIX_TRAIL;
                }
                ctx.fillText(col.trail[t] || randChar(), col.x, cy);
            }
            ctx.globalAlpha = 1;
            col.y += col.speed * fontSize * 0.42;
            // Scramble head + some trail cells every frame for intensity.
            if (Math.random() < 0.35) col.trail[0] = randChar();
            if (Math.random() < 0.2) {
                const idx = 1 + ((Math.random() * Math.max(1, trailLen - 1)) | 0);
                col.trail[idx] = randChar();
            }
            if (col.y - trailLen * fontSize > h) {
                col.y = -Math.random() * h * 0.25;
                col.speed = 1.1 + Math.random() * 2.4;
                col.trail = Array.from(
                    { length: 18 + ((Math.random() * 22) | 0) },
                    randChar
                );
            }
        }

        raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => rebuild();
    window.addEventListener('resize', onResize);

    return {
        setProgress(p) {
            progress = Math.max(0, Math.min(1, Number(p) || 0));
        },
        stop() {
            alive = false;
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
        }
    };
}

function animateMatrixProgress(controllers, from, to, durationMs) {
    if (!controllers.length) return Promise.resolve();
    const duration = Math.max(1, durationMs || 1);
    return new Promise((resolve) => {
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            // Ease-in-out for a more deliberate takeover / retreat.
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - ((-2 * t + 2) ** 2) / 2;
            const p = from + (to - from) * eased;
            controllers.forEach((c) => c.setProgress(p));
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                controllers.forEach((c) => c.setProgress(to));
                resolve();
            }
        };
        requestAnimationFrame(step);
    });
}

/**
 * @param {'dissolve'|'grain'|'matrix'} mode
 * @param {() => void} onSwap
 * @param {{
 *   scope?: 'full'|'catalog'|'mosaic'|'tiles',
 *   fadeTarget?: HTMLElement,
 *   fadeTargets?: HTMLElement[],
 *   grainHost?: HTMLElement,
 *   grainHosts?: HTMLElement[]
 * }} [opts]
 */
export async function runWipeTransition(mode, onSwap, opts = {}) {
    const scope = opts.scope || 'full';
    const cfg = VIEW_MOTION[mode] || VIEW_MOTION.dissolve;
    const half = {
        duration: cfg.duration,
        easing: cfg.easing,
        fill: 'forwards'
    };

    const fadeTargets = (opts.fadeTargets || (opts.fadeTarget ? [opts.fadeTarget] : []))
        .filter(Boolean);
    if (!fadeTargets.length) {
        const fallback = (scope === 'catalog'
            ? (el('browser-shell') || el('tv-catalog-body'))
            : null)
            || (scope === 'mosaic' ? el('player-mosaic') : null)
            || el('app-container')
            || document.body;
        if (fallback) fadeTargets.push(fallback);
    }
    if (!fadeTargets.length) {
        onSwap?.();
        return;
    }

    const grainHosts = (opts.grainHosts || (opts.grainHost ? [opts.grainHost] : []))
        .filter(Boolean);
    if (!grainHosts.length) {
        if (scope === 'catalog') {
            const host = el('browser-shell') || el('tv-catalog-body') || el('remote-dock-sheet');
            if (host) grainHosts.push(host);
        } else if (scope === 'tiles') {
            grainHosts.push(...fadeTargets);
        } else {
            grainHosts.push(fadeTargets[0]);
        }
    }

    const useGrain = mode === 'grain';
    const useMatrix = mode === 'matrix';
    const grains = useGrain
        ? grainHosts.map((host) => ensureGrainOverlay(scope, host)).filter(Boolean)
        : [];
    const matrices = useMatrix
        ? grainHosts.map((host) => ensureMatrixOverlay(scope, host)).filter(Boolean)
        : [];
    /** @type {Array<{ stop: () => void, setProgress: (p: number) => void }>} */
    let matrixControllers = [];

    const cleanupMatrix = () => {
        matrices.forEach((m) => {
            m.classList.remove('is-active');
            m.style.opacity = '';
        });
        stopAllMatrixPaint();
        matrixControllers = [];
    };

    try {
        if (matrices.length) {
            stopAllMatrixPaint();
            matrixControllers = matrices.map((matrix, i) => {
                matrix.classList.add('is-active');
                matrix.style.opacity = '0';
                const ctrl = startMatrixPaint(
                    matrix.querySelector('canvas'),
                    grainHosts[i] || fadeTargets[0]
                );
                ctrl.setProgress(0);
                matrixPaintStops.push(() => ctrl.stop());
                return ctrl;
            });
            const coverOverlay = matrices.map((matrix) => matrix.animate(
                [
                    { opacity: 0 },
                    { opacity: 1, offset: 0.2 },
                    { opacity: 1 }
                ],
                half
            ));
            const hideAnims = fadeTargets.map((target) => target.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                half
            ));
            await Promise.all([
                ...coverOverlay.map((a) => a.finished),
                ...hideAnims.map((a) => a.finished),
                animateMatrixProgress(matrixControllers, 0, 1, half.duration)
            ]);
        } else if (grains.length) {
            stopAllGrainPaint();
            grains.forEach((grain, i) => {
                grain.classList.add('is-active');
                grain.style.opacity = '0';
                grainPaintStops.push(
                    startGrainPaint(grain.querySelector('canvas'), grainHosts[i] || fadeTargets[0])
                );
            });
            const coverAnims = grains.map((grain) => grain.animate(
                [
                    { opacity: 0 },
                    { opacity: 0.85, offset: 0.45 },
                    { opacity: 1 }
                ],
                half
            ));
            const hideAnims = fadeTargets.map((target) => target.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                half
            ));
            await Promise.all([...coverAnims, ...hideAnims].map((a) => a.finished));
        } else {
            const fadeOut = fadeTargets.map((target) => target.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                half
            ));
            await Promise.all(fadeOut.map((a) => a.finished));
        }

        onSwap?.();
        fadeTargets.forEach((target) => {
            void target.offsetHeight;
            target.style.opacity = '0';
        });

        if (matrices.length) {
            const clearAnims = matrices.map((matrix) => matrix.animate(
                [
                    { opacity: 1 },
                    { opacity: 1, offset: 0.35 },
                    { opacity: 0 }
                ],
                half
            ));
            const showAnims = fadeTargets.map((target) => target.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                half
            ));
            await Promise.all([
                ...clearAnims.map((a) => a.finished),
                ...showAnims.map((a) => a.finished),
                animateMatrixProgress(matrixControllers, 1, 0, half.duration)
            ]);
            try {
                [...clearAnims, ...showAnims].forEach((a) => a.cancel());
            } catch { /* ignore */ }
            cleanupMatrix();
        } else if (grains.length) {
            const clearAnims = grains.map((grain) => grain.animate(
                [
                    { opacity: 1 },
                    { opacity: 0.7, offset: 0.4 },
                    { opacity: 0 }
                ],
                half
            ));
            const showAnims = fadeTargets.map((target) => target.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                half
            ));
            await Promise.all([...clearAnims, ...showAnims].map((a) => a.finished));
            try {
                [...clearAnims, ...showAnims].forEach((a) => a.cancel());
            } catch { /* ignore */ }
            grains.forEach((grain) => {
                grain.classList.remove('is-active');
                grain.style.opacity = '';
            });
            stopAllGrainPaint();
        } else {
            const fadeIn = fadeTargets.map((target) => target.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                half
            ));
            await Promise.all(fadeIn.map((a) => a.finished));
            try {
                fadeIn.forEach((a) => a.cancel());
            } catch { /* ignore */ }
        }
    } catch {
        grains.forEach((grain) => {
            grain.classList.remove('is-active');
            grain.style.opacity = '';
        });
        stopAllGrainPaint();
        cleanupMatrix();
    } finally {
        fadeTargets.forEach((target) => {
            target.style.opacity = '';
            target.style.filter = '';
        });
    }
}

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Start film-grain paint on the first-paint boot cover (no-op if missing / reduced motion). */
export function primeBootGrain(bootEl) {
    const boot = bootEl || el('boot-screen');
    if (!boot || prefersReducedMotion()) return;
    const canvas = boot.querySelector('canvas');
    if (!canvas) return;
    stopAllGrainPaint();
    grainPaintStops.push(startGrainPaint(canvas, boot));
}

/**
 * Reveal the themed GUI from the first-paint boot cover using Grain timing.
 * Boot is already covering; this is reveal-only (no cover half).
 * @param {HTMLElement} [bootEl]
 * @param {HTMLElement} [appEl]
 */
export async function revealBootWithGrain(bootEl, appEl) {
    const boot = bootEl || el('boot-screen');
    const app = appEl || el('app-container');
    const root = document.documentElement;

    const finish = () => {
        root.classList.remove('is-booting');
        if (app) {
            app.style.opacity = '';
            app.style.visibility = '';
            app.style.filter = '';
        }
        if (boot) {
            stopAllGrainPaint();
            boot.remove();
        }
    };

    if (!boot || !app) {
        finish();
        return;
    }

    if (prefersReducedMotion()) {
        finish();
        return;
    }

    const cfg = VIEW_MOTION.grain;
    const half = {
        duration: cfg.duration,
        easing: cfg.easing,
        fill: 'forwards'
    };

    const canvas = boot.querySelector('canvas');
    stopAllGrainPaint();
    grainPaintStops.push(startGrainPaint(canvas, boot));

    app.style.visibility = 'visible';
    app.style.opacity = '0';
    boot.style.opacity = '1';

    try {
        const clearAnim = boot.animate(
            [
                { opacity: 1 },
                { opacity: 0.7, offset: 0.4 },
                { opacity: 0 }
            ],
            half
        );
        const showAnim = app.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            half
        );
        await Promise.all([clearAnim.finished, showAnim.finished]);
        try {
            clearAnim.cancel();
            showAnim.cancel();
        } catch { /* ignore */ }
    } catch {
        /* fall through to finish */
    } finally {
        finish();
    }
}
