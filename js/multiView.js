import { createPlayerInstance } from './player/playerInstance.js';
import {
    loadPlayerState,
    savePlayerState,
    DEFAULT_BUFFER_SIZE,
    MAX_BUFFER_SIZE,
    MIN_BUFFER_SIZE
} from './storage/playerState.js';
import { SettingsStore } from './storage/settingsStore.js';
import { FavoritesRecents } from './storage/favoritesRecents.js';
import { channelKey } from './tvProviders/channelShape.js';
import { ACTION_ICONS, CARD_ICONS } from './ui/icons.js';
import { showAppToast } from './ui/toast.js';
import { TvPopoutWindows } from './tvPopoutWindows.js';
import { el } from './tvUtils.js';
import { TileFrames } from './tileFrames.js';
import {
    fillViewTransitionSelect,
    VIEW_TRANSITION_LABELS
} from './ui/viewTransitions.js';
import { classifyTilePlayback } from './player/pauseBuffer.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    MAX_MOSAIC_SLOTS,
    PLAY_FILL_ORDER,
    clearTilePlacementStyle,
    slotIsOccupied
} from './mosaic/constants.js';
import { freeLayoutMethods } from './mosaic/freeLayout.js';
import { swapMethods } from './mosaic/swap.js';
import { persistMethods } from './mosaic/persist.js';
import { resolveMosaicGridTemplate } from './mosaic/gridLayout.js';

export { MAX_MOSAIC_SLOTS };

const SCREEN_GETTERS = {
    topLeft: () => SettingsStore.getScreenTopLeft(),
    topRight: () => SettingsStore.getScreenTopRight(),
    bottomLeft: () => SettingsStore.getScreenBottomLeft(),
    bottomRight: () => SettingsStore.getScreenBottomRight()
};

const SCREEN_SETTERS = {
    topLeft: (v) => SettingsStore.setScreenTopLeft(v),
    topRight: (v) => SettingsStore.setScreenTopRight(v),
    bottomLeft: (v) => SettingsStore.setScreenBottomLeft(v),
    bottomRight: (v) => SettingsStore.setScreenBottomRight(v)
};

const TOGGLE_IDS = {
    topLeft: 'screen-top-left-toggle',
    topRight: 'screen-top-right-toggle',
    bottomLeft: 'screen-bottom-left-toggle',
    bottomRight: 'screen-bottom-right-toggle'
};

function savedVolume() {
    return loadPlayerState().volume || 0.85;
}

function pipSupported() {
    return typeof document !== 'undefined'
        && typeof document.pictureInPictureEnabled === 'boolean'
        && document.pictureInPictureEnabled
        && typeof HTMLVideoElement !== 'undefined'
        && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
}

