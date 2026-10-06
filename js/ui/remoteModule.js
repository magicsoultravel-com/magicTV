/** @module Remote module — teleports catalog body into docked sheet or floating dialog. */
import { el } from '../tvUtils.js';
import { ChannelGrid } from './channelGrid.js';
import { MultiView } from '../multiView.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SettingsStore, isCatalogBarTab } from '../storage/settingsStore.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { RemotePanel, syncRemoteNav } from './remotePanel.js';
import { GuidePanel } from './guidePanel.js';
import { WingPanel } from './wingPanel.js';
import { RemoteExternalPopout } from './remoteExternalPopout.js';
import {
    assembleEndCluster,
    endClusterEl,
    remoteEndActionsEl,
    startActionsEl
} from './moduleActions.js';
import { BrowserModule } from './browserModule.js';
import { ModuleIdleFade } from './moduleIdleFade.js';
import { DockOpenGate } from './dockOpenGate.js';
import {
    hydrateLayoutFromPlayerState,
    getLayoutState,
    patchLayout,
    setReconcileHandler,
    syncCatalogRootClasses,
    splitBrowser,
    joinBrowser,
    toggleSplitBrowser,
    isSplit,
    remoteShellEl,
    browserShellEl,
    bringModuleToFront,
    SHELL_REMOTE
} from './moduleLayout.js';
import {
    REMOTE_BASE_W,
    REMOTE_BASE_H,
    SCALE_MIN,
    SCALE_MAX,
    clampModuleScale,
    clampFloatGeometry,
    uniformScaleFromCorner,
    scaleFromWidth
} from './moduleScaleResize.js';

const MIN_W = REMOTE_BASE_W;
const MIN_H = REMOTE_BASE_H;
const VIEW_PAD = 24;
const EDGE_INSET = 24;
const DEFAULT_SHEET_HEIGHT = 0.62;
/** Short bottom catalog bar ≈ 3/8 of default docked remote height. */
const BAR_SHEET_HEIGHT = DEFAULT_SHEET_HEIGHT * (3 / 8);
const SHEET_TRANSITION_MS = 280;

function wingMultiplier() {
    return WingPanel.isOpen?.() ? 2 : 1;
}

function minDialogWidth() {
    return Math.round(MIN_W * scale * wingMultiplier());
}

function baseWidthForScale(s = scale) {
    return Math.round(MIN_W * clampModuleScale(s) * wingMultiplier());
}

function baseHeightForScale(s = scale) {
    return Math.round(MIN_H * clampModuleScale(s));
}

let deps = {
    getDefaultOnPlay: () => () => {},
    switchTab: () => {},
    switchTabNav: null,
    ensureBrowserCatalog: () => {},
    openTvCatalog: null
};

/** @type {'hidden'|'docked'|'undocked'} */
let mode = 'hidden';
let targetSlotId = null;
let dockParent = null;
let nextSibling = null;
let endClusterDockParent = null;
let endClusterNextSibling = null;
let guideDockParent = null;
let guideNextSibling = null;
let bound = false;
let pinned = false;
let sheetExpanded = false;
let sheetCollapseAnimating = false;
/** @type {'left'|'right'} */
let dockSide = 'left';
/** @type {HTMLElement|null} External OS-window host; when set, mount prefers it over in-page hosts. */
let externalHost = null;

let idleActivityBound = false;
/** Uniform content/window scale (0.5–1.5). */
let scale = 1;

/** @type {{ mode: 'drag'|'resize'|'dock-resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number, originScale?: number } | null} */
let gesture = null;

function moduleEl() {
    return el('remote-module');
}

function dialogEl() {
    return el('remote-module-dialog');
}

function undockedHostEl() {
    return el('remote-module-host');
}

function dockHostEl() {
    return el('remote-dock-host');
}

function stagingEl() {
    return el('remote-module-staging');
}

function catalogBody() {
    return el('tv-catalog-body');
}

function guidePanelEl() {
    return el('guide-panel');
}

let startActionsDockParent = null;
let startActionsNextSibling = null;

function dockSheetEl() {
    return el('remote-dock-sheet');
}

function dockTabEl() {
    return el('remote-dock-tab');
}

function viewportSize() {
    return {
        w: window.innerWidth || document.documentElement.clientWidth || 800,
        h: window.innerHeight || document.documentElement.clientHeight || 600
    };
}

function defaultGeometry() {
    const { h: vh } = viewportSize();
    const width = baseWidthForScale(1);
    const height = baseHeightForScale(1);
    const tabClearance = 44;
    return {
        left: edgeInsetLeft(dockSide, width),
        top: Math.round(vh - height - EDGE_INSET - tabClearance),
        width,
        height
    };
}

function applyRemoteScaleCss() {
    const s = String(clampModuleScale(scale));
    const dialog = dialogEl();
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    dialog?.style.setProperty('--remote-scale', s);
    sheet?.style.setProperty('--remote-scale', s);
    tab?.style.setProperty('--remote-scale', s);
    document.documentElement.style.setProperty('--remote-scale', s);
}

function normalizeDockSide(value) {
    return value === 'right' ? 'right' : 'left';
}

function edgeInsetLeft(side, width) {
    const { w: vw } = viewportSize();
    const w = Math.max(MIN_W, Number(width) || MIN_W);
    if (normalizeDockSide(side) === 'right') {
        return Math.round(Math.max(VIEW_PAD, vw - w - EDGE_INSET));
    }
    return EDGE_INSET;
}

function syncCollapseHeaderBtn() {
    const btn = el('remote-collapse-header-btn');
    if (!btn) return;
    btn.innerHTML = ACTION_ICONS.expand;
    btn.title = 'Collapse remote';
    btn.setAttribute('aria-label', 'Collapse remote');
}

function syncScaleResetBtn() {
    const btn = el('remote-scale-reset-btn');
    if (!btn) return;
    const dirty = Math.abs(clampModuleScale(scale) - 1) > 0.01;
    btn.innerHTML = ACTION_ICONS.scaleReset;
    btn.title = 'Reset size';
    btn.setAttribute('aria-label', 'Reset size');
    btn.hidden = !dirty;
    btn.classList.toggle('is-hidden', !dirty);
}

