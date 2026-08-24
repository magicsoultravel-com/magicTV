/**
 * In-page floating window host for the Browser shell (split mode).
 * Catalog tab state stays in appState; this only presents #browser-shell.
 */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';
import {
    getLayoutState,
    patchLayout,
    joinBrowser,
    browserShellEl,
    isSplit
} from './moduleLayout.js';
import { browserEndActionsEl, startActionsEl } from './moduleActions.js';

const MIN_W = 260;
const MIN_H = 480;
const VIEW_PAD = 8;

let bound = false;
let pinned = false;
/** @type {{ mode: 'drag'|'resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number } | null} */
let gesture = null;

let startDockParent = null;
let startNextSibling = null;
let browserEndDockParent = null;
let browserEndNextSibling = null;
let shellDockParent = null;
let shellNextSibling = null;

function moduleEl() {
    return el('browser-module');
}

function dialogEl() {
    return el('browser-module-dialog');
}

function hostEl() {
    return el('browser-module-host');
}

function stagingEl() {
    return el('remote-module-staging');
}

function viewportSize() {
    return {
        w: window.innerWidth || document.documentElement.clientWidth || 800,
        h: window.innerHeight || document.documentElement.clientHeight || 600
    };
}

function clampGeometry({ left, top, width, height }) {
    const { w: vw, h: vh } = viewportSize();
    let w = Math.max(MIN_W, Math.min(width, vw - VIEW_PAD * 2));
    let h = Math.max(MIN_H, Math.min(height, vh - VIEW_PAD * 2));
    let x = Math.min(Math.max(VIEW_PAD, left), vw - VIEW_PAD - Math.min(w, 80));
    let y = Math.min(Math.max(VIEW_PAD, top), vh - VIEW_PAD - 40);
    if (x + w > vw - VIEW_PAD) w = Math.max(MIN_W, vw - VIEW_PAD - x);
    if (y + h > vh - VIEW_PAD) h = Math.max(MIN_H, vh - VIEW_PAD - y);
    return { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) return getLayoutState().browser;
    const rect = dialog.getBoundingClientRect();
    return clampGeometry({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    });
}

function applyGeometry(geom, { pinned: pinFlag } = {}) {
    const dialog = dialogEl();
    if (!dialog || !geom) return;
    const next = clampGeometry(geom);
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
    if (typeof pinFlag === 'boolean') setPinned(pinFlag, { persist: false });
}

function setPinned(next, { persist = true } = {}) {
    pinned = next === true;
    moduleEl()?.classList.toggle('is-pinned', pinned);
    const dialog = dialogEl();
    if (dialog) dialog.setAttribute('aria-modal', pinned ? 'false' : 'true');
    if (persist) {
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
}

function showUI(show) {
    const modal = moduleEl();
    if (!modal) return;
    modal.classList.toggle('is-hidden', !show);
    modal.hidden = !show;
    modal.setAttribute('aria-hidden', String(!show));
    document.body.classList.toggle('browser-module-open', show);
}

function rememberShellHome(shell) {
    if (!shell || shellDockParent) return;
    shellDockParent = shell.parentElement;
    shellNextSibling = shell.nextSibling;
}

function restoreShellToHome(shell) {
    if (!shell) return;
    if (shellDockParent) {
        if (shellNextSibling && shellNextSibling.parentElement === shellDockParent) {
            shellDockParent.insertBefore(shell, shellNextSibling);
        } else {
            shellDockParent.appendChild(shell);
        }
    }
    shellDockParent = null;
    shellNextSibling = null;
}

function rememberActions() {
    const start = startActionsEl();
    const browserEnd = browserEndActionsEl();
    if (start && !startDockParent) {
        startDockParent = start.parentElement;
        startNextSibling = start.nextSibling;
    }
    if (browserEnd && !browserEndDockParent) {
        browserEndDockParent = browserEnd.parentElement;
        browserEndNextSibling = browserEnd.nextSibling;
    }
}

function restoreActions() {
    const start = startActionsEl();
    const browserEnd = browserEndActionsEl();
    if (start && startDockParent) {
        if (startNextSibling && startNextSibling.parentElement === startDockParent) {
            startDockParent.insertBefore(start, startNextSibling);
        } else {
            startDockParent.appendChild(start);
        }
    }
    if (browserEnd && browserEndDockParent) {
        if (browserEndNextSibling && browserEndNextSibling.parentElement === browserEndDockParent) {
            browserEndDockParent.insertBefore(browserEnd, browserEndNextSibling);
        } else {
            browserEndDockParent.appendChild(browserEnd);
        }
    }
    startDockParent = null;
    startNextSibling = null;
    browserEndDockParent = null;
    browserEndNextSibling = null;
}

function mountShellToHost(host) {
    const shell = browserShellEl();
    if (!shell || !host) return;
    rememberShellHome(shell);
    rememberActions();
    const start = startActionsEl() || stagingEl()?.querySelector('.tv-module__actions--start');
    const browserEnd = browserEndActionsEl() || stagingEl()?.querySelector('.tv-module__actions--browser-end');
    if (start) host.appendChild(start);
    if (browserEnd) host.appendChild(browserEnd);
    host.appendChild(shell);
}

function beginGesture(e, mode, edge) {
    if (e.button != null && e.button !== 0) return;
    const dialog = dialogEl();
    if (!dialog) return;
    const geom = readDialogGeometry();
    gesture = {
        mode,
        edge,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: geom.left,
        originTop: geom.top,
        originW: geom.width,
        originH: geom.height
    };
    try {
        dialog.setPointerCapture(e.pointerId);
    } catch {
        /* ignore */
    }
    e.preventDefault();
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.mode === 'drag') {
        applyGeometry({
            left: gesture.originLeft + dx,
            top: gesture.originTop + dy,
            width: gesture.originW,
            height: gesture.originH
        });
        return;
    }
    let { originLeft: left, originTop: top, originW: width, originH: height } = gesture;
    const edge = gesture.edge || '';
    if (edge.includes('e')) width = gesture.originW + dx;
    if (edge.includes('s')) height = gesture.originH + dy;
    if (edge.includes('w')) {
        left = gesture.originLeft + dx;
        width = gesture.originW - dx;
    }
    if (edge.includes('n')) {
        top = gesture.originTop + dy;
        height = gesture.originH - dy;
    }
    applyGeometry({ left, top, width, height });
}

