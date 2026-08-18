/** @module Channel picker — teleports the real catalog into a per-TV modal. */
import { el } from '../tvUtils.js';
import { ChannelGrid } from './channelGrid.js';
import { MultiView } from '../multiView.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { ACTION_ICONS } from './icons.js';

const MIN_W = 360;
const MIN_H = 280;
const VIEW_PAD = 8;

let deps = {
    getDefaultOnPlay: () => () => {}
};

let targetSlotId = null;
let dockParent = null;
let nextSibling = null;
let endActionsDockParent = null;
let endActionsNextSibling = null;
let bound = false;
let pinned = false;

/** @type {{ mode: 'drag'|'resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number } | null} */
let gesture = null;

function modalEl() {
    return el('channel-picker-modal');
}

function dialogEl() {
    return el('channel-picker-dialog');
}

function hostEl() {
    return el('channel-picker-host');
}

function catalogBody() {
    return el('tv-catalog-body');
}

function catalogRoot() {
    return el('tv-catalog');
}

function catalogEndActions() {
    return catalogRoot()?.querySelector('.tv-catalog__actions--end')
        || document.querySelector('.channel-picker-modal__host > .tv-catalog__actions--end');
}

function viewportSize() {
    return {
        w: window.innerWidth || document.documentElement.clientWidth || 800,
        h: window.innerHeight || document.documentElement.clientHeight || 600
    };
}

function defaultGeometry() {
    const { w: vw, h: vh } = viewportSize();
    const width = Math.min(1100, Math.max(MIN_W, vw - 32));
    const height = Math.min(640, Math.max(MIN_H, Math.round(vh * 0.7)));
    return {
        left: Math.round((vw - width) / 2),
        top: Math.round((vh - height) / 2),
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
    // Keep header (top edge) reachable
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

function persistState(overrides = {}) {
    const wasOpen = ChannelPickerModal.isOpen();
    const prev = loadPlayerState().channelPicker;
    const geom = wasOpen
        ? readDialogGeometry()
        : (prev
            ? {
                left: prev.left,
                top: prev.top,
                width: prev.width,
                height: prev.height
            }
            : defaultGeometry());
    const nextOpen = overrides.open != null ? overrides.open === true : wasOpen;
    const nextPinned = overrides.pinned != null ? overrides.pinned === true : pinned;
    let nextTarget = overrides.targetSlotId != null ? overrides.targetSlotId : targetSlotId;
    if (!nextTarget) nextTarget = prev?.targetSlotId || 'center';

    savePlayerState({
        channelPicker: {
            ...geom,
            pinned: nextPinned,
            open: nextOpen,
            targetSlotId: nextTarget
        }
    });
}

function setPinned(next, { persist = true } = {}) {
    pinned = next === true;
    const modal = modalEl();
    const pinBtn = el('channel-picker-pin');
    modal?.classList.toggle('is-pinned', pinned);
    if (pinBtn) {
        pinBtn.classList.toggle('is-active', pinned);
        pinBtn.setAttribute('aria-pressed', String(pinned));
        pinBtn.title = pinned ? 'Unpin window' : 'Pin window';
        pinBtn.setAttribute('aria-label', pinned ? 'Unpin window' : 'Pin window');
    }
    const dialog = dialogEl();
    if (dialog) dialog.setAttribute('aria-modal', pinned ? 'false' : 'true');
    if (persist) persistState({ pinned, open: ChannelPickerModal.isOpen() });
}

function clearTargetHighlight() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.tv-player-tile.is-channel-picker-target').forEach((tile) => {
        tile.classList.remove('is-channel-picker-target');
    });
}

function syncTargetHighlight() {
    if (ChannelPickerModal.isOpen() && targetSlotId) {
        clearTargetHighlight();
        const mosaic = el('player-mosaic');
        if (!mosaic?.classList.contains('has-corners')) return;
        const tile = el(`player-tile-${targetSlotId}`);
        if (!tile || tile.classList.contains('is-hidden')) return;
        tile.classList.add('is-channel-picker-target');
        return;
    }
    MultiView.syncTileStatusHighlight?.();
}

