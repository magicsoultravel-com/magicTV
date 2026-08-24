/** @module Remote module — teleports catalog body into docked sheet or floating dialog. */
import { el } from '../tvUtils.js';
import { ChannelGrid } from './channelGrid.js';
import { MultiView } from '../multiView.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { RemotePanel, syncRemoteNav } from './remotePanel.js';
import { GuidePanel } from './guidePanel.js';
import { WingPanel } from './wingPanel.js';
import { RemoteExternalPopout } from './remoteExternalPopout.js';
import { browserEndActionsEl, remoteEndActionsEl, startActionsEl } from './moduleActions.js';
import { BrowserModule } from './browserModule.js';
import { ModuleIdleFade } from './moduleIdleFade.js';
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

const MIN_W = 260;
const MIN_H = 560;
const VIEW_PAD = 8;
const DEFAULT_SHEET_HEIGHT = 0.62;

function minDialogWidth() {
    return WingPanel.isOpen?.() ? MIN_W * 2 : MIN_W;
}

let deps = {
    getDefaultOnPlay: () => () => {},
    switchTab: () => {},
    ensureBrowserCatalog: () => {}
};

/** @type {'hidden'|'docked'|'undocked'} */
let mode = 'hidden';
let targetSlotId = null;
let dockParent = null;
let nextSibling = null;
let remoteEndActionsDockParent = null;
let remoteEndActionsNextSibling = null;
let browserEndActionsDockParent = null;
let browserEndActionsNextSibling = null;
let guideDockParent = null;
let guideNextSibling = null;
let bound = false;
let pinned = false;
let sheetExpanded = false;
/** @type {HTMLElement|null} External OS-window host; when set, mount prefers it over in-page hosts. */
let externalHost = null;

let idleActivityBound = false;

/** @type {{ mode: 'drag'|'resize'|'sheet', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number, originSheetH?: number } | null} */
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

function moduleStartActions() {
    return startActionsEl()
        || stagingEl()?.querySelector('.tv-module__actions--start');
}

function moduleRemoteEndActions() {
    return remoteEndActionsEl()
        || stagingEl()?.querySelector('.tv-module__actions--remote-end');
}

function moduleBrowserEndActions() {
    return browserEndActionsEl()
        || stagingEl()?.querySelector('.tv-module__actions--browser-end');
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
    const inset = 12;
    const width = MIN_W;
    const height = MIN_H;
    const tabClearance = 44;
    return {
        left: inset,
        top: Math.round(vh - height - inset - tabClearance),
        width,
        height
    };
}