function resetScale() {
    scale = 1;
    if (mode === 'docked') {
        applyDockScaleGeometry();
    } else if (mode === 'undocked') {
        const geom = readDialogGeometry();
        applyGeometry({
            left: geom.left,
            top: geom.top,
            width: baseWidthForScale(1),
            height: baseHeightForScale(1)
        });
    } else {
        applyRemoteScaleCss();
    }
    syncScaleResetBtn();
    persistState({ scale: 1 });
}

function waitForSheetCollapseAnimation() {
    const sheet = dockSheetEl();
    if (!sheet || !sheetExpanded || mode !== 'docked') {
        return Promise.resolve();
    }

    sheet.classList.add('is-collapsing');
    setSheetExpanded(false, { persist: false });
    updateBodyClasses();
    void sheet.offsetHeight;

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            sheet.removeEventListener('transitionend', onTransitionEnd);
            clearTimeout(fallback);
            sheet.classList.remove('is-collapsing');
            resolve();
        };
        const onTransitionEnd = (e) => {
            if (e.target === sheet && e.propertyName === 'transform') finish();
        };
        sheet.addEventListener('transitionend', onTransitionEnd);
        const fallback = setTimeout(finish, SHEET_TRANSITION_MS);
    });
}

/** Close browser wing + clear bar inline widths so dock peeks at remote tile size. */
function prepareCollapseToRemoteTileWidth() {
    WingPanel.closeBrowserWing({ silent: true });
    clearBarSheetInline();
}

async function animateDockedCollapseThen(run) {
    if (sheetCollapseAnimating) return;
    prepareCollapseToRemoteTileWidth();
    if (mode !== 'docked' || !sheetExpanded) {
        run();
        return;
    }
    sheetCollapseAnimating = true;
    try {
        await waitForSheetCollapseAnimation();
        run();
    } finally {
        sheetCollapseAnimating = false;
    }
}

function syncDockToggleBtn() {
    const btn = el('remote-dock-toggle');
    if (!btn) return;
    const undocked = mode === 'undocked';
    btn.innerHTML = undocked ? ACTION_ICONS.dock : ACTION_ICONS.undock;
    btn.title = undocked ? 'Dock remote' : 'Undock remote';
    btn.setAttribute('aria-label', btn.title);
}

function syncDockSideBtn() {
    const remoteBtn = el('remote-dock-side-btn');
    const browserBtn = el('browser-dock-side-btn');
    const remoteToRight = dockSide !== 'right';
    if (remoteBtn) {
        const label = remoteToRight ? 'Move to right' : 'Move to left';
        remoteBtn.innerHTML = ACTION_ICONS.dockSide;
        remoteBtn.title = label;
        remoteBtn.setAttribute('aria-label', label);
    }
    if (browserBtn) {
        // Browser is always opposite of remote.
        const label = remoteToRight ? 'Move to left' : 'Move to right';
        browserBtn.innerHTML = ACTION_ICONS.dockSide;
        browserBtn.title = label;
        browserBtn.setAttribute('aria-label', label);
    }
}

function applyDockSide(side, { persist = true, moveGeometry = true } = {}) {
    dockSide = normalizeDockSide(side);
    document.body.classList.toggle('remote-dock-side-right', dockSide === 'right');
    document.body.classList.toggle('browser-dock-side-left', dockSide === 'right');
    syncDockSideBtn();
    if (moveGeometry && mode === 'undocked') {
        const geom = readDialogGeometry();
        applyGeometry({
            ...geom,
            left: edgeInsetLeft(dockSide, geom.width)
        });
    }
    if (moveGeometry) {
        BrowserModule.syncDockSideGeometry?.(dockSide);
    }
    if (persist) {
        const prev = getSavedState() || {};
        const width = Number.isFinite(prev.width) ? prev.width : MIN_W;
        persistState({
            dockSide,
            ...(mode !== 'undocked' ? { left: edgeInsetLeft(dockSide, width) } : {})
        });
    }
}

function toggleDockSide() {
    applyDockSide(dockSide === 'right' ? 'left' : 'right');
}

function clampGeometry({ left, top, width, height }) {
    const minW = minDialogWidth();
    const minH = baseHeightForScale();
    const { w: vw, h: vh } = viewportSize();
    return clampFloatGeometry(
        { left, top, width: width ?? minW, height: height ?? minH },
        { minW, minH, viewPad: VIEW_PAD, vw, vh }
    );
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) {
        return {
            ...defaultGeometry(),
            width: baseWidthForScale(),
            height: baseHeightForScale()
        };
    }
    // Prefer persisted scale box over live rect (avoids CSS inflation).
    const left = parseFloat(dialog.style.left);
    const top = parseFloat(dialog.style.top);
    return clampGeometry({
        left: Number.isFinite(left) ? left : dialog.getBoundingClientRect().left,
        top: Number.isFinite(top) ? top : dialog.getBoundingClientRect().top,
        width: baseWidthForScale(),
        height: baseHeightForScale()
    });
}

function applyGeometry(geom, { pinned: pinFlag } = {}) {
    const dialog = dialogEl();
    if (!dialog || !geom) return;
    applyRemoteScaleCss();
    const next = clampGeometry({
        left: geom.left,
        top: geom.top,
        width: baseWidthForScale(),
        height: baseHeightForScale()
    });
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
    if (typeof pinFlag === 'boolean') setPinned(pinFlag, { persist: false });
}

function getSavedState() {
    return loadPlayerState().remoteModule;
}

