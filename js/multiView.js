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
import { channelKey, normalizeChannel } from './tvProviders/channelShape.js';
import { ACTION_ICONS, CARD_ICONS } from './ui/icons.js';
import { showAppToast } from './ui/toast.js';
import { TvPopoutWindows } from './tvPopoutWindows.js';
import { countryFlagEmoji, el } from './tvUtils.js';
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

function getScreenControlStrips() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    return Array.from(document.querySelectorAll('.tv-controls__screens'));
}

function getScreenControlStrip() {
    return getScreenControlStrips()[0] || null;
}
import { swapMethods } from './mosaic/swap.js';
import { persistMethods } from './mosaic/persist.js';
import { resolveMosaicGridTemplate } from './mosaic/gridLayout.js';
import { hydrateTileHoverControls, PLAY_ALL_SVG, PAUSE_ALL_SVG, syncTileRockers } from './ui/tileHoverControls.js';
import { ChanBindPicker } from './ui/chanBindPicker.js';
import { syncScreenBtnActions } from './ui/screenStripControls.js';
import { ChromecastManager } from './cast/chromecastManager.js';

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

const SCREEN_ADD_ORDER = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const SCREEN_LABELS = {
    center: '1',
    topLeft: '2',
    topRight: '3',
    bottomLeft: '4',
    bottomRight: '5'
};

