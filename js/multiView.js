import { createPlayerInstance } from './player/playerInstance.js';
import {
    loadPlayerState,
    savePlayerState,
    DEFAULT_BUFFER_SIZE,
    MAX_BUFFER_SIZE,
    MIN_BUFFER_SIZE,
    DEFAULT_REATTEMPT_INTERVAL,
    DEFAULT_REATTEMPTS,
    clampReattemptInterval,
    clampReattempts
} from './storage/playerState.js';
import { SettingsStore } from './storage/settingsStore.js';
import { showAppToast } from './ui/toast.js';
import { el } from './tvUtils.js';
import {
    fillViewTransitionSelect,
    VIEW_TRANSITION_LABELS
} from './ui/viewTransitions.js';
import {
    reportSlotPressure,
    getSlotPressureReason,
    shouldYieldHealthy,
    resolveYieldState,
    computeYieldLevelCap,
    setHealBudgetContext,
    YIELD_HOLD_MS,
    YIELD_MIN_HEIGHT,
    YIELD_BUFFER_LENGTH
} from './player/loadBudget.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    MAX_MOSAIC_SLOTS,
    PLAY_FILL_ORDER,
    clearTilePlacementStyle,
    SLOT_SCREEN_LABELS,
    applySlotOutlineAttrs
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
    bottomCenter: () => SettingsStore.getScreenBottomCenter(),
    topCenter: () => SettingsStore.getScreenTopCenter(),
    midLeft: () => SettingsStore.getScreenMidLeft(),
    midRight: () => SettingsStore.getScreenMidRight()
};