function persistState(overrides = {}) {
    const prev = getSavedState() || {};
    const wasUndocked = mode === 'undocked';
    const geom = wasUndocked
        ? readDialogGeometry()
        : {
            left: overrides.left != null ? overrides.left : (prev.left ?? defaultGeometry().left),
            top: overrides.top != null ? overrides.top : (prev.top ?? defaultGeometry().top),
            width: overrides.width != null ? overrides.width : (prev.width ?? defaultGeometry().width),
            height: overrides.height != null ? overrides.height : (prev.height ?? defaultGeometry().height)
        };

    const nextMode = overrides.mode != null ? overrides.mode : mode;
    const nextOpen = overrides.open != null ? overrides.open === true : (nextMode !== 'hidden');
    const nextPinned = overrides.pinned != null ? overrides.pinned === true : pinned;
    let nextTarget = overrides.targetSlotId != null ? overrides.targetSlotId : targetSlotId;
    if (!nextTarget) nextTarget = prev.targetSlotId || 'center';
    const nextDockSide = overrides.dockSide != null
        ? normalizeDockSide(overrides.dockSide)
        : dockSide;

    const sheet = dockSheetEl();
    const sheetHeight = overrides.sheetHeight != null
        ? overrides.sheetHeight
        : (sheet?.style.getPropertyValue('--remote-sheet-height') || prev.sheetHeight || DEFAULT_SHEET_HEIGHT);

    const layoutState = getLayoutState();
    const remoteHostKind = nextMode === 'hidden'
        ? 'hidden'
        : (externalHost ? 'os' : nextMode === 'undocked' ? 'undocked' : 'docked');

    savePlayerState({
        remoteModule: {
            ...geom,
            scale: clampModuleScale(overrides.scale != null ? overrides.scale : scale),
            mode: nextMode,
            open: nextOpen,
            pinned: nextPinned,
            targetSlotId: nextTarget,
            dockSide: nextDockSide,
            sheetHeight: parseFloat(sheetHeight) || DEFAULT_SHEET_HEIGHT,
            sheetExpanded: overrides.sheetExpanded != null ? overrides.sheetExpanded === true : sheetExpanded,
            guideOpen: overrides.guideOpen != null ? overrides.guideOpen === true : WingPanel.isGuidePreferred?.(),
            layout: {
                ...layoutState,
                remoteHostKind
            }
        }
    });
}

function setPinned(next, { persist = true } = {}) {
    pinned = next === true;
    const modal = moduleEl();
    const pinBtn = el('remote-module-pin');
    modal?.classList.toggle('is-pinned', pinned);
    if (pinBtn) {
        pinBtn.classList.toggle('is-active', pinned);
        pinBtn.setAttribute('aria-pressed', String(pinned));
        pinBtn.title = pinned ? 'Unpin window' : 'Pin window';
        pinBtn.setAttribute('aria-label', pinBtn.title);
    }
    const dialog = dialogEl();
    if (dialog) dialog.setAttribute('aria-modal', pinned ? 'false' : 'true');
    if (persist) persistState({ pinned });
}

function isSlotHighlightable(slotId) {
    if (!slotId) return false;
    if (slotId !== 'center' && !MultiView.slots?.[slotId]?.enabled) return false;
    const tile = el(`player-tile-${slotId}`);
    return Boolean(tile && !tile.classList.contains('is-hidden'));
}

/** Prefer stored target when still enabled; otherwise fall back to status slot or center. */
function resolveEffectiveTarget(preferred) {
    const seen = new Set();
    for (const id of [preferred, MultiView.statusSlotId, 'center']) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (isSlotHighlightable(id)) return id;
    }
    return 'center';
}

/**
 * Reconcile remote target with MultiView focus.
 * Live statusSlotId wins when highlightable so syncLayout cannot snap focus
 * back to a stale targetSlotId while the user is switching screens.
 */
function syncTargetHighlight() {
    if (mode !== 'hidden') {
        const status = MultiView.statusSlotId;
        const effective = (status && isSlotHighlightable(status))
            ? status
            : resolveEffectiveTarget(targetSlotId || status || 'center');
        if (effective !== targetSlotId) {
            targetSlotId = effective;
            persistState({ targetSlotId: effective, open: true, mode });
        }
        if (MultiView.statusSlotId !== effective) {
            MultiView.setStatusSlot(effective);
        } else {
            MultiView.syncTileStatusHighlight?.();
        }
        syncBrowseButtons();
        return;
    }
    MultiView.syncTileStatusHighlight?.();
}

/** Reconcile remote target when a mosaic slot was disabled (e.g. via Settings). */
function reconcileTargetIfDisabled() {
    if (mode === 'hidden') return;
    syncTargetHighlight();
}

