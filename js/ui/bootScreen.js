/**
 * First-paint boot cover: alternate grain vs classic color-bar GFX.
 * No boot audio — graphics only.
 */
import { el } from '../tvUtils.js';
import {
    VIEW_MOTION,
    primeBootGrain,
    revealBootWithGrain
} from './viewTransitions.js';

const BOOT_STYLE_KEY = 'magicTV_boot_style';
const BOOT_STYLES = ['grain', 'colorbars'];

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function normalizeBootStyle(value) {
    return BOOT_STYLES.includes(value) ? value : 'grain';
}

function readLastBootStyle() {
    try {
        return normalizeBootStyle(localStorage.getItem(BOOT_STYLE_KEY));
    } catch {
        return 'grain';
    }
}

function writeBootStyle(style) {
    try {
        localStorage.setItem(BOOT_STYLE_KEY, style);
    } catch { /* private mode */ }
}

/**
 * Flip grain ↔ colorbars each boot and apply data-boot-style on the cover.
 * @returns {'grain'|'colorbars'}
 */
export function pickBootStyle(bootEl) {
    const boot = bootEl || el('boot-screen');
    const last = readLastBootStyle();
    const next = last === 'colorbars' ? 'grain' : 'colorbars';
    writeBootStyle(next);
    if (boot) boot.setAttribute('data-boot-style', next);
    return next;
}

/**
 * Prime the chosen boot cover (grain paint or color-bar CSS).
 * @returns {'grain'|'colorbars'}
 */
export function primeBootScreen(bootEl) {
    const boot = bootEl || el('boot-screen');
    const style = pickBootStyle(boot);
    if (style === 'grain') primeBootGrain(boot);
    return style;
}

/**
 * Reveal themed GUI from the active boot cover (shared opacity morph-out).
 */
export async function revealBootScreen(bootEl, appEl) {
    const boot = bootEl || el('boot-screen');
    const style = normalizeBootStyle(boot?.getAttribute('data-boot-style'));

    if (style === 'grain') {
        return revealBootWithGrain(boot, appEl);
    }

    const app = appEl || el('app-container');
    const root = document.documentElement;

    const finish = () => {
        root.classList.remove('is-booting');
        if (app) {
            app.style.opacity = '';
            app.style.visibility = '';
            app.style.filter = '';
        }
        boot?.remove();
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
        /* fall through */
    } finally {
        finish();
    }
}
