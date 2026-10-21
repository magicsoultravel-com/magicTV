/**
 * YouTube mode for one mosaic tile.
 *
 * Methods mix into MultiView (this === MultiView). A tile in YouTube mode holds
 * a `createYouTubePlayer()` adapter in `slot.player`; every other mosaic code
 * path (chrome, persist, occupancy, volume, watch echo, play/stop) keeps working
 * because the adapter mirrors the real player contract.
 *
 * Rules:
 *  - Only one tile may run YouTube at a time (`_ytLiveSlotId`); starting another
 *    detaches the previous one first.
 *  - Any TV tune on that slot (channel pick, prev/next, restore, popout) detaches
 *    YouTube mode via `detachYouTubeModeSync()` inside `prepareSlotForPlay`.
 *  - Turning YouTube off restores the TV channel that was on the tile before.
 */
import { showAppToast } from '../ui/toast.js';
import { cancelSlotPrefetch } from '../player/channelPrefetch.js';
import { ChromecastManager } from '../cast/chromecastManager.js';
import { TvPopoutWindows } from '../tvPopoutWindows.js';
import {
    isYouTubeEntry,
    normalizeYouTubeId,
    youtubeEntryConfig,
    youtubeKey
} from '../youtube/youtubeLinks.js';
import { createYouTubePlayer, captureYouTubeSwapState } from '../youtube/youtubePlayer.js';
import {
    buildYouTubeQueue,
    appendYouTubeRelated,
    listYouTubeHistory,
    recordYouTubeHistory,
    resolveYouTubeQueueStep,
    selectYouTubeQueueIndex,
    queueIndexOf,
    saveYouTubeQueue
} from '../youtube/youtubeQueue.js';
import { fetchYouTubeRelated } from '../youtube/youtubeRelated.js';
import { listYouTubeClips, touchYouTubeClip } from '../youtube/youtubeLibrary.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { stubChannelFromEntry } from './persist.js';
import { channelKey } from '../tvProviders/channelShape.js';
import {
    captureSwapPlaybackState,
    applySwapPlaybackContinuity
} from './swapPlayback.js';

function slotHasLiveTv(player) {
    return Boolean(player && player.kind !== 'youtube' && player.channel);
}