function setBrowseButtonState(btn, active) {
    if (!btn) return;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.innerHTML = active ? ACTION_ICONS.browseFilled : ACTION_ICONS.browse;
    const label = active ? 'Hide remote' : 'Pick channel';
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function syncBrowseButtons() {
    const open = mode !== 'hidden';
    const target = targetSlotId;
    document.querySelectorAll('[data-tile-action="browse"]').forEach((btn) => {
        const slotId = btn.closest?.('.tv-player-tile')?.getAttribute('data-slot');
        setBrowseButtonState(btn, open && Boolean(slotId) && target === slotId);
    });
}

function applyOpacity() {
    const pct = SettingsStore.getRemoteModuleOpacity();
    document.documentElement.style.setProperty('--remote-module-opacity', String(pct / 100));
}

function bindIdleActivity() {
    if (idleActivityBound) return;
    idleActivityBound = true;
    ModuleIdleFade.init();
}

function playIntoTarget(channel) {
    const slotId = MultiView.statusSlotId || targetSlotId || 'center';
    TileFrames.setPlaybackBusy(true);
    MultiView.playOnSlot(slotId, channel)
        .catch((e) => {
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (!blocked) showAppToast('Stream unavailable');
        })
        .finally(() => {
            const player = slotId === 'center'
                ? MultiView.getPrimary?.()
                : MultiView.ensurePlayer?.(slotId);
            if (!player?.playing) TileFrames.setPlaybackBusy(false);
        });
}

function getInPageHost() {
    if (mode === 'undocked') return undockedHostEl();
    if (mode === 'docked') return dockHostEl();
    return stagingEl();
}

function getActiveHost() {
    if (externalHost) return externalHost;
    return getInPageHost();
}

function restoreNode(node, parent, next) {
    if (!node || !parent) return;
    if (next && next.parentElement === parent) parent.insertBefore(node, next);
    else if (node.parentElement !== parent) parent.appendChild(node);
}

function restoreBodyToStaging() {
    const body = catalogBody();
    const guide = guidePanelEl();
    const staging = stagingEl();
    const startActions = startActionsEl();
    const cluster = endClusterEl();
    if (!body || !staging) return;

    restoreNode(startActions, startActionsDockParent, startActionsNextSibling);

    if (cluster) {
        assembleEndCluster();
        restoreNode(cluster, endClusterDockParent || staging, endClusterNextSibling);
    }

    if (dockParent) restoreNode(body, dockParent, nextSibling);
    else staging.appendChild(body);

    if (guide) {
        if (guideDockParent) restoreNode(guide, guideDockParent, guideNextSibling);
        else staging.appendChild(guide);
    }

    dockParent = null;
    nextSibling = null;
    guideDockParent = null;
    guideNextSibling = null;
    startActionsDockParent = null;
    startActionsNextSibling = null;
    endClusterDockParent = null;
    endClusterNextSibling = null;
}

function ensureShellsJoinedInRoot() {
    const root = catalogBody();
    const remote = remoteShellEl();
    const browser = browserShellEl();
    if (!root) return;
    if (remote && remote.parentElement !== root) root.appendChild(remote);
    if (browser && browser.parentElement !== root) root.appendChild(browser);
    syncCatalogRootClasses(root);
}

function syncLayoutToggleBtn(btn, { visible, split }) {
    if (!btn) return;
    btn.classList.toggle('is-hidden', !visible);
    if (!btn.classList.contains('tv-module__action') && typeof btn.closest === 'function') {
        btn.closest('.remote-panel__cell')?.classList.toggle('is-hidden', !visible);
    }
    btn.innerHTML = CARD_ICONS.splitLayout;
    if (split) {
        btn.title = 'Join browser with remote';
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
    } else {
        btn.title = 'Split browser';
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
    }
    btn.setAttribute('aria-label', btn.title);
}

function syncSplitChromeButtons() {
    const remoteOpen = mode !== 'hidden';
    const split = isSplit();
    // Always show on remote when open, and on browser whenever split — both sides, both states.
    syncLayoutToggleBtn(el('remote-split-browser-btn'), { visible: remoteOpen, split });
    syncLayoutToggleBtn(el('browser-split-browser-btn'), { visible: split, split });
    const remoteScreenFooter = el('remote-shell-screens-footer');
    if (remoteScreenFooter) {
        remoteScreenFooter.classList.toggle('is-hidden', !split);
        remoteScreenFooter.setAttribute('aria-hidden', String(!split));
    }
    BrowserModule.syncActionButtons?.();
    if (split) MultiView.syncScreenControls?.();
    let activeNav = null;
    try {
        activeNav = typeof document?.querySelector === 'function'
            ? document.querySelector('[data-remote-nav].is-active')?.getAttribute('data-remote-nav')
            : null;
    } catch {
        activeNav = null;
    }
    syncRemoteNav(activeNav || (split ? 'browse' : 'remote'));
}

function handleLayoutToggleClick(e) {
    e.preventDefault();
    if (mode === 'hidden') return;
    const wasSplit = isSplit();
    // Mirror Remote's host: docked remote → docked browser, undocked → undocked.
    const hostKind = mode === 'docked' ? 'docked' : 'undocked';
    toggleSplitBrowser({ hostKind });
    if (!wasSplit) deps.switchTab?.('browse');
    window.dispatchEvent(new CustomEvent('remote:layout_changed', {
        detail: { mode: wasSplit ? 'joined' : 'split' }
    }));
}

function bindLayoutToggleButtons() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-layout-toggle="split"]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', handleLayoutToggleClick);
    });
}

/**
 * Single remount path from layoutState + remote window mode.
 * Joined: both shells in #tv-catalog-body, teleported as one unit.
 * Split: remote catalog root (remote shell only) + BrowserModule host for browser shell.
 */
function reconcileShells() {
    const root = catalogBody();
    const remote = remoteShellEl();
    const browser = browserShellEl();
    if (!root || !remote) return;

    const layout = getLayoutState();
    syncCatalogRootClasses(root);

    if (layout.mode === 'joined' || !browser) {
        // Tear down browser float even when layout already flipped to joined
        // (isOpen() would be false after patchLayout).
        if (browser && (BrowserModule.isOpen?.() || browser.parentElement !== root)) {
            BrowserModule.close();
        }
        ensureShellsJoinedInRoot();
        const host = getActiveHost() || stagingEl();
        if (host && (mode !== 'hidden' || externalHost || host === stagingEl())) {
            teleportBodyTo(host);
        }
        document.body.classList.remove('browser-shell-split');
        syncSplitChromeButtons();
        ModuleIdleFade.syncForLayout();
        return;
    }

    // Split: browser leaves catalog root before remote teleport.
    if (browser.parentElement === root) {
        stagingEl()?.appendChild(browser);
    }
    syncCatalogRootClasses(root);

    const host = getActiveHost() || stagingEl();
    if (host && (mode !== 'hidden' || externalHost || host === stagingEl())) {
        teleportBodyTo(host);
    }

    const browserKind = layout.browserHostKind || 'undocked';
    if (browserKind === 'docked') {
        BrowserModule.dock();
    } else if (browserKind === 'hidden') {
        BrowserModule.hide();
    } else if (browserKind === 'os') {
        BrowserModule.openUndocked();
        patchLayout({ browserHostKind: 'undocked' }, { persist: true, reconcile: false });
    } else {
        BrowserModule.openUndocked();
    }
    document.body.classList.add('browser-shell-split');
    syncSplitChromeButtons();
    ModuleIdleFade.syncForLayout();
    DockOpenGate.afterOpen(() => {
        deps.ensureBrowserCatalog?.();
    });
}

function teleportBodyTo(host) {
    const body = catalogBody();
    const guide = guidePanelEl();
    if (!body || !host) return;

    const startActions = startActionsEl();
    const cluster = endClusterEl();
    const split = isSplit();

    // Already mounted in this host — skip reparent (avoids layout invalidation on pull-out).
    const bodyHere = body.parentElement === host;
    const guideHere = !guide || guide.parentElement === host;
    const clusterHere = !cluster || cluster.parentElement === host;
    const startHere = split || !startActions || startActions.parentElement === host;
    if (bodyHere && guideHere && clusterHere && startHere) {
        syncCatalogRootClasses(body);
        return;
    }

    if (!dockParent) {
        dockParent = body.parentElement;
        nextSibling = body.nextSibling;
    }
    if (guide && !guideDockParent) {
        guideDockParent = guide.parentElement;
        guideNextSibling = guide.nextSibling;
    }
    if (cluster && !endClusterDockParent) {
        endClusterDockParent = cluster.parentElement;
        endClusterNextSibling = cluster.nextSibling;
    }
    if (!split && startActions && !startActionsDockParent) {
        startActionsDockParent = startActions.parentElement;
        startActionsNextSibling = startActions.nextSibling;
    }

    if (!split && startActions) host.appendChild(startActions);

    if (!split) {
        const assembled = assembleEndCluster();
        if (assembled) host.appendChild(assembled);
    } else if (cluster) {
        // Split: remote-end stays in the cluster; browser-end leaves via BrowserModule.
        const remoteEnd = remoteEndActionsEl();
        if (remoteEnd) cluster.appendChild(remoteEnd);
        host.appendChild(cluster);
    }

    host.appendChild(body);
    if (guide) host.appendChild(guide);
    syncCatalogRootClasses(body);
}

