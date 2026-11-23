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
import { createFloatGestures } from './floatShell.js';
import {
    BROWSER_BASE_W,
    BROWSER_BASE_H,
    BROWSER_MIN_W,
    BROWSER_MIN_H,
    REMOTE_BASE_W,
    clampFloatPosition,
    fitBoxToHost,
    freeCornerResize,
    browserTileScaleFromGeom,
    readViewportSize,
    VIEW_PAD,
    EDGE_INSET,
    DRAG_GRIP,
    DEFAULT_SHEET_HEIGHT,
    SHEET_BAR_RATIO,
    SHEET_HEIGHT_MIN,
    SHEET_HEIGHT_MAX
} from './moduleScaleResize.js';

const BAR_SHEET_HEIGHT = DEFAULT_SHEET_HEIGHT * SHEET_BAR_RATIO;

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
/**
 * User-chosen float size — *intent*, not what is currently painted. The painted
 * box is `fitBoxToHost(intent)`, so a temporary shrink (small window, zoom) can
 * never rewrite the size the user actually picked.
 * @type {{ width: number, height: number } | null}
 */
let sizeIntent = null;
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
    return readViewportSize();
}

/**
 * Fit the *size* into the host, then clamp the *position* — never the other way
 * around. The old combined clamp rewrote width/height as the window reached an
 * edge, so dragging resized the window (the "bounce") and a window that had been
 * clamped once could never come back.
 */
function clampGeometry({ left, top, width, height }) {
    const { w: vw, h: vh } = viewportSize();
    const box = fitBoxToHost(
        { width, height },
        { vw, vh, pad: VIEW_PAD, minW: BROWSER_MIN_W, minH: BROWSER_MIN_H }
    );
    const pos = clampFloatPosition({ left, top, ...box }, { grip: DRAG_GRIP, pad: VIEW_PAD, vw, vh });
    return { ...pos, ...box };
}

/** The size the user picked (falls back to the painted box, then the base). */
function currentSize() {
    if (sizeIntent) return { ...sizeIntent };
    const dialog = dialogEl();
    const width = parseFloat(dialog?.style.width);
    const height = parseFloat(dialog?.style.height);
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
    return { width: BROWSER_BASE_W, height: BROWSER_BASE_H };
}

function rememberSize({ width, height }) {
    const w = Number(width);
    const h = Number(height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        sizeIntent = { width: Math.round(w), height: Math.round(h) };
    }
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) return getLayoutState().browser;
    const left = parseFloat(dialog.style.left);
    const top = parseFloat(dialog.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        const rect = dialog.getBoundingClientRect();
        return clampGeometry({ left: rect.left, top: rect.top, ...currentSize() });
    }
    return clampGeometry({ left, top, ...currentSize() });
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

/**
 * Paint the float window.
 *
 * `remember: true` (restore / reset / end of a resize) records the requested
 * size as intent. A drag must pass `remember: false`: it only moves the window
 * and would otherwise persist whatever the host happened to fit.
 *
 * @param {{ left: number, top: number, width?: number, height?: number }} geom
 * @param {{ pinned?: boolean, remember?: boolean }} [opts]
 */
