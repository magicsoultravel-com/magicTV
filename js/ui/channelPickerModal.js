/** @module Channel picker — teleports the real catalog into a per-TV modal. */
import { el } from '../tvUtils.js';
import { ChannelGrid } from './channelGrid.js';
import { MultiView } from '../multiView.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';

const MIN_W = 360;
const MIN_H = 280;
const VIEW_PAD = 8;

let deps = {
    getDefaultOnPlay: () => () => {},
    leaveSettingsIfNeeded: () => {}
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

function persistGeometry() {
    const geom = readDialogGeometry();
    savePlayerState({
        channelPicker: {
            ...geom,
            pinned
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
    if (persist) persistGeometry();
}

function syncTitle() {
    const title = el('channel-picker-title');
    if (!title) return;
    title.textContent = targetSlotId === 'center'
        ? 'Pick a channel — main'
        : 'Pick a channel';
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
    persistGeometry();
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
    init({ getDefaultOnPlay, leaveSettingsIfNeeded } = {}) {
        if (typeof getDefaultOnPlay === 'function') deps.getDefaultOnPlay = getDefaultOnPlay;
        if (typeof leaveSettingsIfNeeded === 'function') deps.leaveSettingsIfNeeded = leaveSettingsIfNeeded;
        bindOnce();
    },

    isOpen() {
        const modal = modalEl();
        return !!(modal && !modal.hidden && !modal.classList.contains('is-hidden'));
    },

    isPinned() {
        return pinned;
    },

    open(slotId = 'center') {
        bindOnce();
        const modal = modalEl();
        const host = hostEl();
        const body = catalogBody();
        if (!modal || !host || !body) return;

        targetSlotId = slotId || 'center';
        deps.leaveSettingsIfNeeded();
        syncTitle();

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
            queueMicrotask(() => {
                el('channel-picker-close')?.focus();
            });
        }
    },

    close() {
        const modal = modalEl();
        const body = catalogBody();
        const endActions = catalogEndActions();
        if (!modal) return;

        if (this.isOpen()) persistGeometry();

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

        catalogRoot()?.classList.remove('is-catalog-teleported');
        document.body.classList.remove('has-channel-picker');
        modal.hidden = true;
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('is-pinned');
        ChannelGrid.setOnPlay(deps.getDefaultOnPlay());
    }
};