function clampGeometry({ left, top, width, height }) {
    const minW = minDialogWidth();
    const { w: vw, h: vh } = viewportSize();
    let w = Math.max(minW, Math.min(width, vw - VIEW_PAD * 2));
    let h = Math.max(MIN_H, Math.min(height, vh - VIEW_PAD * 2));
    let x = left;
    let y = top;
    x = Math.min(Math.max(VIEW_PAD, x), vw - VIEW_PAD - Math.min(w, 80));
    y = Math.min(Math.max(VIEW_PAD, y), vh - VIEW_PAD - 40);
    if (x + w > vw - VIEW_PAD) w = Math.max(minW, vw - VIEW_PAD - x);
    if (y + h > vh - VIEW_PAD) h = Math.max(MIN_H, vh - VIEW_PAD - y);
    return { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) return defaultGeometry();
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

function getSavedState() {
    return loadPlayerState().remoteModule;
}

function persistState(overrides = {}) {
    const prev = getSavedState() || {};
    const wasUndocked = mode === 'undocked';
    const geom = wasUndocked
        ? readDialogGeometry()
        : {
            left: prev.left ?? defaultGeometry().left,
            top: prev.top ?? defaultGeometry().top,
            width: prev.width ?? defaultGeometry().width,
            height: prev.height ?? defaultGeometry().height
        };

    const nextMode = overrides.mode != null ? overrides.mode : mode;
    const nextOpen = overrides.open != null ? overrides.open === true : (nextMode !== 'hidden');
    const nextPinned = overrides.pinned != null ? overrides.pinned === true : pinned;
    let nextTarget = overrides.targetSlotId != null ? overrides.targetSlotId : targetSlotId;
    if (!nextTarget) nextTarget = prev.targetSlotId || 'center';

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
            mode: nextMode,
            open: nextOpen,
            pinned: nextPinned,
            targetSlotId: nextTarget,
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

function clearTargetHighlight() {
    document.querySelectorAll('.tv-player-tile.is-channel-picker-target').forEach((tile) => {
        tile.classList.remove('is-channel-picker-target');
    });
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

function syncTargetHighlight() {
    if (mode !== 'hidden' && targetSlotId) {
        const effective = resolveEffectiveTarget(targetSlotId);
        if (effective !== targetSlotId) {
            targetSlotId = effective;
            persistState({ targetSlotId: effective, open: true, mode });
        }
        clearTargetHighlight();
        const mosaic = el('player-mosaic');
        if (!mosaic?.classList.contains('has-corners')) {
            syncBrowseButtons();
            return;
        }
        const tile = el(`player-tile-${effective}`);
        if (tile && !tile.classList.contains('is-hidden')) {
            tile.classList.add('is-channel-picker-target');
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
    const pct = SettingsStore.getChannelPickerOpacity();
    document.documentElement.style.setProperty('--remote-module-opacity', String(pct / 100));
    document.documentElement.style.setProperty('--channel-picker-opacity', String(pct / 100));
}

function bindIdleActivity() {
    if (idleActivityBound) return;
    idleActivityBound = true;
    ModuleIdleFade.init();
}

function playIntoTarget(channel) {
    const slotId = MultiView.statusSlotId || targetSlotId || 'center';
    TileFrames.setPlaybackBusy(true);
    MultiView.playOnSlot(slotId, channel).catch((e) => {
        const blocked = e?.name === 'NotAllowedError'
            || String(e?.message || '').toLowerCase().includes('not allowed');
        if (!blocked) showAppToast('Stream unavailable');
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

function restoreBodyToStaging() {
    const body = catalogBody();
    const guide = guidePanelEl();
    const staging = stagingEl();
    const remoteEndActions = moduleRemoteEndActions();
    const browserEndActions = moduleBrowserEndActions();
    const startActions = moduleStartActions();
    if (!body || !staging) return;

    if (startActions && startActionsDockParent) {
        if (startActionsNextSibling && startActionsNextSibling.parentElement === startActionsDockParent) {
            startActionsDockParent.insertBefore(startActions, startActionsNextSibling);
        } else {
            startActionsDockParent.appendChild(startActions);
        }
    }

    if (remoteEndActions && remoteEndActionsDockParent) {
        if (remoteEndActionsNextSibling && remoteEndActionsNextSibling.parentElement === remoteEndActionsDockParent) {
            remoteEndActionsDockParent.insertBefore(remoteEndActions, remoteEndActionsNextSibling);
        } else {
            remoteEndActionsDockParent.appendChild(remoteEndActions);
        }
    }

    if (browserEndActions && browserEndActionsDockParent) {
        if (browserEndActionsNextSibling && browserEndActionsNextSibling.parentElement === browserEndActionsDockParent) {
            browserEndActionsDockParent.insertBefore(browserEndActions, browserEndActionsNextSibling);
        } else {
            browserEndActionsDockParent.appendChild(browserEndActions);
        }
    }

    if (dockParent) {
        if (nextSibling && nextSibling.parentElement === dockParent) {
            dockParent.insertBefore(body, nextSibling);
        } else {
            dockParent.appendChild(body);
        }
    } else {
        staging.appendChild(body);
    }

    if (guide) {
        if (guideDockParent) {
            if (guideNextSibling && guideNextSibling.parentElement === guideDockParent) {
                guideDockParent.insertBefore(guide, guideNextSibling);
            } else {
                guideDockParent.appendChild(guide);
            }
        } else {
            staging.appendChild(guide);
        }
    }

    dockParent = null;
    nextSibling = null;
    guideDockParent = null;
    guideNextSibling = null;
    startActionsDockParent = null;
    startActionsNextSibling = null;
    remoteEndActionsDockParent = null;
    remoteEndActionsNextSibling = null;
    browserEndActionsDockParent = null;
    browserEndActionsNextSibling = null;
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
    if (typeof btn.closest === 'function') {
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
    toggleSplitBrowser({ hostKind: 'undocked' });
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
    deps.ensureBrowserCatalog?.();
}

function teleportBodyTo(host) {
    const body = catalogBody();
    const guide = guidePanelEl();
    if (!body || !host) return;

    const remoteEndActions = moduleRemoteEndActions();
    const browserEndActions = moduleBrowserEndActions();
    const startActions = moduleStartActions();
    const split = isSplit();

    if (!dockParent) {
        dockParent = body.parentElement;
        nextSibling = body.nextSibling;
    }
    if (guide && !guideDockParent) {
        guideDockParent = guide.parentElement;
        guideNextSibling = guide.nextSibling;
    }
    if (remoteEndActions && !remoteEndActionsDockParent) {
        remoteEndActionsDockParent = remoteEndActions.parentElement;
        remoteEndActionsNextSibling = remoteEndActions.nextSibling;
    }
    if (!split) {
        if (browserEndActions && !browserEndActionsDockParent) {
            browserEndActionsDockParent = browserEndActions.parentElement;
            browserEndActionsNextSibling = browserEndActions.nextSibling;
        }
        if (startActions && !startActionsDockParent) {
            startActionsDockParent = startActions.parentElement;
            startActionsNextSibling = startActions.nextSibling;
        }
    }

    if (!split && startActions) host.appendChild(startActions);
    if (remoteEndActions) host.appendChild(remoteEndActions);
    if (!split && browserEndActions) host.appendChild(browserEndActions);
    host.appendChild(body);
    if (guide) host.appendChild(guide);
    syncCatalogRootClasses(body);
}

function mountToActiveHost() {
    reconcileShells();
    updateBodyClasses();
}

function applySheetHeight(ratio) {
    const sheet = dockSheetEl();
    if (!sheet) return;
    const { h: vh } = viewportSize();
    const clamped = Math.min(0.85, Math.max(DEFAULT_SHEET_HEIGHT, ratio));
    const px = Math.round(vh * clamped);
    sheet.style.setProperty('--remote-sheet-height', String(clamped));
    sheet.style.height = `${px}px`;
}

function setSheetExpanded(expanded, { persist = true } = {}) {
    sheetExpanded = expanded === true;
    const sheet = dockSheetEl();
    const tab = dockTabEl();
    sheet?.classList.toggle('is-expanded', sheetExpanded);
    sheet?.classList.toggle('is-collapsed', !sheetExpanded);
    sheet?.setAttribute('aria-hidden', String(!sheetExpanded));
    tab?.classList.toggle('is-active', sheetExpanded && mode === 'docked');
    tab?.setAttribute('aria-expanded', String(sheetExpanded));
    if (sheetExpanded && mode === 'docked') {
        const saved = getSavedState();
        applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
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
    dockSheetEl()?.querySelector('[data-dock-resize]')?.classList.remove('is-dragging');
    gesture = null;
    persistState();
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (gesture.mode === 'sheet') {
        const { h: vh } = viewportSize();
        const originPx = gesture.originSheetH ?? vh * DEFAULT_SHEET_HEIGHT;
        const nextPx = Math.max(vh * 0.25, Math.min(vh * 0.85, originPx - dy));
        applySheetHeight(nextPx / vh);
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

    const edge = gesture.edge || '';
    let left = gesture.originLeft;
    let top = gesture.originTop;
    let width = gesture.originW;
    let height = gesture.originH;

    if (edge.includes('e')) width = gesture.originW + dx;
    if (edge.includes('s')) height = gesture.originH + dy;
    if (edge.includes('w')) {
        width = gesture.originW - dx;
        left = gesture.originLeft + dx;
    }
    if (edge.includes('n')) {
        height = gesture.originH - dy;
        top = gesture.originTop + dy;
    }

    if (width < minDialogWidth()) {
        const minW = minDialogWidth();
        if (edge.includes('w')) left = gesture.originLeft + gesture.originW - minW;
        width = minW;
    }
    if (height < MIN_H) {
        if (edge.includes('n')) top = gesture.originTop + gesture.originH - MIN_H;
        height = MIN_H;
    }

    applyGeometry({ left, top, width, height });
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

    if (modeName === 'sheet') {
        const sheet = dockSheetEl();
        const { h: vh } = viewportSize();
        gesture = {
            mode: 'sheet',
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originLeft: 0,
            originTop: 0,
            originW: 0,
            originH: 0,
            originSheetH: sheet?.getBoundingClientRect().height ?? vh * DEFAULT_SHEET_HEIGHT
        };
        sheet?.querySelector('[data-dock-resize]')?.classList.add('is-dragging');
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
            originH: geom.height
        };
        if (modeName === 'drag') {
            e.currentTarget?.classList?.add('is-dragging');
            dialogEl()?.classList.add('is-dragging');
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

    el('remote-module-close')?.addEventListener('click', () => RemoteModule.close());
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

    dockTabEl()?.addEventListener('click', () => {
        if (mode === 'hidden') {
            RemoteModule.open({
                mode: 'docked',
                slotId: targetSlotId || 'center',
                tab: isSplit() ? null : 'remote',
                focusClose: false
            });
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

    dockSheetEl()?.querySelector('[data-dock-resize]')?.addEventListener('pointerdown', (e) => {
        beginGesture(e, 'sheet');
    });

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', () => {
        if (mode === 'undocked') applyGeometry(readDialogGeometry());
        if (mode === 'docked' && sheetExpanded) {
            const saved = getSavedState();
            applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
        }
    });
    window.addEventListener('pagehide', () => {
        if (mode !== 'hidden') persistState();
    });

    window.addEventListener('wing:mode_changed', (e) => {
        const open = e.detail?.open === true;
        if (mode === 'undocked') {
            const geom = readDialogGeometry();
            if (open && geom.width < MIN_W * 2) {
                applyGeometry({ ...geom, width: MIN_W * 2 });
            } else if (!open && geom.width >= MIN_W * 2) {
                applyGeometry({ ...geom, width: MIN_W });
            } else {
                applyGeometry(geom);
            }
        }
        persistState({ guideOpen: WingPanel.isGuidePreferred?.() });
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
    const guideOpen = saved?.guideOpen === true;
    const minW = guideOpen ? MIN_W * 2 : MIN_W;
    if (saved) {
        applyGeometry({
            left: Number.isFinite(saved.left) ? saved.left : geom.left,
            top: Number.isFinite(saved.top) ? saved.top : geom.top,
            width: Math.max(minW, Number.isFinite(saved.width) ? saved.width : minW),
            height: MIN_H
        }, { pinned: saved.pinned === true });
        applySheetHeight(saved.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
        return;
    }
    applyGeometry({ ...defaultGeometry(), width: minW }, { pinned: false });
    applySheetHeight(DEFAULT_SHEET_HEIGHT);
}

export const RemoteModule = {
    init({ getDefaultOnPlay, switchTab, ensureBrowserCatalog } = {}) {
        if (typeof getDefaultOnPlay === 'function') deps.getDefaultOnPlay = getDefaultOnPlay;
        if (typeof switchTab === 'function') deps.switchTab = switchTab;
        if (typeof ensureBrowserCatalog === 'function') deps.ensureBrowserCatalog = ensureBrowserCatalog;
        hydrateLayoutFromPlayerState();
        setReconcileHandler(() => {
            reconcileShells();
            updateBodyClasses();
            RemotePanel.syncRemotePanel?.();
            RemoteExternalPopout.syncBtn?.();
            syncSplitChromeButtons();
        });
        RemotePanel.init({ switchTab: deps.switchTab, getRemoteModule: () => RemoteModule });
        BrowserModule.init({ ensureBrowserCatalog: deps.ensureBrowserCatalog });
        bindOnce();
        syncBrowseButtons();
        syncSplitChromeButtons();
        applyOpacity();
        updateBodyClasses();
        ensureShellsJoinedInRoot();
    },

    getMode() {
        return mode;
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

    open({ slotId = 'center', mode: openMode = 'docked', tab = 'remote', focusClose = true } = {}) {
        bindOnce();
        targetSlotId = slotId || 'center';
        MultiView.setStatusSlot(targetSlotId);

        if (tab != null && tab !== undefined) deps.switchTab(tab);

        if (mode === 'hidden') {
            mode = openMode === 'undocked' ? 'undocked' : 'docked';
            ChannelGrid.setOnPlay(playIntoTarget);

            if (mode === 'undocked') {
                showUndockedUI(true);
                restoreFromState();
                mountToActiveHost();
                applyOpacity();
                if (focusClose) {
                    queueMicrotask(() => el('remote-module-close')?.focus());
                }
            } else {
                showUndockedUI(false);
                mountToActiveHost();
                const saved = getSavedState();
                setSheetExpanded(true, { persist: false });
                applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
            }
        } else if (mode === 'docked' && openMode === 'undocked') {
            this.undock();
        } else {
            mountToActiveHost();
        }

        updateBodyClasses();
        RemotePanel.bind();
        persistState({ open: true, mode, targetSlotId });
        syncTargetHighlight();
        syncBrowseButtons();
        syncSplitChromeButtons();
        RemoteExternalPopout.syncBtn();
        RemotePanel.syncRemotePanel();
    },

    close() {
        if (mode === 'hidden') return;

        // While split, "close/hide" must not rejoin Browser — only collapse Remote.
        if (isSplit()) {
            this.hide();
            return;
        }

        if (RemoteExternalPopout.isPoppedOut()) {
            RemoteExternalPopout.popIn();
        }

        persistState({ open: false, mode: 'hidden' });

        externalHost = null;
        restoreBodyToStaging();
        ensureShellsJoinedInRoot();
        showUndockedUI(false);
        setSheetExpanded(false, { persist: false });

        mode = 'hidden';
        targetSlotId = null;
        remoteEndActionsDockParent = null;
        remoteEndActionsNextSibling = null;
        browserEndActionsDockParent = null;
        browserEndActionsNextSibling = null;

        clearTargetHighlight();
        MultiView.syncTileStatusHighlight?.();
        updateBodyClasses();
        syncSplitChromeButtons();

        ChannelGrid.setOnPlay(deps.getDefaultOnPlay());
        syncBrowseButtons();
        RemoteExternalPopout.syncBtn();
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

        if (RemoteExternalPopout.isPoppedOut()) {
            RemoteExternalPopout.popIn();
        }

        // Collapse Remote UI only — leave layout.mode === 'split' and Browser hosts alone.
        externalHost = null;
        showUndockedUI(false);
        setSheetExpanded(false, { persist: false });

        const body = catalogBody();
        const guide = guidePanelEl();
        const staging = stagingEl();
        const remoteEnd = moduleRemoteEndActions();
        if (body && staging) {
            if (remoteEnd) staging.appendChild(remoteEnd);
            staging.appendChild(body);
            if (guide) staging.appendChild(guide);
        }
        dockParent = null;
        nextSibling = null;
        guideDockParent = null;
        guideNextSibling = null;
        remoteEndActionsDockParent = null;
        remoteEndActionsNextSibling = null;

        mode = 'hidden';
        persistState({ open: false, mode: 'hidden' });
        // Keep targetSlotId so reopening still aims at the same TV.
        updateBodyClasses();
        syncSplitChromeButtons();
        syncBrowseButtons();
        RemoteExternalPopout.syncBtn();
        RemotePanel.syncRemotePanel();
        // Playback-from-browser still uses playIntoTarget while split.
        ChannelGrid.setOnPlay(playIntoTarget);
    },

    dock() {
        if (mode !== 'undocked') return;
        showUndockedUI(false);
        mode = 'docked';
        // While external, only update the return host; remount happens on pop-in.
        if (!externalHost) {
            mountToActiveHost();
            setSheetExpanded(true);
            const saved = getSavedState();
            applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
        }
        updateBodyClasses();
        persistState({ mode: 'docked', open: true });
        syncBrowseButtons();
        RemotePanel.syncRemotePanel();
    },

    undock() {
        if (mode !== 'docked') return;
        mode = 'undocked';
        setSheetExpanded(false, { persist: false });
        dockSheetEl()?.style.removeProperty('height');
        if (!externalHost) {
            showUndockedUI(true);
            restoreFromState();
            mountToActiveHost();
            applyOpacity();
        }
        updateBodyClasses();
        persistState({ mode: 'undocked', open: true });
        syncBrowseButtons();
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
            const saved = getSavedState();
            applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
            mountToActiveHost();
        } else {
            mountToActiveHost();
        }
        RemotePanel.syncRemotePanel();
    },

    toggleDockedSheet() {
        if (mode !== 'docked') return;
        if (!sheetExpanded) {
            setSheetExpanded(true);
            mountToActiveHost();
        } else {
            setSheetExpanded(false);
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
    resetIdleFade: () => ModuleIdleFade.resetAll()
};

