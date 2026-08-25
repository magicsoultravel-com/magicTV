/**
 * Collapsible shell header: brand click fades chrome, collapses the bar,
 * and FLIP-moves the icon + wordmark to the top-right of the canvas.
 */
import { SettingsStore } from '../storage/settingsStore.js';
import { MultiView } from '../multiView.js';

const COLLAPSED_CLASS = 'is-header-collapsed';
const FLIP_MS = 380;
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** @type {Animation | null} */
let activeFlip = null;
let bound = false;
let animating = false;

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function brandEl() {
    return document.querySelector('.tv-brand');
}

function headerEl() {
    return document.querySelector('.tv-header');
}

function isCollapsed() {
    return document.body.classList.contains(COLLAPSED_CLASS);
}

function syncAria(collapsed) {
    const brand = brandEl();
    if (!brand) return;
    brand.setAttribute('aria-expanded', String(!collapsed));
    brand.setAttribute('aria-label', collapsed ? 'Expand header' : 'Collapse header');
}

function applyCollapsedClass(collapsed) {
    document.body.classList.toggle(COLLAPSED_CLASS, collapsed);
    document.getElementById('app-container')?.classList.toggle(COLLAPSED_CLASS, collapsed);
    syncAria(collapsed);
}

function reflowMosaic() {
    if (typeof MultiView?.hasCustomPlacement === 'function' && MultiView.hasCustomPlacement()) {
        requestAnimationFrame(() => MultiView.applyFreeLayout());
    }
}

function onHeaderTransitionEnd(e) {
    if (e.target !== headerEl()) return;
    if (e.propertyName !== 'max-height' && e.propertyName !== 'padding-top') return;
    reflowMosaic();
}

/**
 * @param {boolean} collapsed
 * @param {{ animate?: boolean }} [opts]
 */
export function setHeaderCollapsed(collapsed, opts = {}) {
    const animate = opts.animate !== false;
    const brand = brandEl();
    const next = collapsed === true;
    if (next === isCollapsed()) {
        syncAria(next);
        return;
    }

    if (activeFlip) {
        activeFlip.cancel();
        activeFlip = null;
    }

    SettingsStore.setHeaderCollapsed(next);

    if (!animate || !brand || prefersReducedMotion()) {
        applyCollapsedClass(next);
        reflowMosaic();
        return;
    }

    animating = true;
    const first = brand.getBoundingClientRect();
    applyCollapsedClass(next);
    const last = brand.getBoundingClientRect();

    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width > 0 ? first.width / last.width : 1;
    const sy = last.height > 0 ? first.height / last.height : 1;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) {
        animating = false;
        reflowMosaic();
        return;
    }

    activeFlip = brand.animate(
        [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transform: 'none' }
        ],
        { duration: FLIP_MS, easing: FLIP_EASING, fill: 'none' }
    );

    activeFlip.finished
        .catch(() => {})
        .finally(() => {
            activeFlip = null;
            animating = false;
            reflowMosaic();
        });
}

export function toggleHeaderCollapsed() {
    if (animating) return;
    setHeaderCollapsed(!isCollapsed(), { animate: true });
}

export function initHeaderCollapse() {
    if (bound || typeof document === 'undefined') return;
    bound = true;

    const brand = brandEl();
    const header = headerEl();
    if (!brand) return;

    if (!brand.hasAttribute('role')) brand.setAttribute('role', 'button');
    if (!brand.hasAttribute('tabindex')) brand.setAttribute('tabindex', '0');

    const restored = SettingsStore.getHeaderCollapsed();
    applyCollapsedClass(restored);
    if (restored) reflowMosaic();

    brand.addEventListener('click', (e) => {
        e.preventDefault();
        toggleHeaderCollapsed();
    });

    brand.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleHeaderCollapsed();
    });

    header?.addEventListener('transitionend', onHeaderTransitionEnd);
}