function mountToActiveHost() {
    reconcileShells();
    updateBodyClasses();
}

function applyDockScaleGeometry() {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    if (!sheet) return;
    applyRemoteScaleCss();
    const { h: vh } = viewportSize();
    const width = baseWidthForScale();
    const height = Math.min(Math.round(vh * 0.85), baseHeightForScale());
    const ratio = height / Math.max(1, vh);
    sheet.style.setProperty('--remote-sheet-height', String(ratio));
    sheet.style.width = `${width}px`;
    sheet.style.height = `${height}px`;
    if (tab) {
        tab.style.width = `${width}px`;
    }
    BrowserModule.syncCatalogChrome?.();
}

function clearBarSheetInline() {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    const dialog = dialogEl();
    if (sheet) {
        sheet.style.removeProperty('width');
        sheet.style.removeProperty('left');
        sheet.style.removeProperty('right');
        sheet.style.removeProperty('max-width');
    }
    if (tab) {
        tab.style.removeProperty('width');
        tab.style.removeProperty('left');
        tab.style.removeProperty('right');
        tab.style.removeProperty('max-width');
    }
    if (dialog) {
        dialog.classList.remove('is-catalog-bar');
        dialog.style.removeProperty('width');
        dialog.style.removeProperty('min-width');
        dialog.style.removeProperty('max-width');
        dialog.style.removeProperty('height');
        dialog.style.removeProperty('left');
        dialog.style.removeProperty('right');
        dialog.style.removeProperty('bottom');
        dialog.style.removeProperty('top');
    }
}

function applyBarSheetGeometry() {
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    const { w: vw, h: vh } = viewportSize();
    const px = Math.max(48, Math.round(vh * BAR_SHEET_HEIGHT));
    if (sheet) {
        sheet.style.setProperty('--remote-sheet-height', String(BAR_SHEET_HEIGHT));
        sheet.style.height = `${px}px`;
        sheet.style.width = `${vw}px`;
        sheet.style.maxWidth = '100vw';
        sheet.style.left = '0';
        sheet.style.right = '0';
    }
    if (tab) {
        tab.style.width = `${vw}px`;
        tab.style.maxWidth = '100vw';
        tab.style.left = '0';
        tab.style.right = '0';
    }
    if (mode === 'undocked') {
        const dialog = dialogEl();
        if (dialog) {
            dialog.classList.add('is-catalog-bar');
            dialog.style.width = `${vw}px`;
            dialog.style.minWidth = `${vw}px`;
            dialog.style.maxWidth = '100vw';
            dialog.style.height = `${px}px`;
            dialog.style.left = '0';
            dialog.style.right = '0';
            dialog.style.bottom = '0';
            dialog.style.top = 'auto';
        }
    }
}

function resolveActiveCatalogTab() {
    for (const t of ['browse', 'favorites', 'recents', 'settings', 'remote']) {
        if (document.getElementById(`${t}-panel`)?.classList.contains('is-active')) return t;
    }
    return 'remote';
}

function syncCatalogChromeGeometry(tab = resolveActiveCatalogTab()) {
    const bar = SettingsStore.getCatalogChrome() === 'bar' && isCatalogBarTab(tab) && !isSplit();
    document.body.classList.toggle('catalog-bar-active', bar);
    WingPanel.syncForTab?.(tab);

    if (mode === 'docked' && sheetExpanded) {
        if (bar) {
            applyBarSheetGeometry();
        } else {
            clearBarSheetInline();
            const saved = getSavedState();
            if (saved?.scale != null) scale = clampModuleScale(saved.scale);
            applyDockScaleGeometry();
        }
    } else if (mode === 'undocked') {
        if (bar) {
            applyBarSheetGeometry();
        } else {
            clearBarSheetInline();
            const saved = getSavedState();
            if (saved) {
                if (saved.scale != null) scale = clampModuleScale(saved.scale);
                applyGeometry(saved, { pinned });
            }
        }
    } else {
        clearBarSheetInline();
    }

    BrowserModule.syncCatalogChrome?.(tab);
}

function setSheetExpanded(expanded, { persist = true, animateOpen = false } = {}) {
    const wasExpanded = sheetExpanded;
    sheetExpanded = expanded === true;
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    if (sheetExpanded && !wasExpanded && animateOpen && mode === 'docked') {
        DockOpenGate.begin(sheet);
    }
    sheet?.classList.toggle('is-expanded', sheetExpanded);
    sheet?.classList.toggle('is-collapsed', !sheetExpanded);
    sheet?.setAttribute('aria-hidden', String(!sheetExpanded));
    tab?.classList.toggle('is-active', sheetExpanded && mode === 'docked');
    tab?.setAttribute('aria-expanded', String(sheetExpanded));
    if (sheetExpanded && mode === 'docked') {
        syncCatalogChromeGeometry();
    }
    if (!sheetExpanded) {
        sheet?.classList.remove('is-opening');
    }
    if (persist) persistState({ sheetExpanded });
}

function showUndockedUI(show) {
    const modal = moduleEl();
    if (!modal) return;
    modal.hidden = !show;
    modal.classList.toggle('is-hidden', !show);
    modal.setAttribute('aria-hidden', String(!show));
}

function updateBodyClasses() {
    document.body.classList.toggle('has-remote-module', mode !== 'hidden');
    document.body.classList.toggle('has-channel-picker', mode === 'undocked');
    document.body.classList.toggle('remote-docked', mode === 'docked');
    document.body.classList.toggle('remote-docked-expanded', mode === 'docked' && sheetExpanded);
    document.body.classList.toggle('remote-hidden-tab', mode === 'hidden');
    document.body.classList.toggle('remote-undocked-open', mode === 'undocked');
    document.body.classList.toggle('remote-dock-side-right', dockSide === 'right');
    document.body.classList.toggle('browser-dock-side-left', dockSide === 'right');
}

function onKeydown(e) {
    if (e.key === 'Escape' && mode !== 'hidden') {
        if (RemoteExternalPopout.isPoppedOut()) return;
        e.preventDefault();
        if (mode === 'undocked' && !pinned) RemoteModule.close();
        else if (mode === 'docked' && sheetExpanded) RemoteModule.toggleDockedSheet();
        else RemoteModule.close();
    }
}

