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
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { ACTION_ICONS, CARD_ICONS } from './ui/icons.js';
import { showAppToast } from './ui/toast.js';
import { TvPopoutWindows } from './tvPopoutWindows.js';
import { el } from './tvUtils.js';
import { TileFrames } from './tileFrames.js';
import { PosterCache } from './storage/posterCache.js';
import {
    TILE_SWAP_DURATIONS,
    fillViewTransitionSelect,
    resolveViewTransition,
    runWipeTransition,
    VIEW_TRANSITION_LABELS
} from './ui/viewTransitions.js';
import { classifyTilePlayback, resolveRestorePlayMute } from './player/pauseBuffer.js';

const CORNER_IDS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const SLOT_IDS = ['topLeft', 'center', 'topRight', 'bottomLeft', 'bottomRight'];
/** Fill order for batch play: primary first, then corners. Raise with mosaic capacity later. */
export const MAX_MOSAIC_SLOTS = 5;
const PLAY_FILL_ORDER = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const DRAG_THRESHOLD_PX = 6;
const RESIZE_MIN_W = 72;
const RESIZE_MIN_H = 64;
const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']);

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

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const SWAP_DURATIONS = TILE_SWAP_DURATIONS;

function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearSwapClasses(tile) {
    if (!tile) return;
    tile.classList.remove(
        'tv-swap-out',
        'tv-swap-in',
        'tv-swap--smooth',
        'tv-swap--slide',
        'tv-swap--fade',
        'tv-swap--spring',
        'tv-swap--crossfade',
        'tv-swap--flip',
        'is-swapping'
    );
}

