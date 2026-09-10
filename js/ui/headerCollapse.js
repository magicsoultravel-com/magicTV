/**
 * Collapsible shell header: brand click fades chrome, collapses the bar,
 * and FLIP-moves the icon + wordmark to the top-right of the canvas.
 * Settings Header mode is the source of truth (full vs color/grey marks).
 */
import {
    SettingsStore,
    HEADER_MODES,
    HEADER_MODE_LABELS,
    isHeaderMarkMode,
    normalizeHeaderMode
} from '../storage/settingsStore.js';
import { MultiView } from '../multiView.js';
import { showAppToast } from './toast.js';

const COLLAPSED_CLASS = 'is-header-collapsed';
const FLIP_MS = 380;
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SELECT_ID = 'header-mode-select';

/** @type {Animation | null} */
let activeFlip = null;
let bound = false;
let settingsBound = false;
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

function modeSelectEl() {
    return document.getElementById(SELECT_ID);
}

function isCollapsed() {
    return document.body.classList.contains(COLLAPSED_CLASS);
}

function currentDomMode() {
    const raw = document.body.getAttribute('data-header-mode');
    return normalizeHeaderMode(raw || (isCollapsed() ? 'colorMark' : 'full'));
}

function syncAria(collapsed) {
    const brand = brandEl();
    if (!brand) return;
    brand.setAttribute('aria-expanded', String(!collapsed));
    brand.setAttribute('aria-label', collapsed ? 'Expand header' : 'Collapse header');
}

function syncModeSelect(mode) {
    const select = modeSelectEl();
    if (!select) return;
    if (select.value !== mode) select.value = mode;
}

function applyHeaderModeDom(mode) {
    const collapsed = mode !== 'full';
    document.body.classList.toggle(COLLAPSED_CLASS, collapsed);
    document.getElementById('app-container')?.classList.toggle(COLLAPSED_CLASS, collapsed);
    document.body.setAttribute('data-header-mode', mode);
    document.getElementById('app-container')?.setAttribute('data-header-mode', mode);
    syncAria(collapsed);
    syncModeSelect(mode);
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
 * @param {string} mode
 * @param {{ animate?: boolean, toast?: boolean }} [opts]
 */
export function setHeaderMode(mode, opts = {}) {
    const animate = opts.animate !== false;
    const brand = brandEl();
    const next = normalizeHeaderMode(mode);
    const prev = currentDomMode();
    const wasCollapsed = prev !== 'full';
    const willCollapse = next !== 'full';

    SettingsStore.setHeaderMode(next);

    if (next === prev && isCollapsed() === willCollapse) {
        applyHeaderModeDom(next);
        return next;
    }

    if (activeFlip) {
        activeFlip.cancel();
        activeFlip = null;
    }

    const crossing = wasCollapsed !== willCollapse;

    if (!animate || !brand || prefersReducedMotion() || !crossing) {
        applyHeaderModeDom(next);
        if (crossing) reflowMosaic();
        if (opts.toast) {
            showAppToast(`Header: ${HEADER_MODE_LABELS[next] || next}`);
        }
        return next;
    }

    animating = true;
    const first = brand.getBoundingClientRect();
    applyHeaderModeDom(next);
    const last = brand.getBoundingClientRect();

    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width > 0 ? first.width / last.width : 1;
    const sy = last.height > 0 ? first.height / last.height : 1;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) {
        animating = false;
        reflowMosaic();
        if (opts.toast) {
            showAppToast(`Header: ${HEADER_MODE_LABELS[next] || next}`);
        }
        return next;
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

    if (opts.toast) {
        showAppToast(`Header: ${HEADER_MODE_LABELS[next] || next}`);
    }
    return next;
}

/** @deprecated Prefer setHeaderMode */
export function setHeaderCollapsed(collapsed, opts = {}) {
    if (collapsed === true) {
        return setHeaderMode(SettingsStore.getLastHeaderMark(), opts);
    }
    return setHeaderMode('full', opts);
}

export function toggleHeaderCollapsed() {
    if (animating) return;
    const mode = SettingsStore.getHeaderMode();
    if (isHeaderMarkMode(mode)) {
        setHeaderMode('full', { animate: true });
        return;
    }
    setHeaderMode(SettingsStore.getLastHeaderMark(), { animate: true });
}

export function bindHeaderModeSettings() {
    if (settingsBound || typeof document === 'undefined') return;
    const select = modeSelectEl();
    if (!select) return;
    settingsBound = true;
    select.dataset.bound = '1';

    if (!select.options?.length) {
        select.innerHTML = HEADER_MODES
            .map((id) => `<option value="${id}">${HEADER_MODE_LABELS[id] || id}</option>`)
            .join('');
    }

    select.value = SettingsStore.getHeaderMode();
    select.addEventListener('change', () => {
        const next = setHeaderMode(select.value, { animate: true, toast: true });
        select.value = next;
    });
}

export function initHeaderCollapse() {
    if (bound || typeof document === 'undefined') return;
    bound = true;

    const brand = brandEl();
    const header = headerEl();
    if (!brand) return;

    if (!brand.hasAttribute('role')) brand.setAttribute('role', 'button');
    if (!brand.hasAttribute('tabindex')) brand.setAttribute('tabindex', '0');

    const restored = SettingsStore.getHeaderMode();
    applyHeaderModeDom(restored);
    if (restored !== 'full') reflowMosaic();

    bindHeaderModeSettings();

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
