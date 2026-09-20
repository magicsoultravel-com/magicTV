/**
 * Status-slot focus, screen-strip sync, and chrome retarget.
 * Methods mix into MultiView (this === MultiView).
 */
import { el } from '../tvUtils.js';
import { CORNER_IDS, SLOT_IDS, PLAY_FILL_ORDER, DRAG_THRESHOLD_PX, applySlotOutlineAttrs } from './constants.js';
import { syncScreenBtnActions } from '../ui/screenStripControls.js';

const SCREEN_ADD_ORDER = [
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'bottomCenter',
    'topCenter',
    'midLeft',
    'midRight'
];

/** Cached chrome modules so focus switches do not re-await dynamic imports. */
let _statusChromeMods = null;
let _statusChromePromise = null;
/** Cached remote module so focus can retarget synchronously after first load. */
let _remoteModuleRef = null;
let _remoteModulePromise = null;

/** @type {null | {
 *   pointerId: number,
 *   sourceSlot: string,
 *   sourceBtn: HTMLElement,
 *   ghost: HTMLElement,
 *   startX: number,
 *   startY: number,
 *   offsetX: number,
 *   offsetY: number,
 *   dragging: boolean,
 *   targetSlot: string | null
 * }} */
let _stripDrag = null;

function getScreenControlStrips() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    return Array.from(document.querySelectorAll('.tv-controls__screens'));
}

function clearStripDragTargetHighlights() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.tv-controls__screen-btn.is-strip-drop-target')
        .forEach((btn) => btn.classList.remove('is-strip-drop-target'));
}

function endStripDrag({ commit = false } = {}) {
    const session = _stripDrag;
    _stripDrag = null;
    if (!session) return;
    const { sourceBtn, ghost, sourceSlot, targetSlot, dragging } = session;
    sourceBtn?.classList.remove('is-strip-dragging');
    clearStripDragTargetHighlights();
    ghost?.remove?.();
    try {
        sourceBtn?.releasePointerCapture?.(session.pointerId);
    } catch { /* ignore */ }

    if (commit && dragging && targetSlot && targetSlot !== sourceSlot) {
        // MultiView method mixed onto `this` by the caller via bind.
        return { sourceSlot, targetSlot };
    }
    return null;
}