function endGesture() {
    if (!gesture) return;
    moduleEl()?.querySelector('[data-remote-module-drag]')?.classList.remove('is-dragging');
    dialogEl()?.classList.remove('is-dragging');
    moduleEl()?.classList.remove('is-resizing');
    dockSheetEl()?.classList.remove('is-resizing');
    gesture = null;
    syncScaleResetBtn();
    persistState({ scale });
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
    const next = uniformScaleFromCorner({
        originLeft: gesture.originLeft,
        originTop: gesture.originTop,
        originW: gesture.originW,
        originH: gesture.originH,
        originScale: gesture.originScale ?? scale,
        baseW: MIN_W * wingMultiplier(),
        baseH: MIN_H,
        dx,
        dy,
        edge,
        minScale: SCALE_MIN,
        maxScale: SCALE_MAX
    });
    scale = next.scale;
    if (gesture.mode === 'dock-resize') {
        applyDockScaleGeometry();
        return;
    }
    applyGeometry({
        left: next.left,
        top: next.top,
        width: next.width,
        height: next.height
    });
}

function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    endGesture();
}

function beginGesture(e, modeName, edge = '') {
    if (e.button != null && e.button !== 0) return;

    if (modeName === 'dock-resize') {
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
            originW: rect?.width ?? baseWidthForScale(),
            originH: rect?.height ?? baseHeightForScale(),
            originScale: scale
        };
        sheet?.classList.add('is-resizing');
    } else {
        const dialog = dialogEl();
        if (!dialog) return;
        const geom = readDialogGeometry();
        gesture = {
            mode: modeName,
            edge,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originLeft: geom.left,
            originTop: geom.top,
            originW: geom.width,
            originH: geom.height,
            originScale: scale
        };
        if (modeName === 'drag') {
            e.currentTarget?.classList?.add('is-dragging');
            dialogEl()?.classList.add('is-dragging');
        }
        if (modeName === 'resize') {
            moduleEl()?.classList.add('is-resizing');
        }
    }

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    e.preventDefault();
}

function bindOnce() {
    if (bound) return;
    bound = true;

    const modal = moduleEl();
    modal?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_REMOTE), true);
    dockSheetEl()?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_REMOTE), true);
    dockTabEl()?.addEventListener('pointerdown', () => bringModuleToFront(SHELL_REMOTE), true);

    el('remote-collapse-header-btn')?.addEventListener('click', () => RemoteModule.hide());
    el('remote-dock-toggle')?.addEventListener('click', () => {
        if (mode === 'undocked') RemoteModule.dock();
        else RemoteModule.undock();
    });
    el('remote-dock-side-btn')?.addEventListener('click', () => toggleDockSide());
    el('remote-scale-reset-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetScale();
    });
    bindLayoutToggleButtons();
    modal?.querySelector('[data-remote-module-drag]')?.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('button')) return;
        beginGesture(e, 'drag');
    });

    dialogEl()?.addEventListener('pointerdown', (e) => {
        if (mode !== 'undocked') return;
        if (e.target.closest?.('button, input, select, textarea, a, .channel-tile, .country-tile, .tv-controls__screen-btn, .tv-controls__add-screen-btn, [data-remote-resize]')) return;
        beginGesture(e, 'drag');
    });

    modal?.querySelectorAll('[data-remote-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'resize', handle.getAttribute('data-remote-resize') || '');
        });
    });

    dockSheetEl()?.querySelectorAll('[data-remote-dock-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'dock-resize', handle.getAttribute('data-remote-dock-resize') || 'se');
        });
    });

    dockTabEl()?.addEventListener('click', () => {
        const welcomeOpen = typeof document !== 'undefined'
            && document.body?.classList?.contains('has-resume-session');
        if (welcomeOpen) {
            import('./resumeSessionModal.js')
                .then(({ ResumeSessionModal }) => {
                    ResumeSessionModal.close?.();
                    RemoteModule.open({
                        mode: 'docked',
                        slotId: targetSlotId || 'center',
                        tab: isSplit() ? null : 'remote',
                        focusClose: false
                    });
                })
                .catch(() => {
                    RemoteModule.open({
                        mode: 'docked',
                        slotId: targetSlotId || 'center',
                        tab: isSplit() ? null : 'remote',
                        focusClose: false
                    });
                });
            return;
        }
        if (mode === 'hidden') {
            RemoteModule.open({
                mode: 'docked',
                slotId: targetSlotId || 'center',
                tab: isSplit() ? null : 'remote',
                focusClose: false
            });
        } else if (mode === 'docked' && !sheetExpanded) {
            RemoteModule.toggleDockedSheet();
        }
    });

    // Brand click → hide Remote (to dock tab when split).
    document.addEventListener('click', (e) => {
        const brand = e.target?.closest?.('#remote-shell > .module-shell__chrome > .remote-module__brand');
        if (!brand) return;
        if (mode === 'hidden') return;
        if (dialogEl()?.classList.contains('is-dragging')) return;
        e.preventDefault();
        RemoteModule.hide();
    });

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', () => {
        if (mode === 'undocked' || (mode === 'docked' && sheetExpanded)) {
            syncCatalogChromeGeometry();
        }
    });
    window.addEventListener('pagehide', () => {
        if (mode !== 'hidden') persistState();
    });

    window.addEventListener('wing:mode_changed', () => {
        if (mode === 'undocked') {
            applyGeometry(readDialogGeometry());
        } else if (mode === 'docked' && sheetExpanded) {
            applyDockScaleGeometry();
        }
        persistState({ guideOpen: WingPanel.isGuidePreferred?.(), scale });
    });

    window.addEventListener('guide:visibility_changed', (e) => {
        const visible = e.detail?.visible === true;
        persistState({ guideOpen: visible });
    });

    bindIdleActivity();
}

