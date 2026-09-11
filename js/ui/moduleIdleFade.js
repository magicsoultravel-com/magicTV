/**
 * Whole-UI idle fade (header, remote/browser modules, dock tabs, tile chrome).
 * One timer + one CSS multiplier; hover over chrome hosts pauses the fade.
 */
import { SettingsStore } from '../storage/settingsStore.js';

const UI_HOSTS = [
    '.tv-header',
    '#remote-module',
    '#remote-dock-sheet',
    '#remote-dock-tab',
    '#browser-module',
    '#browser-dock-sheet',
    '#browser-dock-tab'
].join(', ');

const CSS_VAR = '--ui-idle-opacity-mult';
const FADED_CLASS = 'ui-idle-faded';

/** @type {{
 *   delayTimer: ReturnType<typeof setTimeout> | null,
 *   fadeRaf: number | null,
 *   mult: number,
 *   hovering: boolean
 * }} */
const state = {
    delayTimer: null,
    fadeRaf: null,
    mult: 1,
    hovering: false
};

let bound = false;

function getSettings() {
    return {
        enabled: SettingsStore.getRemoteIdleFadeEnabled(),
        delayMs: SettingsStore.getRemoteIdleDelaySec() * 1000,
        fadeMs: SettingsStore.getRemoteIdleFadeSec() * 1000
    };
}

function clearTimers() {
    if (state.delayTimer) {
        clearTimeout(state.delayTimer);
        state.delayTimer = null;
    }
    if (state.fadeRaf) {
        cancelAnimationFrame(state.fadeRaf);
        state.fadeRaf = null;
    }
}

function updateCss() {
    if (typeof document === 'undefined') return;
    const effective = state.hovering ? 1 : state.mult;
    document.documentElement.style.setProperty(CSS_VAR, String(effective));
    document.body.classList.toggle(FADED_CLASS, state.mult <= 0.01 && !state.hovering);
}

function applyMult(mult) {
    state.mult = Math.max(0, Math.min(1, mult));
    updateCss();
}

function startFadeOut(fadeMs) {
    if (state.hovering) return;
    const start = performance.now();
    const tick = (now) => {
        if (state.hovering) {
            state.fadeRaf = null;
            applyMult(1);
            return;
        }
        const t = fadeMs <= 0 ? 1 : Math.min(1, (now - start) / fadeMs);
        applyMult(1 - t);
        if (t < 1) state.fadeRaf = requestAnimationFrame(tick);
        else state.fadeRaf = null;
    };
    state.fadeRaf = requestAnimationFrame(tick);
}

function schedule() {
    clearTimers();
    // Avoid importing RemoteExternalPopout (cycle with remoteModule). Body class is the SSOT signal.
    if (document.body?.classList?.contains('remote-external-popout-active')) {
        applyMult(1);
        return;
    }
    const { enabled, delayMs, fadeMs } = getSettings();
    if (!enabled || state.hovering) {
        applyMult(1);
        return;
    }
    applyMult(1);
    state.delayTimer = setTimeout(() => startFadeOut(fadeMs), delayMs);
}

function wake() {
    clearTimers();
    applyMult(1);
    schedule();
}

function setHovering(hovering) {
    state.hovering = hovering === true;
    if (state.hovering) {
        clearTimers();
        applyMult(1);
    } else {
        updateCss();
        schedule();
    }
}

function bindHover() {
    document.addEventListener('pointerover', (e) => {
        if (!e.target.closest?.(UI_HOSTS)) return;
        if (state.hovering) return;
        setHovering(true);
    }, true);
    document.addEventListener('pointerout', (e) => {
        if (!e.target.closest?.(UI_HOSTS)) return;
        const related = e.relatedTarget;
        if (related && typeof related.closest === 'function' && related.closest(UI_HOSTS)) return;
        setHovering(false);
    }, true);
}

export const ModuleIdleFade = {
    init() {
        if (bound || typeof document === 'undefined') return;
        bound = true;
        document.addEventListener('pointerdown', wake, { capture: true, passive: true });
        document.addEventListener('touchstart', wake, { capture: true, passive: true });
        document.addEventListener('wheel', wake, { capture: true, passive: true });
        document.addEventListener('pointermove', wake, { capture: true, passive: true });
        document.addEventListener('keydown', wake, { capture: true, passive: true });
        bindHover();
        applyMult(1);
        schedule();
    },

    wakeRemote() {
        wake();
    },

    wakeBrowser() {
        wake();
    },

    /** Call after split/join so fade reschedules with the current layout. */
    syncForLayout() {
        schedule();
    },

    resetAll() {
        wake();
    }
};
