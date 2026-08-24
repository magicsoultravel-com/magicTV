/**
 * In-page floating + bottom-right dock hosts for the Browser shell (split mode).
 * Catalog tab state stays in appState; this only presents #browser-shell.
 */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { loadPlayerState } from '../storage/playerState.js';
import { MultiView } from '../multiView.js';
import {
    getLayoutState,
    patchLayout,
    joinBrowser,
    browserShellEl,
    isSplit,
    bringModuleToFront,
    SHELL_BROWSER
} from './moduleLayout.js';
import { browserEndActionsEl, startActionsEl } from './moduleActions.js';

const MIN_W = 260;
const MIN_H = 480;
const VIEW_PAD = 8;
const DEFAULT_SHEET_HEIGHT_FALLBACK = 0.62;

let bound = false;
let pinned = false;
let ensureBrowserCatalog = () => {};
/** @type {'hidden'|'docked'|'undocked'} */
let uiMode = 'hidden';
/** @type {{ mode: 'drag'|'resize'|'sheet', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number, originSheetH?: number } | null} */
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

function floatHostEl() {
    return el('browser-module-host');
}

function dockHostEl() {
    return el('browser-dock-host');
}

function dockSheetEl() {
    return el('browser-dock-sheet');
}

function dockTabEl() {
    return el('browser-dock-tab');
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

function showFloatUI(show) {
    const modal = moduleEl();
    if (!modal) return;
    modal.classList.toggle('is-hidden', !show);
    modal.hidden = !show;
    modal.setAttribute('aria-hidden', String(!show));
    document.body.classList.toggle('browser-module-open', show);
}

function measureRemoteDockGeometry() {
    const remoteSheet = el('remote-dock-sheet');
    const remoteTab = el('remote-dock-tab');
    const { w: vw, h: vh } = viewportSize();
    let remoteW = remoteSheet?.offsetWidth || 0;
    if (remoteW < 40) {
        remoteW = remoteTab?.offsetWidth || 0;
    }
    if (remoteW < 40) {
        const cssMin = getComputedStyle(document.documentElement)
            .getPropertyValue('--remote-min-width')
            .trim();
        const parsed = parseFloat(cssMin);
        remoteW = Number.isFinite(parsed) ? parsed : MIN_W;
    }

    let remoteH = 0;
    if (remoteSheet?.classList.contains('is-expanded') && remoteSheet.offsetHeight > 40) {
        remoteH = remoteSheet.offsetHeight;
    } else {
        const saved = loadPlayerState()?.remoteModule;
        const ratio = Number(saved?.sheetHeight);
        const r = Number.isFinite(ratio)
            ? Math.min(0.85, Math.max(0.25, ratio))
            : DEFAULT_SHEET_HEIGHT_FALLBACK;
        remoteH = Math.round(vh * r);
    }

    return {
        width: Math.round(Math.min(vw * 0.9, Math.max(MIN_W * 2, remoteW * 2))),
        height: Math.round(Math.min(vh * 0.9, Math.max(MIN_H, remoteH)))
    };
}

function applyDockGeometry(heightOverride = null) {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    if (!sheet) return;
    const base = measureRemoteDockGeometry();
    const { h: vh } = viewportSize();
    const height = heightOverride != null
        ? Math.round(Math.min(vh * 0.85, Math.max(MIN_H, heightOverride)))
        : base.height;
    const width = base.width;
    sheet.style.width = `${width}px`;
    sheet.style.height = `${height}px`;
    sheet.style.top = 'auto';
    sheet.style.right = '';
    sheet.style.bottom = '0';
    sheet.style.maxHeight = '85vh';
    sheet.style.setProperty('--browser-sheet-height', String(height / Math.max(1, vh)));
    if (tab) tab.style.width = `${width}px`;
}

function setDockExpanded(expanded) {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    sheet?.classList.toggle('is-expanded', expanded);
    sheet?.classList.toggle('is-collapsed', !expanded);
    sheet?.setAttribute('aria-hidden', String(!expanded));
    tab?.classList.toggle('is-active', expanded && uiMode === 'docked');
    tab?.classList.toggle('is-hidden', uiMode === 'undocked' || !isSplit());
    tab?.setAttribute('aria-expanded', String(expanded && uiMode === 'docked'));
    tab?.classList.toggle('is-visible', isSplit() && uiMode === 'hidden');
    document.body.classList.toggle('browser-docked', uiMode === 'docked');
    document.body.classList.toggle('browser-docked-expanded', uiMode === 'docked' && expanded);
    document.body.classList.toggle('browser-hidden-tab', isSplit() && uiMode === 'hidden');
    document.body.classList.remove('browser-dock-tab-visible');
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

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (gesture.mode === 'sheet') {
        const originPx = gesture.originSheetH ?? measureRemoteDockGeometry().height;
        // Top-edge resize on a bottom sheet: dragging up grows height.
        const nextPx = Math.max(MIN_H, originPx - dy);
        applyDockGeometry(nextPx);
        return;
    }

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
    if (width < MIN_W) {
        if (edge.includes('w')) left = gesture.originLeft + gesture.originW - MIN_W;
        width = MIN_W;
    }
    if (height < MIN_H) {
        if (edge.includes('n')) top = gesture.originTop + gesture.originH - MIN_H;
        height = MIN_H;
    }
    applyGeometry({ left, top, width, height });
}

function onPointerUp(e) {
    if (!gesture || (e && e.pointerId !== gesture.pointerId)) return;
    try {
        e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
        /* ignore */
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    dialogEl()?.classList.remove('is-dragging');
    dockSheetEl()?.querySelector('[data-browser-dock-resize]')?.classList.remove('is-dragging');

    const wasSheet = gesture.mode === 'sheet';
    gesture = null;
    if (wasSheet) {
        const sheet = dockSheetEl();
        const height = sheet?.getBoundingClientRect().height;
        const { h: vh } = viewportSize();
        if (Number.isFinite(height) && vh > 0) {
            patchLayout({ browserSheetHeight: height / vh }, { reconcile: false });
        }
        applyDockGeometry(height);
        return;
    }
    if (uiMode === 'undocked') {
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
}

function beginGesture(e, mode, edge = '') {
    if (e.button != null && e.button !== 0) return;

    if (mode === 'sheet') {
        const sheet = dockSheetEl();
        gesture = {
            mode: 'sheet',
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originLeft: 0,
            originTop: 0,
            originW: 0,
            originH: 0,
            originSheetH: sheet?.getBoundingClientRect().height ?? measureRemoteDockGeometry().height
        };
        sheet?.querySelector('[data-browser-dock-resize]')?.classList.add('is-dragging');
    } else {
        const dialog = dialogEl();
        if (!dialog || uiMode !== 'undocked') return;
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
        if (mode === 'drag') dialog.classList.add('is-dragging');
    }

    try {
        e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {
        /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    e.preventDefault();
}

function syncWindowControls() {
    const strip = el('browser-window-controls');
    const layoutStrip = el('layout-window-controls');
    const dockBtn = el('browser-dock-toggle');
    const hideBtn = el('browser-hide-toggle');
    const splitBtn = el('remote-split-browser-btn');
    const joinBtn = el('browser-join-btn');
    const split = isSplit();
    const kind = getLayoutState().browserHostKind;

    strip?.classList.toggle('is-hidden', !split);

    if (splitBtn) {
        splitBtn.classList.toggle('is-hidden', split);
        splitBtn.innerHTML = CARD_ICONS.splitLayout;
        splitBtn.title = 'Split browser';
        splitBtn.setAttribute('aria-label', splitBtn.title);
        splitBtn.setAttribute('aria-pressed', String(split));
    }
    if (joinBtn) {
        joinBtn.classList.toggle('is-hidden', !split);
        joinBtn.innerHTML = CARD_ICONS.popin;
        joinBtn.title = 'Join browser with remote';
        joinBtn.setAttribute('aria-label', joinBtn.title);
    }

    if (dockBtn) {
        dockBtn.classList.toggle('is-hidden', !split);
        const undocked = kind === 'undocked';
        dockBtn.innerHTML = undocked ? ACTION_ICONS.dock : ACTION_ICONS.undock;
        dockBtn.title = undocked ? 'Dock browser' : 'Undock browser';
        dockBtn.setAttribute('aria-label', dockBtn.title);
    }
    if (hideBtn) {
        hideBtn.classList.toggle('is-hidden', !split);
        hideBtn.innerHTML = ACTION_ICONS.collapse;
        const unhidden = kind !== 'hidden';
        hideBtn.classList.toggle('is-module-unhidden', unhidden);
        hideBtn.title = unhidden ? 'Hide browser' : 'Show browser';
        hideBtn.setAttribute('aria-label', hideBtn.title);
    }
}

function syncActionButtons() {
    const popBtn = el('browser-external-popout-btn');
    const split = isSplit();
    if (popBtn) {
        popBtn.classList.toggle('is-hidden', !split);
        popBtn.innerHTML = CARD_ICONS.popout;
        popBtn.title = 'Pop out browser';
        popBtn.setAttribute('aria-label', 'Pop out browser');
    }
    syncWindowControls();
    syncRemoteScreenFooter();
}

function syncRemoteScreenFooter() {
    const footer = el('remote-shell-screens-footer');
    if (!footer) return;
    const split = isSplit();
    footer.classList.toggle('is-hidden', !split);
    footer.setAttribute('aria-hidden', String(!split));
    if (split) MultiView.syncScreenControls?.();
}

function bindOnce() {
    if (bound) return;
    bound = true;
    const modal = moduleEl();
    const dialog = dialogEl();

    modal?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_BROWSER), true);
    dockSheetEl()?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_BROWSER), true);
    dockTabEl()?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_BROWSER), true);

    dialog?.addEventListener('pointerdown', (e) => {
        if (uiMode !== 'undocked') return;
        if (e.target.closest?.('[data-browser-resize]')) {
            beginGesture(e, 'resize', e.target.closest('[data-browser-resize]').getAttribute('data-browser-resize') || 'se');
            return;
        }
        if (e.target.closest?.('[data-browser-module-drag]')) {
            if (e.target.closest?.('button')) return;
            beginGesture(e, 'drag');
            return;
        }
        if (e.target.closest?.('button, input, select, textarea, a, .channel-tile, .country-tile, .tv-controls__screen-btn, .tv-controls__add-screen-btn, [data-browser-resize], [data-browser-window-action]')) {
            return;
        }
        beginGesture(e, 'drag');
    });

    modal?.querySelectorAll('[data-browser-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'resize', handle.getAttribute('data-browser-resize') || 'se');
        });
    });

    dockSheetEl()?.querySelector('[data-browser-dock-resize]')?.addEventListener('pointerdown', (e) => {
        beginGesture(e, 'sheet');
    });

    dockTabEl()?.addEventListener('click', () => {
        if (!isSplit()) return;
        if (uiMode === 'hidden') BrowserModule.show();
        else if (uiMode === 'docked') BrowserModule.hide();
    });

    modal?.querySelector('[data-browser-module-dismiss]')?.addEventListener('click', () => {
        if (!pinned && uiMode === 'undocked') BrowserModule.hide();
    });

    el('browser-join-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        joinBrowser();
        window.dispatchEvent(new CustomEvent('remote:layout_changed', { detail: { mode: 'joined' } }));
    });

    el('browser-external-popout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAppToast('Browser OS popout uses the remote Pop out control for now');
    });

    document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('[data-browser-window-action]');
        if (btn) {
            e.preventDefault();
            const action = btn.getAttribute('data-browser-window-action');
            if (action === 'dock-toggle') {
                if (getLayoutState().browserHostKind === 'undocked') BrowserModule.dock();
                else BrowserModule.undock();
            } else if (action === 'hide-toggle') {
                if (getLayoutState().browserHostKind === 'hidden') BrowserModule.show();
                else BrowserModule.hide();
            }
            return;
        }
        const brand = e.target?.closest?.('#browser-shell > .module-shell__chrome > .remote-module__brand');
        if (!brand) return;
        if (!isSplit() || uiMode === 'hidden') return;
        if (dialogEl()?.classList.contains('is-dragging')) return;
        e.preventDefault();
        BrowserModule.hide();
    });

    window.addEventListener('resize', () => {
        if (!isSplit()) return;
        if (uiMode === 'undocked') applyGeometry(readDialogGeometry());
        if (uiMode === 'docked') applyDockGeometry();
    });
}

