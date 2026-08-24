/**
 * Per-shell idle fade (Remote / Browser).
 * Same settings (delay/duration); independent timers and hover pause when split.
 */
import { SettingsStore } from '../storage/settingsStore.js';
import { isSplit } from './moduleLayout.js';

const REMOTE_HOSTS = '#remote-module, #remote-dock-sheet, #remote-dock-tab';
const BROWSER_HOSTS = '#browser-module, #browser-dock-sheet, #browser-dock-tab';

/** @type {Record<string, {
 *   delayTimer: ReturnType<typeof setTimeout> | null,
 *   fadeRaf: number | null,
 *   mult: number,
 *   hovering: boolean,
 *   cssVar: string,
 *   fadedClass: string,
 *   hosts: string
 * }>} */
const shells = {
    remote: {
        delayTimer: null,
        fadeRaf: null,
        mult: 1,
        hovering: false,
        cssVar: '--remote-idle-opacity-mult',
        fadedClass: 'remote-idle-faded',
        hosts: REMOTE_HOSTS
    },
    browser: {
        delayTimer: null,
        fadeRaf: null,
        mult: 1,
        hovering: false,
        cssVar: '--browser-idle-opacity-mult',
        fadedClass: 'browser-idle-faded',
        hosts: BROWSER_HOSTS
    }
};

let bound = false;

function getSettings() {
    return {
        enabled: SettingsStore.getRemoteIdleFadeEnabled(),
        delayMs: SettingsStore.getRemoteIdleDelaySec() * 1000,
        fadeMs: SettingsStore.getRemoteIdleFadeSec() * 1000
    };
}

function clearTimers(id) {
    const s = shells[id];
    if (!s) return;
    if (s.delayTimer) {
        clearTimeout(s.delayTimer);
        s.delayTimer = null;
    }
    if (s.fadeRaf) {
        cancelAnimationFrame(s.fadeRaf);
        s.fadeRaf = null;
    }
}

function updateCss(id) {
    const s = shells[id];
    if (!s || typeof document === 'undefined') return;
    const effective = s.hovering ? 1 : s.mult;
    document.documentElement.style.setProperty(s.cssVar, String(effective));
    document.body.classList.toggle(s.fadedClass, s.mult <= 0.01 && !s.hovering);
}

function applyMult(id, mult) {
    const s = shells[id];
    if (!s) return;
    s.mult = Math.max(0, Math.min(1, mult));
    updateCss(id);
}

function startFadeOut(id, fadeMs) {
    const s = shells[id];
    if (!s || s.hovering) return;
    const start = performance.now();
    const tick = (now) => {
        if (s.hovering) {
            s.fadeRaf = null;
            applyMult(id, 1);
            return;
        }
        const t = fadeMs <= 0 ? 1 : Math.min(1, (now - start) / fadeMs);
        applyMult(id, 1 - t);
        if (t < 1) s.fadeRaf = requestAnimationFrame(tick);
        else s.fadeRaf = null;
    };
    s.fadeRaf = requestAnimationFrame(tick);
}

function schedule(id) {
    clearTimers(id);
    const s = shells[id];
    if (!s) return;
    if (id === 'browser' && !isSplit()) {
        applyMult(id, 1);
        return;
    }
    // Avoid importing RemoteExternalPopout (cycle with remoteModule). Body class is the SSOT signal.
    if (id === 'remote' && document.body?.classList?.contains('remote-external-popout-active')) {
        applyMult(id, 1);
        return;
    }
    const { enabled, delayMs, fadeMs } = getSettings();
    if (!enabled) {
        applyMult(id, 1);
        return;
    }
    if (s.hovering) {
        applyMult(id, 1);
        return;
    }
    applyMult(id, 1);
    s.delayTimer = setTimeout(() => startFadeOut(id, fadeMs), delayMs);
}

function wake(id) {
    const s = shells[id];
    if (!s) return;
    clearTimers(id);
    applyMult(id, 1);
    schedule(id);
}

function shellFromEventTarget(target) {
    if (!target?.closest) return null;
    if (target.closest(BROWSER_HOSTS)) return 'browser';
    if (target.closest(REMOTE_HOSTS)) return 'remote';
    return null;
}

function onPointerDown(e) {
    const id = shellFromEventTarget(e.target);
    if (id) wake(id);
    else if (!isSplit()) wake('remote');
}

function onKeyActivity() {
    wake('remote');
    if (isSplit()) wake('browser');
}

function setHovering(id, hovering) {
    const s = shells[id];
    if (!s) return;
    s.hovering = hovering === true;
    if (s.hovering) {
        clearTimers(id);
        applyMult(id, 1);
    } else {
        updateCss(id);
        schedule(id);
    }
}

function bindHover(id) {
    const s = shells[id];
    document.addEventListener('pointerover', (e) => {
        if (!e.target.closest?.(s.hosts)) return;
        if (s.hovering) return;
        setHovering(id, true);
    }, true);
    document.addEventListener('pointerout', (e) => {
        if (!e.target.closest?.(s.hosts)) return;
        const related = e.relatedTarget;
        if (related && typeof related.closest === 'function' && related.closest(s.hosts)) return;
        setHovering(id, false);
    }, true);
}

export const ModuleIdleFade = {
    init() {
        if (bound || typeof document === 'undefined') return;
        bound = true;
        document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
        document.addEventListener('touchstart', onPointerDown, { capture: true, passive: true });
        document.addEventListener('wheel', onPointerDown, { capture: true, passive: true });
        document.addEventListener('keydown', onKeyActivity, { capture: true, passive: true });
        bindHover('remote');
        bindHover('browser');
        applyMult('remote', 1);
        applyMult('browser', 1);
        schedule('remote');
        if (isSplit()) schedule('browser');
    },

    wakeRemote() {
        wake('remote');
    },

    wakeBrowser() {
        if (isSplit()) wake('browser');
        else applyMult('browser', 1);
    },

    /** Call after split/join so the right shells are scheduled. */
    syncForLayout() {
        if (isSplit()) {
            schedule('remote');
            schedule('browser');
        } else {
            clearTimers('browser');
            applyMult('browser', 1);
            schedule('remote');
        }
    },

    resetAll() {
        wake('remote');
        if (isSplit()) wake('browser');
        else applyMult('browser', 1);
    }
};
