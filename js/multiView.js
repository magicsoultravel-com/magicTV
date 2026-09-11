import { createPlayerInstance } from './player/playerInstance.js';
import {
    loadPlayerState,
    savePlayerState,
    DEFAULT_BUFFER_SIZE,
    MAX_BUFFER_SIZE,
    MIN_BUFFER_SIZE
} from './storage/playerState.js';
import { SettingsStore } from './storage/settingsStore.js';
import { showAppToast } from './ui/toast.js';
import { el } from './tvUtils.js';
import {
    fillViewTransitionSelect,
    VIEW_TRANSITION_LABELS
} from './ui/viewTransitions.js';
import { reportSlotLoading } from './player/loadBudget.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    MAX_MOSAIC_SLOTS,
    clearTilePlacementStyle,
    SLOT_SCREEN_LABELS
} from './mosaic/constants.js';
import { freeLayoutMethods } from './mosaic/freeLayout.js';
import { swapMethods } from './mosaic/swap.js';
import { rotateMethods } from './mosaic/rotate.js';
import { persistMethods } from './mosaic/persist.js';
import { focusChromeMethods } from './mosaic/focusChrome.js';
import { playbackMethods } from './mosaic/playback.js';
import { tileChromeMethods } from './mosaic/tileChrome.js';
import { resolveMosaicGridTemplate } from './mosaic/gridLayout.js';
import { hydrateTileHoverControls, syncTileRockers } from './ui/tileHoverControls.js';
import { ChanBindPicker } from './ui/chanBindPicker.js';
import { ChromecastManager } from './cast/chromecastManager.js';
import { registerMosaicSlotState } from './mosaic/slotOccupancy.js';

export { MAX_MOSAIC_SLOTS, SLOT_SCREEN_LABELS };

const SCREEN_GETTERS = {
    topLeft: () => SettingsStore.getScreenTopLeft(),
    topRight: () => SettingsStore.getScreenTopRight(),
    bottomLeft: () => SettingsStore.getScreenBottomLeft(),
    bottomRight: () => SettingsStore.getScreenBottomRight(),
    bottomCenter: () => SettingsStore.getScreenBottomCenter()
};

const SCREEN_SETTERS = {
    topLeft: (v) => SettingsStore.setScreenTopLeft(v),
    topRight: (v) => SettingsStore.setScreenTopRight(v),
    bottomLeft: (v) => SettingsStore.setScreenBottomLeft(v),
    bottomRight: (v) => SettingsStore.setScreenBottomRight(v),
    bottomCenter: (v) => SettingsStore.setScreenBottomCenter(v)
};

function savedVolume() {
    return loadPlayerState().volume || 0.85;
}

