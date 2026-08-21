/** @module Remote module — teleports catalog body into docked sheet or floating dialog. */
import { el } from '../tvUtils.js';
import { ChannelGrid } from './channelGrid.js';
import { MultiView } from '../multiView.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { ACTION_ICONS } from './icons.js';
import { RemotePanel } from './remotePanel.js';
import { RemoteExternalPopout } from './remoteExternalPopout.js';
import { BrowserPopout } from './browserPopout.js';
import { BrowserExternalPopout } from './browserExternalPopout.js';
import { browserEndActionsEl, remoteEndActionsEl, startActionsEl } from './moduleActions.js';

const MIN_W = 260;
const MIN_H = 560;
const VIEW_PAD = 8;
const DEFAULT_SHEET_HEIGHT = 0.62;

let deps = {
    getDefaultOnPlay: () => () => {},
    switchTab: () => {}
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
let bound = false;
let pinned = false;
let sheetExpanded = false;

let idleDelayTimer = null;
let fadeRafId = null;
let idleActivityBound = false;
/** @type {number} 0–1 multiplier applied on top of base remote opacity */
let idleOpacityMult = 1;
let idleHoverPreview = false;
const IDLE_HOVER_PREVIEW_MULT = 0.55;

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
    const { w: vw, h: vh } = viewportSize();
    let w = Math.max(MIN_W, Math.min(width, vw - VIEW_PAD * 2));
    let h = Math.max(MIN_H, Math.min(height, vh - VIEW_PAD * 2));
    let x = left;
    let y = top;
    x = Math.min(Math.max(VIEW_PAD, x), vw - VIEW_PAD - Math.min(w, 80));
    y = Math.min(Math.max(VIEW_PAD, y), vh - VIEW_PAD - 40);
    if (x + w > vw - VIEW_PAD) w = Math.max(MIN_W, vw - VIEW_PAD - x);
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

    savePlayerState({
        remoteModule: {
            ...geom,
            mode: nextMode,
            open: nextOpen,
            pinned: nextPinned,
            targetSlotId: nextTarget,
            sheetHeight: parseFloat(sheetHeight) || DEFAULT_SHEET_HEIGHT,
            sheetExpanded: overrides.sheetExpanded != null ? overrides.sheetExpanded === true : sheetExpanded
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

function getIdleFadeSettings() {
    return {
        enabled: SettingsStore.getRemoteIdleFadeEnabled(),
        delayMs: SettingsStore.getRemoteIdleDelaySec() * 1000,
        fadeMs: SettingsStore.getRemoteIdleFadeSec() * 1000
    };
}

function clearIdleTimers() {
    if (idleDelayTimer) {
        clearTimeout(idleDelayTimer);
        idleDelayTimer = null;
    }
    if (fadeRafId) {
        cancelAnimationFrame(fadeRafId);
        fadeRafId = null;
    }
}

function applyIdleOpacityMult(mult) {
    idleOpacityMult = Math.max(0, Math.min(1, mult));
    updateIdleOpacityCss();
}

function updateIdleOpacityCss() {
    const effective = idleHoverPreview && idleOpacityMult <= 0.01
        ? IDLE_HOVER_PREVIEW_MULT
        : idleOpacityMult;
    document.documentElement.style.setProperty('--remote-idle-opacity-mult', String(effective));
    document.body.classList.toggle('remote-idle-faded', idleOpacityMult <= 0.01 && !idleHoverPreview);
    document.body.classList.toggle('remote-idle-hover-preview', idleHoverPreview && idleOpacityMult <= 0.01);
}

function startIdleFadeOut(fadeMs) {
    const start = performance.now();
    const tick = (now) => {
        const t = fadeMs <= 0 ? 1 : Math.min(1, (now - start) / fadeMs);
        applyIdleOpacityMult(1 - t);
        if (t < 1) {
            fadeRafId = requestAnimationFrame(tick);
        } else {
            fadeRafId = null;
        }
    };
    fadeRafId = requestAnimationFrame(tick);
}

function scheduleIdleFade() {
    clearIdleTimers();
    if (RemoteExternalPopout.isPoppedOut()) {
        applyIdleOpacityMult(1);
        return;
    }
    const { enabled, delayMs, fadeMs } = getIdleFadeSettings();
    if (!enabled) {
        applyIdleOpacityMult(1);
        return;
    }
    applyIdleOpacityMult(1);
    idleDelayTimer = setTimeout(() => startIdleFadeOut(fadeMs), delayMs);
}

function onUserActivity() {
    idleHoverPreview = false;
    if (fadeRafId || idleOpacityMult < 1) {
        applyIdleOpacityMult(1);
    } else {
        updateIdleOpacityCss();
    }
    scheduleIdleFade();
}

function bindIdleHoverPreview() {
    const selector = '.remote-dock-tab, .remote-dock-sheet.is-expanded, .remote-module__dialog, .browser-popout-module__dialog';
    document.addEventListener('pointerover', (e) => {
        if (idleOpacityMult > 0.01) return;
        if (!e.target.closest?.(selector)) return;
        if (idleHoverPreview) return;
        idleHoverPreview = true;
        updateIdleOpacityCss();
    }, true);
    document.addEventListener('pointerout', (e) => {
        if (idleOpacityMult > 0.01) return;
        if (!e.target.closest?.(selector)) return;
        const related = e.relatedTarget;
        if (related && typeof related.closest === 'function' && related.closest(selector)) return;
        if (!idleHoverPreview) return;
        idleHoverPreview = false;
        updateIdleOpacityCss();
    }, true);
}

function bindIdleActivity() {
    if (idleActivityBound) return;
    idleActivityBound = true;
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    for (const ev of events) {
        document.addEventListener(ev, onUserActivity, { capture: true, passive: true });
    }
    window.addEventListener('scroll', onUserActivity, { capture: true, passive: true });
    bindIdleHoverPreview();
    applyIdleOpacityMult(1);
    scheduleIdleFade();
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

function getActiveHost() {
    if (mode === 'undocked') return undockedHostEl();
    if (mode === 'docked') return dockHostEl();
    return stagingEl();
}

function restoreBodyToStaging() {
    const body = catalogBody();
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
    dockParent = null;
    nextSibling = null;
    startActionsDockParent = null;
    startActionsNextSibling = null;
    remoteEndActionsDockParent = null;
    remoteEndActionsNextSibling = null;
    browserEndActionsDockParent = null;
    browserEndActionsNextSibling = null;
}

function teleportBodyTo(host) {
    const body = catalogBody();
    if (!body || !host) return;

    const remoteEndActions = moduleRemoteEndActions();
    const browserEndActions = moduleBrowserEndActions();
    const startActions = moduleStartActions();

    if (!dockParent) {
        dockParent = body.parentElement;
        nextSibling = body.nextSibling;
    }
    if (remoteEndActions && !remoteEndActionsDockParent) {
        remoteEndActionsDockParent = remoteEndActions.parentElement;
        remoteEndActionsNextSibling = remoteEndActions.nextSibling;
    }
    if (browserEndActions && !browserEndActionsDockParent) {
        browserEndActionsDockParent = browserEndActions.parentElement;
        browserEndActionsNextSibling = browserEndActions.nextSibling;
    }
    if (startActions && !startActionsDockParent) {
        startActionsDockParent = startActions.parentElement;
        startActionsNextSibling = startActions.nextSibling;
    }

    if (startActions) host.appendChild(startActions);
    if (remoteEndActions) host.appendChild(remoteEndActions);
    if (browserEndActions) host.appendChild(browserEndActions);
    host.appendChild(body);
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
    el('remote-module-close')?.addEventListener('click', () => RemoteModule.close());
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
        if (mode === 'hidden') RemoteModule.open({ mode: 'docked' });
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

    bindIdleActivity();
}

function restoreFromState() {
    const saved = getSavedState();
    const geom = defaultGeometry();
    if (saved) {
        applyGeometry({
            left: Number.isFinite(saved.left) ? saved.left : geom.left,
            top: Number.isFinite(saved.top) ? saved.top : geom.top,
            width: MIN_W,
            height: MIN_H
        }, { pinned: saved.pinned === true });
        applySheetHeight(saved.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
        return;
    }
    applyGeometry(defaultGeometry(), { pinned: false });
    applySheetHeight(DEFAULT_SHEET_HEIGHT);
}

function mountToActiveHost() {
    const host = getActiveHost();
    if (!host) return;
    teleportBodyTo(host);
    updateBodyClasses();
}

export const RemoteModule = {
    init({ getDefaultOnPlay, switchTab } = {}) {
        if (typeof getDefaultOnPlay === 'function') deps.getDefaultOnPlay = getDefaultOnPlay;
        if (typeof switchTab === 'function') deps.switchTab = switchTab;
        RemotePanel.init({ switchTab: deps.switchTab, getRemoteModule: () => RemoteModule });
        bindOnce();
        syncBrowseButtons();
        applyOpacity();
        updateBodyClasses();
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

        if (tab !== undefined) deps.switchTab(tab);

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
        RemoteExternalPopout.syncBtn();
        RemotePanel.syncRemotePanel();
    },

    close() {
        if (mode === 'hidden') return;

        if (RemoteExternalPopout.isPoppedOut()) {
            RemoteExternalPopout.popIn();
        }
        if (BrowserPopout.isOpen()) {
            BrowserPopout.close();
        }
        if (BrowserExternalPopout.isPoppedOut()) {
            BrowserExternalPopout.popIn();
        }

        persistState({ open: false, mode: 'hidden' });

        restoreBodyToStaging();
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

        ChannelGrid.setOnPlay(deps.getDefaultOnPlay());
        syncBrowseButtons();
        RemoteExternalPopout.syncBtn();
    },

    dock() {
        if (mode !== 'undocked') return;
        showUndockedUI(false);
        mode = 'docked';
        mountToActiveHost();
        setSheetExpanded(true);
        const saved = getSavedState();
        applySheetHeight(saved?.sheetHeight ?? DEFAULT_SHEET_HEIGHT);
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
        showUndockedUI(true);
        restoreFromState();
        mountToActiveHost();
        applyOpacity();
        updateBodyClasses();
        persistState({ mode: 'undocked', open: true });
        syncBrowseButtons();
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
    },

    syncTargetHighlight,
    syncBrowseButtons,
    reconcileTargetIfDisabled,
    applyOpacity,
    resetIdleFade: onUserActivity
};

