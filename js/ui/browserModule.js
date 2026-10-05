/**
 * In-page floating + bottom-right dock hosts for the Browser shell (split mode).
 * Catalog tab state stays in appState; this only presents #browser-shell.
 */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { loadPlayerState } from '../storage/playerState.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { MultiView } from '../multiView.js';
import {
    getLayoutState,
    patchLayout,
    browserShellEl,
    isSplit,
    bringModuleToFront,
    SHELL_BROWSER
} from './moduleLayout.js';
import { assembleEndCluster, browserEndActionsEl, startActionsEl } from './moduleActions.js';
import { RemoteModule } from './remoteModule.js';
import { DockOpenGate } from './dockOpenGate.js';
import {
    BROWSER_BASE_W,
    BROWSER_BASE_H,
    clampFloatGeometry,
    freeCornerResize,
    browserTileScaleFromGeom
} from './moduleScaleResize.js';

const MIN_W = 260;
const MIN_H = 480;
const VIEW_PAD = 8;
const EDGE_INSET = 24;
const DEFAULT_SHEET_HEIGHT_FALLBACK = 0.62;
const BAR_SHEET_HEIGHT = DEFAULT_SHEET_HEIGHT_FALLBACK * (3 / 8);

let bound = false;
let pinned = false;
let ensureBrowserCatalog = () => {};
/** @type {(tab: string) => void} */
let switchTab = () => {};
/** @type {'hidden'|'docked'|'undocked'} */
let uiMode = 'hidden';
/** Saved dock footprint when user corner-resizes (px). */
/** @type {{ width: number, height: number } | null} */
let dockSizeOverride = null;
/** @type {{ mode: 'drag'|'resize'|'dock-resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number } | null} */
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
    return clampFloatGeometry(
        { left, top, width, height },
        { minW: MIN_W, minH: MIN_H, viewPad: VIEW_PAD, vw, vh }
    );
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) return getLayoutState().browser;
    const left = parseFloat(dialog.style.left);
    const top = parseFloat(dialog.style.top);
    const width = parseFloat(dialog.style.width);
    const height = parseFloat(dialog.style.height);
    if (![left, top, width, height].every(Number.isFinite)) {
        const rect = dialog.getBoundingClientRect();
        return clampGeometry({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        });
    }
    return clampGeometry({ left, top, width, height });
}

function applyBrowserTileScale(width, height) {
    const tileScale = browserTileScaleFromGeom({
        width,
        height,
        baseW: BROWSER_BASE_W,
        baseH: BROWSER_BASE_H
    });
    const value = String(tileScale);
    dialogEl()?.style.setProperty('--browser-tile-scale', value);
    dockSheetEl()?.style.setProperty('--browser-tile-scale', value);
    dockHostEl()?.style.setProperty('--browser-tile-scale', value);
    floatHostEl()?.style.setProperty('--browser-tile-scale', value);
}