export const MultiView = {
    ...persistMethods,
    ...freeLayoutMethods,
    ...swapMethods,
    ...rotateMethods,
    ...focusChromeMethods,
    ...playbackMethods,
    ...tileChromeMethods,

    initialized: false,
    sharedVolume: savedVolume(),
    lastVolume: savedVolume() || 0.85,
    /** @type {Record<string, { id: string, enabled: boolean, player: ReturnType<typeof createPlayerInstance> | null }>} */
    slots: {
        topLeft: { id: 'topLeft', enabled: false, player: null },
        center: { id: 'center', enabled: true, player: null },
        topRight: { id: 'topRight', enabled: false, player: null },
        bottomLeft: { id: 'bottomLeft', enabled: false, player: null },
        bottomRight: { id: 'bottomRight', enabled: false, player: null },
        bottomCenter: { id: 'bottomCenter', enabled: false, player: null }
    },
    pipWatchers: new WeakSet(),

    swapBusy: false,
    /** False until restoreSlots finishes (or boot finds nothing to restore). */
    slotsHydrated: false,
    /** Channel keys remembered from mosaicSlots — used to hide “Pick a channel” before HLS. */
    rememberedSlotKeys: /** @type {Record<string, string>} */ ({}),

    /** @type {Record<string, { x: number, y: number, w: number, h: number, z: number }>} */
    mosaicPlacement: {},
    placementZTop: 1,
    dragSession: null,
    _resizeBound: false,
    _hoverBound: false,
    _refreshTilesRaf: 0,
    /** Slot used for channel-picker targeting / status highlight (last focused screen). */
    statusSlotId: 'center',
    /** Mosaic tile hovered from a bottom screen strip (remote / browser). */
    screenStripHoverSlotId: null,
    /** Bottom multi-TV strip enlarged to show channel title + frame. */
    screensStripExpanded: false,

    getPrimary() {
        return this.slots.center.player;
    },

    /**
     * Resolve the player for a mosaic slot (center falls back to primary).
     * @param {string} slotId
     */
    getPlayerForSlot(slotId) {
        const id = slotId || 'center';
        const slot = SLOT_IDS.includes(id) ? this.slots[id] : null;
        return slot?.player || (id === 'center' ? this.getPrimary() : null);
    },

    getStatusPlayer() {
        const id = this.statusSlotId;
        const slot = SLOT_IDS.includes(id) ? this.slots[id] : null;
        if (slot?.enabled && slot.player) return slot.player;
        return this.getPrimary();
    },

    getSharedVolume() {
        return this.sharedVolume;
    },

    getLastVolume() {
        return this.lastVolume;
    },

    init() {
        if (this.initialized) return;
        this.initialized = true;

        registerMosaicSlotState(() => ({
            slots: this.slots,
            rememberedSlotKeys: this.rememberedSlotKeys,
            getPrimary: () => this.getPrimary()
        }));

        this.ensurePlayer('center', { startMuted: true });
        CORNER_IDS.forEach((id) => {
            this.setSideEnabled(id, SCREEN_GETTERS[id](), { silent: true });
        });

        const saved = loadPlayerState().mosaicPlacement || {};
        this.mosaicPlacement = this.sanitizePlacementMap(saved);
        this.placementZTop = Object.values(this.mosaicPlacement)
            .reduce((max, p) => Math.max(max, p?.z || 1), 1);
        this.ensureCenterOnTop();

        hydrateTileHoverControls();
        syncTileRockers();
        ChanBindPicker.wireTileBindMenus();
        this.syncLayout();
        this.mountAll();
        this.bindUi();
        ChromecastManager.init(this).catch(() => {});
        window.addEventListener('tv:cast_state_changed', () => this.scheduleRefreshTiles());
        window.addEventListener('tv:cast_host_toggled', () => this.scheduleRefreshTiles());
        this.bindPlacementChrome();
        // Stubs only — full stream restore is hydrateMosaicFromSaved() from app.js.
        if (!this._deferFullRestore) {
            this.applySavedSlotStubs();
            this.slotsHydrated = true;
        }

        if (this.hasCustomPlacement() && !this.isPlacementSane()) {
            this.mosaicPlacement = {};
            this.placementZTop = 1;
            this.clearFreeLayoutStyles();
            this.persistPlacement();
            this.syncLayout();
        } else if (Object.keys(saved).length !== Object.keys(this.mosaicPlacement).length) {
            // Persist scrubbing of disabled-slot entries.
            this.persistPlacement();
        }

        this.syncPlacementChrome();
        if (this.hasCustomPlacement()) {
            requestAnimationFrame(() => this.applyFreeLayout());
        }
        this.ensureLayoutModeOnInit();
        window.addEventListener('tv:popout_changed', () => this.scheduleRefreshTiles());

        if (!this._deferFullRestore) {
            this.syncScreenControls();
        }
    },

    /**
     * Boot hook: restore saved mosaic slots as stopped players (no stream
     * attach — ▶ starts a fresh live attach on user play).
     * @returns {Promise<boolean>}
     */
    async hydrateMosaicFromSaved() {
        this._deferFullRestore = true;
        if (!this.initialized) this.init();
        const restored = await this.restoreSlots();
        if (!restored) {
            this.applySavedSlotStubs();
            this.slotsHydrated = true;
        }
        this.syncScreenControls();
        return restored;
    },

    ensurePlayer(slotId, { startMuted = true } = {}) {
        const slot = this.slots[slotId];
        if (!slot) return null;
        if (slot.player) return slot.player;

        const player = createPlayerInstance({
            id: slotId,
            startMuted,
            getSharedVolume: () => this.sharedVolume,
            getLastVolume: () => this.lastVolume,
            onSharedVolumeChange: (volume, lastVolume) => {
                this.sharedVolume = volume;
                this.lastVolume = lastVolume;
                savePlayerState({ volume });
                this.applyVolumeToAll();
            },
            shouldBroadcast: () => {
                // Status screen drives header/remote chrome; center also broadcasts so
                // primary HLS ticks keep mosaic buffer overlays fresh when another TV is focused.
                return player === this.getStatusPlayer() || player === this.slots.center.player;
            },
            onState: (player) => {
                reportSlotLoading(
                    player?.id,
                    player?.loading === true
                    || player?.loadPhase === 'connecting'
                    || player?.loadPhase === 'buffering'
                );
                this.scheduleRefreshTiles();
                this.noteSlotPlayingForTiles(player);
            },
            shouldRecordRecents: () => true
        });
        player.init();
        slot.player = player;
        this.watchPip(player.video);
        return player;
    },

    watchPip(video) {
        if (!video || this.pipWatchers.has(video)) return;
        this.pipWatchers.add(video);
        video.addEventListener('enterpictureinpicture', () => {
            window.dispatchEvent(new CustomEvent('tv:pip_changed'));
            this.scheduleRefreshTiles();
        });
        video.addEventListener('leavepictureinpicture', () => {
            window.dispatchEvent(new CustomEvent('tv:pip_changed'));
            this.getPrimary()?.emitState();
            this.scheduleRefreshTiles();
        });
    },

    bindUi() {
        const mosaic = el('player-mosaic');
        if (!mosaic || mosaic.dataset.bound === '1') return;
        mosaic.dataset.bound = '1';

        mosaic.addEventListener('pointerdown', (e) => this.onTilePointerDown(e));

        mosaic.addEventListener('click', (e) => {
            const castToggle = e.target.closest?.('[data-cast-toggle]');
            if (castToggle) {
                e.stopPropagation();
                e.preventDefault();
                const kind = castToggle.getAttribute('data-cast-toggle');
                if (kind === 'host-video') ChromecastManager.toggleHostVideo();
                this.scheduleRefreshTiles();
                return;
            }

            const actionBtn = e.target.closest?.('[data-tile-action]');
            if (actionBtn) {
                e.stopPropagation();
                e.preventDefault();
                const tile = actionBtn.closest?.('.tv-player-tile');
                const slotId = tile?.getAttribute('data-slot');
                const action = actionBtn.getAttribute('data-tile-action');
                const target = actionBtn.getAttribute('data-controls-target') || 'local';
                if (slotId && action) this.handleTileAction(slotId, action, { target, triggerEl: actionBtn });
                return;
            }
            // Tile focus (z-raise / pinned picker retarget) is handled on pointerup when the gesture was a click.
        });

        mosaic.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest?.('[data-tile-action]')) return;
            if (e.target.closest?.('[data-tile-chan-bind-btn]')) return;
            const tile = e.target.closest?.('.tv-player-tile');
            if (!tile) return;
            e.preventDefault();
            const slotId = tile.getAttribute('data-slot');
            if (!slotId || !this.slots[slotId]?.enabled) return;
            if (this.hasCustomPlacement()) {
                this.raiseTileInStack(slotId);
                this.persistPlacement();
            }
            this.maybeRetargetChannelPicker(slotId);
        });

        if (!this._resizeBound) {
            this._resizeBound = true;
            let resizeTimer = 0;
            window.addEventListener('resize', () => {
                window.clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(() => {
                    if (this.hasCustomPlacement()) this.applyFreeLayout();
                }, 80);
            });

            const observeTarget = typeof document !== 'undefined' ? document.body : null;
            if (observeTarget && typeof MutationObserver === 'function') {
                const obs = new MutationObserver(() => {
                    if (this.hasCustomPlacement()) {
                        requestAnimationFrame(() => this.applyFreeLayout());
                    }
                });
                obs.observe(observeTarget, { attributes: true, attributeFilter: ['class'] });
            }
        }
    },

    bindPlacementChrome() {
        if (this._hoverBound || typeof document === 'undefined') return;
        this._hoverBound = true;

        if (!this._fullscreenSyncBound) {
            this._fullscreenSyncBound = true;
            const syncFullscreenActive = () => {
                const active = !!document.fullscreenElement;
                document.querySelectorAll('[data-tile-action="fullscreen"]').forEach((btn) => {
                    btn.classList.toggle('is-active', active);
                    btn.setAttribute('aria-pressed', String(active));
                });
            };
            document.addEventListener('fullscreenchange', syncFullscreenActive);
            syncFullscreenActive();
        }

        this.syncMosaicChrome();
    },

    syncLayout() {
        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        const grid = resolveMosaicGridTemplate({
            freeLayout: this.hasCustomPlacement(),
            topLeft: this.slots.topLeft.enabled,
            topRight: this.slots.topRight.enabled,
            bottomLeft: this.slots.bottomLeft.enabled,
            bottomRight: this.slots.bottomRight.enabled,
            bottomCenter: this.slots.bottomCenter.enabled
        });

        mosaic.classList.toggle('has-left', grid.hasLeft);
        mosaic.classList.toggle('has-right', grid.hasRight);
        mosaic.classList.toggle('has-top-left', this.slots.topLeft.enabled);
        mosaic.classList.toggle('has-top-right', this.slots.topRight.enabled);
        mosaic.classList.toggle('has-bottom-left', this.slots.bottomLeft.enabled);
        mosaic.classList.toggle('has-bottom-right', this.slots.bottomRight.enabled);
        mosaic.classList.toggle('has-bottom-center', this.slots.bottomCenter.enabled);
        mosaic.classList.toggle('has-corners', grid.hasAnyCorner);

        mosaic.style.gridTemplateAreas = grid.areas;
        mosaic.style.gridTemplateColumns = grid.columns;
        mosaic.style.gridTemplateRows = grid.rows;

        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const enabled = this.slots[id].enabled;
            tile.classList.toggle('is-hidden', !enabled);
            tile.classList.toggle('is-primary', id === 'center');
            tile.setAttribute('aria-hidden', enabled ? 'false' : 'true');
            if (!enabled) {
                clearTilePlacementStyle(tile);
                delete this.mosaicPlacement[id];
            }
        });

        if (this.hasCustomPlacement()) {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => this.applyFreeLayout());
            } else {
                this.applyFreeLayout();
            }
        } else {
            this.clearFreeLayoutStyles();
        }
        this.syncPlacementChrome();
        this.syncTileStatusHighlight();
        if (typeof document === 'undefined') return;
        import('./ui/remoteModule.js')
            .then(({ RemoteModule }) => {
                if (typeof document === 'undefined') return;
                try {
                    RemoteModule.syncTargetHighlight?.();
                } catch { /* ignore */ }
                import('./ui/remotePanel.js').then(({ RemotePanel }) => {
                    if (typeof document === 'undefined') return;
                    try { RemotePanel.syncRemotePanel?.(); } catch { /* ignore */ }
                }).catch(() => {});
            })
            .catch(() => {});
    },

    mountAll() {
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot.enabled || !slot.player) return;
            const surface = el(`tv-playback-surface-${id}`);
            if (surface) slot.player.mountVideo(surface);
        });
    },

    setSideEnabled(sideId, enabled, { silent = false } = {}) {
        if (!CORNER_IDS.includes(sideId)) return;
        const slot = this.slots[sideId];
        const next = Boolean(enabled);
        if (slot.enabled === next && slot.player) {
            this.syncLayout();
            this.mountAll();
            this.scheduleRefreshTiles();
            return;
        }

        slot.enabled = next;
        if (next) {
            this.ensurePlayer(sideId, { startMuted: true });
            slot.player.muted = true;
            slot.player.applyAudioToVideo();
            if (this.hasCustomPlacement() && !this.mosaicPlacement[sideId]) {
                if (!this.isGridLayoutMode?.()) {
                    this.mosaicPlacement[sideId] = {
                        x: 0.04,
                        y: 0.04,
                        w: 0.28,
                        h: 0.32,
                        z: 1
                    };
                    this.raiseTileInStack(sideId);
                    this.persistPlacement();
                }
            }
        } else {
            if (slot.player) {
                slot.player.stop({ clearChannel: true }).catch(() => {});
                if (this.mosaicPlacement[sideId]) {
                    delete this.mosaicPlacement[sideId];
                    this.persistPlacement();
                }
            }
            delete this.rememberedSlotKeys[sideId];
            if (this.statusSlotId === sideId) this.setStatusSlot('center');
        }

        SCREEN_SETTERS[sideId]?.(next);

        this.syncLayout();
        if (next && this.isGridLayoutMode?.() && !silent) {
            const mosaic = el('player-mosaic');
            if (mosaic?.classList?.add) {
                this.applyGridLayoutPreset();
            }
        }
        this.mountAll();
        this.scheduleRefreshTiles();
        if (!next) {
            import('./ui/remoteModule.js')
                .then(({ RemoteModule }) => RemoteModule.reconcileTargetIfDisabled?.())
                .catch(() => {});
        }
        if (!silent) {
            this.syncSettingsToggles();
            this.getPrimary()?.emitState();
            // Never persist during silent boot enable — that would wipe saved
            // mosaic channels before restoreSlots() runs.
            this.persistSlots();
        }
    },

    setSharedVolume(value) {
        const clamped = Math.min(1, Math.max(0, value));
        this.sharedVolume = clamped;
        if (clamped > 0) this.lastVolume = clamped;
        savePlayerState({ volume: clamped });
        const primary = this.getPrimary();
        if (primary && clamped > 0) {
            primary.muted = false;
        } else if (primary && clamped === 0) {
            primary.muted = true;
        }
        this.applyVolumeToAll();
        primary?.emitState();
        return clamped;
    },

    /** Per-TV gain 0..1 (heard = master × slot). */
    setSlotVolume(slotId, value) {
        const player = this.slots[slotId]?.player;
        if (!player?.setVolume) return 0;
        const clamped = player.setVolume(value);
        this.persistSlots();
        this.scheduleRefreshTiles();
        return clamped;
    },

    applyVolumeToAll() {
        SLOT_IDS.forEach((id) => {
            this.slots[id].player?.applyAudioToVideo();
        });
    },

    setBufferSize(size) {
        const clamped = Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, size));
        savePlayerState({ bufferSize: clamped });
        SLOT_IDS.forEach((id) => {
            const player = this.slots[id].player;
            if (player) player.setBufferSize(clamped);
        });
        this.getPrimary()?.emitState();
        return clamped;
    },

    getBufferSize() {
        return loadPlayerState().bufferSize || DEFAULT_BUFFER_SIZE;
    },

    syncSettingsToggles() {
        if (typeof document === 'undefined') return;
        const modeSelect = el('chan-switch-mode-select');
        if (modeSelect) {
            modeSelect.value = SettingsStore.getChanSwitchMode();
        }
        const swapSelect = el('swap-transition-select');
        if (swapSelect) {
            fillViewTransitionSelect(swapSelect, SettingsStore.getSwapTransition());
        }
        const shutdownSelect = el('shutdown-transition-select');
        if (shutdownSelect) {
            fillViewTransitionSelect(shutdownSelect, SettingsStore.getShutdownTransition());
        }
        this.syncScreenControls();
    },

    bindSettings() {
        if (typeof document === 'undefined') return;
        const CHAN_SWITCH_MODE_LABELS = {
            classic: 'Classic',
            safeLoading: 'Safe Loading'
        };
        const modeSelect = el('chan-switch-mode-select');
        if (modeSelect && modeSelect.dataset.bound !== '1') {
            modeSelect.dataset.bound = '1';
            modeSelect.value = SettingsStore.getChanSwitchMode();
            modeSelect.addEventListener('change', () => {
                const next = SettingsStore.setChanSwitchMode(modeSelect.value);
                modeSelect.value = next;
                const label = CHAN_SWITCH_MODE_LABELS[next] || next;
                showAppToast(`Chan switch mode: ${label}`);
            });
        }
        const swapSelect = el('swap-transition-select');
        if (swapSelect && swapSelect.dataset.bound !== '1') {
            swapSelect.dataset.bound = '1';
            fillViewTransitionSelect(swapSelect, SettingsStore.getSwapTransition());
            swapSelect.addEventListener('change', () => {
                const next = SettingsStore.setSwapTransition(swapSelect.value);
                swapSelect.value = next;
                const label = VIEW_TRANSITION_LABELS[next] || next;
                showAppToast(`Channel switch: ${label}`);
            });
        }
        const shutdownSelect = el('shutdown-transition-select');
        if (shutdownSelect && shutdownSelect.dataset.bound !== '1') {
            shutdownSelect.dataset.bound = '1';
            fillViewTransitionSelect(shutdownSelect, SettingsStore.getShutdownTransition());
            shutdownSelect.addEventListener('change', () => {
                const next = SettingsStore.setShutdownTransition(shutdownSelect.value);
                shutdownSelect.value = next;
                const label = VIEW_TRANSITION_LABELS[next] || next;
                showAppToast(`Shutdown: ${label}`);
            });
        }
        this.syncSettingsToggles();
        this.bindScreenControls();
    }
};
