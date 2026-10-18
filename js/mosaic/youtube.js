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

        if (autoplay) player.resume();
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