export const focusChromeMethods = {
    /**
     * Point channel-picker / status highlight at a mosaic slot.
     * @param {string} slotId
     */
    setStatusSlot(slotId) {
        const next = SLOT_IDS.includes(slotId) && this.slots[slotId]?.enabled
            ? slotId
            : 'center';
        const changed = this.statusSlotId !== next;
        this.statusSlotId = next;
        if (changed) {
            this.clearScreenStripHover();
            // Prefer the focused slot's own player so chrome does not briefly show another TV.
            const slotPlayer = this.slots[next]?.player;
            if (slotPlayer) slotPlayer.emitState();
            else this.getPrimary()?.emitState();
            this.syncStatusChrome();
        }
        this.syncScreenControls();
        this.syncTileStatusHighlight();
    },

    /** Refresh remote bar / panel + page header for the focused screen (no broadcast required). */
    syncStatusChrome() {
        if (typeof document === 'undefined') return;
        const safe = (fn) => {
            try { fn(); } catch { /* chrome may not be fully wired in tests / early boot */ }
        };
        const apply = (mods) => {
            // Drop late async resolves after tests tear down document (parallel suites).
            if (typeof document === 'undefined') return;
            safe(() => mods.remotePanel?.syncRemotePanel?.());
            safe(() => mods.remotePanel?.syncRemoteChannelBar?.());
            safe(() => mods.playerChrome?.PlayerChrome?.updateNowPlayingHeader?.());
            safe(() => mods.volumeDial?.syncVolumeDial?.());
            safe(() => mods.chanBindPicker?.syncBindButtons?.());
        };
        if (_statusChromeMods) {
            apply(_statusChromeMods);
            return;
        }
        if (!_statusChromePromise) {
            _statusChromePromise = Promise.all([
                import('../ui/remotePanel.js'),
                import('../ui/playerChrome.js'),
                import('../ui/volumeDial.js'),
                import('../ui/chanBindPicker.js')
            ]).then(([remotePanel, playerChrome, volumeDial, chanBindPicker]) => {
                _statusChromeMods = { remotePanel, playerChrome, volumeDial, chanBindPicker };
                return _statusChromeMods;
            });
        }
        _statusChromePromise.then(apply).catch(() => {});
    },

    /**
     * Focus the bottom Buffer/Quality readout on a specific screen.
     * @param {string} slotId
     */
    focusScreen(slotId) {
        if (!SLOT_IDS.includes(slotId)) return;
        this.setStatusSlot(slotId);
        this.raiseTileInStack(slotId);
        if (this.hasCustomPlacement()) {
            this.persistPlacement();
        }
        this.maybeRetargetChannelPicker(slotId);
    },

    /**
     * Add the next screen in the fixed order (honors Max TVs setting).
     */
    addNextScreen() {
        const max = this.getMaxMosaicSlots?.() ?? PLAY_FILL_ORDER.length;
        const enabledCount = PLAY_FILL_ORDER.filter((id) => this.slots[id]?.enabled).length;
        if (enabledCount >= max) return;
        const next = SCREEN_ADD_ORDER.find((id) => !this.slots[id].enabled);
        if (!next) return;
        this.setSideEnabled(next, true);
        this.focusScreen(next);
    },

    /**
     * Remove a specific corner screen from the bottom bar strip.
     * @param {string} slotId
     */
    removeScreen(slotId) {
        if (!CORNER_IDS.includes(slotId) || !this.slots[slotId]?.enabled) return;
        if (this.statusSlotId === slotId) this.setStatusSlot('center');
        this.setSideEnabled(slotId, false);
    },

    /**
     * Sync the bottom screen-switcher strip with the current slot state.
     */
    syncScreenControls() {
        if (typeof document === 'undefined') return;
        const strips = getScreenControlStrips();
        if (!strips.length) return;
        const expanded = this.screensStripExpanded === true;
        const enabledCount = PLAY_FILL_ORDER.filter((id) => this.slots[id]?.enabled).length;
        const max = this.getMaxMosaicSlots?.() ?? PLAY_FILL_ORDER.length;
        strips.forEach((strip) => {
            const section = strip.closest('.remote-panel__footer-screens');
            if (section) {
                section.classList.toggle('is-screens-expanded', expanded);
                section.dataset.screenCount = String(enabledCount);
                const expandBtn = section.querySelector('.tv-controls__screens-expand');
                if (expandBtn) {
                    expandBtn.setAttribute('aria-expanded', String(expanded));
                    const label = expanded ? 'Collapse multi-TV strip' : 'Expand multi-TV strip';
                    expandBtn.title = label;
                    expandBtn.setAttribute('aria-label', label);
                }
            }
            const buttons = strip.querySelectorAll('.tv-controls__screen-btn');
            const addBtn = strip.querySelector('.tv-controls__add-screen-btn, #add-screen-btn');
            buttons.forEach((btn) => {
                const slotId = btn.dataset.screenSlot;
                const enabled = slotId === 'center' || this.slots[slotId]?.enabled;
                btn.hidden = !enabled;
                btn.classList.toggle('is-active', enabled && this.statusSlotId === slotId);
                if (enabled && slotId) {
                    applySlotOutlineAttrs(btn, slotId);
                    const player = this.slots[slotId]?.player;
                    const intentPlaying = player?.wantPlaying === true || player?.playing === true;
                    const isMuted = player ? !this.isSlotAudible(player) : true;
                    syncScreenBtnActions(btn, player, { intentPlaying, isMuted });
                    this.syncScreenBtnPreview(btn, player, expanded);
                } else {
                    this.syncScreenBtnPreview(btn, null, false);
                }
            });
            if (addBtn) {
                const atMax = enabledCount >= max
                    || SCREEN_ADD_ORDER.every((id) => this.slots[id].enabled);
                addBtn.hidden = atMax;
                addBtn.classList.toggle('is-limit', atMax);
                addBtn.title = 'Add screen';
                addBtn.setAttribute('aria-label', 'Add screen');
            }
        });
        this.syncTileStatusHighlight();
    },

    /**
     * Paint channel name + freeze-frame on an expanded screen-strip tile.
     * @param {HTMLElement} btn
     * @param {object|null} player
     * @param {boolean} expanded
     */
    syncScreenBtnPreview(btn, player, expanded) {
        if (!btn) return;
        const nameEl = btn.querySelector('.tv-controls__screen-name');
        const frameEl = btn.querySelector('.tv-controls__screen-frame');
        const name = expanded ? (player?.channel?.name || '').trim() : '';
        if (nameEl) {
            nameEl.textContent = name;
            if (name) nameEl.removeAttribute('hidden');
            else nameEl.setAttribute('hidden', '');
        }
        if (frameEl) {
            const poster = expanded ? (player?.posterDataUrl || '') : '';
            if (poster) {
                if (frameEl.dataset.frameSrc !== poster) {
                    frameEl.dataset.frameSrc = poster;
                    frameEl.style.backgroundImage = `url("${poster.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
                }
                frameEl.classList.add('has-frame');
            } else {
                if (frameEl.dataset.frameSrc) delete frameEl.dataset.frameSrc;
                frameEl.style.backgroundImage = '';
                frameEl.classList.remove('has-frame');
            }
        }
    },

    setScreensStripExpanded(expanded) {
        this.screensStripExpanded = expanded === true;
        this.syncScreenControls();
    },

    toggleScreensStripExpanded() {
        this.setScreensStripExpanded(!this.screensStripExpanded);
    },

    /**
     * Keep the selected mosaic tile highlighted with the channel-picker target style.
     * Single owner for `is-channel-picker-target` (remote open or closed).
     */
    syncTileStatusHighlight() {
        if (typeof document === 'undefined') return;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const active = Boolean(this.slots[id]?.enabled && this.statusSlotId === id)
                && !tile.classList.contains('is-hidden');
            tile.classList.toggle('is-channel-picker-target', active);
        });
    },

    /** Highlight the mosaic tile matching a hovered screen-strip button. */
    setScreenStripHover(slotId) {
        if (!SLOT_IDS.includes(slotId)) return;
        if (slotId !== 'center' && !this.slots[slotId]?.enabled) return;
        if (this.screenStripHoverSlotId === slotId) return;
        this.screenStripHoverSlotId = slotId;
        this.syncScreenStripTileHighlight();
    },

    clearScreenStripHover() {
        if (!this.screenStripHoverSlotId) return;
        this.screenStripHoverSlotId = null;
        this.syncScreenStripTileHighlight();
    },

    syncScreenStripTileHighlight() {
        if (typeof document === 'undefined') return;
        const hoverId = this.screenStripHoverSlotId;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const hovered = hoverId === id
                && (id === 'center' || this.slots[id]?.enabled)
                && !tile.classList.contains('is-hidden');
            tile.classList.toggle('is-screen-strip-hover', hovered);
        });
    },

    maybeRetargetChannelPicker(slotId) {
        if (!slotId || !this.slots[slotId]?.enabled) return;
        this.setStatusSlot(slotId);
        const apply = (RemoteModule) => {
            if (typeof document === 'undefined') return;
            // Drop stale async results if the user already focused elsewhere.
            if (this.statusSlotId !== slotId) return;
            if (!RemoteModule.isOpen()) return;
            RemoteModule.retarget(slotId);
        };
        if (_remoteModuleRef) {
            apply(_remoteModuleRef);
            return;
        }
        if (!_remoteModulePromise) {
            _remoteModulePromise = import('../ui/remoteModule.js')
                .then((m) => {
                    _remoteModuleRef = m.RemoteModule;
                    return _remoteModuleRef;
                });
        }
        _remoteModulePromise.then(apply).catch(() => {});
    },

    /**
     * Begin / update / finish screen-strip drag-to-swap.
     * @param {PointerEvent} e
     */
    onScreenStripPointerDown(e) {
        if (e.button != null && e.button !== 0) return;
        const btn = e.target.closest?.('.tv-controls__screen-btn');
        if (!btn || btn.hidden || !btn.closest('.tv-controls__screens')) return;
        if (e.target.closest?.('.tv-controls__screen-remove, [data-screen-action]')) return;
        const slotId = btn.dataset.screenSlot;
        if (!slotId || !SLOT_IDS.includes(slotId)) return;
        if (slotId !== 'center' && !this.slots[slotId]?.enabled) return;

        const rect = btn.getBoundingClientRect();
        _stripDrag = {
            pointerId: e.pointerId,
            sourceSlot: slotId,
            sourceBtn: btn,
            ghost: null,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            dragging: false,
            targetSlot: null
        };
        try {
            btn.setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
    },

    onScreenStripPointerMove(e) {
        const session = _stripDrag;
        if (!session || e.pointerId !== session.pointerId) return;
        const dx = e.clientX - session.startX;
        const dy = e.clientY - session.startY;
        if (!session.dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            session.dragging = true;
            session.sourceBtn.classList.add('is-strip-dragging');
            const ghost = session.sourceBtn.cloneNode(true);
            ghost.classList.add('tv-controls__screen-btn--ghost');
            ghost.removeAttribute('data-screen-slot');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.style.width = `${session.sourceBtn.offsetWidth}px`;
            ghost.style.height = `${session.sourceBtn.offsetHeight}px`;
            document.body.appendChild(ghost);
            session.ghost = ghost;
            this.clearScreenStripHover();
        }
        if (session.ghost) {
            session.ghost.style.transform =
                `translate(${e.clientX - session.offsetX}px, ${e.clientY - session.offsetY}px)`;
        }

        clearStripDragTargetHighlights();
        session.targetSlot = null;
        const elUnder = document.elementFromPoint(e.clientX, e.clientY);
        const targetBtn = elUnder?.closest?.('.tv-controls__screen-btn');
        if (targetBtn && !targetBtn.hidden && targetBtn !== session.sourceBtn
            && targetBtn.closest('.tv-controls__screens')) {
            const targetSlot = targetBtn.dataset.screenSlot;
            if (targetSlot && SLOT_IDS.includes(targetSlot)
                && (targetSlot === 'center' || this.slots[targetSlot]?.enabled)
                && targetSlot !== session.sourceSlot) {
                targetBtn.classList.add('is-strip-drop-target');
                session.targetSlot = targetSlot;
                this.setScreenStripHover(targetSlot);
            }
        }
    },

    async onScreenStripPointerUp(e) {
        const session = _stripDrag;
        if (!session || e.pointerId !== session.pointerId) return;
        const wasDragging = session.dragging;
        const sourceSlot = session.sourceSlot;
        const swap = endStripDrag({ commit: true });
        this.clearScreenStripHover();
        if (swap) {
            await this.swapSlotChannels?.(swap.sourceSlot, swap.targetSlot);
            return;
        }
        if (!wasDragging && sourceSlot) {
            this.focusScreen(sourceSlot);
        }
    },

    onScreenStripPointerCancel(e) {
        const session = _stripDrag;
        if (!session || (e.pointerId != null && e.pointerId !== session.pointerId)) return;
        endStripDrag({ commit: false });
        this.clearScreenStripHover();
    },

    bindScreenControls() {
        if (typeof document === 'undefined') return;
        if (document.body?.dataset?.screenControlsBound === '1') return;
        document.body.dataset.screenControlsBound = '1';

        document.body.addEventListener('click', (e) => {
            // Strip focus is handled on pointerup when the gesture was a click (not a drag).
            if (e.target.closest?.('.tv-controls__screen-btn')
                && !e.target.closest?.('.tv-controls__screen-remove, [data-screen-action], .tv-controls__add-screen-btn, .tv-controls__screens-expand')) {
                // Prevent duplicate focus from click after pointerup already focused.
                if (e.target.closest?.('.tv-controls__screens')) {
                    const removeOrAction = e.target.closest?.('.tv-controls__screen-remove, [data-screen-action]');
                    if (!removeOrAction) {
                        e.stopPropagation();
                        e.preventDefault();
                        // focus already done on pointerup for non-drag
                        return;
                    }
                }
            }

            const expandBtn = e.target.closest?.('.tv-controls__screens-expand');
            if (expandBtn) {
                e.stopPropagation();
                e.preventDefault();
                this.toggleScreensStripExpanded();
                return;
            }

            const strip = e.target.closest('.tv-controls__screens');
            if (!strip) return;

            const addBtn = e.target.closest('.tv-controls__add-screen-btn, #add-screen-btn');
            if (addBtn && strip.contains(addBtn)) {
                e.stopPropagation();
                e.preventDefault();
                this.addNextScreen();
                return;
            }
            const removeBtn = e.target.closest('.tv-controls__screen-remove');
            if (removeBtn && strip.contains(removeBtn)) {
                e.stopPropagation();
                e.preventDefault();
                const slotId = removeBtn.closest('.tv-controls__screen-btn')?.dataset.screenSlot;
                if (slotId) this.removeScreen(slotId);
                return;
            }
            const actionBtn = e.target.closest('[data-screen-action]');
            if (actionBtn && strip.contains(actionBtn)) {
                e.stopPropagation();
                e.preventDefault();
                const slotId = actionBtn.closest('.tv-controls__screen-btn')?.dataset.screenSlot;
                const action = actionBtn.dataset.screenAction;
                if (slotId && action) {
                    this.handleTileAction(slotId, action).then(() => {
                        this.syncScreenControls();
                        import('../ui/remotePanel.js')
                            .then(({ syncRemotePanel }) => syncRemotePanel())
                            .catch(() => {});
                    }).catch(() => {});
                }
            }
        });

        document.body.addEventListener('pointerdown', (e) => {
            if (!e.target.closest?.('.tv-controls__screens')) return;
            this.onScreenStripPointerDown(e);
        });
        document.body.addEventListener('pointermove', (e) => this.onScreenStripPointerMove(e));
        document.body.addEventListener('pointerup', (e) => {
            this.onScreenStripPointerUp(e).catch(() => {});
        });
        document.body.addEventListener('pointercancel', (e) => this.onScreenStripPointerCancel(e));
        document.body.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !_stripDrag) return;
            endStripDrag({ commit: false });
            this.clearScreenStripHover();
        });

        document.body.addEventListener('mouseover', (e) => {
            if (_stripDrag?.dragging) return;
            const btn = e.target.closest?.('.tv-controls__screen-btn');
            if (!btn || btn.hidden || !btn.closest('.tv-controls__screens')) return;
            if (btn.contains(e.relatedTarget)) return;
            const slotId = btn.dataset.screenSlot;
            if (slotId) this.setScreenStripHover(slotId);
        });

        document.body.addEventListener('mouseout', (e) => {
            if (_stripDrag?.dragging) return;
            const btn = e.target.closest?.('.tv-controls__screen-btn');
            if (!btn || btn.hidden) return;
            if (btn.contains(e.relatedTarget)) return;
            if (e.relatedTarget?.closest?.('.tv-controls__screen-btn')) return;
            this.clearScreenStripHover();
        });

        this.syncScreenControls();
    }
};