function applyGeometry(geom, { pinned: pinFlag, remember = true } = {}) {
    const dialog = dialogEl();
    if (!dialog || !geom) return;
    if (remember) rememberSize({ width: geom.width ?? currentSize().width, height: geom.height ?? currentSize().height });
    const size = currentSize();
    const next = clampGeometry({ left: geom.left, top: geom.top, ...size });
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
        // Keep intent width/height; the painted box may be host-fitted.
        const painted = readDialogGeometry();
        patchLayout(
            { browser: { left: painted.left, top: painted.top, ...currentSize(), pinned } },
            { reconcile: false }
        );
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
        remoteW = Number.isFinite(parsed) ? parsed : REMOTE_BASE_W;
    }

    let remoteH = 0;
    if (remoteSheet?.classList.contains('is-expanded') && remoteSheet.offsetHeight > 40) {
        remoteH = remoteSheet.offsetHeight;
    } else {
        const saved = loadPlayerState()?.remoteModule;
        const ratio = Number(saved?.sheetHeight);
        const r = Number.isFinite(ratio) ? ratio : DEFAULT_SHEET_HEIGHT;
        remoteH = Math.round(vh * Math.min(SHEET_HEIGHT_MAX, Math.max(SHEET_HEIGHT_MIN, r)));
    }

    // "2× the remote" is a fixed rule against the *static* remote width — never
    // the live remote scale, or resizing the remote would silently resize the
    // browser (and change what the catalog shows).
    return {
        width: Math.round(Math.min(vw * 0.9, Math.max(BROWSER_BASE_W, remoteW * 2))),
        height: Math.round(Math.min(vh * 0.9, Math.max(BROWSER_MIN_H, remoteH)))
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
        Math.max(BROWSER_BASE_W, override?.width ?? base.width)
    ));
    const height = Math.round(Math.min(
        vh * 0.85,
        Math.max(BROWSER_MIN_H, override?.height ?? base.height)
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
    // Only the docked sheet resizes here; the floating window goes through the
    // shared gesture controller.
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    const next = freeCornerResize({
        originLeft: gesture.originLeft,
        originTop: gesture.originTop,
        originW: gesture.originW,
        originH: gesture.originH,
        dx,
        dy,
        edge: gesture.edge || 'se',
        // Docked sheet stays at least 2× the remote width — the same 2:1 rule
        // the float default follows, so a docked/docked-then-undocked window
        // does not change character.
        minW: BROWSER_BASE_W,
        minH: BROWSER_MIN_H
    });
    dockSizeOverride = { width: next.width, height: next.height };
    gesture.dockSize = dockSizeOverride;
    applyDockGeometry(dockSizeOverride);
}

function onPointerUp(e) {
    if (!gesture || (e && e.pointerId !== gesture.pointerId)) return;
    try {
        e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
        /* ignore */
    }
    const settled = gesture.dockSize;
    cancelDockResize();
    if (settled) {
        dockSizeOverride = settled;
        applyDockGeometry(dockSizeOverride);
    }
    syncScaleResetBtn();
}

/**
 * Drop the dock-sheet resize without persisting — for teardown paths (dock /
 * hide) that can land mid-gesture and would otherwise leave the sheet stuck with
 * `is-resizing` and the window listeners attached.
 */
function cancelDockResize() {
    if (!gesture) return;
    gesture = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    dockSheetEl()?.classList.remove('is-resizing');
}

/**
 * Drag + corner-resize for the floating browser window.
 *
 * Free W×H surface: resize writes the intent size only, so a window the host
 * fitted smaller keeps its real size and grows back with the viewport.
 */
const floatGestures = createFloatGestures({
    getModule: () => moduleEl(),
    getDialog: () => dialogEl(),
    dragHandleSelector: '[data-browser-module-drag]',
    getPaintedBox: () => readDialogGeometry(),
    resolveModel() {
        if (uiMode !== 'undocked' || !dialogEl()) return null;
        return {
            kind: 'free',
            minW: BROWSER_MIN_W,
            minH: BROWSER_MIN_H,
            getIntent: () => currentSize(),
            setIntent: (size) => rememberSize(size)
        };
    },
    apply: (box) => applyGeometry(box, { remember: false }),
    commit() {
        // Persist intent (position + the size the user picked), not the fitted box.
        if (uiMode !== 'undocked') {
            syncScaleResetBtn();
            return;
        }
        const painted = readDialogGeometry();
        patchLayout(
            { browser: { left: painted.left, top: painted.top, ...currentSize(), pinned } },
            { reconcile: false }
        );
        syncScaleResetBtn();
    }
});

function beginGesture(e, mode, edge = '') {
    if (e.button != null && e.button !== 0) return;

    if (mode !== 'dock-resize') {
        floatGestures.begin(e, mode, edge);
        return;
    }

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
        originW: rect?.width ?? BROWSER_BASE_W,
        originH: rect?.height ?? BROWSER_BASE_H,
        dockSize: null
    };
    sheet?.classList.add('is-resizing');

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
    const w = Math.max(BROWSER_BASE_W, Number(width) || BROWSER_BASE_W);
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

function browserSizeIsDirty() {
    if (dockSizeOverride) return true;
    if (uiMode !== 'undocked') return false;
    // Compare intent, not the painted box: a host-fitted box is not a user choice.
    const size = currentSize();
    return Math.abs(size.width - BROWSER_BASE_W) > 2 || Math.abs(size.height - BROWSER_BASE_H) > 2;
}

function syncScaleResetBtn() {
    const btn = el('browser-scale-reset-btn');
    if (!btn) return;
    const dirty = browserSizeIsDirty();
    btn.innerHTML = ACTION_ICONS.scaleReset;
    btn.title = 'Reset size';
    btn.setAttribute('aria-label', 'Reset size');
    btn.hidden = !dirty;
    btn.classList.toggle('is-hidden', !dirty);
}

function resetSize() {
    dockSizeOverride = null;
    if (uiMode === 'undocked') {
        const geom = readDialogGeometry();
        const next = {
            left: geom.left,
            top: geom.top,
            width: BROWSER_BASE_W,
            height: BROWSER_BASE_H,
            pinned
        };
        applyGeometry(next, { pinned, remember: true });
        patchLayout({ browser: next }, { reconcile: false });
    } else if (uiMode === 'docked') {
        applyDockGeometry();
    }
    syncScaleResetBtn();
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
    syncScaleResetBtn();
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

    el('browser-scale-reset-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetSize();
    });

    document.addEventListener('click', (e) => {
        const brand = e.target?.closest?.('#browser-shell > .module-shell__chrome > .remote-module__brand');
        if (!brand) return;
        if (dialogEl()?.classList.contains('is-dragging')) return;
        e.preventDefault();
        collapseBrowserChrome();
    });

    window.addEventListener('resize', () => {
        if (!isSplit()) return;
        if (uiMode === 'undocked') {
            // Re-fit from intent. Reading the painted (host-clamped) box back and
            // re-clamping it is what made every resize/zoom ratchet the window
            // smaller with no way back.
            const painted = readDialogGeometry();
            applyGeometry({ left: painted.left, top: painted.top }, { remember: false });
        }
        if (uiMode === 'docked') applyDockGeometry();
    });
}

function tearDownHosts() {
    const shell = browserShellEl();
    restoreActions();
    restoreShellToHome(shell);
    showFloatUI(false);
    setDockExpanded(false);
    dockSheetEl()?.classList.remove('is-resizing');
    dockSheetEl()?.style.removeProperty('width');
    dockTabEl()?.classList.add('is-hidden');
    dockTabEl()?.classList.remove('is-visible', 'is-resizing');
    sizeIntent = null;
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
        floatGestures.cancel();
        cancelDockResize();
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
        floatGestures.cancel();
        cancelDockResize();
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
        const size = currentSize();
        const next = {
            left: edgeInsetLeft(browserSide, size.width),
            top: geom.top,
            ...size
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
    syncScaleResetBtn,
    resetSize,

    persistGeometry() {
        if (uiMode !== 'undocked') return;
        const painted = readDialogGeometry();
        patchLayout(
            { browser: { left: painted.left, top: painted.top, ...currentSize(), pinned } },
            { reconcile: false }
        );
    }
};