function clearTilePlacementStyle(tile) {
    if (!tile) return;
    tile.style.left = '';
    tile.style.top = '';
    tile.style.width = '';
    tile.style.height = '';
    tile.style.zIndex = '';
    tile.classList.remove('is-placed');
}

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

    getPrimary() {
        return this.slots.center.player;
    },

    /**
     * Apply saved mosaic assignments immediately (name + cached poster) before catalog/HLS.
     */
    applySavedSlotStubs() {
        const state = loadPlayerState();
        let mosaic = state.mosaicSlots && Object.keys(state.mosaicSlots).length
            ? state.mosaicSlots
            : null;
        if (!mosaic && state.lastChannelKey) {
            mosaic = {
                center: {
                    key: state.lastChannelKey,
                    name: state.lastChannelName || '',
                    muted: true,
                    url: ''
                }
            };
        }
        this.rememberedSlotKeys = {};
        if (!mosaic) {
            this.refreshTiles();
            return;
        }

        const keys = [];
        SLOT_IDS.forEach((id) => {
            const entry = mosaic[id];
            if (!entry?.key) return;
            this.rememberedSlotKeys[id] = entry.key;
            keys.push(entry.key);

            if (id !== 'center' && !this.slots[id]?.enabled) {
                this.setSideEnabled(id, true, { silent: true });
            }

            const startMuted = entry.muted !== false;
            const player = this.ensurePlayer(id, { startMuted });
            if (!player) return;
            player.muted = startMuted;
            player.applyAudioToVideo();

            if (!player.channel) {
                const parsed = parseChannelKey(entry.key);
                player.channel = {
                    providerId: parsed?.providerId,
                    channelId: parsed?.channelId,
                    channeluuid: entry.key,
                    name: entry.name || 'Last channel',
                    url_resolved: entry.url || undefined
                };
            }
        });

        this.syncLayout();
        this.mountAll();
        this.refreshTiles();

        if (!keys.length) return;
        PosterCache.getPosters(keys).then((map) => {
            let painted = false;
            SLOT_IDS.forEach((id) => {
                const key = this.rememberedSlotKeys[id];
                const player = this.slots[id]?.player;
                if (!key || !player) return;
                const poster = map.get(key);
                if (!poster) return;
                if (!player.posterDataUrl) {
                    player.posterDataUrl = poster;
                    painted = true;
                }
            });
            if (painted) this.refreshTiles();
        }).catch(() => {});
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

    hasCustomPlacement() {
        return SLOT_IDS.some((id) => Boolean(this.mosaicPlacement[id]));
    },

    /** Validate existing placement entries only (partial free-layout is OK). */
    isPlacementSane() {
        if (!this.hasCustomPlacement()) return true;
        for (const id of SLOT_IDS) {
            const p = this.mosaicPlacement[id];
            if (!p) continue;
            if (p.w < 0.05 || p.h < 0.08) return false;
        }
        return true;
    },

    /** Drop disabled corner entries; center stays when present. */
    sanitizePlacementMap(raw = {}) {
        const next = { ...raw };
        CORNER_IDS.forEach((id) => {
            if (!next[id]) return;
            if (!this.slots[id]?.enabled) delete next[id];
        });
        if (next.center && !this.slots.center?.enabled) delete next.center;
        return next;
    },

    /** Keep center strictly above every other placed tile (repairs saved state). */
    ensureCenterOnTop() {
        if (!this.hasCustomPlacement() || !this.mosaicPlacement.center) return;
        let maxOther = 0;
        for (const id of SLOT_IDS) {
            if (id === 'center') continue;
            const p = this.mosaicPlacement[id];
            if (!p) continue;
            maxOther = Math.max(maxOther, p.z || 1);
        }
        const centerZ = this.mosaicPlacement.center.z || 1;
        if (centerZ <= maxOther) {
            this.placementZTop = Math.max(this.placementZTop, maxOther + 1);
            this.mosaicPlacement.center.z = this.placementZTop;
        } else {
            this.placementZTop = Math.max(this.placementZTop, centerZ);
        }
    },

    /**
     * Raise a tile in the free-layout stack.
     * Center always gets the top z; a non-center slot becomes second-from-top.
     */
    raiseTileInStack(slotId) {
        if (!this.hasCustomPlacement()) return;

        this.placementZTop += 1;
        const top = this.placementZTop;

        if (this.mosaicPlacement.center) {
            this.mosaicPlacement.center.z = top;
            const centerTile = el('player-tile-center');
            if (centerTile) centerTile.style.zIndex = String(top);
        }

        if (slotId && slotId !== 'center' && this.mosaicPlacement[slotId]) {
            this.mosaicPlacement[slotId].z = top - 1;
            const tile = el(`player-tile-${slotId}`);
            if (tile) tile.style.zIndex = String(top - 1);
        }
    },

    placementZForSlot(slotId) {
        const p = this.mosaicPlacement[slotId];
        if (p?.z != null) return p.z;
        return slotId === 'center' ? this.placementZTop : Math.max(1, this.placementZTop - 1);
    },

    syncPlacementChrome() {
        if (typeof document === 'undefined') return;
        const app = el('app-container') || document.body;
        app.classList.toggle('has-custom-mosaic-placement', this.hasCustomPlacement());
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
        window.addEventListener('tv:popout_changed', () => this.refreshTiles());

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
                this.refreshTiles();
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
            this.refreshTiles();
        });
        video.addEventListener('leavepictureinpicture', () => {
            window.dispatchEvent(new CustomEvent('tv:pip_changed'));
            this.getPrimary()?.emitState();
            this.refreshTiles();
        });
    },

    bindUi() {
        const mosaic = el('player-mosaic');
        if (!mosaic || mosaic.dataset.bound === '1') return;
        mosaic.dataset.bound = '1';

        mosaic.addEventListener('pointerdown', (e) => this.onTilePointerDown(e));

        mosaic.addEventListener('click', (e) => {
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
            // Tile swap is handled on pointerup when the gesture was a click.
        });

        mosaic.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest?.('[data-tile-action]')) return;
            const tile = e.target.closest?.('.tv-player-tile');
            if (!tile || tile.getAttribute('data-slot') === 'center') return;
            e.preventDefault();
            const slotId = tile.getAttribute('data-slot');
            if (!slotId || !this.slots[slotId]?.enabled) return;
            this.swapWithCenter(slotId);
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
        this.refreshTiles();
        this.getPrimary()?.emitState();
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
        this.refreshTiles();
        this.getPrimary()?.emitState();
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

    onTilePointerDown(e) {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-tile-action]')) return;
        if (this.swapBusy) return;

        const tile = e.target.closest?.('.tv-player-tile');
        if (!tile || tile.classList.contains('is-hidden')) return;
        const slotId = tile.getAttribute('data-slot');
        if (!slotId || !SLOT_IDS.includes(slotId)) return;
        if (!this.slots[slotId]?.enabled) return;

        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        const resizeHandle = e.target.closest?.('[data-resize]');
        const resizeEdge = resizeHandle?.getAttribute('data-resize');
        if (resizeHandle && (!resizeEdge || !RESIZE_EDGES.has(resizeEdge))) return;

        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        this.dragSession = {
            mode: resizeHandle ? 'resize' : 'drag',
            edges: resizeEdge || '',
            slotId,
            tile,
            pointerId: e.pointerId,
            startX,
            startY,
            originLeft: 0,
            originTop: 0,
            width: 0,
            height: 0,
            dragged: Boolean(resizeHandle),
            startedFree: false
        };

        if (resizeHandle) {
            this.beginTileResize(this.dragSession);
        }

        const onMove = (ev) => {
            if (!this.dragSession || ev.pointerId !== this.dragSession.pointerId) return;
            if (this.dragSession.mode === 'resize') {
                this.moveTileResize(this.dragSession, ev.clientX, ev.clientY);
                return;
            }
            const dx = ev.clientX - this.dragSession.startX;
            const dy = ev.clientY - this.dragSession.startY;
            if (!this.dragSession.dragged) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                this.beginTileDrag(this.dragSession);
            }
            this.moveTileDrag(this.dragSession, ev.clientX, ev.clientY);
        };

        const onUp = (ev) => {
            if (!this.dragSession || ev.pointerId !== this.dragSession.pointerId) return;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            if (this.dragSession.mode === 'resize') {
                this.endTileResize(this.dragSession);
            } else {
                this.endTileDrag(this.dragSession);
            }
            this.dragSession = null;
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        try { tile.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    },

    beginTileDrag(session) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        session.dragged = true;
        if (!this.hasCustomPlacement()) {
            this.captureGridAsPlacement();
            session.startedFree = true;
        }

        this.raiseTileInStack(session.slotId);

        this.applyFreeLayout();

        const mosaicRect = mosaic.getBoundingClientRect();
        const tileRect = session.tile.getBoundingClientRect();
        session.originLeft = tileRect.left - mosaicRect.left;
        session.originTop = tileRect.top - mosaicRect.top;
        session.width = tileRect.width;
        session.height = tileRect.height;
        session.dragOriginClientX = session.startX;
        session.dragOriginClientY = session.startY;
        session.dragOriginLeft = session.originLeft;
        session.dragOriginTop = session.originTop;

        session.tile.classList.add('is-dragging');
        session.tile.classList.add('is-placed');
        session.tile.style.zIndex = String(this.placementZForSlot(session.slotId));
    },

    moveTileDrag(session, clientX, clientY) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        const mw = mosaic.clientWidth;
        let baseH = Number(mosaic.dataset.freeBaseHeight);
        if (!Number.isFinite(baseH) || baseH <= 0) {
            baseH = mosaic.clientHeight || 1;
        }
        const dx = clientX - (session.dragOriginClientX ?? session.startX);
        const dy = clientY - (session.dragOriginClientY ?? session.startY);
        let left = (session.dragOriginLeft ?? session.originLeft) + dx;
        let top = (session.dragOriginTop ?? session.originTop) + dy;
        const w = session.width;
        const h = session.height;

        left = Math.min(Math.max(0, left), Math.max(0, mw - w));
        top = Math.min(Math.max(0, top), Math.max(0, baseH - h));

        session.tile.style.left = `${left}px`;
        session.tile.style.top = `${top}px`;
        session.tile.style.width = `${w}px`;
        session.tile.style.height = `${h}px`;

        if (mw > 0 && baseH > 0) {
            this.mosaicPlacement[session.slotId] = {
                x: left / mw,
                y: top / baseH,
                w: w / mw,
                h: h / baseH,
                z: this.placementZForSlot(session.slotId)
            };
        }

        const maxBottom = top + h;
        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, maxBottom + 8))}px`;
    },

    endTileDrag(session) {
        if (!session?.tile) return;
        session.tile.classList.remove('is-dragging');
        try { session.tile.releasePointerCapture?.(session.pointerId); } catch { /* ignore */ }

        if (session.dragged) {
            this.persistPlacement();
            this.applyFreeLayout();
            this.syncPlacementChrome();
            return;
        }

        // Click (no drag): corner tiles swap with center.
        const { slotId } = session;
        if (slotId && slotId !== 'center' && CORNER_IDS.includes(slotId) && this.slots[slotId]?.enabled) {
            if (this.hasCustomPlacement()) {
                this.raiseTileInStack(slotId);
                this.persistPlacement();
            }
            this.swapWithCenter(slotId);
        }
    },

    beginTileResize(session) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        if (!this.hasCustomPlacement()) {
            this.captureGridAsPlacement();
            session.startedFree = true;
        }

        this.raiseTileInStack(session.slotId);

        this.applyFreeLayout();

        const mosaicRect = mosaic.getBoundingClientRect();
        const tileRect = session.tile.getBoundingClientRect();
        session.originLeft = tileRect.left - mosaicRect.left;
        session.originTop = tileRect.top - mosaicRect.top;
        session.width = tileRect.width;
        session.height = tileRect.height;
        session.dragOriginClientX = session.startX;
        session.dragOriginClientY = session.startY;

        session.tile.classList.add('is-resizing');
        session.tile.classList.add('is-placed');
        session.tile.style.zIndex = String(this.placementZForSlot(session.slotId));
    },

    moveTileResize(session, clientX, clientY) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        const mw = mosaic.clientWidth;
        let baseH = Number(mosaic.dataset.freeBaseHeight);
        if (!Number.isFinite(baseH) || baseH <= 0) {
            baseH = mosaic.clientHeight || 1;
        }

        const dx = clientX - (session.dragOriginClientX ?? session.startX);
        const dy = clientY - (session.dragOriginClientY ?? session.startY);
        const edges = session.edges || '';

        let left = session.originLeft;
        let top = session.originTop;
        let w = session.width;
        let h = session.height;
        const right = session.originLeft + session.width;
        const bottom = session.originTop + session.height;

        if (edges.includes('e')) {
            w = Math.max(RESIZE_MIN_W, session.width + dx);
            w = Math.min(w, Math.max(RESIZE_MIN_W, mw - left));
        }
        if (edges.includes('s')) {
            h = Math.max(RESIZE_MIN_H, session.height + dy);
            h = Math.min(h, Math.max(RESIZE_MIN_H, baseH - top));
        }
        if (edges.includes('w')) {
            const nextLeft = Math.min(right - RESIZE_MIN_W, Math.max(0, session.originLeft + dx));
            w = right - nextLeft;
            left = nextLeft;
        }
        if (edges.includes('n')) {
            const nextTop = Math.min(bottom - RESIZE_MIN_H, Math.max(0, session.originTop + dy));
            h = bottom - nextTop;
            top = nextTop;
        }

        left = Math.min(Math.max(0, left), Math.max(0, mw - w));
        top = Math.min(Math.max(0, top), Math.max(0, baseH - h));
        w = Math.max(RESIZE_MIN_W, Math.min(w, mw - left));
        h = Math.max(RESIZE_MIN_H, Math.min(h, baseH - top));

        session.tile.style.left = `${left}px`;
        session.tile.style.top = `${top}px`;
        session.tile.style.width = `${w}px`;
        session.tile.style.height = `${h}px`;

        if (mw > 0 && baseH > 0) {
            this.mosaicPlacement[session.slotId] = {
                x: left / mw,
                y: top / baseH,
                w: w / mw,
                h: h / baseH,
                z: this.placementZForSlot(session.slotId)
            };
        }

        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, top + h + 8))}px`;
    },

    endTileResize(session) {
        if (!session?.tile) return;
        session.tile.classList.remove('is-resizing');
        try { session.tile.releasePointerCapture?.(session.pointerId); } catch { /* ignore */ }

        this.persistPlacement();
        this.applyFreeLayout();
        this.syncPlacementChrome();
    },

    captureGridAsPlacement() {
        const mosaic = el('player-mosaic');
        if (!mosaic) return;
        const mosaicRect = mosaic.getBoundingClientRect();
        const mw = mosaicRect.width || mosaic.clientWidth;
        const mh = mosaicRect.height || mosaic.clientHeight;
        if (mw <= 0 || mh <= 0) return;

        const next = {};
        let z = 1;
        // Measure every visible tile before absolutizing into free-layout.
        SLOT_IDS.forEach((id) => {
            if (!this.slots[id]?.enabled) return;
            const tile = el(`player-tile-${id}`);
            if (!tile || tile.classList.contains('is-hidden')) return;
            const r = tile.getBoundingClientRect();
            const left = r.left - mosaicRect.left;
            const top = r.top - mosaicRect.top;
            const width = Math.max(48, r.width);
            const height = Math.max(36, r.height);
            next[id] = {
                x: left / mw,
                y: top / mh,
                w: width / mw,
                h: height / mh,
                z: z++
            };
            tile.style.left = `${left}px`;
            tile.style.top = `${top}px`;
            tile.style.width = `${width}px`;
            tile.style.height = `${height}px`;
            tile.style.zIndex = String(next[id].z);
            tile.classList.add('is-placed');
        });

        if (!Object.keys(next).length) return;

        this.mosaicPlacement = next;
        this.placementZTop = Object.values(next).reduce((max, p) => Math.max(max, p.z || 1), 1);
        this.ensureCenterOnTop();
        if (next.center) {
            const centerTile = el('player-tile-center');
            if (centerTile) centerTile.style.zIndex = String(next.center.z);
        }
        mosaic.dataset.freeBaseHeight = String(Math.ceil(mh));
        mosaic.style.minHeight = `${Math.ceil(mh)}px`;
        mosaic.classList.add('is-free-layout');
        this.syncLayout();
        this.syncPlacementChrome();
    },

    applyFreeLayout() {
        const mosaic = el('player-mosaic');
        if (!mosaic || !this.hasCustomPlacement()) return;

        this.mosaicPlacement = this.sanitizePlacementMap(this.mosaicPlacement);
        this.ensureCenterOnTop();

        if (!this.isPlacementSane()) {
            this.mosaicPlacement = {};
            this.placementZTop = 1;
            this.clearFreeLayoutStyles();
            this.persistPlacement();
            this.syncLayout();
            this.syncPlacementChrome();
            return;
        }

        const mw = mosaic.clientWidth;
        if (mw <= 0) return;

        let baseH = Number(mosaic.dataset.freeBaseHeight);
        if (!Number.isFinite(baseH) || baseH < 120) {
            const measured = mosaic.classList.contains('is-free-layout')
                ? 0
                : mosaic.clientHeight;
            baseH = Math.max(measured, 240);
            mosaic.dataset.freeBaseHeight = String(Math.ceil(baseH));
        }

        mosaic.classList.add('is-free-layout');

        let maxBottom = 0;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const enabled = this.slots[id]?.enabled;
            if (!enabled) {
                clearTilePlacementStyle(tile);
                return;
            }
            const p = this.mosaicPlacement[id];
            if (!p) {
                clearTilePlacementStyle(tile);
                return;
            }
            const left = p.x * mw;
            const top = p.y * baseH;
            const width = Math.max(RESIZE_MIN_W, p.w * mw);
            const height = Math.max(RESIZE_MIN_H, p.h * baseH);
            tile.style.left = `${left}px`;
            tile.style.top = `${top}px`;
            tile.style.width = `${width}px`;
            tile.style.height = `${height}px`;
            tile.style.zIndex = String(p.z || 1);
            tile.classList.add('is-placed');
            maxBottom = Math.max(maxBottom, top + height);
        });

        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, maxBottom + 8))}px`;
        this.syncPlacementChrome();
    },

    clearFreeLayoutStyles() {
        const mosaic = el('player-mosaic');
        mosaic?.classList.remove('is-free-layout');
        if (mosaic) {
            mosaic.style.minHeight = '';
            delete mosaic.dataset.freeBaseHeight;
        }
        SLOT_IDS.forEach((id) => clearTilePlacementStyle(el(`player-tile-${id}`)));
    },

    persistPlacement() {
        const cleaned = this.sanitizePlacementMap(this.mosaicPlacement);
        this.mosaicPlacement = cleaned;
        savePlayerState({ mosaicPlacement: { ...cleaned } });
    },

    resetMosaicPlacement() {
        this.mosaicPlacement = {};
        this.placementZTop = 1;
        this.clearFreeLayoutStyles();
        this.persistPlacement();
        this.syncLayout();
        this.mountAll();
        this.refreshTiles();
        this.syncPlacementChrome();
    },

    async handleTileAction(slotId, action) {
        if (slotId === 'center') return;

        if (action === 'dismiss') {
            this.setSideEnabled(slotId, false);
            return;
        }

        const player = this.slots[slotId]?.player;
        if (!player) return;

        switch (action) {
            case 'play':
            case 'pause':
                // Same stable control: toggle intent (hiding swap drops mash clicks).
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
        this.refreshTiles();
    },

    syncLayout() {
        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        const hasTopLeft = this.slots.topLeft.enabled;
        const hasTopRight = this.slots.topRight.enabled;
        const hasBottomLeft = this.slots.bottomLeft.enabled;
        const hasBottomRight = this.slots.bottomRight.enabled;
        const hasLeft = hasTopLeft || hasBottomLeft;
        const hasRight = hasTopRight || hasBottomRight;
        const hasTop = hasTopLeft || hasTopRight;
        const hasBottom = hasBottomLeft || hasBottomRight;
        const hasAnyCorner = hasLeft || hasRight;

        mosaic.classList.toggle('has-left', hasLeft);
        mosaic.classList.toggle('has-right', hasRight);
        mosaic.classList.toggle('has-top-left', hasTopLeft);
        mosaic.classList.toggle('has-top-right', hasTopRight);
        mosaic.classList.toggle('has-bottom-left', hasBottomLeft);
        mosaic.classList.toggle('has-bottom-right', hasBottomRight);
        mosaic.classList.toggle('has-corners', hasAnyCorner);

        let areas = '"center"';
        let columns = '1fr';
        let rows = '1fr';

        // While tiles are free-placed, keep a single-cell grid shell as the floor;
        // all players (including center) overlay via absolute placement.
        if (this.hasCustomPlacement()) {
            areas = '"center"';
            columns = '1fr';
            rows = '1fr';
        } else if (!hasAnyCorner) {
            areas = '"center"';
            columns = '1fr';
            rows = '1fr';
        } else if (hasTop && hasBottom) {
            if (hasLeft && hasRight) {
                areas = '"topLeft center topRight" "bottomLeft center bottomRight"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
                rows = '1fr 1fr';
            } else if (hasLeft) {
                areas = '"topLeft center" "bottomLeft center"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
                rows = '1fr 1fr';
            } else {
                areas = '"center topRight" "center bottomRight"';
                columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
                rows = '1fr 1fr';
            }
        } else if (hasTop) {
            if (hasLeft && hasRight) {
                areas = '"topLeft center topRight"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
            } else if (hasLeft) {
                areas = '"topLeft center"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
            } else {
                areas = '"center topRight"';
                columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
            }
        } else if (hasBottom) {
            if (hasLeft && hasRight) {
                areas = '"bottomLeft center bottomRight"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
            } else if (hasLeft) {
                areas = '"bottomLeft center"';
                columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
            } else {
                areas = '"center bottomRight"';
                columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
            }
        }

        mosaic.style.gridTemplateAreas = areas;
        mosaic.style.gridTemplateColumns = columns;
        mosaic.style.gridTemplateRows = rows;

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
    },

    mountAll() {
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot.enabled || !slot.player) return;
            const surface = el(`tv-playback-surface-${id}`);
            if (surface) slot.player.mountVideo(surface);
        });
    },

    ensureMounted() {
        this.mountAll();
    },

    setSideEnabled(sideId, enabled, { silent = false } = {}) {
        if (!CORNER_IDS.includes(sideId)) return;
        const slot = this.slots[sideId];
        const next = Boolean(enabled);
        if (slot.enabled === next && slot.player) {
            this.syncLayout();
            this.mountAll();
            this.refreshTiles();
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
        this.refreshTiles();
        if (!silent) {
            this.syncSettingsToggles();
            this.getPrimary()?.emitState();
            // Never persist during silent boot enable — that would wipe saved
            // mosaic channels before restoreSlots() runs.
            this.persistSlots();
        }
    },

    persistSlots() {
        const prev = loadPlayerState().mosaicSlots || {};
        const mosaicSlots = { ...prev };

        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            // Keep prior memory for disabled corners; only rewrite enabled slots.
            if (!slot?.enabled) return;

            if (!slot.player?.channel) {
                // Before hydrate, empty players must not wipe saved satellites.
                if (!this.slotsHydrated) return;
                // Keep remembered stub assignments (instant restore) even if HLS failed.
                if (this.rememberedSlotKeys[id]) return;
                delete mosaicSlots[id];
                return;
            }
            const key = channelKey(slot.player.channel);
            if (!key || key.endsWith(':')) {
                if (!this.slotsHydrated) return;
                delete mosaicSlots[id];
                return;
            }
            mosaicSlots[id] = {
                key,
                name: slot.player.channel.name || '',
                muted: slot.player.muted !== false,
                url: slot.player.channel.url_resolved || slot.player.channel.url || ''
            };
        });

        const primary = this.getPrimary();
        const primaryKey = primary?.channel ? channelKey(primary.channel) : null;
        savePlayerState({
            mosaicSlots,
            ...(primaryKey && !primaryKey.endsWith(':')
                ? {
                    lastChannelKey: primaryKey,
                    lastChannelName: primary.channel.name || ''
                }
                : {})
        });
    },

    /**
     * Restore remembered channels into all slots. Only the center plays when
     * wasPlaying was true; every other slot loads paused (+ cached poster when available).
     * Stubs/posters are applied in applySavedSlotStubs(); this attaches streams in parallel.
     */
    async restoreSlots() {
        const state = loadPlayerState();
        let mosaic = state.mosaicSlots && Object.keys(state.mosaicSlots).length
            ? state.mosaicSlots
            : null;

        if (!mosaic && state.lastChannelKey) {
            mosaic = {
                center: {
                    key: state.lastChannelKey,
                    name: state.lastChannelName || '',
                    muted: true
                }
            };
        }
        if (!mosaic) {
            this.slotsHydrated = true;
            return false;
        }

        try {
            // Re-enable any satellite that has a saved channel so restore cannot skip it.
            CORNER_IDS.forEach((id) => {
                if (!mosaic[id]?.key) return;
                if (!this.slots[id]?.enabled) {
                    this.setSideEnabled(id, true, { silent: true });
                }
            });
            this.syncLayout();
            this.mountAll();
            this.syncSettingsToggles();

            const resolveEntry = async (entry) => {
                let channel = null;
                try {
                    channel = await TvProviderRegistry.getChannel(parseChannelKey(entry.key));
                } catch { /* ignore */ }

                if (channel?.url_resolved) return channel;

                const parsed = parseChannelKey(entry.key);
                const url = entry.url || channel?.url_resolved || '';
                if (!url && !parsed) return null;

                return {
                    providerId: parsed?.providerId || channel?.providerId,
                    channelId: parsed?.channelId || channel?.channelId,
                    channeluuid: entry.key,
                    name: entry.name || channel?.name || 'Last channel',
                    url_resolved: url || undefined,
                    countrycode: channel?.countrycode || ''
                };
            };

            const restoreOne = async (id, { play } = {}) => {
                const entry = mosaic[id];
                if (!entry?.key) return;
                if (id !== 'center' && !this.slots[id]?.enabled) return;

                const desiredMuted = entry.muted !== false;
                const player = this.ensurePlayer(id, { startMuted: desiredMuted });
                player.muted = desiredMuted;
                player.applyAudioToVideo();

                const surface = el(`tv-playback-surface-${id}`);
                if (surface) player.mountVideo(surface);

                const channel = await resolveEntry(entry);
                if (!channel) {
                    const parsed = parseChannelKey(entry.key);
                    player.channel = {
                        providerId: parsed?.providerId,
                        channelId: parsed?.channelId,
                        channeluuid: entry.key,
                        name: entry.name || 'Last channel'
                    };
                    player.emitState();
                    return;
                }

                if (!channel.url_resolved) {
                    player.channel = channel;
                    player.emitState();
                    return;
                }

                this.rememberedSlotKeys[id] = entry.key;

                if (play) {
                    // Muted-first autoplay (historical boot behavior); re-apply saved mute after.
                    const mutePlan = resolveRestorePlayMute(entry.muted);
                    player.muted = mutePlan.duringPlay;
                    player.applyAudioToVideo();
                    try {
                        await player.playChannel(channel);
                    } catch { /* autoplay may block */ }
                    // Keep last poster until live video paints; do not force-clear.
                    player.muted = mutePlan.afterPlay;
                } else {
                    await player.loadChannelPaused(channel);
                    player.muted = desiredMuted;
                }

                player.applyAudioToVideo();
                this.refreshTiles();
            };

            const centerPlay = state.wasPlaying === true;
            await Promise.all([
                restoreOne('center', { play: centerPlay }),
                ...CORNER_IDS.map((id) => restoreOne(id, { play: false }))
            ]);

            this.mountAll();
            this.refreshTiles();
            this.getPrimary()?.emitState();
            this.persistSlots();
            if (this.hasCustomPlacement()) {
                requestAnimationFrame(() => this.applyFreeLayout());
            }
            return true;
        } finally {
            this.slotsHydrated = true;
        }
    },

    swapWithCenter(sideId) {
        if (!CORNER_IDS.includes(sideId)) return;
        if (this.swapBusy) return;
        const side = this.slots[sideId];
        const center = this.slots.center;
        if (!side.enabled || !side.player || !center.player) return;

        let mode = resolveViewTransition(SettingsStore.getSwapTransition(), 'swap');
        // Absolute free-layout tiles fight scale/flip transforms — keep opacity only.
        if (this.hasCustomPlacement() && (mode === 'smooth' || mode === 'flip' || mode === 'slide' || mode === 'spring')) {
            mode = 'crossfade';
        }
        if (mode === 'instant' || prefersReducedMotion()) {
            this.commitSwap(sideId);
            return;
        }
        if (mode === 'dissolve' || mode === 'grain') {
            this.animateSwapWipe(sideId, mode);
            return;
        }
        // fade shares tile CSS with crossfade naming when needed
        const tileMode = mode === 'fade' ? 'fade' : mode;
        if (!SWAP_DURATIONS[tileMode] && !SWAP_DURATIONS[mode]) {
            this.commitSwap(sideId);
            return;
        }
        this.animateSwap(sideId, tileMode);
    },

    commitSwap(sideId) {
        const side = this.slots[sideId];
        const center = this.slots.center;
        if (!side?.player || !center?.player) return;

        const centerWasPlaying = center.player.playing === true;
        const sideWasPlaying = side.player.playing === true;

        const tmp = center.player;
        center.player = side.player;
        side.player = tmp;

        center.player.id = 'center';
        side.player.id = sideId;

        this.mountAll();
        this.refreshTiles();

        // Keep both streams playing across the swap when they were already live.
        // Auto-pause only happens on full page reload (restoreSlots).
        if (centerWasPlaying && center.player.channel && !center.player.playing) {
            center.player.posterDataUrl = null;
            center.player.toggle().catch(() => {});
        } else if (center.player.playing) {
            center.player.posterDataUrl = null;
        }

        if (sideWasPlaying && side.player.channel && !side.player.playing) {
            side.player.posterDataUrl = null;
            side.player.toggle().catch(() => {});
        } else if (side.player.playing) {
            side.player.posterDataUrl = null;
        }

        center.player.emitState();
        this.persistSlots();
        this.refreshTiles();
        window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
            detail: { primary: 'center', swapped: sideId }
        }));
    },

    async animateSwapWipe(sideId, mode) {
        const centerTile = el('player-tile-center');
        const sideTile = el(`player-tile-${sideId}`);
        if (!centerTile || !sideTile) {
            this.commitSwap(sideId);
            return;
        }
        this.swapBusy = true;
        try {
            // Grain/dissolve only the two tiles in the swap — leave the rest of the mosaic alone.
            await runWipeTransition(mode, () => this.commitSwap(sideId), {
                scope: 'tiles',
                fadeTargets: [centerTile, sideTile],
                grainHosts: [centerTile, sideTile]
            });
        } finally {
            this.swapBusy = false;
        }
    },

    async animateSwap(sideId, mode) {
        const centerTile = el('player-tile-center');
        const sideTile = el(`player-tile-${sideId}`);
        if (!centerTile || !sideTile) {
            this.commitSwap(sideId);
            return;
        }

        this.swapBusy = true;
        const duration = SWAP_DURATIONS[mode] || 280;
        const modeClass = `tv-swap--${mode}`;

        try {
            centerTile.classList.add('is-swapping', modeClass, 'tv-swap-out');
            sideTile.classList.add('is-swapping', modeClass, 'tv-swap-out');
            // Force style application before waiting
            void centerTile.offsetWidth;
            await waitMs(duration);

            this.commitSwap(sideId);

            clearSwapClasses(centerTile);
            clearSwapClasses(sideTile);
            centerTile.classList.add('is-swapping', modeClass, 'tv-swap-in');
            sideTile.classList.add('is-swapping', modeClass, 'tv-swap-in');
            void centerTile.offsetWidth;
            await waitMs(duration);
        } finally {
            clearSwapClasses(centerTile);
            clearSwapClasses(sideTile);
            this.swapBusy = false;
        }
    },

    playOnPrimary(channel) {
        const primary = this.getPrimary();
        if (!primary) return Promise.reject(new Error('No primary player'));
        this.mountAll();
        return primary.playChannel(channel).finally(() => this.persistSlots());
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
        this.refreshTiles();
        this.getPrimary()?.emitState();
    },

    setSharedVolume(value) {
        const clamped = Math.min(1, Math.max(0, value));
        this.sharedVolume = clamped;
        if (clamped > 0) this.lastVolume = clamped;
        savePlayerState({ volume: clamped });
        this.applyVolumeToAll();
        const primary = this.getPrimary();
        if (primary && clamped > 0) {
            primary.muted = false;
        } else if (primary && clamped === 0) {
            primary.muted = true;
        }
        this.applyVolumeToAll();
        primary?.emitState();
        this.refreshTiles();
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
            const hasChannel = Boolean(player?.channel) || Boolean(rememberedKey);
            const empty = tile.querySelector('.tv-player-tile__empty');
            const intentPlaying = player?.wantPlaying === true || player?.playing === true;
            const { uiPlaying, uiPaused, uiStopped } = classifyTilePlayback({
                hasChannel,
                playing: intentPlaying,
                posterDataUrl: player?.posterDataUrl,
                pausePhase: player?.pausePhase,
                stopped: player?.stopped === true
            });

            tile.classList.toggle('is-empty', !hasChannel);
            tile.classList.toggle('is-playing', uiPlaying);
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
            // Poster covers stubs/reload before the <video> has a decoded frame.
            // Once paused with a real frame, leave the video visible (native freeze).
            const videoHasFrame = Boolean(player?.video?.videoWidth > 0);
            const showPoster = Boolean(
                hasChannel
                && player
                && player.posterDataUrl
                && !uiPlaying
                && !videoHasFrame
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

            if (id === 'center') return;

            const playBtn = tile.querySelector('[data-tile-action="play"]');
            const pauseBtn = tile.querySelector('[data-tile-action="pause"]');
            const muteBtn = tile.querySelector('.tv-player-tile__hover [data-tile-action="mute"]');
            const favBtn = tile.querySelector('[data-tile-action="fav"]');
            const pipBtn = tile.querySelector('[data-tile-action="pip"]');
            const audioEl = tile.querySelector('.tv-player-tile__audio');

            // One stable hit-target — icon swaps; pause button stays hidden.
            if (playBtn) {
                playBtn.classList.remove('is-hidden');
                playBtn.textContent = uiPlaying ? '⏸' : '▶';
                playBtn.title = uiPlaying ? 'Pause' : 'Play';
                playBtn.setAttribute('aria-label', uiPlaying ? 'Pause' : 'Play');
            }
            if (pauseBtn) {
                pauseBtn.classList.add('is-hidden');
                pauseBtn.setAttribute('aria-hidden', 'true');
            }

            // Solid corner speaker only while unmuted with audible volume; click mutes.
            const showAudio = Boolean(
                hasChannel
                && player
                && player.muted === false
                && this.sharedVolume > 0
            );
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