export const MultiView = {
    ...persistMethods,
    ...freeLayoutMethods,
    ...swapMethods,

    initialized: false,
    sharedVolume: savedVolume(),
    lastVolume: savedVolume() || 0.85,
    /** @type {Record<string, { id: string, enabled: boolean, player: ReturnType<typeof createPlayerInstance> | null }>} */
    slots: {
        topLeft: { id: 'topLeft', enabled: false, player: null },
        center: { id: 'center', enabled: true, player: null },
        topRight: { id: 'topRight', enabled: false, player: null },
        bottomLeft: { id: 'bottomLeft', enabled: false, player: null },
        bottomRight: { id: 'bottomRight', enabled: false, player: null }
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

    getPrimary() {
        return this.slots.center.player;
    },

    /**
     * Coalesce mosaic chrome DOM sync to one walk per animation frame.
     */
    scheduleRefreshTiles() {
        if (this._refreshTilesRaf) return;
        const run = () => {
            this._refreshTilesRaf = 0;
            this.refreshTiles();
        };
        if (typeof requestAnimationFrame === 'function') {
            this._refreshTilesRaf = requestAnimationFrame(run);
        } else {
            this._refreshTilesRaf = setTimeout(run, 0);
        }
    },

    /**
     * Snap channel-grid tiles from any mosaic slot that is playing.
     * @param {ReturnType<typeof createPlayerInstance>} player
     */
    noteSlotPlayingForTiles(player) {
        if (!player?.playing) return;
        const url = player.channel?.url_resolved || player.channel?.url || '';
        if (!url || !player.video) return;
        const key = channelKey(player.channel);
        TileFrames.notePlayingVideo(url, player.video, key);
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

        this.ensurePlayer('center', { startMuted: true });
        CORNER_IDS.forEach((id) => {
            this.setSideEnabled(id, SCREEN_GETTERS[id](), { silent: true });
        });

        const saved = loadPlayerState().mosaicPlacement || {};
        this.mosaicPlacement = this.sanitizePlacementMap(saved);
        this.placementZTop = Object.values(this.mosaicPlacement)
            .reduce((max, p) => Math.max(max, p?.z || 1), 1);
        this.ensureCenterOnTop();

        this.syncLayout();
        this.mountAll();
        this.bindUi();
        this.bindPlacementChrome();
        this.applySavedSlotStubs();

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
        window.addEventListener('tv:popout_changed', () => this.scheduleRefreshTiles());

        // If app never calls restoreSlots (nothing saved), allow persist to clear empties.
        const savedSlots = loadPlayerState().mosaicSlots || {};
        if (!Object.keys(savedSlots).length && !loadPlayerState().lastChannelKey) {
            this.slotsHydrated = true;
        }
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
            shouldBroadcast: () => this.slots.center.player === player,
            onState: () => {
                this.scheduleRefreshTiles();
                this.noteSlotPlayingForTiles(player);
            },
            shouldRecordRecents: () => this.slots.center.player === player
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
            const qualityOpt = e.target.closest?.('[data-quality-mode]');
            if (qualityOpt) {
                e.stopPropagation();
                e.preventDefault();
                const tile = qualityOpt.closest?.('.tv-player-tile');
                const slotId = tile?.getAttribute('data-slot');
                const modeAttr = qualityOpt.getAttribute('data-quality-mode');
                if (!slotId || modeAttr == null) return;
                const mode = modeAttr === 'auto' ? 'auto' : Number(modeAttr);
                this.slots[slotId]?.player?.setQualityMode?.(mode);
                const wrap = qualityOpt.closest?.('[data-quality-wrap]');
                wrap?.classList.remove('is-open');
                wrap?.querySelector?.('[data-tile-action="quality"]')
                    ?.setAttribute('aria-expanded', 'false');
                return;
            }

            const qualityBtn = e.target.closest?.('[data-tile-action="quality"]');
            if (qualityBtn) {
                e.stopPropagation();
                e.preventDefault();
                const wrap = qualityBtn.closest?.('[data-quality-wrap]');
                if (!wrap) return;
                const open = !wrap.classList.contains('is-open');
                mosaic.querySelectorAll('[data-quality-wrap].is-open').forEach((el) => {
                    if (el !== wrap) {
                        el.classList.remove('is-open');
                        el.querySelector('[data-tile-action="quality"]')
                            ?.setAttribute('aria-expanded', 'false');
                    }
                });
                wrap.classList.toggle('is-open', open);
                qualityBtn.setAttribute('aria-expanded', String(open));
                return;
            }

            const actionBtn = e.target.closest?.('[data-tile-action]');
            if (actionBtn) {
                e.stopPropagation();
                e.preventDefault();
                const tile = actionBtn.closest?.('.tv-player-tile');
                const slotId = tile?.getAttribute('data-slot');
                const action = actionBtn.getAttribute('data-tile-action');
                if (slotId && action) this.handleTileAction(slotId, action);
                return;
            }
            // Tile focus (z-raise / pinned picker retarget) is handled on pointerup when the gesture was a click.
        });

        if (!this._qualityOutsideBound) {
            this._qualityOutsideBound = true;
            document.addEventListener('pointerdown', (e) => {
                if (e.target.closest?.('[data-quality-wrap]')) return;
                mosaic.querySelectorAll('[data-quality-wrap].is-open').forEach((wrap) => {
                    wrap.classList.remove('is-open');
                    wrap.querySelector('[data-tile-action="quality"]')
                        ?.setAttribute('aria-expanded', 'false');
                });
            });
        }

        mosaic.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest?.('[data-tile-action]')) return;
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

            const catalog = typeof document !== 'undefined'
                && typeof document.querySelector === 'function'
                ? document.querySelector('.tv-catalog')
                : null;
            if (catalog && typeof MutationObserver === 'function') {
                const obs = new MutationObserver(() => {
                    if (this.hasCustomPlacement()) {
                        requestAnimationFrame(() => this.applyFreeLayout());
                    }
                });
                obs.observe(catalog, { attributes: true, attributeFilter: ['class'] });
            }
        }
    },

    bindPlacementChrome() {
        if (this._hoverBound || typeof document === 'undefined') return;
        this._hoverBound = true;
        const app = el('app-container') || document.body;
        const playerSlot = el('player-slot');
        const resetBtn = el('mosaic-reset-btn');
        const muteAllBtn = el('mosaic-mute-all-btn');

        const setHovered = (on) => {
            app.classList.toggle('is-player-hovered', on);
        };

        playerSlot?.addEventListener('mouseenter', () => setHovered(true));
        playerSlot?.addEventListener('mouseleave', () => setHovered(false));
        playerSlot?.addEventListener('focusin', () => setHovered(true));
        playerSlot?.addEventListener('focusout', (e) => {
            if (playerSlot.contains(e.relatedTarget)) return;
            setHovered(false);
        });

        resetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetMosaicPlacement();
        });

        muteAllBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isMuteAllActive()) this.unmuteAll();
            else this.muteAll();
        });

        this.syncMosaicChrome();
    },

    isSlotAudible(player) {
        return Boolean(
            player?.channel
            && player.muted === false
            && this.sharedVolume > 0
        );
    },

    isMuteAllActive() {
        if (this.sharedVolume <= 0) return true;
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled) continue;
            if (this.isSlotAudible(slot.player)) return false;
        }
        return true;
    },

    muteAll() {
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            slot.player.mute();
        });
        this.persistSlots();
        // emitState → onState → scheduleRefreshTiles
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    unmuteAll() {
        if (this.sharedVolume <= 0) {
            const restored = this.lastVolume > 0 ? this.lastVolume : 0.85;
            this.setSharedVolume(restored);
        }
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            slot.player.unmute();
        });
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    syncMosaicChrome() {
        if (typeof document === 'undefined') return;
        const app = el('app-container') || document.body;
        const muteAllActive = this.isMuteAllActive();
        app.classList.toggle('is-mute-all-active', muteAllActive);

        const muteAllBtn = el('mosaic-mute-all-btn');
        if (!muteAllBtn) return;
        const label = muteAllActive ? 'Unmute all' : 'Mute all';
        muteAllBtn.title = label;
        muteAllBtn.setAttribute('aria-label', label);
        muteAllBtn.setAttribute('aria-pressed', String(muteAllActive));
        const wave = muteAllBtn.querySelector('.mosaic-mute-all-wave');
        const slash = muteAllBtn.querySelector('.mosaic-mute-all-slash');
        if (wave) wave.style.opacity = muteAllActive ? '0' : '1';
        if (slash) slash.setAttribute('opacity', muteAllActive ? '1' : '0');
    },

    async maybeRetargetChannelPicker(slotId) {
        if (!slotId || !this.slots[slotId]?.enabled) return;
        try {
            const { ChannelPickerModal } = await import('./ui/channelPickerModal.js');
            if (!ChannelPickerModal.isOpen() || !ChannelPickerModal.isPinned()) return;
            ChannelPickerModal.open(slotId);
        } catch {
            /* ignore */
        }
    },

    async handleTileAction(slotId, action) {
        if (slotId === 'center') return;

        if (action === 'dismiss') {
            this.setSideEnabled(slotId, false);
            return;
        }

        if (action === 'browse') {
            const { ChannelPickerModal } = await import('./ui/channelPickerModal.js');
            ChannelPickerModal.toggle(slotId);
            return;
        }

        const player = this.slots[slotId]?.player;
        if (!player) return;

        switch (action) {
            case 'play':
                // Stable hit-target: icon swaps on this button (no separate pause control).
                player.toggle();
                break;
            case 'stop':
                await player.stop();
                this.persistSlots();
                break;
            case 'mute':
                if (player.channel) player.toggleMute();
                this.persistSlots();
                break;
            case 'swap':
                this.swapWithCenter(slotId);
                break;
            case 'fav':
                if (player.channel) {
                    FavoritesRecents.toggleFavorite(player.channel);
                    this.getPrimary()?.emitState();
                }
                break;
            case 'fullscreen': {
                const video = player.video;
                if (!video?.requestFullscreen) {
                    showAppToast('Fullscreen isn’t supported here');
                    break;
                }
                try {
                    await video.requestFullscreen();
                } catch {
                    showAppToast('Fullscreen blocked');
                }
                break;
            }
            case 'pip': {
                const video = player.video;
                const url = player.channel?.url_resolved || player.channel?.url || '';
                await TvPopoutWindows.detach({
                    slotId,
                    video,
                    url,
                    name: player.channel?.name || 'magicTV',
                    muted: player.muted !== false,
                    pipSupported: pipSupported()
                });
                break;
            }
            default:
                break;
        }
        this.scheduleRefreshTiles();
    },

    syncLayout() {
        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        const grid = resolveMosaicGridTemplate({
            freeLayout: this.hasCustomPlacement(),
            topLeft: this.slots.topLeft.enabled,
            topRight: this.slots.topRight.enabled,
            bottomLeft: this.slots.bottomLeft.enabled,
            bottomRight: this.slots.bottomRight.enabled
        });

        mosaic.classList.toggle('has-left', grid.hasLeft);
        mosaic.classList.toggle('has-right', grid.hasRight);
        mosaic.classList.toggle('has-top-left', this.slots.topLeft.enabled);
        mosaic.classList.toggle('has-top-right', this.slots.topRight.enabled);
        mosaic.classList.toggle('has-bottom-left', this.slots.bottomLeft.enabled);
        mosaic.classList.toggle('has-bottom-right', this.slots.bottomRight.enabled);
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
            requestAnimationFrame(() => this.applyFreeLayout());
        } else {
            this.clearFreeLayoutStyles();
        }
        this.syncPlacementChrome();
        import('./ui/channelPickerModal.js')
            .then(({ ChannelPickerModal }) => ChannelPickerModal.syncTargetHighlight?.())
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
        } else if (slot.player) {
            slot.player.stop({ clearChannel: true }).catch(() => {});
            if (this.mosaicPlacement[sideId]) {
                delete this.mosaicPlacement[sideId];
                this.persistPlacement();
            }
        }

        SCREEN_SETTERS[sideId]?.(next);

        this.syncLayout();
        this.mountAll();
        this.scheduleRefreshTiles();
        if (!silent) {
            this.syncSettingsToggles();
            this.getPrimary()?.emitState();
            // Never persist during silent boot enable — that would wipe saved
            // mosaic channels before restoreSlots() runs.
            this.persistSlots();
        }
    },

    playOnPrimary(channel) {
        const primary = this.getPrimary();
        if (!primary) return Promise.reject(new Error('No primary player'));
        this.mountAll();
        return primary.playChannel(channel).finally(() => this.persistSlots());
    },

    /**
     * Play a channel on a specific mosaic slot (enables the side if needed).
     * @param {string} slotId
     * @param {object} channel
     */
    playOnSlot(slotId, channel) {
        const id = slotId || 'center';
        if (CORNER_IDS.includes(id) && !this.slots[id]?.enabled) {
            this.setSideEnabled(id, true);
        }
        this.mountAll();
        const startMuted = id !== 'center';
        const player = this.ensurePlayer(id, { startMuted });
        if (!player) return Promise.reject(new Error(`No player for slot ${id}`));
        const surface = el(`tv-playback-surface-${id}`);
        if (surface) player.mountVideo(surface);
        return player.playChannel(channel).finally(() => {
            this.persistSlots();
            this.scheduleRefreshTiles();
            this.syncSettingsToggles();
            if (id === 'center') this.getPrimary()?.emitState();
        });
    },

    /**
     * Play channels across mosaic slots in display order (center first, then corners).
     * Enables only the slots needed for the list (capped at MAX_MOSAIC_SLOTS) and disables unused corners.
     * @param {object[]} channels
     */
    async playChannelsOnMosaic(channels) {
        const list = (Array.isArray(channels) ? channels : [])
            .filter(Boolean)
            .slice(0, Math.min(MAX_MOSAIC_SLOTS, PLAY_FILL_ORDER.length));
        if (!list.length) return;

        this.init();

        const used = new Set(PLAY_FILL_ORDER.slice(0, list.length));
        for (const id of CORNER_IDS) {
            this.setSideEnabled(id, used.has(id), { silent: true });
        }

        this.syncLayout();
        this.mountAll();

        const plays = list.map((channel, i) => {
            const slotId = PLAY_FILL_ORDER[i];
            const startMuted = slotId !== 'center';
            const player = this.ensurePlayer(slotId, { startMuted });
            if (!player) return Promise.resolve();
            if (startMuted) {
                player.muted = true;
                player.applyAudioToVideo();
            }
            const surface = el(`tv-playback-surface-${slotId}`);
            if (surface) player.mountVideo(surface);
            return player.playChannel(channel).catch((err) => {
                const blocked = err?.name === 'NotAllowedError'
                    || String(err?.message || '').toLowerCase().includes('not allowed');
                if (!blocked) console.warn(`playChannelsOnMosaic ${slotId} failed`, err);
                return null;
            });
        });

        await Promise.allSettled(plays);
        this.persistSlots();
        this.syncSettingsToggles();
        this.getPrimary()?.emitState();
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

    refreshTiles() {
        if (typeof document === 'undefined') return;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            const slot = this.slots[id];
            if (!tile || !slot) return;

            const player = slot.player;
            const rememberedKey = this.rememberedSlotKeys[id] || '';
            const hasChannel = slotIsOccupied(player?.channel, rememberedKey);
            const empty = tile.querySelector('.tv-player-tile__empty');
            const mediaPlaying = player?.playing === true;
            const intentPlaying = player?.wantPlaying === true || mediaPlaying;
            const { uiPlaying, uiLoading, uiPaused, uiStopped } = classifyTilePlayback({
                hasChannel,
                playing: mediaPlaying,
                posterDataUrl: player?.posterDataUrl,
                pausePhase: player?.pausePhase,
                stopped: player?.stopped === true,
                loading: player?.loading === true,
                loadPhase: player?.loadPhase || 'idle',
                wantPlaying: player?.wantPlaying === true
            });

            tile.classList.toggle('is-empty', !hasChannel);
            tile.classList.toggle('is-playing', uiPlaying);
            tile.classList.toggle('is-loading', uiLoading);
            tile.classList.toggle('is-paused', uiPaused);
            tile.classList.toggle('is-stopped', uiStopped);
            // Never show “Pick a channel” for a remembered/saved assignment.
            if (empty) empty.classList.toggle('is-hidden', hasChannel);

            const nameEl = tile.querySelector('.tv-player-tile__name');
            if (nameEl) {
                const name = (player?.channel?.name || '').trim();
                if (hasChannel && name) {
                    nameEl.textContent = name;
                    nameEl.classList.remove('is-hidden');
                } else {
                    nameEl.textContent = '';
                    nameEl.classList.add('is-hidden');
                }
            }

            const posterEl = tile.querySelector('.tv-player-tile__poster');
            // Cover black gaps: keep poster while loading/awaiting first paint, or when
            // the <video> has no decoded frame yet.
            const videoHasFrame = Boolean(player?.video?.videoWidth > 0);
            const showPoster = Boolean(
                hasChannel
                && player
                && player.posterDataUrl
                && !uiPlaying
                && (uiLoading || !videoHasFrame)
            );
            tile.classList.toggle('has-poster', showPoster);
            if (posterEl) {
                if (showPoster) {
                    if (posterEl.getAttribute('src') !== player.posterDataUrl) {
                        posterEl.src = player.posterDataUrl;
                    }
                    posterEl.classList.remove('is-hidden');
                } else {
                    posterEl.classList.add('is-hidden');
                }
            }

            this.syncTileQualityMenu(tile, player);

            if (id === 'center') return;

            const playBtn = tile.querySelector('[data-tile-action="play"]');
            const muteBtn = tile.querySelector('.tv-player-tile__hover [data-tile-action="mute"]');
            const favBtn = tile.querySelector('[data-tile-action="fav"]');
            const pipBtn = tile.querySelector('[data-tile-action="pip"]');
            const audioEl = tile.querySelector('.tv-player-tile__audio');

            // One stable hit-target — icon swaps on the play button.
            if (playBtn) {
                playBtn.classList.remove('is-hidden');
                playBtn.textContent = intentPlaying ? '⏸' : '▶';
                playBtn.title = intentPlaying ? 'Pause' : 'Play';
                playBtn.setAttribute('aria-label', intentPlaying ? 'Pause' : 'Play');
            }

            // Solid corner speaker only while unmuted with audible volume; click mutes.
            const showAudio = this.isSlotAudible(player);
            if (audioEl) {
                audioEl.classList.toggle('is-hidden', !showAudio);
            }

            const isMuted = !showAudio;
            if (muteBtn) {
                muteBtn.classList.toggle('is-muted', isMuted);
                muteBtn.setAttribute('aria-pressed', String(isMuted));
                muteBtn.title = isMuted ? 'Unmute' : 'Mute';
                const wave = muteBtn.querySelector('.tile-mute-wave');
                const slash = muteBtn.querySelector('.tile-mute-slash');
                if (wave) wave.style.opacity = isMuted ? '0' : '1';
                if (slash) slash.style.opacity = isMuted ? '1' : '0';
            }

            if (favBtn && player?.channel) {
                const isFav = FavoritesRecents.isFavorite(player.channel);
                favBtn.classList.toggle('is-active', isFav);
                favBtn.innerHTML = isFav ? CARD_ICONS.starFilled : '☆';
                favBtn.setAttribute('aria-pressed', String(isFav));
            } else if (favBtn) {
                favBtn.classList.remove('is-active');
                favBtn.textContent = '☆';
            }

            if (pipBtn) {
                const nativeSupported = pipSupported();
                const windowOpen = TvPopoutWindows.isOpen(id);
                const nativeActive = nativeSupported && document.pictureInPictureElement === player?.video;
                const active = nativeActive || windowOpen;
                // Always show pip — window popout works even without native PiP
                pipBtn.classList.remove('is-hidden');
                pipBtn.classList.toggle('is-active', active);
                pipBtn.innerHTML = active
                    ? ACTION_ICONS.pictureInPictureExit
                    : ACTION_ICONS.pictureInPicture;
                pipBtn.title = active ? 'Pop in' : 'Pop out';
                pipBtn.setAttribute('aria-label', active ? 'Pop in' : 'Pop out');
            }
        });
        this.syncMosaicChrome();
    },

    syncTileQualityMenu(tile, player) {
        const popup = tile?.querySelector?.('.tv-player-tile__quality-popup');
        const btn = tile?.querySelector?.('[data-tile-action="quality"]');
        if (!popup || !btn) return;

        const levels = player?.getQualityLevels?.() || [];
        const mode = player?.qualityMode ?? 'auto';
        const modeKey = mode === 'auto' ? 'auto' : String(mode);
        const fingerprint = `${modeKey}:${levels.map((l) => `${l.index}:${l.label}`).join(',')}`;

        if (popup.dataset.qualityFingerprint !== fingerprint) {
            popup.dataset.qualityFingerprint = fingerprint;
            const ordered = [...levels].sort((a, b) => b.index - a.index);
            const parts = [
                `<button type="button" class="tv-player-tile__quality-option${mode === 'auto' ? ' is-selected' : ''}" role="menuitemradio" aria-checked="${mode === 'auto'}" data-quality-mode="auto">Auto</button>`
            ];
            for (const level of ordered) {
                const selected = mode !== 'auto' && Number(mode) === level.index;
                parts.push(
                    `<button type="button" class="tv-player-tile__quality-option${selected ? ' is-selected' : ''}" role="menuitemradio" aria-checked="${selected}" data-quality-mode="${level.index}">${level.label}</button>`
                );
            }
            popup.innerHTML = parts.join('');
        } else {
            popup.querySelectorAll('[data-quality-mode]').forEach((opt) => {
                const selected = opt.getAttribute('data-quality-mode') === modeKey;
                opt.classList.toggle('is-selected', selected);
                opt.setAttribute('aria-checked', String(selected));
            });
        }

        const hasStream = Boolean(player?.channel);
        btn.disabled = !hasStream;
        if (!hasStream) {
            btn.title = 'Quality';
        } else if (mode === 'auto') {
            const live = player.qualityLabel && player.qualityLabel !== '—'
                ? ` (${player.qualityLabel})`
                : '';
            btn.title = `Quality: Auto${live}`;
        } else {
            btn.title = `Quality: ${player.qualityLabel || '—'}`;
        }
    },

    syncSettingsToggles() {
        if (typeof document === 'undefined') return;
        CORNER_IDS.forEach((id) => {
            const btn = el(TOGGLE_IDS[id]);
            if (!btn) return;
            const on = this.slots[id].enabled;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
        const swapSelect = el('swap-transition-select');
        if (swapSelect) {
            fillViewTransitionSelect(swapSelect, SettingsStore.getSwapTransition());
        }
    },

    bindSettings() {
        if (typeof document === 'undefined') return;
        CORNER_IDS.forEach((id) => {
            const btn = el(TOGGLE_IDS[id]);
            if (!btn || btn.dataset.bound === '1') return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => {
                this.setSideEnabled(id, !this.slots[id].enabled);
            });
        });
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
        this.syncSettingsToggles();
    }
};