function restoreFromState() {
    const saved = getSavedState();
    const geom = defaultGeometry();
    applyDockSide(saved?.dockSide, { persist: false, moveGeometry: false });
    if (saved) {
        if (Number.isFinite(saved.scale)) {
            scale = clampModuleScale(saved.scale);
        } else if (Number.isFinite(saved.width)) {
            scale = scaleFromWidth(saved.width / wingMultiplier(), MIN_W);
        } else {
            scale = 1;
        }
        applyGeometry({
            left: Number.isFinite(saved.left) ? saved.left : geom.left,
            top: Number.isFinite(saved.top) ? saved.top : geom.top,
            width: baseWidthForScale(),
            height: baseHeightForScale()
        }, { pinned: saved.pinned === true });
        applyDockScaleGeometry();
        syncScaleResetBtn();
        return;
    }
    scale = 1;
    applyGeometry(defaultGeometry(), { pinned: false });
    applyDockScaleGeometry();
    syncScaleResetBtn();
}

function finishClose() {
    if (RemoteExternalPopout.isPoppedOut()) {
        RemoteExternalPopout.popIn();
    }

    DockOpenGate.cancel();
    persistState({ open: false, mode: 'hidden' });

    externalHost = null;
    restoreBodyToStaging();
    ensureShellsJoinedInRoot();
    showUndockedUI(false);
    setSheetExpanded(false, { persist: false });

    mode = 'hidden';
    targetSlotId = null;
    endClusterDockParent = null;
    endClusterNextSibling = null;

    MultiView.syncTileStatusHighlight?.();
    updateBodyClasses();
    syncSplitChromeButtons();

    ChannelGrid.setOnPlay(deps.getDefaultOnPlay());
    syncBrowseButtons();
    RemoteExternalPopout.syncBtn();
}

function finishHideSplit() {
    if (RemoteExternalPopout.isPoppedOut()) {
        RemoteExternalPopout.popIn();
    }

    DockOpenGate.cancel();
    externalHost = null;
    showUndockedUI(false);
    setSheetExpanded(false, { persist: false });

    const body = catalogBody();
    const guide = guidePanelEl();
    const staging = stagingEl();
    const cluster = endClusterEl();
    if (body && staging) {
        if (cluster) {
            assembleEndCluster();
            staging.appendChild(cluster);
        }
        staging.appendChild(body);
        if (guide) staging.appendChild(guide);
    }
    dockParent = null;
    nextSibling = null;
    guideDockParent = null;
    guideNextSibling = null;
    endClusterDockParent = null;
    endClusterNextSibling = null;

    mode = 'hidden';
    persistState({ open: false, mode: 'hidden' });
    updateBodyClasses();
    syncSplitChromeButtons();
    syncBrowseButtons();
    RemoteExternalPopout.syncBtn();
    RemotePanel.syncRemotePanel();
    ChannelGrid.setOnPlay(playIntoTarget);
}