const SCREEN_SETTERS = {
    topLeft: (v) => SettingsStore.setScreenTopLeft(v),
    topRight: (v) => SettingsStore.setScreenTopRight(v),
    bottomLeft: (v) => SettingsStore.setScreenBottomLeft(v),
    bottomRight: (v) => SettingsStore.setScreenBottomRight(v),
    bottomCenter: (v) => SettingsStore.setScreenBottomCenter(v),
    topCenter: (v) => SettingsStore.setScreenTopCenter(v),
    midLeft: (v) => SettingsStore.setScreenMidLeft(v),
    midRight: (v) => SettingsStore.setScreenMidRight(v)
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
        bottomCenter: { id: 'bottomCenter', enabled: false, player: null },
        topCenter: { id: 'topCenter', enabled: false, player: null },
        midLeft: { id: 'midLeft', enabled: false, player: null },
        midRight: { id: 'midRight', enabled: false, player: null }
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

    /**
     * Sibling soft-yield latch (MultiView is the sole applicator — not per-slot).
     * Enter immediately when shouldYieldHealthy; exit only after YIELD_HOLD_MS.
     */
    _siblingYieldActive: false,
    _lastYieldWorthyAt: 0,
    _yieldHoldTimer: 0,

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
        this.enforceMaxMosaicSlots({ silent: true });

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
        window.addEventListener('tv:mosaic_watch_chrome_changed', () => {
            this.ensureWatchChromeTick();
            this.updateWatchChromeOnly();
        });
        this.ensureWatchChromeTick();
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
                reportSlotPressure(player?.id, this.deriveSlotPressureReason(player));
                this.syncSiblingYield();
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

    /**
     * Pressure reason for loadBudget / sibling yield. Null clears constraint.
     * @param {ReturnType<typeof createPlayerInstance> | null | undefined} player
     * @returns {string|null}
     */
    deriveSlotPressureReason(player) {
        if (!player) return null;
        if (player.healing === true) return 'healing';
        if (player.preparing === true || player._preparePromise != null) return 'preparing';
        if (player.loading === true
            || player.loadPhase === 'connecting'
            || player.loadPhase === 'buffering') {
            return 'loading';
        }
        if (player._freezePressure === true) return 'freeze';
        return null;
    },

    /** Playing mosaic slot ids (wantPlaying or playing with a channel). */
    collectPlayingSlotIds() {
        const ids = [];
        for (const id of SLOT_IDS) {
            const player = this.slots[id]?.player;
            if (!player?.channel) continue;
            if (player.wantPlaying === true || player.playing === true) ids.push(id);
        }
        return ids;
    },

    /**
     * Sole coordinator for sibling soft-yield. Re-run on every slot onState and
     * when the hysteresis hold timer fires.
     * @param {number} [now]
     */
    syncSiblingYield(now = Date.now()) {
        const playingIds = this.collectPlayingSlotIds();
        let constrainedPlaying = 0;
        let healthyPlaying = 0;
        for (const id of playingIds) {
            if (getSlotPressureReason(id)) constrainedPlaying += 1;
            else healthyPlaying += 1;
        }

        const shouldYieldNow = shouldYieldHealthy({
            constrainedCount: constrainedPlaying,
            healthyPlayingCount: healthyPlaying
        });
        const next = resolveYieldState({
            prevActive: this._siblingYieldActive === true,
            shouldYieldNow,
            lastYieldWorthyAt: this._lastYieldWorthyAt || 0,
            now,
            holdMs: YIELD_HOLD_MS
        });
        this._lastYieldWorthyAt = next.lastYieldWorthyAt;

        const wasActive = this._siblingYieldActive === true;
        this._siblingYieldActive = next.active === true;

        setHealBudgetContext({
            yieldActive: this._siblingYieldActive,
            playingIds
        });

        if (this._siblingYieldActive) {
            this.applySiblingYieldToHealthy();
        } else if (wasActive) {
            this.clearSiblingYieldAll();
        }

        this.armSiblingYieldHoldTimer(now, shouldYieldNow);
    },

    /** Cancel pending hysteresis wakeup (tests / teardown). */
    clearSiblingYieldHoldTimer() {
        if (!this._yieldHoldTimer) return;
        try { clearTimeout(this._yieldHoldTimer); } catch { /* ignore */ }
        this._yieldHoldTimer = 0;
    },

    /**
     * While in the post-clear hold window, schedule one wakeup to unyield.
     * @param {number} now
     * @param {boolean} shouldYieldNow
     */
    armSiblingYieldHoldTimer(now, shouldYieldNow) {
        if (typeof setTimeout !== 'function') return;
        this.clearSiblingYieldHoldTimer();
        if (!this._siblingYieldActive || shouldYieldNow) return;
        const elapsed = Math.max(0, now - (this._lastYieldWorthyAt || now));
        const remain = Math.max(0, YIELD_HOLD_MS - elapsed);
        this._yieldHoldTimer = setTimeout(() => {
            this._yieldHoldTimer = 0;
            try {
                this.syncSiblingYield();
            } catch { /* document may be torn down in tests */ }
        }, remain + 1);
        if (typeof this._yieldHoldTimer?.unref === 'function') {
            try { this._yieldHoldTimer.unref(); } catch { /* ignore */ }
        }
    },

    /** Apply ABR/buffer yield to healthy playing auto-quality slots. */
    applySiblingYieldToHealthy() {
        for (const id of SLOT_IDS) {
            const player = this.slots[id]?.player;
            if (!player?.hls) continue;
            if (!(player.wantPlaying === true || player.playing === true)) continue;
            if (getSlotPressureReason(id)) {
                player.clearSiblingYieldProfile?.();
                continue;
            }
            if (player.qualityMode !== 'auto') continue;

            const levels = player.hls.levels || [];
            const priorCap = player._yieldRestore?.autoLevelCapping;
            const liveCap = Number.isFinite(player.hls.autoLevelCapping)
                ? player.hls.autoLevelCapping
                : -1;
            const sizeBasedCap = Number.isInteger(priorCap) && priorCap >= 0
                ? priorCap
                : (liveCap >= 0 && !player._siblingYielded ? liveCap : -1);

            const levelCap = computeYieldLevelCap({
                levels,
                minHeight: YIELD_MIN_HEIGHT,
                sizeBasedCap
            });
            player.applySiblingYieldProfile?.({
                levelCap,
                bufferLength: YIELD_BUFFER_LENGTH
            });
        }
    },

    clearSiblingYieldAll() {
        for (const id of SLOT_IDS) {
            this.slots[id]?.player?.clearSiblingYieldProfile?.();
        }
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
            this.raiseTileInStack(slotId);
            if (this.hasCustomPlacement()) {
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
                const UI_CLASS_RE = /^(remote-|browser-|catalog-|ui-idle-|has-resume|has-remote|has-channel)/;
                const obs = new MutationObserver((mutations) => {
                    if (!this.hasCustomPlacement()) return;
                    let mosaicRelevant = false;
                    for (const m of mutations) {
                        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
                        const prev = (m.oldValue || '').split(/\s+/).filter(Boolean);
                        const next = [...observeTarget.classList];
                        const prevSet = new Set(prev);
                        const nextSet = new Set(next);
                        for (const c of next) {
                            if (!prevSet.has(c) && !UI_CLASS_RE.test(c)) {
                                mosaicRelevant = true;
                                break;
                            }
                        }
                        if (!mosaicRelevant) {
                            for (const c of prev) {
                                if (!nextSet.has(c) && !UI_CLASS_RE.test(c)) {
                                    mosaicRelevant = true;
                                    break;
                                }
                            }
                        }
                        if (mosaicRelevant) break;
                    }
                    if (!mosaicRelevant) return;
                    const mosaic = document.getElementById('player-mosaic');
                    const w = mosaic?.clientWidth || 0;
                    const h = mosaic?.clientHeight || 0;
                    if (w === this._lastFreeLayoutW && h === this._lastFreeLayoutH) return;
                    requestAnimationFrame(() => {
                        this._lastFreeLayoutW = mosaic?.clientWidth || 0;
                        this._lastFreeLayoutH = mosaic?.clientHeight || 0;
                        this.applyFreeLayout();
                    });
                });
                obs.observe(observeTarget, {
                    attributes: true,
                    attributeFilter: ['class'],
                    attributeOldValue: true
                });
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

    /**
     * User Max TVs setting (clamped). Hard ceiling is MAX_MOSAIC_SLOTS.
     * @returns {number}
     */
    getMaxMosaicSlots() {
        return SettingsStore.getMaxMosaicSlots();
    },

    /**
     * Persist Max TVs and disable excess satellite screens when lowered.
     * @param {number} value
     * @param {{ silent?: boolean }} [opts]
     * @returns {number}
     */
    setMaxMosaicSlots(value, { silent = false } = {}) {
        const next = SettingsStore.setMaxMosaicSlots(value);
        this.enforceMaxMosaicSlots({ silent });
        if (!silent) {
            this.syncSettingsToggles();
            this.syncScreenControls?.();
            import('./ui/remotePanel.js')
                .then(({ syncLayoutPicker }) => syncLayoutPicker?.())
                .catch(() => {});
        }
        return next;
    },

    /**
     * Disable satellite screens beyond the current max (center always kept).
     * @param {{ silent?: boolean }} [opts]
     */
    enforceMaxMosaicSlots({ silent = false } = {}) {
        const max = this.getMaxMosaicSlots();
        let enabled = 1; // center
        for (const id of PLAY_FILL_ORDER) {
            if (id === 'center') continue;
            if (!this.slots[id]?.enabled) continue;
            enabled += 1;
            if (enabled > max) {
                this.setSideEnabled(id, false, { silent });
            }
        }
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
            bottomCenter: this.slots.bottomCenter.enabled,
            topCenter: this.slots.topCenter?.enabled,
            midLeft: this.slots.midLeft?.enabled,
            midRight: this.slots.midRight?.enabled
        });

        mosaic.classList.toggle('has-left', grid.hasLeft);
        mosaic.classList.toggle('has-right', grid.hasRight);
        mosaic.classList.toggle('has-top-left', this.slots.topLeft.enabled);
        mosaic.classList.toggle('has-top-right', this.slots.topRight.enabled);
        mosaic.classList.toggle('has-bottom-left', this.slots.bottomLeft.enabled);
        mosaic.classList.toggle('has-bottom-right', this.slots.bottomRight.enabled);
        mosaic.classList.toggle('has-bottom-center', this.slots.bottomCenter.enabled);
        mosaic.classList.toggle('has-top-center', this.slots.topCenter?.enabled === true);
        mosaic.classList.toggle('has-mid-left', this.slots.midLeft?.enabled === true);
        mosaic.classList.toggle('has-mid-right', this.slots.midRight?.enabled === true);
        mosaic.classList.toggle('has-corners', grid.hasAnyCorner);

        mosaic.style.gridTemplateAreas = grid.areas;
        mosaic.style.gridTemplateColumns = grid.columns;
        mosaic.style.gridTemplateRows = grid.rows;

        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const enabled = this.slots[id]?.enabled === true;
            tile.classList.toggle('is-hidden', !enabled);
            tile.classList.toggle('is-primary', id === 'center');
            tile.setAttribute('aria-hidden', enabled ? 'false' : 'true');
            applySlotOutlineAttrs(tile, id);
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
            if (!slot?.enabled || !slot.player) return;
            const surface = el(`tv-playback-surface-${id}`);
            if (surface) slot.player.mountVideo(surface);
        });
    },

    setSideEnabled(sideId, enabled, { silent = false } = {}) {
        if (!CORNER_IDS.includes(sideId)) return;
        const slot = this.slots[sideId];
        if (!slot) return;
        const next = Boolean(enabled);
        if (next) {
            const currentEnabled = PLAY_FILL_ORDER.filter((id) => this.slots[id]?.enabled).length;
            const wouldBe = slot.enabled ? currentEnabled : currentEnabled + 1;
            if (wouldBe > this.getMaxMosaicSlots()) return;
        }
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
                this.applyGridLayoutPreset(undefined, { animate: true });
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

    setReattemptInterval(seconds) {
        const clamped = clampReattemptInterval(seconds);
        savePlayerState({ reattemptInterval: clamped });
        SLOT_IDS.forEach((id) => {
            const player = this.slots[id].player;
            if (player) player.setReattemptInterval(clamped);
        });
        return clamped;
    },

    getReattemptInterval() {
        return loadPlayerState().reattemptInterval ?? DEFAULT_REATTEMPT_INTERVAL;
    },

    setReattempts(count) {
        const clamped = clampReattempts(count);
        savePlayerState({ reattempts: clamped });
        SLOT_IDS.forEach((id) => {
            const player = this.slots[id].player;
            if (player) player.setReattempts(clamped);
        });
        return clamped;
    },

    getReattempts() {
        return loadPlayerState().reattempts ?? DEFAULT_REATTEMPTS;
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
        const maxTvsInput = el('max-tvs-input');
        if (maxTvsInput) {
            maxTvsInput.value = String(this.getMaxMosaicSlots());
            maxTvsInput.max = String(MAX_MOSAIC_SLOTS);
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
        const maxTvsInput = el('max-tvs-input');
        if (maxTvsInput && maxTvsInput.dataset.bound !== '1') {
            maxTvsInput.dataset.bound = '1';
            maxTvsInput.max = String(MAX_MOSAIC_SLOTS);
            maxTvsInput.value = String(this.getMaxMosaicSlots());
            maxTvsInput.addEventListener('change', () => {
                const next = this.setMaxMosaicSlots(Number(maxTvsInput.value));
                maxTvsInput.value = String(next);
                showAppToast(`Max TVs: ${next}`);
            });
            maxTvsInput.addEventListener('blur', () => {
                maxTvsInput.value = String(this.getMaxMosaicSlots());
            });
        }
        this.syncSettingsToggles();
        this.bindScreenControls();
    }
};