export const youtubeMethods = {
    /** @param {string} slotId */
    isYouTubeSlot(slotId) {
        return this.slots?.[slotId]?.player?.kind === 'youtube';
    },

    /** True when any tile currently runs YouTube mode. */
    hasYouTubeSlot() {
        if (this._ytLiveSlotId) return true;
        return Object.values(this.slots || {}).some((slot) => slot?.player?.kind === 'youtube');
    },

    /**
     * Start (or switch) YouTube mode on one tile.
     * @param {string} slotId
     * @param {string} videoIdOrUrl
     * @param {{ autoplay?: boolean, title?: string, startAt?: number, silent?: boolean, persist?: boolean }} [opts]
     * @returns {Promise<boolean>} true when the adapter is mounted
     */
    async enterYouTubeMode(slotId, videoIdOrUrl, {
        autoplay = true,
        title = '',
        startAt = 0,
        silent = false,
        persist = true
    } = {}) {
        const videoId = normalizeYouTubeId(videoIdOrUrl);
        if (!videoId) {
            if (!silent) showAppToast('Paste a YouTube link or 11-character id');
            return false;
        }
        const slot = this.slots?.[slotId];
        if (!slot) return false;

        // One live YouTube tile: detach the previous one before taking over.
        if (this._ytLiveSlotId && this._ytLiveSlotId !== slotId) {
            this.detachYouTubeModeSync(this._ytLiveSlotId);
        }

        // A cross-origin embed can't be cast or popped out — release both first.
        try {
            if (ChromecastManager.getActiveSlot() === slotId && ChromecastManager.isCasting()) {
                await ChromecastManager.stopCast?.();
            }
        } catch { /* ignore */ }
        try {
            if (TvPopoutWindows.isOpen?.(slotId)) TvPopoutWindows.close(slotId);
        } catch { /* ignore */ }

        if (slotId !== 'center' && !slot.enabled) {
            this.setSideEnabled(slotId, true, { silent: true });
            if (!this.slots[slotId]?.enabled) {
                if (!silent) showAppToast('All TV slots are in use');
                return false;
            }
        }

        const current = slot.player;
        if (!this.youtubeReturn) this.youtubeReturn = {};
        const hadReturn = Boolean(this.youtubeReturn[slotId]);
        // Preserve mute/volume when switching clips or taking over a live TV,
        // otherwise use the same default as a normal play (center audible).
        const carryFromPlayer = Boolean(
            current && (current.kind === 'youtube' || current.channel)
        );
        const carriedMuted = carryFromPlayer ? current.muted : null;
        const carriedVolume = carryFromPlayer ? current.volume : null;

        if (!hadReturn) {
            const previousChannel = slotHasLiveTv(current) ? current.channel : null;
            const rememberedKey = this.rememberedSlotKeys?.[slotId] || '';
            if (previousChannel || rememberedKey) {
                this.youtubeReturn[slotId] = {
                    channel: previousChannel,
                    key: previousChannel ? '' : rememberedKey,
                    name: previousChannel?.name || '',
                    muted: previousChannel ? current.muted : true,
                    volume: previousChannel ? current.volume : 1
                };
            }
        }
        if (this.rememberedSlotKeys) delete this.rememberedSlotKeys[slotId];
        if (this._ytPendingReturn) delete this._ytPendingReturn[slotId];

        // Same tile, different clip (picker / tray): swap on the live iframe
        // instead of tearing it down, so mute/volume and player readiness stay.
        if (current?.kind === 'youtube' && typeof current.swapVideo === 'function') {
            const swapped = current.swapVideo(videoId, { title, startAt, autoplay });
            if (swapped) {
                this._ytResetQueue(slotId, current);
                recordYouTubeHistory({
                    videoId,
                    title: title || current.channel?.name || '',
                    author: this._ytAuthors?.[videoId] || ''
                });
                if (autoplay) this._ytPrefetchRelated(slotId);
                if (persist) this.persistSlots?.();
                this.scheduleRefreshTiles?.();
                this.syncStatusChrome?.();
                return true;
            }
        }

        if (current && current.kind !== 'youtube') {
            cancelSlotPrefetch(slotId);
            try {
                if (typeof current.dispose === 'function') await current.dispose();
                else await current.stop?.({ clearChannel: true });
            } catch { /* ignore */ }
        } else if (current?.kind === 'youtube') {
            try {
                current.destroy?.();
            } catch { /* ignore */ }
            slot.player = null;
        } else {
            slot.player = null;
        }

        const muted = carriedMuted != null ? carriedMuted : slotId !== 'center';
        const volume = carriedVolume != null ? Number(carriedVolume) : 1;
        const player = this._ytCreateSlotPlayer(slotId, {
            videoId,
            title,
            startAt,
            muted,
            volume
        });
        if (!player) return false;

        this._ytResetQueue(slotId, player);
        recordYouTubeHistory({
            videoId,
            title: title || player.channel?.name || '',
            author: this._ytAuthors?.[videoId] || ''
        });
        if (autoplay) {
            player.resume();
            // Fill the tray with next-up previews (local queue is already there).
            this._ytPrefetchRelated(slotId);
        }
        if (persist) this.persistSlots?.();
        this.scheduleRefreshTiles?.();
        this.syncStatusChrome?.();
        return true;
    },


    /**
     * Commit a main-screen swap where one of the two tiles runs YouTube.
     *
     * A cross-origin iframe can't be re-parented without reloading, so the
     * embed is torn down and rebuilt on the destination slot with the same
     * clip, playhead, mute/volume and play intent. The TV player simply moves
     * to the vacated slot — its <video> is relocated, never reloaded.
     *
     * @param {string} sideId corner that was swapped with main
     * @param {string} ytSlot slot currently running YouTube (`center` or `sideId`)
     * @param {{ unmuteCenter?: boolean }} [opts]
     * @returns {boolean} true when the swap was committed
     */
    commitSwapWithYouTube(sideId, ytSlot, opts = {}) {
        const tvSlot = ytSlot === 'center' ? sideId : 'center';
        const ytSlotState = this.slots?.[ytSlot];
        const tvSlotState = this.slots?.[tvSlot];
        const ytPlayer = ytSlotState?.player;
        const tvPlayer = tvSlotState?.player;
        if (ytPlayer?.kind !== 'youtube' || !tvPlayer) return false;

        const ytState = captureYouTubeSwapState(ytPlayer);
        const tvBefore = captureSwapPlaybackState(tvPlayer);
        // The queue survives the iframe rebuild so next/prev keeps its place.
        const ytQueueBefore = this._ytQueue;

        // Tear the embed down first: its surface is about to host the TV player.
        this.detachYouTubeModeSync(ytSlot);

        // The TV player takes over the YouTube slot; the old TV slot is filled
        // by the recreated embed below.
        ytSlotState.player = tvPlayer;
        tvSlotState.player = null;
        tvPlayer.id = ytSlot;

        this.rememberedSlotKeys = this.rememberedSlotKeys || {};
        const tvKey = tvPlayer.channel ? channelKey(tvPlayer.channel) : '';
        if (tvKey) this.rememberedSlotKeys[ytSlot] = tvKey;
        else delete this.rememberedSlotKeys[ytSlot];
        delete this.rememberedSlotKeys[tvSlot];

        // Relocate before mountAll so _syncVideoMount never sees a stray <video>.
        this.relocateOwnedSlotVideos?.();
        cancelSlotPrefetch(ytSlot);
        cancelSlotPrefetch(tvSlot);
        this.mountAll?.();
        applySwapPlaybackContinuity(tvBefore, tvPlayer);

        const player = this._ytCreateSlotPlayer(tvSlot, ytState);
        if (player) this._ytAdoptQueue(tvSlot, player, ytQueueBefore);
        if (player && ytState.autoplay) player.resume();

        // The channel YouTube displaced follows the embed to its new tile, so
        // leaving YouTube there restores it instead of duplicating the channel
        // that now occupies the vacated slot.
        const parked = this._ytPendingReturn?.[ytSlot] || null;
        if (parked) {
            this.youtubeReturn = this.youtubeReturn || {};
            this.youtubeReturn[tvSlot] = parked;
        }
        if (this._ytPendingReturn) delete this._ytPendingReturn[ytSlot];
        if (this.youtubeReturn) delete this.youtubeReturn[ytSlot];

        if (opts.unmuteCenter) {
            this.muteSolo?.('center');
        } else {
            this.slots.center?.player?.emitState?.();
            this.persistSlots?.();
        }
        this.scheduleRefreshTiles?.();
        this.syncMosaicChrome?.();
        this.syncStatusChrome?.();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
                detail: { primary: 'center', swapped: sideId }
            }));
        }
        return Boolean(player);
    },

    /**
     * Build + assign the adapter (mounting happens through mountAll()).
     * @param {string} slotId
     * @param {{ videoId: string, title?: string, startAt?: number, muted?: boolean, volume?: number, watchSessionSeconds?: number }} options
     */
    _ytCreateSlotPlayer(slotId, { videoId, title = '', startAt = 0, muted = true, volume = 1, watchSessionSeconds = 0 }) {
        const slot = this.slots?.[slotId];
        if (!slot) return null;
        const player = createYouTubePlayer({
            id: slotId,
            videoId,
            title,
            startAt,
            watchSessionSeconds,
            muted,
            volume,
            getSharedVolume: () => this.sharedVolume,
            getLastVolume: () => this.lastVolume,
            onState: () => this.scheduleRefreshTiles?.(),
            onEnded: (endedPlayer) => this._ytMaybeAutoAdvance(slotId, endedPlayer),
            onError: (message) => {
                const now = Date.now();
                if (now - (this._ytErrorToastAt || 0) < 4000) return;
                this._ytErrorToastAt = now;
                showAppToast(message);
            }
        });
        if (!player.channel) return null;
        slot.player = player;
        this._ytLiveSlotId = slotId;
        this.mountAll?.();
        player.emitState();
        return player;
    },

    /**
     * Detach YouTube mode without touching TV restore state. Synchronous —
     * safe to call from `prepareSlotForPlay()` right before a new tune.
     * @param {string} slotId
     * @returns {boolean} true when a YouTube tile was detached
     */
    detachYouTubeModeSync(slotId) {
        const slot = this.slots?.[slotId];
        const current = slot?.player;
        if (!current || current.kind !== 'youtube') return false;
        const returnState = this.youtubeReturn?.[slotId] || null;
        try {
            current.destroy?.();
        } catch { /* ignore */ }
        slot.player = null;
        if (this._ytLiveSlotId === slotId) this._ytLiveSlotId = null;
        this._ytForgetQueue(slotId);
        if (returnState) {
            this._ytPendingReturn = this._ytPendingReturn || {};
            this._ytPendingReturn[slotId] = returnState;
        }
        if (this.youtubeReturn) delete this.youtubeReturn[slotId];
        this.scheduleRefreshTiles?.();
        return true;
    },

    /**
     * Turn YouTube mode off and restore the tile's previous TV channel.
     * @param {string} slotId
     * @param {{ silent?: boolean, persist?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async detachYouTubeMode(slotId, { silent = false, persist = true } = {}) {
        const pending = this._ytPendingReturn?.[slotId] || null;
        const hadYouTube = this.detachYouTubeModeSync(slotId);
        if (!hadYouTube && !pending) return false;
        // detachYouTubeModeSync() parks the return state for this call.
        const previous = this._ytPendingReturn?.[slotId] || pending || null;
        if (this._ytPendingReturn) delete this._ytPendingReturn[slotId];
        if (this.youtubeReturn) delete this.youtubeReturn[slotId];

        if (previous?.channel) {
            await this.playOnSlot?.(slotId, previous.channel, { skipHistory: true });
        } else if (previous?.key) {
            const player = this.ensurePlayer?.(slotId, { startMuted: previous.muted !== false });
            if (player) {
                player.channel = stubChannelFromEntry({ key: previous.key, name: previous.name || '' });
                player.stopped = true;
                player.wantPlaying = false;
                player.playing = false;
                player.pausePhase = 'idle';
                player.loading = false;
                player.loadPhase = 'idle';
                player.emitState?.();
                this.rememberedSlotKeys = this.rememberedSlotKeys || {};
                this.rememberedSlotKeys[slotId] = previous.key;
                this.mountAll?.();
            }
        }

        if (persist) this.persistSlots?.();
        this.scheduleRefreshTiles?.();
        this.syncStatusChrome?.();
        if (!silent) showAppToast('YouTube mode off');
        return true;
    },

    /**
     * Restore a saved YouTube tile as a paused placeholder (no autoplay).
     * Only one tile can run YouTube, so the first saved entry wins.
     * @param {Record<string, object>} mosaic
     * @returns {Promise<boolean>}
     */
    async restoreYouTubeSlots(mosaic) {
        if (!mosaic) return false;
        for (const slotId of Object.keys(mosaic)) {
            const entry = mosaic[slotId];
            if (!isYouTubeEntry(entry)) continue;
            const config = youtubeEntryConfig(entry);
            if (!config) continue;
            const ok = await this.enterYouTubeMode(slotId, config.videoId, {
                autoplay: false,
                title: config.title,
                startAt: config.startAt,
                silent: true,
                persist: false
            });
            // One live YouTube tile — later saved entries stay as TV placeholders.
            return ok;
        }
        return false;
    },

    /**
     * Persisted entry for a YouTube tile (or null when the slot is not YT).
     * @param {string} slotId
     */
    youTubeSlotEntry(slotId) {
        const player = this.slots?.[slotId]?.player;
        if (!player || player.kind !== 'youtube') return null;
        const videoId = normalizeYouTubeId(player.videoId);
        if (!videoId) return null;
        return {
            kind: 'youtube',
            key: youtubeKey(videoId),
            videoId,
            name: player.channel?.name || '',
            muted: player.muted !== false,
            volume: Math.min(1, Math.max(0, Number.isFinite(player.volume) ? player.volume : 1)),
            url: player.posterDataUrl || ''
        };
    },

    /** Clear YouTube bookkeeping for a slot that is being disabled. */
    forgetYouTubeSlot(slotId) {
        if (this._ytLiveSlotId === slotId) this._ytLiveSlotId = null;
        if (this.youtubeReturn) delete this.youtubeReturn[slotId];
        if (this._ytPendingReturn) delete this._ytPendingReturn[slotId];
        this._ytForgetQueue(slotId);
    },

    // ---- play queue (prev / next / related tray) -------------------------

    /** Remember the channel name that came with a related clip. */
    _ytRememberAuthor(item) {
        if (!item?.videoId || !item.author) return;
        this._ytAuthors = this._ytAuthors || {};
        this._ytAuthors[item.videoId] = item.author;
    },

    /**
     * Build the queue for the clip a tile is running: current → same author →
     * rest of the saved library → history. Remote related clips are appended
     * later by `_ytPrefetchRelated()`.
     * @param {string} slotId
     * @param {object} player
     */
    _ytResetQueue(slotId, player) {
        const videoId = normalizeYouTubeId(player?.videoId);
        if (!videoId) return null;
        const library = listYouTubeClips();
        const author = this._ytAuthors?.[videoId]
            || library.find((clip) => clip.videoId === videoId)?.author
            || '';
        const queue = buildYouTubeQueue({
            current: { videoId, title: player?.channel?.name || '', author },
            library,
            history: listYouTubeHistory()
        });
        this._ytQueue = { slotId, queue, relatedFor: '' };
        this._ytQueueOpen = { ...(this._ytQueueOpen || {}), [slotId]: false };
        this._ytRelatedGen = (this._ytRelatedGen || 0) + 1;
        this._ytClearRelatedPending(slotId);
        saveYouTubeQueue(queue);
        return queue;
    },

    /** Forget one slot's in-flight related lookup (its result is discarded). */
    _ytClearRelatedPending(slotId) {
        if (this._ytRelatedPending?.[slotId]) {
            const pending = { ...this._ytRelatedPending };
            delete pending[slotId];
            this._ytRelatedPending = pending;
        }
        if (this._ytRelatedTokens?.[slotId]) {
            const tokens = { ...this._ytRelatedTokens };
            delete tokens[slotId];
            this._ytRelatedTokens = tokens;
        }
    },

    /**
     * Re-point an existing queue at a (possibly moved) tile after a swap.
     * Falls back to a fresh local queue when the clip is not in it.
     */
    _ytAdoptQueue(slotId, player, previous = null) {
        const videoId = normalizeYouTubeId(player?.videoId);
        if (!videoId) return null;
        if (previous?.queue?.items?.some((item) => item.videoId === videoId)) {
            const index = Math.max(0, queueIndexOf(previous.queue, videoId));
            this._ytQueue = {
                slotId,
                queue: selectYouTubeQueueIndex(previous.queue, index),
                relatedFor: previous.relatedFor || ''
            };
            const open = { ...(this._ytQueueOpen || {}) };
            if (previous.slotId) delete open[previous.slotId];
            open[slotId] = false;
            this._ytQueueOpen = open;
            return this._ytQueue.queue;
        }
        return this._ytResetQueue(slotId, player);
    },

    /** Drop queue + tray state for a tile that is leaving YouTube mode. */
    _ytForgetQueue(slotId) {
        if (this._ytQueue?.slotId === slotId) this._ytQueue = null;
        this._ytRelatedGen = (this._ytRelatedGen || 0) + 1;
        this._ytClearRelatedPending(slotId);
        if (this._ytQueueOpen?.[slotId]) {
            const open = { ...this._ytQueueOpen };
            delete open[slotId];
            this._ytQueueOpen = open;
        }
        if (this._ytEndedAt?.[slotId]) {
            const endedAt = { ...this._ytEndedAt };
            delete endedAt[slotId];
            this._ytEndedAt = endedAt;
        }
    },

    /**
     * Queue for the tile, rebuilt when the player switched clip behind our back
     * (picker, restore, TV tune).
     * @param {string} slotId
     */
    ensureYouTubeQueue(slotId) {
        const player = this.slots?.[slotId]?.player;
        const videoId = normalizeYouTubeId(player?.videoId);
        if (!videoId) return { videoId: '', index: -1, items: [], updatedAt: 0 };
        const active = this._ytQueue;
        if (active?.slotId === slotId && active.queue?.items?.length) {
            const index = queueIndexOf(active.queue, videoId);
            if (index < 0) return this._ytResetQueue(slotId, player) || active.queue;
            if (index !== active.queue.index) active.queue = selectYouTubeQueueIndex(active.queue, index);
            return active.queue;
        }
        return this._ytResetQueue(slotId, player) || { videoId: '', index: -1, items: [], updatedAt: 0 };
    },

    /**
     * Snapshot for the chrome (prev/next disabled states + tray contents).
     * @param {string} slotId
     */
    youtubeQueueState(slotId) {
        const player = this.slots?.[slotId]?.player;
        if (!player || player.kind !== 'youtube') {
            return {
                active: false,
                videoId: '',
                index: -1,
                items: [],
                hasPrev: false,
                hasNext: false,
                open: false,
                relatedLoading: false
            };
        }
        const queue = this.ensureYouTubeQueue(slotId);
        return {
            active: true,
            videoId: queue.videoId,
            index: queue.index,
            items: queue.items,
            hasPrev: queue.index > 0,
            hasNext: queue.index >= 0 && queue.index < queue.items.length - 1,
            open: Boolean(this._ytQueueOpen?.[slotId]),
            relatedLoading: Boolean(this._ytRelatedPending?.[slotId])
        };
    },

    /**
     * Switch the tile to one queue entry. Same clip resumes; a different clip
     * goes through the adapter's in-place `swapVideo()` (no iframe teardown, so
     * mute/volume/play intent carry over).
     * @param {string} slotId
     * @param {number} index
     * @param {{ autoplay?: boolean }} [opts]
     */
    _ytApplyQueueIndex(slotId, index, { autoplay = true } = {}) {
        const player = this.slots?.[slotId]?.player;
        if (!player || player.kind !== 'youtube') return false;
        const queue = this.ensureYouTubeQueue(slotId);
        const target = Math.floor(Number(index));
        const item = Number.isFinite(target) ? queue.items[target] : null;
        if (!item) return false;

        this._ytQueue.queue = selectYouTubeQueueIndex(queue, target);
        this._ytRememberAuthor(item);

        if (item.videoId === player.videoId) {
            if (autoplay) player.resume();
            this.scheduleRefreshTiles?.();
            return true;
        }

        const ok = typeof player.swapVideo === 'function'
            ? player.swapVideo(item.videoId, { title: item.title, autoplay })
            : false;
        if (!ok) return false;

        touchYouTubeClip({ videoId: item.videoId, title: item.title, author: item.author });
        recordYouTubeHistory({ videoId: item.videoId, title: item.title, author: item.author });
        this.persistSlots?.();
        this.scheduleRefreshTiles?.();
        this.syncStatusChrome?.();
        this._ytPrefetchRelated(slotId);
        return true;
    },

    /**
     * Step through the queue. At the tail, one related lookup extends it before
     * giving up — the local library keeps prev/next working fully offline.
     * @param {string} slotId
     * @param {number} delta +1 next, -1 previous
     * @param {{ silent?: boolean }} [opts]
     * @returns {Promise<boolean>} true when a clip started
     */
    async stepYouTubeQueue(slotId, delta, { silent = false } = {}) {
        if (!this.isYouTubeSlot(slotId)) {
            if (!silent) showAppToast('YouTube mode is off');
            return false;
        }
        const direction = Math.trunc(Number(delta)) || 0;
        if (!direction) return false;

        let step = resolveYouTubeQueueStep(this.ensureYouTubeQueue(slotId), direction);
        if (!step && direction > 0) {
            await this._ytPrefetchRelated(slotId, { force: true });
            step = resolveYouTubeQueueStep(this.ensureYouTubeQueue(slotId), direction);
        }
        if (!step) {
            if (!silent) showAppToast(direction > 0 ? 'No more videos in the queue' : 'Start of the queue');
            return false;
        }
        return this._ytApplyQueueIndex(slotId, step.index, { autoplay: true });
    },

    /** Jump to one tray thumbnail (and collapse the tray). */
    playYouTubeQueueIndex(slotId, index) {
        this._ytQueueOpen = { ...(this._ytQueueOpen || {}), [slotId]: false };
        const ok = this._ytApplyQueueIndex(slotId, index, { autoplay: true });
        this.scheduleRefreshTiles?.();
        return ok;
    },

    /**
     * Toggle (or force) the thumbnail tray hover-pin.
     * @param {string} slotId
     * @param {boolean} [force]
     * @returns {boolean} the new open state
     */
    toggleYouTubeQueueTray(slotId, force) {
        const player = this.slots?.[slotId]?.player;
        if (!player || player.kind !== 'youtube') return false;
        const open = typeof force === 'boolean' ? force : !this._ytQueueOpen?.[slotId];
        this._ytQueueOpen = { ...(this._ytQueueOpen || {}), [slotId]: open };
        if (open) {
            this.ensureYouTubeQueue(slotId);
            this._ytPrefetchRelated(slotId);
        }
        this.scheduleRefreshTiles?.();
        return open;
    },

    /**
     * Append remotely suggested clips to the tail. Generation-guarded so a fast
     * prev/next or a tile teardown can never write into a stale queue.
     * @param {string} slotId
     * @param {{ force?: boolean }} [opts]
     * @returns {Promise<boolean>} true when new items were appended
     */
    async _ytPrefetchRelated(slotId, { force = false } = {}) {
        const player = this.slots?.[slotId]?.player;
        if (!player || player.kind !== 'youtube') return false;
        const videoId = normalizeYouTubeId(player.videoId);
        if (!videoId) return false;
        if (!SettingsStore.getYouTubeRelatedEnabled()) return false;

        this.ensureYouTubeQueue(slotId);

        const inFlight = this._ytRelatedPending?.[slotId];
        if (inFlight) {
            // A forced call (tail of the queue) waits for the running lookup
            // instead of reporting "no more videos" mid-flight.
            if (force) {
                try { await inFlight; } catch { /* handled below */ }
            }
            return false;
        }
        if (!force && this._ytQueue?.relatedFor === videoId) return false;

        const token = {};
        this._ytRelatedTokens = { ...(this._ytRelatedTokens || {}), [slotId]: token };
        this._ytQueue.relatedFor = videoId;
        const generation = this._ytRelatedGen || 0;

        const task = (async () => {
            // `_ytRelatedFetcher` is the test seam (no network in unit tests).
            const load = this._ytRelatedFetcher || fetchYouTubeRelated;
            const result = await load(videoId, {
                provider: SettingsStore.getYouTubeRelatedProvider(),
                invidiousInstance: SettingsStore.getYouTubeRelatedInstance()
            });
            if (generation !== (this._ytRelatedGen || 0)) return false;
            if (!this.isYouTubeSlot(slotId)) return false;
            if (normalizeYouTubeId(this.slots?.[slotId]?.player?.videoId) !== videoId) return false;

            const items = Array.isArray(result?.items) ? result.items : [];
            if (!items.length) {
                // Nothing came back: allow a later tray/queue action to retry
                // (fetchYouTubeRelated's negative cache keeps that cheap).
                if (this._ytQueue?.slotId === slotId) this._ytQueue.relatedFor = '';
                return false;
            }
            items.forEach((item) => this._ytRememberAuthor(item));
            this._ytQueue.queue = appendYouTubeRelated(this.ensureYouTubeQueue(slotId), items);
            saveYouTubeQueue(this._ytQueue.queue);
            return true;
        })().catch(() => false);

        this._ytRelatedPending = { ...(this._ytRelatedPending || {}), [slotId]: task };
        this.scheduleRefreshTiles?.();

        try {
            return await task;
        } finally {
            if (this._ytRelatedTokens?.[slotId] === token) {
                this._ytClearRelatedPending(slotId);
                this.scheduleRefreshTiles?.();
            }
        }
    },

    /**
     * Auto-play the next queue entry when a clip ends. One hop per ended event,
     * skipped entirely when the setting is off.
     * @param {string} slotId
     * @param {object} player
     */
    _ytMaybeAutoAdvance(slotId, player) {
        if (!player?.ended) return;
        const now = Date.now();
        this._ytEndedAt = this._ytEndedAt || {};
        if (now - (this._ytEndedAt[slotId] || 0) < 500) return;
        this._ytEndedAt[slotId] = now;
        if (!SettingsStore.getYouTubeQueueAutoAdvance()) return;
        if (!this.isYouTubeSlot(slotId)) return;
        const run = () => {
            if (!this.isYouTubeSlot(slotId)) return;
            this.stepYouTubeQueue(slotId, 1, { silent: true });
        };
        if (typeof setTimeout === 'function') setTimeout(run, 0);
        else run();
    },

    /** Guard used by swap / rotate / cast / popout: any YouTube tile involved? */
    involvesYouTubeSlot(...slotIds) {
        return slotIds.some((slotId) => Boolean(slotId) && this.isYouTubeSlot(slotId));
    },

    /** Slots that currently sit in YouTube mode. */
    youtubeSlotIds() {
        return Object.keys(this.slots || {}).filter((slotId) => this.isYouTubeSlot(slotId));
    }
};