export const RemoteModule = {
    init({ getDefaultOnPlay, switchTab, switchTabNav, ensureBrowserCatalog, openTvCatalog } = {}) {
        if (typeof getDefaultOnPlay === 'function') deps.getDefaultOnPlay = getDefaultOnPlay;
        if (typeof switchTab === 'function') deps.switchTab = switchTab;
        if (typeof switchTabNav === 'function') deps.switchTabNav = switchTabNav;
        if (typeof ensureBrowserCatalog === 'function') deps.ensureBrowserCatalog = ensureBrowserCatalog;
        if (typeof openTvCatalog === 'function') deps.openTvCatalog = openTvCatalog;
        hydrateLayoutFromPlayerState();
        setReconcileHandler(() => {
            reconcileShells();
            updateBodyClasses();
            RemotePanel.syncRemotePanel?.();
            RemoteExternalPopout.syncBtn?.();
            syncSplitChromeButtons();
        });
        RemotePanel.init({
            switchTab: deps.switchTabNav || deps.switchTab,
            openTvCatalog: deps.openTvCatalog,
            getRemoteModule: () => RemoteModule
        });
        BrowserModule.init({
            ensureBrowserCatalog: deps.ensureBrowserCatalog,
            switchTab: deps.switchTab
        });
        bindOnce();
        syncBrowseButtons();
        syncSplitChromeButtons();
        applyOpacity();
        updateBodyClasses();
        ensureShellsJoinedInRoot();
        syncDockSideBtn();
        syncCollapseHeaderBtn();
        syncDockToggleBtn();
        syncScaleResetBtn();
    },

    getMode() {
        return mode;
    },

    getDockSide() {
        return dockSide;
    },

    toggleDockSide() {
        toggleDockSide();
    },

    syncDockSideButtons() {
        syncDockSideBtn();
    },

    isOpen() {
        return mode !== 'hidden';
    },

    isPinned() {
        return pinned;
    },

    getTargetSlotId() {
        return targetSlotId;
    },

    toggle(slotId = 'center', { tab } = {}) {
        const id = slotId || 'center';
        if (this.isOpen() && targetSlotId === id && (!tab || tab === 'remote')) {
            this.close();
            return;
        }
        this.open({ slotId: id, tab });
    },

    /**
     * Chrome / TV surfaces: open the shared browser in TV catalog mode.
     * Avoids sticky radio mode left by Radio Browse.
     */
    openTvCatalog({ slotId = 'center', tab = 'browse' } = {}) {
        const id = slotId || 'center';
        targetSlotId = id;
        MultiView.setStatusSlot(id);
        if (typeof deps.openTvCatalog === 'function') {
            deps.openTvCatalog({ tab });
            if (mode !== 'hidden') {
                persistState({ open: true, mode, targetSlotId });
                syncTargetHighlight();
                syncBrowseButtons();
            }
            return;
        }
        this.open({ slotId: id, tab });
    },

    open({ slotId = 'center', mode: openMode = 'docked', tab = 'remote', focusClose = true } = {}) {
        bindOnce();
        targetSlotId = slotId || 'center';
        MultiView.setStatusSlot(targetSlotId);

        const wasHidden = mode === 'hidden';
        const deferTab = wasHidden && openMode !== 'undocked' && tab != null;

        if (!deferTab && tab != null && tab !== undefined) deps.switchTab(tab);

        if (mode === 'hidden') {
            mode = openMode === 'undocked' ? 'undocked' : 'docked';
            ChannelGrid.setOnPlay(playIntoTarget);

            if (mode === 'undocked') {
                showUndockedUI(true);
                restoreFromState();
                mountToActiveHost();
                applyOpacity();
                if (focusClose) {
                    queueMicrotask(() => el('remote-collapse-header-btn')?.focus());
                }
            } else {
                showUndockedUI(false);
                mountToActiveHost();
                const saved = getSavedState();
                if (saved?.scale != null) scale = clampModuleScale(saved.scale);
                setSheetExpanded(true, { persist: false, animateOpen: true });
                applyDockScaleGeometry();
            }
        } else if (mode === 'docked' && openMode === 'undocked') {
            this.undock();
        } else {
            mountToActiveHost();
            if (mode === 'docked' && !sheetExpanded && openMode === 'docked') {
                setSheetExpanded(true, { persist: false, animateOpen: true });
            }
        }

        updateBodyClasses();
        RemotePanel.bind();
        persistState({ open: true, mode, targetSlotId });
        syncTargetHighlight();
        syncBrowseButtons();
        syncSplitChromeButtons();
        RemoteExternalPopout.syncBtn();
        syncDockToggleBtn();

        const finishChrome = () => {
            if (deferTab) deps.switchTab(tab);
            RemotePanel.syncRemotePanel();
        };
        if (DockOpenGate.isOpening()) {
            DockOpenGate.afterOpen(finishChrome);
        } else {
            finishChrome();
        }
    },

    close() {
        if (mode === 'hidden') return;

        if (isSplit()) {
            this.hide();
            return;
        }

        animateDockedCollapseThen(finishClose);
    },

    /**
     * Hide Remote to the bottom dock tab.
     * When split, Browser stays open in its host (no join).
     * When joined, fully closes the catalog module.
     */
    hide() {
        if (mode === 'hidden') return;

        if (!isSplit()) {
            this.close();
            return;
        }

        animateDockedCollapseThen(finishHideSplit);
    },

    dock() {
        if (mode !== 'undocked') return;
        showUndockedUI(false);
        mode = 'docked';
        // While external, only update the return host; remount happens on pop-in.
        if (!externalHost) {
            mountToActiveHost();
            setSheetExpanded(true, { animateOpen: true });
            syncCatalogChromeGeometry();
        }
        updateBodyClasses();
        persistState({ mode: 'docked', open: true });
        syncBrowseButtons();
        syncDockToggleBtn();
        if (DockOpenGate.isOpening()) {
            DockOpenGate.afterOpen(() => RemotePanel.syncRemotePanel());
        } else {
            RemotePanel.syncRemotePanel();
        }
    },

    undock() {
        if (mode !== 'docked') return;
        mode = 'undocked';
        setSheetExpanded(false, { persist: false });
        dockSheetEl()?.style.removeProperty('height');
        if (!externalHost) {
            showUndockedUI(true);
            restoreFromState();
            const geom = readDialogGeometry();
            applyGeometry({
                ...geom,
                left: edgeInsetLeft(dockSide, geom.width)
            });
            mountToActiveHost();
            applyOpacity();
        }
        updateBodyClasses();
        persistState({ mode: 'undocked', open: true });
        syncBrowseButtons();
        syncDockToggleBtn();
        RemotePanel.syncRemotePanel();
    },

    getInPageHost,

    getActiveHost,

    setExternalHost(host) {
        externalHost = host || null;
    },

    clearExternalHost() {
        externalHost = null;
    },

    mountTo(host) {
        if (!host) return;
        teleportBodyTo(host);
        updateBodyClasses();
    },

    /** Remount into the current in-page host after an external pop-in. */
    returnFromExternal() {
        externalHost = null;
        if (mode === 'undocked') {
            showUndockedUI(true);
            restoreFromState();
            mountToActiveHost();
            applyOpacity();
        } else if (mode === 'docked') {
            showUndockedUI(false);
            setSheetExpanded(true, { persist: false });
            syncCatalogChromeGeometry();
            mountToActiveHost();
        } else {
            mountToActiveHost();
        }
        RemotePanel.syncRemotePanel();
    },

    /**
     * Welcome screen: show the bottom peek tab.
     * Prefer staying `hidden` (that is the normal peek-tab state). If the
     * remote is already open, collapse any expanded sheet without persisting.
     */
    ensureCollapsedDockTab() {
        bindOnce();
        if (mode === 'hidden') {
            updateBodyClasses();
            return;
        }
        if (mode === 'undocked') {
            showUndockedUI(false);
            mode = 'docked';
            setSheetExpanded(false, { persist: false });
            mountToActiveHost();
            updateBodyClasses();
            syncDockToggleBtn();
            RemotePanel.syncRemotePanel();
            return;
        }
        if (mode === 'docked' && sheetExpanded) {
            setSheetExpanded(false, { persist: false });
            updateBodyClasses();
        }
    },

    toggleDockedSheet() {
        if (mode !== 'docked') return;
        if (!sheetExpanded) {
            setSheetExpanded(true, { animateOpen: true });
            mountToActiveHost();
        } else {
            setSheetExpanded(false);
            DockOpenGate.cancel();
        }
        persistState({ sheetExpanded });
    },

    retarget(slotId = 'center') {
        if (mode === 'hidden') return;
        targetSlotId = slotId || 'center';
        MultiView.setStatusSlot(targetSlotId);
        persistState({ targetSlotId, open: true, mode });
        syncTargetHighlight();
        syncBrowseButtons();
    },

    restoreOpenIfNeeded() {
        const saved = getSavedState();
        if (!saved?.open) {
            syncBrowseButtons();
            return;
        }
        const restoreMode = saved.mode === 'undocked' ? 'undocked' : 'docked';
        this.open({
            slotId: saved.targetSlotId || 'center',
            mode: restoreMode,
            tab: 'remote',
            focusClose: false
        });
        if (restoreMode === 'docked') {
            setSheetExpanded(true, { persist: false });
        }
        const layout = saved.layout || getLayoutState();
        if (layout?.mode === 'split') {
            splitBrowser({ hostKind: layout.browserHostKind || 'undocked' });
            deps.ensureBrowserCatalog?.();
        }
    },

    reconcileShells,
    syncSplitChromeButtons,
    focusBrowserWindow() {
        if (!isSplit()) return false;
        const dialog = el('browser-module-dialog');
        try {
            dialog?.focus?.();
        } catch {
            /* ignore */
        }
        return true;
    },

    syncTargetHighlight,
    syncBrowseButtons,
    reconcileTargetIfDisabled,
    applyOpacity,
    syncCatalogChrome(tab) {
        syncCatalogChromeGeometry(tab ?? resolveActiveCatalogTab());
    },
    resetScale,
    syncScaleResetBtn,
    resetIdleFade: () => ModuleIdleFade.resetAll()
};