function endGesture(e) {
    if (!gesture || (e && e.pointerId !== gesture.pointerId)) return;
    gesture = null;
    patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
}

function bindOnce() {
    if (bound) return;
    bound = true;
    const modal = moduleEl();
    if (!modal) return;

    modal.addEventListener('pointerdown', (e) => {
        const drag = e.target?.closest?.('[data-browser-module-drag]');
        const resize = e.target?.closest?.('[data-browser-resize]');
        if (resize) {
            beginGesture(e, 'resize', resize.getAttribute('data-browser-resize') || 'se');
            return;
        }
        if (drag) beginGesture(e, 'drag');
    });
    modal.addEventListener('pointermove', onPointerMove);
    modal.addEventListener('pointerup', endGesture);
    modal.addEventListener('pointercancel', endGesture);

    modal.querySelector('[data-browser-module-dismiss]')?.addEventListener('click', () => {
        if (!pinned) joinBrowser();
    });

    el('browser-join-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        joinBrowser();
    });

    el('browser-external-popout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        // Step 1: in-page split is the supported Browser host; OS popout reuses remote path later.
        showAppToast('Browser OS popout uses the remote Pop out control for now');
    });

    window.addEventListener('resize', () => {
        if (isSplit() && getLayoutState().browserHostKind === 'undocked') {
            applyGeometry(readDialogGeometry());
        }
    });
}

function syncActionButtons() {
    const joinBtn = el('browser-join-btn');
    const popBtn = el('browser-external-popout-btn');
    const split = isSplit();
    if (joinBtn) {
        joinBtn.classList.toggle('is-hidden', !split);
        joinBtn.innerHTML = CARD_ICONS.popin;
        joinBtn.title = 'Join with remote';
        joinBtn.setAttribute('aria-label', 'Join with remote');
    }
    if (popBtn) {
        popBtn.classList.toggle('is-hidden', !split);
        popBtn.innerHTML = CARD_ICONS.popout;
        popBtn.title = 'Pop out browser';
        popBtn.setAttribute('aria-label', 'Pop out browser');
    }
}

export const BrowserModule = {
    init() {
        bindOnce();
        syncActionButtons();
    },

    isOpen() {
        return isSplit() && getLayoutState().browserHostKind === 'undocked';
    },

    /** Show in-page float and mount browser shell into it. */
    openUndocked() {
        bindOnce();
        const host = hostEl();
        if (!host) return;
        const saved = getLayoutState().browser;
        showUI(true);
        applyGeometry(saved, { pinned: saved.pinned === true });
        mountShellToHost(host);
        syncActionButtons();
        document.body.classList.add('browser-shell-split');
    },

    /** Tear down float UI and leave shell placement to reconcile (join path). */
    close() {
        const shell = browserShellEl();
        restoreActions();
        restoreShellToHome(shell);
        showUI(false);
        syncActionButtons();
        document.body.classList.remove('browser-shell-split');
    },

    mountTo(host) {
        if (!host) return;
        mountShellToHost(host);
        syncActionButtons();
    },

    getHost() {
        return hostEl();
    },

    syncActionButtons,

    persistGeometry() {
        if (!this.isOpen()) return;
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
};