function tearDownHosts() {
    const shell = browserShellEl();
    restoreActions();
    restoreShellToHome(shell);
    showFloatUI(false);
    setDockExpanded(false);
    dockSheetEl()?.style.removeProperty('width');
    dockTabEl()?.classList.add('is-hidden');
    dockTabEl()?.classList.remove('is-visible');
    uiMode = 'hidden';
    document.body.classList.remove('browser-shell-split', 'browser-docked', 'browser-docked-expanded', 'browser-dock-tab-visible', 'browser-hidden-tab');
    syncActionButtons();
}

export const BrowserModule = {
    init({ ensureBrowserCatalog: ensureFn } = {}) {
        if (typeof ensureFn === 'function') ensureBrowserCatalog = ensureFn;
        bindOnce();
        syncActionButtons();
        setDockExpanded(false);
        dockTabEl()?.classList.add('is-hidden');
    },

    isOpen() {
        return isSplit() && (uiMode === 'undocked' || uiMode === 'docked');
    },

    getUiMode() {
        return uiMode;
    },

    /** Show in-page float and mount browser shell into it. */
    openUndocked() {
        bindOnce();
        const host = floatHostEl();
        if (!host) return;
        const saved = getLayoutState().browser;
        setDockExpanded(false);
        dockTabEl()?.classList.add('is-hidden');
        showFloatUI(true);
        uiMode = 'undocked';
        applyGeometry(saved, { pinned: saved.pinned === true });
        mountShellToHost(host);
        bringModuleToFront(SHELL_BROWSER);
        document.body.classList.add('browser-shell-split');
        document.body.classList.remove('browser-docked', 'browser-docked-expanded', 'browser-dock-tab-visible', 'browser-hidden-tab');
        syncActionButtons();
        patchLayout({ browserHostKind: 'undocked' }, { reconcile: false });
        ensureBrowserCatalog();
    },

    dock() {
        if (!isSplit()) return;
        bindOnce();
        showFloatUI(false);
        const host = dockHostEl();
        if (!host) return;
        uiMode = 'docked';
        applyDockGeometry();
        setDockExpanded(true);
        dockTabEl()?.classList.remove('is-hidden');
        mountShellToHost(host);
        bringModuleToFront(SHELL_BROWSER);
        document.body.classList.add('browser-shell-split', 'browser-docked', 'browser-docked-expanded');
        document.body.classList.remove('browser-dock-tab-visible', 'browser-hidden-tab');
        syncActionButtons();
        patchLayout({ browserHostKind: 'docked' }, { reconcile: false });
        ensureBrowserCatalog();
    },

    undock() {
        if (!isSplit()) return;
        this.openUndocked();
    },

    hide() {
        if (!isSplit()) return;
        bindOnce();
        // Keep shell mounted in dock host (collapsed) for fast restore.
        if (uiMode === 'undocked') {
            const host = dockHostEl();
            if (host) mountShellToHost(host);
        }
        showFloatUI(false);
        uiMode = 'hidden';
        setDockExpanded(false);
        dockTabEl()?.classList.remove('is-hidden');
        dockTabEl()?.classList.add('is-visible');
        document.body.classList.add('browser-shell-split', 'browser-hidden-tab');
        document.body.classList.remove('browser-docked-expanded', 'browser-dock-tab-visible');
        document.body.classList.toggle('browser-docked', false);
        syncActionButtons();
        patchLayout({ browserHostKind: 'hidden' }, { reconcile: false });
    },

    show() {
        if (!isSplit()) return;
        this.dock();
        ensureBrowserCatalog();
    },

    /** Tear down float/dock UI and leave shell placement to reconcile (join path). */
    close() {
        tearDownHosts();
    },

    mountTo(host) {
        if (!host) return;
        mountShellToHost(host);
        syncActionButtons();
    },

    getHost() {
        if (uiMode === 'docked' || uiMode === 'hidden') return dockHostEl();
        return floatHostEl();
    },

    syncActionButtons,
    syncWindowControls,

    persistGeometry() {
        if (uiMode !== 'undocked') return;
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
};