function applyGeometry(geom, { pinned: pinFlag } = {}) {
    const dialog = dialogEl();
    if (!dialog || !geom) return;
    const next = clampGeometry(geom);
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
    applyBrowserTileScale(next.width, next.height);
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

function applyDockGeometry(sizeOverride = null) {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    if (!sheet) return;
    const { w: vw, h: vh } = viewportSize();
    const useBar = SettingsStore.getCatalogChrome() === 'bar';

    if (useBar) {
        const height = Math.max(48, Math.round(vh * BAR_SHEET_HEIGHT));
        sheet.style.width = `${vw}px`;
        sheet.style.maxWidth = '100vw';
        sheet.style.height = `${height}px`;
        sheet.style.top = 'auto';
        sheet.style.left = '0';
        sheet.style.right = '0';
        sheet.style.bottom = '0';
        sheet.style.maxHeight = '30vh';
        sheet.style.setProperty('--browser-sheet-height', String(BAR_SHEET_HEIGHT));
        sheet.classList.add('is-catalog-bar');
        applyBrowserTileScale(vw, height);
        if (tab) {
            tab.style.width = `${vw}px`;
            tab.style.maxWidth = '100vw';
            tab.style.left = '0';
            tab.style.right = '0';
        }
        document.body.classList.toggle('catalog-bar-active', true);
        return;
    }

    sheet.classList.remove('is-catalog-bar');
    const base = measureRemoteDockGeometry();
    const override = sizeOverride || dockSizeOverride;
    const width = Math.round(Math.min(
        vw * 0.9,
        Math.max(MIN_W * 2, override?.width ?? base.width)
    ));
    const height = Math.round(Math.min(
        vh * 0.85,
        Math.max(MIN_H, override?.height ?? base.height)
    ));
    sheet.style.width = `${width}px`;
    sheet.style.height = `${height}px`;
    sheet.style.top = 'auto';
    sheet.style.left = '';
    sheet.style.right = '';
    sheet.style.bottom = '0';
    sheet.style.maxHeight = '85vh';
    sheet.style.maxWidth = '';
    sheet.style.setProperty('--browser-sheet-height', String(height / Math.max(1, vh)));
    applyBrowserTileScale(width, height);
    if (tab) {
        tab.style.width = `${width}px`;
        tab.style.removeProperty('left');
        tab.style.removeProperty('right');
        tab.style.removeProperty('max-width');
    }
    document.body.classList.toggle('catalog-bar-active', false);
}

function setDockExpanded(expanded, { animateOpen = false } = {}) {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    const wasExpanded = sheet?.classList.contains('is-expanded');
    if (expanded && !wasExpanded && animateOpen) {
        DockOpenGate.begin(sheet);
    }
    if (!expanded) {
        sheet?.classList.remove('is-opening');
        if (wasExpanded) DockOpenGate.cancel();
    }
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
    assembleEndCluster();
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
    const start = startActionsEl();
    const browserEnd = browserEndActionsEl();
    if (start) host.appendChild(start);
    if (browserEnd) host.appendChild(browserEnd);
    host.appendChild(shell);
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

    const edge = gesture.edge || 'se';
    const next = freeCornerResize({
        originLeft: gesture.originLeft,
        originTop: gesture.originTop,
        originW: gesture.originW,
        originH: gesture.originH,
        dx,
        dy,
        edge,
        minW: gesture.mode === 'dock-resize' ? MIN_W * 2 : MIN_W,
        minH: MIN_H
    });

    if (gesture.mode === 'dock-resize') {
        dockSizeOverride = { width: next.width, height: next.height };
        applyDockGeometry(dockSizeOverride);
        return;
    }
    applyGeometry(next);
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

    const wasDock = gesture.mode === 'dock-resize';
    gesture = null;
    if (wasDock) {
        const sheet = dockSheetEl();
        const width = sheet?.getBoundingClientRect().width;
        const height = sheet?.getBoundingClientRect().height;
        if (Number.isFinite(width) && Number.isFinite(height)) {
            dockSizeOverride = { width: Math.round(width), height: Math.round(height) };
            patchLayout({
                browserSheetWidth: width / Math.max(1, viewportSize().w)
            }, { reconcile: false });
        }
        applyDockGeometry(dockSizeOverride);
        return;
    }
    if (uiMode === 'undocked') {
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
}

function beginGesture(e, mode, edge = '') {
    if (e.button != null && e.button !== 0) return;

    if (mode === 'dock-resize') {
        const sheet = dockSheetEl();
        const rect = sheet?.getBoundingClientRect();
        gesture = {
            mode: 'dock-resize',
            edge,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originLeft: rect?.left ?? 0,
            originTop: rect?.top ?? 0,
            originW: rect?.width ?? MIN_W * 2,
            originH: rect?.height ?? MIN_H
        };
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

function edgeInsetLeft(side, width) {
    const { w: vw } = viewportSize();
    const w = Math.max(MIN_W, Number(width) || MIN_W);
    if (side === 'right') {
        return Math.round(Math.max(VIEW_PAD, vw - w - EDGE_INSET));
    }
    return EDGE_INSET;
}

function syncDockSideBtn() {
    RemoteModule.syncDockSideButtons?.();
}

function syncDockToggleBtn() {
    const dockBtn = el('browser-dock-toggle');
    if (!dockBtn) return;
    const split = isSplit();
    dockBtn.classList.toggle('is-hidden', !split);
    const undocked = getLayoutState().browserHostKind === 'undocked';
    dockBtn.innerHTML = undocked ? ACTION_ICONS.dock : ACTION_ICONS.undock;
    dockBtn.title = undocked ? 'Dock browser' : 'Undock browser';
    dockBtn.setAttribute('aria-label', dockBtn.title);
}

function syncCollapseHeaderBtn() {
    const collapseBtn = el('browser-collapse-header-btn');
    if (!collapseBtn) return;
    collapseBtn.classList.remove('is-hidden');
    collapseBtn.innerHTML = ACTION_ICONS.expand;
    const label = isSplit() ? 'Collapse browser' : 'Collapse remote';
    collapseBtn.title = label;
    collapseBtn.setAttribute('aria-label', label);
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
    syncDockToggleBtn();
    syncDockSideBtn();
    syncCollapseHeaderBtn();
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

/** Brand / chevron — collapse browser host when split, else the joined remote. */
function collapseBrowserChrome() {
    if (isSplit()) {
        if (uiMode !== 'hidden') BrowserModule.hide();
        return;
    }
    RemoteModule.hide();
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
            if (e.target.closest?.('button, .remote-module__brand')) return;
            beginGesture(e, 'drag');
            return;
        }
        if (e.target.closest?.('button, input, select, textarea, a, .channel-tile, .country-tile, .tv-controls__screen-btn, .tv-controls__add-screen-btn, [data-browser-resize], .remote-module__brand')) {
            return;
        }
        beginGesture(e, 'drag');
    });

    modal?.querySelectorAll('[data-browser-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'resize', handle.getAttribute('data-browser-resize') || 'se');
        });
    });

    dockSheetEl()?.querySelectorAll('[data-browser-dock-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'dock-resize', handle.getAttribute('data-browser-dock-resize') || 'se');
        });
    });

    dockTabEl()?.addEventListener('click', () => {
        if (!isSplit()) return;
        if (uiMode === 'hidden') BrowserModule.show();
        else if (uiMode === 'docked') BrowserModule.hide();
    });

    modal?.querySelector('[data-browser-module-dismiss]')?.addEventListener('click', () => {
        if (!pinned && uiMode === 'undocked') BrowserModule.hide();
    });

    el('browser-external-popout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAppToast('Browser OS popout uses the remote Pop out control for now');
    });

    el('browser-dock-toggle')?.addEventListener('click', () => {
        if (getLayoutState().browserHostKind === 'undocked') BrowserModule.dock();
        else BrowserModule.undock();
    });

    el('browser-collapse-header-btn')?.addEventListener('click', () => {
        collapseBrowserChrome();
    });

    el('browser-dock-side-btn')?.addEventListener('click', () => RemoteModule.toggleDockSide());

    document.addEventListener('click', (e) => {
        const brand = e.target?.closest?.('#browser-shell > .module-shell__chrome > .remote-module__brand');
        if (!brand) return;
        if (dialogEl()?.classList.contains('is-dragging')) return;
        e.preventDefault();
        collapseBrowserChrome();
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
    init({ ensureBrowserCatalog: ensureFn, switchTab: switchTabFn } = {}) {
        if (typeof ensureFn === 'function') ensureBrowserCatalog = ensureFn;
        if (typeof switchTabFn === 'function') switchTab = switchTabFn;
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
        DockOpenGate.afterOpen(() => {
            ensureBrowserCatalog();
        });
    },

    dock() {
        if (!isSplit()) return;
        bindOnce();
        showFloatUI(false);
        const host = dockHostEl();
        if (!host) return;
        uiMode = 'docked';
        applyDockGeometry();
        setDockExpanded(true, { animateOpen: true });
        dockTabEl()?.classList.remove('is-hidden');
        mountShellToHost(host);
        bringModuleToFront(SHELL_BROWSER);
        document.body.classList.add('browser-shell-split', 'browser-docked', 'browser-docked-expanded');
        document.body.classList.remove('browser-dock-tab-visible', 'browser-hidden-tab');
        syncActionButtons();
        patchLayout({ browserHostKind: 'docked' }, { reconcile: false });
        DockOpenGate.afterOpen(() => {
            ensureBrowserCatalog();
        });
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

    /**
     * Nudge undocked browser float to the edge opposite remote's dock side.
     * @param {'left'|'right'} remoteDockSide
     */
    syncDockSideGeometry(remoteDockSide) {
        if (!isSplit() || uiMode !== 'undocked') return;
        const browserSide = remoteDockSide === 'right' ? 'left' : 'right';
        const geom = readDialogGeometry();
        const next = {
            ...geom,
            left: edgeInsetLeft(browserSide, geom.width)
        };
        applyGeometry(next);
        patchLayout({ browser: { ...next, pinned } }, { reconcile: false });
    },

    show() {
        if (!isSplit()) return;
        this.dock();
    },

    /** Tear down float/dock UI and leave shell placement to reconcile (join path). */
    close() {
        tearDownHosts();
    },

    syncCatalogChrome() {
        if (!isSplit()) {
            dockSheetEl()?.classList.remove('is-catalog-bar');
            return;
        }
        if (uiMode === 'docked') {
            applyDockGeometry();
        }
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
    syncDockToggleBtn,
    syncCollapseHeaderBtn,

    persistGeometry() {
        if (uiMode !== 'undocked') return;
        patchLayout({ browser: { ...readDialogGeometry(), pinned } }, { reconcile: false });
    }
};