export const SLOT_SCREEN_LABELS = SCREEN_LABELS;

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
    /** Slot used for channel-picker targeting / status highlight (last focused screen). */
    statusSlotId: 'center',
    /** Mosaic tile hovered from a bottom screen strip (remote / browser). */
    screenStripHoverSlotId: null,
    /** Bottom multi-TV strip enlarged to show channel title + frame. */
    screensStripExpanded: false,

    getPrimary() {
        return this.slots.center.player;
    },

    getStatusPlayer() {
        const id = this.statusSlotId;
        const slot = SLOT_IDS.includes(id) ? this.slots[id] : null;
        if (slot?.enabled && slot.player) return slot.player;
        return this.getPrimary();
    },

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
        import('./ui/remotePanel.js').then(({ syncRemotePanel, syncRemoteChannelBar }) => {
            syncRemotePanel?.();
            syncRemoteChannelBar?.();
        }).catch(() => {});
        import('./ui/playerChrome.js').then(({ PlayerChrome }) => {
            PlayerChrome.updateNowPlayingHeader?.();
        }).catch(() => {});
        import('./ui/volumeDial.js').then(({ syncVolumeDial }) => {
            syncVolumeDial?.();
        }).catch(() => {});
        import('./ui/chanBindPicker.js').then(({ syncBindButtons }) => {
            syncBindButtons?.();
        }).catch(() => {});
    },

    /**
     * Focus the bottom Buffer/Quality readout on a specific screen.
     * @param {string} slotId
     */
    focusScreen(slotId) {
        if (!SLOT_IDS.includes(slotId)) return;
        this.setStatusSlot(slotId);
        if (this.hasCustomPlacement()) {
            this.raiseTileInStack(slotId);
            this.persistPlacement();
        }
        this.maybeRetargetChannelPicker(slotId);
    },

    /**
     * Add the next screen in the fixed order, or remove the last added one
     * when all corners are already enabled.
     */
    addNextScreen() {
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
        const enabledCount = 1 + SCREEN_ADD_ORDER.filter((id) => this.slots[id]?.enabled).length;
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
                const atMax = SCREEN_ADD_ORDER.every((id) => this.slots[id].enabled);
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

        this.slotsHydrated = true;
        this.syncScreenControls();
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
            onState: () => {
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

    isSlotAudible(player) {
        return Boolean(
            player?.channel
            && player.muted === false
            && this.sharedVolume > 0
            && (player.volume ?? 1) > 0
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

    isAnyPlaying() {
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) continue;
            if (slot.player.wantPlaying === true || slot.player.playing === true) return true;
        }
        return false;
    },

    isAllPlaying() {
        let hasChannel = false;
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) continue;
            hasChannel = true;
            if (!(slot.player.wantPlaying === true || slot.player.playing === true)) return false;
        }
        return hasChannel;
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

    /** Mute every other TV; unmute this one (one-way). */
    muteSolo(slotId) {
        if (this.sharedVolume <= 0) {
            const restored = this.lastVolume > 0 ? this.lastVolume : 0.85;
            this.setSharedVolume(restored);
        }
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            if (id === slotId) slot.player.unmute();
            else slot.player.mute();
        });
        this.persistSlots();
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

    async stopAll() {
        await Promise.all(SLOT_IDS.map(async (id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot?.player?.channel) return;
            await slot.player.stop().catch(() => {});
        }));
        this.persistSlots();
        TileFrames.setPlaybackBusy(false);
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    async playAll() {
        await Promise.all(SLOT_IDS.map(async (id) => {
            const slot = this.slots[id];
            const player = slot?.player;
            if (!slot?.enabled || !player?.channel) return;
            if (player.wantPlaying === true || player.playing === true) return;
            try {
                if (player.channel.url_resolved && !player.stopped) {
                    await player.resume();
                } else {
                    await player.playChannel(player.channel);
                }
            } catch {
                /* ignore per-slot failures */
            }
        }));
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    async pauseAll() {
        await Promise.all(SLOT_IDS.map(async (id) => {
            const slot = this.slots[id];
            const player = slot?.player;
            if (!slot?.enabled || !player?.channel) return;
            if (player.wantPlaying !== true && player.playing !== true) return;
            try {
                player.pause();
            } catch {
                /* ignore per-slot failures */
            }
        }));
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    syncMosaicChrome() {
        if (typeof document === 'undefined') return;
        const app = el('app-container') || document.body;
        const muteAllActive = this.isMuteAllActive();
        app.classList.toggle('is-mute-all-active', muteAllActive);

        const muteAllBtns = [el('mosaic-mute-all-btn'), el('remote-mute-all-btn')].filter(Boolean);
        muteAllBtns.forEach((btn) => {
            const label = muteAllActive ? 'Unmute all' : 'Mute all';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-pressed', String(muteAllActive));
            const wave = btn.querySelector('.mosaic-mute-all-wave, .remote-mute-all-wave');
            const slash = btn.querySelector('.mosaic-mute-all-slash, .remote-mute-all-slash');
            if (wave) wave.style.opacity = muteAllActive ? '0' : '1';
            if (slash) slash.setAttribute('opacity', muteAllActive ? '1' : '0');
        });

        const anyPlaying = this.isAnyPlaying();
        const allPlaying = this.isAllPlaying();

        const playAllBtns = [el('mosaic-play-all-btn'), el('remote-play-all-btn')].filter(Boolean);
        playAllBtns.forEach((btn) => {
            const isPause = allPlaying;
            const label = isPause ? 'Pause all' : 'Play all';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-pressed', String(isPause));
            btn.innerHTML = isPause ? PAUSE_ALL_SVG : PLAY_ALL_SVG;
        });

        const stopAllBtns = [el('mosaic-stop-all-btn'), el('remote-stop-all-btn')].filter(Boolean);
        stopAllBtns.forEach((btn) => {
            const label = 'Stop all';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.classList.toggle('is-hidden', !anyPlaying);
            btn.setAttribute('aria-disabled', String(!anyPlaying));
            btn.setAttribute('aria-pressed', String(anyPlaying));
        });

        if (typeof document !== 'undefined') {
            import('./ui/remotePanel.js').then(({ RemotePanel }) => RemotePanel.syncRemotePanel?.()).catch(() => {});
        }
    },

    async maybeRetargetChannelPicker(slotId) {
        if (!slotId || !this.slots[slotId]?.enabled) return;
        this.setStatusSlot(slotId);
        try {
            const { RemoteModule } = await import('./ui/remoteModule.js');
            if (!RemoteModule.isOpen()) return;
            RemoteModule.retarget(slotId);
        } catch {
            /* ignore */
        }
    },

    async handleTileAction(slotId, action, { target = 'local' } = {}) {
        if (action === 'reset') {
            this.resetMosaicPlacement();
            return;
        }

        if (action === 'mute-solo') {
            this.muteSolo(slotId);
            return;
        }

        if (action === 'mute-all') {
            if (this.isMuteAllActive()) this.unmuteAll();
            else this.muteAll();
            return;
        }

        if (action === 'play-all') {
            if (this.isAllPlaying()) await this.pauseAll();
            else await this.playAll();
            return;
        }

        if (action === 'stop-all') {
            await this.stopAll();
            return;
        }

        if (slotId === 'center' && (action === 'dismiss' || action === 'swap')) return;

        if (action === 'dismiss') {
            if (this.statusSlotId === slotId) this.setStatusSlot('center');
            this.setSideEnabled(slotId, false);
            return;
        }

        if (SLOT_IDS.includes(slotId) && this.slots[slotId]?.enabled) {
            this.setStatusSlot(slotId);
        }

        if (action === 'browse') {
            const { RemoteModule } = await import('./ui/remoteModule.js');
            RemoteModule.toggle(slotId, { tab: 'browse' });
            return;
        }

        if (action === 'cast') {
            const player = this.slots[slotId]?.player;
            const channel = player?.channel;
            const url = channel?.url_resolved || channel?.url || '';
            if (!url) {
                showAppToast('Pick a channel before casting');
                return;
            }
            try {
                await ChromecastManager.startCast(slotId, channel);
            } catch (err) {
                const msg = String(err?.message || err || '');
                if (!msg.toLowerCase().includes('cancel')) {
                    showAppToast('Cast failed');
                }
            }
            this.scheduleRefreshTiles();
            return;
        }

        const player = this.slots[slotId]?.player;
        if (!player) return;

        const castActive = ChromecastManager.getActiveSlot() === slotId;
        const useCast = castActive && ChromecastManager.isCasting() && target === 'cast';

        switch (action) {
            case 'play':
                if (useCast) ChromecastManager.togglePlayPause();
                else player.toggle();
                break;
            case 'stop':
                if (useCast) {
                    await ChromecastManager.stopMedia();
                } else {
                    const shouldAnimate = player.playing || player.loading || player.pausePhase !== 'idle';
                    if (shouldAnimate) {
                        await this.withChannelSwitchTransition(slotId, () => player.stop());
                    } else {
                        await player.stop();
                    }
                    this.persistSlots();
                }
                break;
            case 'mute':
                if (useCast) {
                    ChromecastManager.toggleCastMute();
                } else if (player.channel) {
                    player.toggleMute();
                    this.persistSlots();
                }
                break;
            case 'vol-up':
                if (!useCast && player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) + 0.05);
                }
                break;
            case 'vol-down':
                if (!useCast && player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) - 0.05);
                }
                break;
            case 'chan-up':
            case 'chan-down': {
                const { navigateChannel } = await import('./channelNav.js');
                await navigateChannel(slotId, action === 'chan-up' ? 'up' : 'down');
                break;
            }
            case 'cast-vol-down':
                if (castActive && ChromecastManager.isCasting()) {
                    ChromecastManager.adjustVolume(-0.1);
                }
                break;
            case 'cast-vol-up':
                if (castActive && ChromecastManager.isCasting()) {
                    ChromecastManager.adjustVolume(0.1);
                }
                break;
            case 'swap':
                this.swapWithCenter(slotId);
                if (ChromecastManager.isCasting()) {
                    const activeSlot = ChromecastManager.getActiveSlot();
                    const activePlayer = activeSlot ? this.slots[activeSlot]?.player : null;
                    if (activePlayer?.channel) {
                        ChromecastManager.loadMedia(activePlayer.channel).catch(() => {});
                    }
                }
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
                if (slotId === 'center') {
                    const { TvPip } = await import('./tvPip.js');
                    await TvPip.toggle();
                    break;
                }
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
        this.syncTileStatusHighlight();
        if (typeof document !== 'undefined') {
            import('./ui/remoteModule.js')
                .then(({ RemoteModule }) => {
                    RemoteModule.syncTargetHighlight?.();
                    import('./ui/remotePanel.js').then(({ RemotePanel }) => RemotePanel.syncRemotePanel?.()).catch(() => {});
                })
                .catch(() => {});
        }
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

    playOnPrimary(channel) {
        return this.playOnSlot('center', channel);
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
        this.setStatusSlot(id);
        this.mountAll();
        const startMuted = id !== 'center';
        const player = this.ensurePlayer(id, { startMuted });
        if (!player) return Promise.reject(new Error(`No player for slot ${id}`));
        const surface = el(`tv-playback-surface-${id}`);
        if (surface) player.mountVideo(surface);

        const normalized = normalizeChannel(channel, channel?.providerId) || channel;
        const key = channelKey(normalized);
        player.switchGeneration = (player.switchGeneration || 0) + 1;
        const switchGen = player.switchGeneration;

        player.channel = normalized;
        player.error = null;
        player.beginTransport(true);
        TileFrames.armLiveSnap(normalized.url_resolved || '');
        if (key) {
            savePlayerState({
                lastChannelKey: key,
                lastChannelName: normalized.name || ''
            });
        }
        player.emitState();
        this.persistSlots();
        this.scheduleRefreshTiles();
        this.syncStatusChrome();

        player.startPrepareChannel(normalized, switchGen);

        const hasVisibleContent = Boolean(
            player.channel
            && (player.playing || player.loading || player.pausePhase !== 'idle')
        );
        const bufferReady = player.isPrepareReady();

        return this.withChannelSwitchTransition(
            id,
            {
                onPrepare: () => player.startPrepareChannel(normalized, switchGen),
                onCommit: () => player.commitPreparedChannel(normalized, switchGen)
            },
            {
                skipOut: !hasVisibleContent || bufferReady,
                skipIn: bufferReady
            }
        ).finally(async () => {
            this.persistSlots();
            this.scheduleRefreshTiles();
            this.syncSettingsToggles();
            if (ChromecastManager.getActiveSlot() === id && ChromecastManager.isCasting()) {
                try {
                    await ChromecastManager.loadMedia(channel);
                } catch { /* ignore */ }
            }
            if (id === 'center') this.getPrimary()?.emitState();
        });
    },

    /**
     * Pause other slots and start playback on one mosaic screen (resume modal).
     * @param {string} slotId
     */
    async playExclusiveSlot(slotId) {
        const id = slotId || 'center';
        if (CORNER_IDS.includes(id) && !this.slots[id]?.enabled) {
            this.setSideEnabled(id, true);
        }

        for (const otherId of SLOT_IDS) {
            if (otherId === id) continue;
            const player = this.slots[otherId]?.player;
            if (!player) continue;
            if (player.playing || player.wantPlaying) player.pause();
        }

        this.setStatusSlot(id);
        this.mountAll();
        const startMuted = id !== 'center';
        const player = this.ensurePlayer(id, { startMuted });
        if (!player?.channel) return;

        TileFrames.setPlaybackBusy(true);
        if (player.playing) {
            this.persistSlots();
            this.scheduleRefreshTiles();
            player.emitState?.();
            return;
        }

        const surface = el(`tv-playback-surface-${id}`);
        if (surface) player.mountVideo(surface);

        try {
            if (player.channel.url_resolved && !player.stopped) {
                await player.resume();
            } else {
                await player.playChannel(player.channel);
            }
        } finally {
            this.persistSlots();
            this.scheduleRefreshTiles();
            this.syncSettingsToggles();
            player.emitState?.();
        }
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
            const tuningLive = player?.preparing === true && mediaPlaying;
            const { uiPlaying, uiLoading, uiPaused, uiStopped, uiDisconnected } = classifyTilePlayback({
                hasChannel,
                playing: mediaPlaying,
                posterDataUrl: player?.posterDataUrl,
                pausePhase: player?.pausePhase,
                stopped: player?.stopped === true,
                loading: player?.loading === true,
                loadPhase: player?.loadPhase || 'idle',
                wantPlaying: player?.wantPlaying === true,
                preparing: player?.preparing === true,
                error: player?.error || null
            });

            tile.classList.toggle('is-empty', !hasChannel);
            tile.classList.toggle('is-playing', uiPlaying);
            tile.classList.toggle('is-loading', uiLoading);
            tile.classList.toggle('is-preparing', tuningLive);
            tile.classList.toggle('is-paused', uiPaused);
            tile.classList.toggle('is-stopped', uiStopped);
            tile.classList.toggle('is-disconnected', uiDisconnected);
            const stateEl = tile.querySelector('.tv-player-tile__playback-state');
            if (stateEl) {
                if (uiDisconnected) {
                    stateEl.setAttribute('aria-hidden', 'false');
                    stateEl.setAttribute('role', 'img');
                    stateEl.setAttribute('aria-label', 'Unable to connect');
                } else {
                    stateEl.setAttribute('aria-hidden', 'true');
                    stateEl.removeAttribute('role');
                    stateEl.removeAttribute('aria-label');
                }
            }
            // Never show “Pick a channel” for a remembered/saved assignment.
            if (empty) empty.classList.toggle('is-hidden', hasChannel);

            const nameEl = tile.querySelector('.tv-player-tile__name');
            if (nameEl) {
                const name = (player?.channel?.name || '').trim();
                const nameTextEl = nameEl.querySelector('.tv-player-tile__name-text');
                const flagEl = nameEl.querySelector('.tv-player-tile__flag');
                if (hasChannel && name) {
                    if (nameTextEl) nameTextEl.textContent = name;
                    else nameEl.textContent = name;
                    if (flagEl) {
                        const code = player?.channel?.countrycode || '';
                        flagEl.textContent = code ? countryFlagEmoji(code) : '';
                    }
                    nameEl.classList.remove('is-hidden');
                } else {
                    if (nameTextEl) nameTextEl.textContent = '';
                    else nameEl.textContent = '';
                    if (flagEl) flagEl.textContent = '';
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
                && !tuningLive
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
            this.syncTileCastUi(tile, id, player);

            const audioEl = tile.querySelector('.tv-player-tile__audio');
        });
        this.syncMosaicChrome();
        if (this.screensStripExpanded) this.syncScreenControls();
    },

    syncTileCastUi(tile, slotId, player) {
        const isCasting = ChromecastManager.isCasting();
        const isActiveCastSlot = ChromecastManager.getActiveSlot() === slotId;
        const hostVideo = ChromecastManager.getHostVideo();

        const castRow = tile.querySelector('[data-controls-row="cast"]');
        const localRow = tile.querySelector('[data-controls-row="local"]');
        const hover = tile.querySelector('.tv-player-tile__hover');
        const localLabel = tile.querySelector('.tv-controls__row-label--local');

        const dual = isCasting && isActiveCastSlot;

        if (hover) {
            hover.classList.toggle('is-casting', dual);
            hover.classList.toggle('has-dual-rows', dual);
        }

        if (castRow) {
            castRow.hidden = !dual;
        }
        if (localRow) {
            localRow.hidden = false;
        }
        if (localLabel) {
            localLabel.classList.toggle('is-hidden', !dual);
        }

        tile.querySelectorAll('[data-tile-action="cast"]').forEach((castBtn) => {
            const active = isCasting && isActiveCastSlot;
            castBtn.dataset.castActive = String(active);
            castBtn.classList.toggle('is-casting', active);
            castBtn.setAttribute('aria-pressed', String(active));
            castBtn.title = active ? 'Stop casting' : 'Cast';
            castBtn.setAttribute('aria-label', active ? 'Stop casting' : 'Cast');
        });

        tile.querySelectorAll('[data-cast-toggle="host-video"]').forEach((btn) => {
            btn.classList.toggle('is-active', hostVideo);
            btn.setAttribute('aria-pressed', String(hostVideo));
        });

        const intentPlaying = player?.wantPlaying === true || player?.playing === true;
        const showAudio = this.isSlotAudible(player);
        const audioEl = tile.querySelector('.tv-player-tile__audio');
        if (audioEl) {
            audioEl.classList.toggle('is-hidden', !showAudio);
        }

        tile.querySelectorAll('[data-controls-row="local"] [data-tile-action]').forEach((btn) => {
            this.syncTileControlButton(btn, player, slotId, {
                intentPlaying,
                isMuted: !showAudio,
                target: 'local'
            });
        });

        const volPct = tile.querySelector('[data-tile-vol-pct]');
        if (volPct) {
            const slotVol = Math.min(1, Math.max(0, Number.isFinite(player?.volume) ? player.volume : 1));
            volPct.textContent = String(Math.round(slotVol * 100));
        }

        if (isCasting && isActiveCastSlot) {
            const castPlaying = ChromecastManager.isCastPlaying();
            const castMuted = ChromecastManager.isCastMuted();
            tile.querySelectorAll('[data-controls-row="cast"] [data-tile-action]').forEach((btn) => {
                this.syncTileControlButton(btn, player, slotId, {
                    intentPlaying: castPlaying,
                    isMuted: castMuted,
                    target: 'cast'
                });
            });
        }
    },

    syncTileControlButton(btn, player, slotId, { intentPlaying, isMuted, target }) {
        const action = btn.getAttribute('data-tile-action');
        if (action === 'play') {
            btn.classList.remove('is-hidden');
            btn.textContent = intentPlaying ? '⏸' : '▶';
            btn.title = intentPlaying ? 'Pause' : 'Play';
            btn.setAttribute('aria-label', intentPlaying ? 'Pause' : 'Play');
            return;
        }
        if (action === 'mute') {
            btn.classList.toggle('is-muted', isMuted);
            btn.setAttribute('aria-pressed', String(isMuted));
            btn.title = isMuted ? 'Unmute' : 'Mute';
            const wave = btn.querySelector('.tile-mute-wave');
            const slash = btn.querySelector('.tile-mute-slash');
            if (wave) wave.style.opacity = isMuted ? '0' : '1';
            if (slash) slash.style.opacity = isMuted ? '1' : '0';
            return;
        }
        if (action === 'fav') {
            if (player?.channel) {
                const isFav = FavoritesRecents.isFavorite(player.channel);
                btn.classList.toggle('is-active', isFav);
                btn.innerHTML = isFav ? CARD_ICONS.starFilled : '☆';
                btn.setAttribute('aria-pressed', String(isFav));
            } else {
                btn.classList.remove('is-active');
                btn.textContent = '☆';
            }
            return;
        }
        if (action === 'pip') {
            const nativeSupported = pipSupported();
            const windowOpen = TvPopoutWindows.isOpen(slotId);
            const nativeActive = nativeSupported && document.pictureInPictureElement === player?.video;
            const active = nativeActive || windowOpen;
            btn.classList.remove('is-hidden');
            btn.classList.toggle('is-active', active);
            btn.innerHTML = active
                ? ACTION_ICONS.pictureInPictureExit
                : ACTION_ICONS.pictureInPicture;
            btn.title = active ? 'Pop in' : 'Pop out';
            btn.setAttribute('aria-label', active ? 'Pop in' : 'Pop out');
        }
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
        const swapSelect = el('swap-transition-select');
        if (swapSelect) {
            fillViewTransitionSelect(swapSelect, SettingsStore.getSwapTransition());
        }
        this.syncScreenControls();
    },

    bindScreenControls() {
        if (typeof document === 'undefined') return;
        if (document.body?.dataset?.screenControlsBound === '1') return;
        document.body.dataset.screenControlsBound = '1';

        document.body.addEventListener('click', (e) => {
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
                        import('./ui/remotePanel.js')
                            .then(({ syncRemotePanel }) => syncRemotePanel())
                            .catch(() => {});
                    }).catch(() => {});
                }
                return;
            }
            const screenBtn = e.target.closest('.tv-controls__screen-btn');
            if (screenBtn && strip.contains(screenBtn)) {
                e.stopPropagation();
                e.preventDefault();
                const slotId = screenBtn.dataset.screenSlot;
                if (slotId) this.focusScreen(slotId);
            }
        });

        document.body.addEventListener('mouseover', (e) => {
            const btn = e.target.closest?.('.tv-controls__screen-btn');
            if (!btn || btn.hidden || !btn.closest('.tv-controls__screens')) return;
            if (btn.contains(e.relatedTarget)) return;
            const slotId = btn.dataset.screenSlot;
            if (slotId) this.setScreenStripHover(slotId);
        });

        document.body.addEventListener('mouseout', (e) => {
            const btn = e.target.closest?.('.tv-controls__screen-btn');
            if (!btn || btn.hidden) return;
            if (btn.contains(e.relatedTarget)) return;
            if (e.relatedTarget?.closest?.('.tv-controls__screen-btn')) return;
            this.clearScreenStripHover();
        });

        this.syncScreenControls();
    },

    bindSettings() {
        if (typeof document === 'undefined') return;
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
        this.bindScreenControls();
    }
};