function setBrowseButtonState(btn, active) {
    if (!btn) return;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.innerHTML = active ? ACTION_ICONS.browseFilled : ACTION_ICONS.browse;
    const label = active ? 'Hide channel picker' : 'Pick channel';
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function syncBrowseButtons() {
    if (typeof document === 'undefined') return;
    const open = ChannelPickerModal.isOpen();
    const target = targetSlotId;

    document.querySelectorAll('[data-tile-action="browse"]').forEach((btn) => {
        const slotId = btn.closest?.('.tv-player-tile')?.getAttribute('data-slot');
        setBrowseButtonState(btn, open && Boolean(slotId) && target === slotId);
    });
}

function applyOpacity() {
    if (typeof document === 'undefined') return;
    const pct = SettingsStore.getChannelPickerOpacity();
    document.documentElement.style.setProperty('--channel-picker-opacity', String(pct / 100));
}

function playIntoTarget(channel) {
    const slotId = targetSlotId || 'center';
    const stayOpen = pinned;
    if (!stayOpen) ChannelPickerModal.close();
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

function onKeydown(e) {
    if (e.key === 'Escape' && ChannelPickerModal.isOpen()) {
        e.preventDefault();
        ChannelPickerModal.close();
    }
}

function endGesture() {
    if (!gesture) return;
    const header = modalEl()?.querySelector('[data-channel-picker-drag]');
    header?.classList.remove('is-dragging');
    gesture = null;
    persistState({ open: true });
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

    // Enforce min size against the edge being dragged
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

function beginGesture(e, mode, edge = '') {
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
    if (mode === 'drag') {
        e.currentTarget?.classList?.add('is-dragging');
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
    const modal = modalEl();
    if (!modal) return;

    modal.querySelectorAll('[data-channel-picker-dismiss]').forEach((node) => {
        node.addEventListener('click', () => {
            if (!pinned) ChannelPickerModal.close();
        });
    });

    el('channel-picker-close')?.addEventListener('click', () => ChannelPickerModal.close());
    el('channel-picker-pin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setPinned(!pinned);
    });

    const header = modal.querySelector('[data-channel-picker-drag]');
    header?.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('button')) return;
        beginGesture(e, 'drag');
    });

    modal.querySelectorAll('[data-picker-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            const edge = handle.getAttribute('data-picker-resize') || '';
            beginGesture(e, 'resize', edge);
        });
    });

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', () => {
        if (!ChannelPickerModal.isOpen()) return;
        applyGeometry(readDialogGeometry());
    });
    window.addEventListener('pagehide', () => {
        if (ChannelPickerModal.isOpen()) persistState({ open: true });
    });
}

function restoreFromState() {
    const saved = loadPlayerState().channelPicker;
    if (saved) {
        applyGeometry(saved, { pinned: saved.pinned === true });
        return;
    }
    applyGeometry(defaultGeometry(), { pinned: false });
}

export const ChannelPickerModal = {
    init({ getDefaultOnPlay } = {}) {
        if (typeof getDefaultOnPlay === 'function') deps.getDefaultOnPlay = getDefaultOnPlay;
        bindOnce();
        syncBrowseButtons();
        applyOpacity();
    },

    isOpen() {
        const modal = modalEl();
        return !!(modal && !modal.hidden && !modal.classList.contains('is-hidden'));
    },

    isPinned() {
        return pinned;
    },

    getTargetSlotId() {
        return targetSlotId;
    },

    /** Open for slot, or close if already open for that same slot. */
    toggle(slotId = 'center') {
        const id = slotId || 'center';
        if (this.isOpen() && targetSlotId === id) {
            this.close();
            return;
        }
        this.open(id);
    },

    open(slotId = 'center', { focusClose = true } = {}) {
        bindOnce();
        const modal = modalEl();
        const host = hostEl();
        const body = catalogBody();
        if (!modal || !host || !body) return;

        targetSlotId = slotId || 'center';
        MultiView.setStatusSlot(targetSlotId);

        if (!this.isOpen()) {
            const endActions = catalogEndActions();
            if (endActions) {
                endActionsDockParent = endActions.parentElement;
                endActionsNextSibling = endActions.nextSibling;
                host.appendChild(endActions);
            }
            dockParent = body.parentElement;
            nextSibling = body.nextSibling;
            host.appendChild(body);
            catalogRoot()?.classList.add('is-catalog-teleported');
            document.body.classList.add('has-channel-picker');
            modal.hidden = false;
            modal.classList.remove('is-hidden');
            modal.setAttribute('aria-hidden', 'false');
            ChannelGrid.setOnPlay(playIntoTarget);
            restoreFromState();
            applyOpacity();
            if (focusClose) {
                queueMicrotask(() => {
                    el('channel-picker-close')?.focus();
                });
            }
        }
        persistState({ open: true, targetSlotId });
        syncTargetHighlight();
        syncBrowseButtons();
    },

    /** Re-open after reload when last session left the picker docked open. */
    restoreOpenIfNeeded() {
        const saved = loadPlayerState().channelPicker;
        if (!saved?.open) {
            syncBrowseButtons();
            return;
        }
        this.open(saved.targetSlotId || 'center', { focusClose: false });
    },

    syncTargetHighlight,
    syncBrowseButtons,
    applyOpacity,

    close() {
        const modal = modalEl();
        const body = catalogBody();
        const endActions = catalogEndActions();
        if (!modal) return;

        if (this.isOpen()) persistState({ open: false });

        if (body && dockParent) {
            if (nextSibling && nextSibling.parentElement === dockParent) {
                dockParent.insertBefore(body, nextSibling);
            } else {
                dockParent.appendChild(body);
            }
        }
        dockParent = null;
        nextSibling = null;

        if (endActions && endActionsDockParent) {
            if (endActionsNextSibling && endActionsNextSibling.parentElement === endActionsDockParent) {
                endActionsDockParent.insertBefore(endActions, endActionsNextSibling);
            } else {
                endActionsDockParent.appendChild(endActions);
            }
        }
        endActionsDockParent = null;
        endActionsNextSibling = null;
        targetSlotId = null;
        clearTargetHighlight();
        MultiView.syncTileStatusHighlight?.();

        catalogRoot()?.classList.remove('is-catalog-teleported');
        document.body.classList.remove('has-channel-picker');
        modal.hidden = true;
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('is-pinned');
        ChannelGrid.setOnPlay(deps.getDefaultOnPlay());
        syncBrowseButtons();
    }
};
