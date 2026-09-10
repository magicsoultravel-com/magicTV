/**
 * Channel prepare/warm-up and commit swap for a player instance.
 * Methods expect `this` === player (mixed into createPlayerInstance).
 */
import { TvProviderRegistry } from '../tvProviders/registry.js';
import {
    channelKey,
    parseChannelKey,
    normalizeChannel
} from '../tvProviders/channelShape.js';
import { savePlayerState } from '../storage/playerState.js';
import { TileFrames } from '../tileFrames.js';
import {
    applyHlsBufferConfig,
    applyQualityMode,
    bindHlsPlaybackHandlers,
    syncHlsPlaybackState
} from './hlsAttach.js';
import { ChannelPreloader, PRELOAD_STALL_MS } from './channelPreloader.js';
import {
    consumePrefetched,
    evictPrefetchedKey,
    scheduleSlotPrefetch
} from './channelPrefetch.js';
import {
    shouldContinuePlayAfterAttach,
    isAutoplayNotAllowedError,
    shouldRetryPlayMuted
} from './pauseBuffer.js';
import { releasePausedFill } from './loadBudget.js';

/**
 * Resolve a channel object or key string, aborting when `isCurrent` goes false.
 * @param {object} player
 * @param {object|string} channelOrKey
 * @param {() => boolean} isCurrent
 * @param {{ requireUrl?: boolean }} [opts]
 * @returns {Promise<{ channel: object, key: string } | null>}
 */
export async function resolveChannelInput(player, channelOrKey, isCurrent, {
    requireUrl = true
} = {}) {
    let channel = typeof channelOrKey === 'object' && channelOrKey !== null
        ? channelOrKey
        : null;

    if (!channel && typeof channelOrKey === 'string') {
        const parsed = parseChannelKey(channelOrKey);
        channel = await TvProviderRegistry.getChannel(parsed);
        if (!isCurrent()) return null;
    }

    if (channel && !channel.url_resolved) {
        const parsed = parseChannelKey(channelKey(channel));
        channel = await TvProviderRegistry.getChannel(parsed);
        if (!isCurrent()) return null;
    }

    const key = channelKey(channel);
    if (!key || !channel) return null;
    if (requireUrl && !channel.url_resolved) return null;
    return { channel, key };
}

/**
 * Attempt muted autoplay retry after a blocked play().
 * @param {object} player
 * @param {Error} playErr
 * @returns {Promise<boolean>} true if muted retry was used (and awaited play)
 */
export async function tryMutedAutoplayRetry(player, playErr) {
    if (!shouldRetryPlayMuted({
        blocked: isAutoplayNotAllowedError(playErr),
        muted: player.muted
    })) {
        return false;
    }
    player.muted = true;
    player.applyAudioToVideo();
    await player.video.play();
    return true;
}

/**
 * Play after attach/commit with muted retry. Returns false if superseded.
 * @param {object} player
 * @param {{ generation: number, transportAtStart: number, retryAbort?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export async function playAfterAttach(player, { generation, transportAtStart, retryAbort = false }) {
    const continueCheck = () => shouldContinuePlayAfterAttach({
        generation,
        playGeneration: player.playGeneration,
        wantPlaying: player.wantPlaying,
        transportGen: player.transportGen,
        transportAtStart
    });

    try {
        await player.video.play();
    } catch (playErr) {
        if (!continueCheck()) return false;
        if (await tryMutedAutoplayRetry(player, playErr)) {
            return continueCheck();
        }
        if (retryAbort && playErr?.name === 'AbortError') {
            await new Promise((r) => setTimeout(r, 50));
            await player.video.play();
            return continueCheck();
        }
        throw playErr;
    }
    return continueCheck();
}

export const prepareCommitMethods = {
    async _resolveChannelInput(channelOrKey, generation) {
        return resolveChannelInput(
            this,
            channelOrKey,
            () => generation == null || generation === this.switchGeneration
        );
    },

    _adoptPrefetchedStaging(prefetched) {
        if (!prefetched?.video) return false;
        this._preloader.cancel();
        const discarded = this.videoBack;
        this.videoBack = prefetched.video;
        if (discarded && discarded !== prefetched.video && discarded !== this.video) {
            // Remove the orphaned staging element instead of parking it in the holder —
            // otherwise every prefetched handoff leaks a <video> into the hidden holder.
            try { discarded.pause(); } catch { /* ignore */ }
            discarded.removeAttribute('src');
            try { discarded.load(); } catch { /* ignore */ }
            discarded.remove?.();
        }
        if (this.videoMount && this.videoBack.parentElement === this.videoMount) {
            if (this.videoHolder) this.videoHolder.appendChild(this.videoBack);
        }
        this.videoBack.classList.add('tv-video--staging');
        this.videoBack.muted = true;
        this.videoBack.defaultMuted = true;
        if (this.videoBack.parentElement !== this.videoHolder) {
            this.videoHolder.appendChild(this.videoBack);
        }
        this._bindVideoEvents(prefetched.video);
        this._preloader.adoptPrepared({
            video: this.videoBack,
            hls: prefetched.hls,
            channel: prefetched.channel,
            url: prefetched.channel?.url_resolved || ''
        });
        return true;
    },

    /**
     * Whether the staging buffer is warmed and ready to swap in.
     * @returns {boolean}
     */
    isPrepareReady() {
        return this._preloader?.isReady() === true;
    },

    /**
     * Staging buffer warmed enough to swap — readyState ≥ 2 (decoded data), dimensions optional.
     * @returns {boolean}
     */
    isPrepareReadyWithFrame() {
        if (!this.isPrepareReady()) return false;
        const staging = this.videoBack;
        return Boolean(staging && staging.readyState >= 2);
    },

    /**
     * Wait for in-flight warm-up; returns when ready, stalled, or superseded.
     * @param {number} [switchGen]
     * @returns {Promise<boolean>}
     */
    async waitForPrepareReady(switchGen) {
        if (switchGen != null && switchGen !== this.switchGeneration) return false;
        if (this.isPrepareReadyWithFrame()) return true;

        const promise = this._preparePromise;
        if (promise) {
            try {
                await promise;
            } catch { /* warm failed */ }
        }

        if (switchGen != null && switchGen !== this.switchGeneration) return false;

        if (this.isPrepareReadyWithFrame()) return true;

        const preloader = this._preloader;
        if (preloader?.isMakingProgress?.()) {
            const deadline = Date.now() + PRELOAD_STALL_MS;
            while (Date.now() < deadline) {
                if (switchGen != null && switchGen !== this.switchGeneration) return false;
                if (this.isPrepareReadyWithFrame()) return true;
                if (!preloader.isMakingProgress()) break;
                await new Promise((r) => setTimeout(r, 80));
            }
        }

        return this.isPrepareReadyWithFrame();
    },

    /**
     * Internal warm-up worker for startPrepareChannel.
     * @param {object|string} channelOrKey
     * @param {number} switchGen
     * @param {{ suppressUi?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async _runPrepare(channelOrKey, switchGen, { suppressUi = false } = {}) {
        const prepareGen = this.prepareGeneration;
        const isStale = () => switchGen !== this.switchGeneration
            || prepareGen !== this.prepareGeneration;
        const resolved = await this._resolveChannelInput(channelOrKey, switchGen);
        if (!resolved || isStale()) return false;

        const { channel, key } = resolved;
        const prefetched = consumePrefetched(this.id, key);
        if (prefetched && this._adoptPrefetchedStaging(prefetched)) {
            this.preparedTarget = channel;
            if (!suppressUi) {
                this.preparing = false;
                this.emitState();
            }
            return true;
        }

        this._preloader.cancel();
        this.preparedTarget = channel;
        if (!suppressUi) {
            this.preparing = true;
            this.emitState();
        }

        // Warm the staging element while RENDERED but offscreen. Browsers throttle
        // media inside display:none subtrees (the videoHolder is is-hidden), leaving
        // warm-ups to always time out. Prefetch already does this on <body>; mirror it.
        let movedToBody = false;
        const back = this.videoBack;
        if (back) {
            const doBody = typeof document !== 'undefined' && document.body;
            if (doBody && back.parentElement !== document.body) {
                try {
                    document.body.appendChild(back);
                    back.classList.add('tv-video--staging');
                    back.classList.remove('tv-video--prefetch');
                    back.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:90px;opacity:0;pointer-events:none;';
                    movedToBody = true;
                } catch { /* keep holder */ }
            }
        }

        const ok = await this._preloader.warmChannel(back, channel, {
            isStale
        });

        if (isStale()) return false;

        if (!movedToBody && back) {
            // Ensure staging styling so a promoted front video is visible later.
            back.classList.add('tv-video--staging');
            back.classList.remove('tv-video--prefetch');
        }
        if (!suppressUi) {
            this.preparing = false;
            if (ok) this.preparedTarget = channel;
            else this.preparedTarget = null;
            this.emitState();
        } else if (!ok) {
            this.preparedTarget = null;
        } else {
            this.preparedTarget = channel;
        }
        return ok;
    },

    /**
     * Cancel offscreen warm-up without touching the visible stream.
     */
    cancelPrepare() {
        this.prepareGeneration += 1;
        this._preloader?.cancel();
        this._preparePromise = null;
        this.preparing = false;
        this.preparedTarget = null;
    },

    /**
     * Kick off background warm-up (non-blocking). Idempotent per switchGeneration.
     * @param {object|string} channelOrKey
     * @param {number} switchGen
     * @param {{ suppressUi?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    startPrepareChannel(channelOrKey, switchGen, opts = {}) {
        this.init();
        if (switchGen != null && switchGen !== this.switchGeneration) {
            return Promise.resolve(false);
        }
        if (this._preparePromise && this._prepareSwitchGen === switchGen) {
            return this._preparePromise;
        }

        this.prepareGeneration += 1;
        this._prepareSwitchGen = switchGen;
        this._preparePromise = this._runPrepare(channelOrKey, switchGen, opts).finally(() => {
            if (this._prepareSwitchGen === switchGen) {
                this._preparePromise = null;
            }
        });
        return this._preparePromise;
    },

    /**
     * Swap the warmed staging buffer into the visible player.
     * Falls back to playChannel when warm-up did not complete.
     * @param {object|string} [channelOrKey]
     * @param {number} [switchGen]
     * @param {{ allowFallback?: boolean }} [opts]
     * @returns {Promise<boolean|void>}
     */
    async commitPreparedChannel(channelOrKey, switchGen, opts = {}) {
        const allowFallback = opts.allowFallback !== false;
        this.init();
        if (switchGen != null && switchGen !== this.switchGeneration) return false;
        this._clearStuckLoadWatchdog();

        await this.waitForPrepareReady(switchGen);
        if (switchGen != null && switchGen !== this.switchGeneration) return false;

        const fallbackInput = channelOrKey || this.preparedTarget;
        const fallbackResolved = fallbackInput
            ? await this._resolveChannelInput(fallbackInput, switchGen)
            : null;

        if (!this._preloader.isReady()) {
            if (fallbackResolved?.channel) {
                if (switchGen != null && switchGen !== this.switchGeneration) return false;
                if (!allowFallback) return this._failPreparedSwitch(switchGen);
                return this._fallbackPlayChannel(fallbackResolved.channel);
            }
            return this._failPreparedSwitch(switchGen);
        }

        const stagingVideo = this.videoBack;
        if (!(stagingVideo && stagingVideo.readyState >= 2)) {
            return this._failPreparedSwitch(switchGen);
        }

        const generation = ++this.playGeneration;
        this._stuckLoadRetried = false;
        this._loadLastProgressAt = Date.now();
        const taken = this._preloader.takeover();
        const channel = taken.channel || fallbackResolved?.channel;
        const key = channelKey(channel);
        if (!key || !channel?.url_resolved) {
            if (fallbackResolved?.channel) {
                if (switchGen != null && switchGen !== this.switchGeneration) return false;
                if (!allowFallback) return this._failPreparedSwitch(switchGen);
                return this._fallbackPlayChannel(fallbackResolved.channel);
            }
            return this._failPreparedSwitch(switchGen);
        }

        if (switchGen != null && switchGen !== this.switchGeneration) return false;

        this.recentRecordedForKey = null;
        this.error = null;
        this.resumeBlocked = false;
        this.stopped = false;
        this.pausePhase = 'idle';
        const transportAtStart = this.beginTransport(true);
        this.setPauseLiveSync(false);
        TileFrames.armLiveSnap(channel.url_resolved || '');

        let swapCompleted = false;

        await this.destroyHls();
        try { this.video?.pause(); } catch { /* ignore */ }

        await this._exitPresentationBeforeSwap();

        const oldFront = this.video;
        this.video = this.videoBack;
        this.videoBack = oldFront;
        this.hls = taken.hls;
        if (this.hls) {
            applyHlsBufferConfig(this.hls, this.getBufferSize());
            this.qualityMode = applyQualityMode(this.hls, this.qualityMode);
            // Re-wire live handling so the taken-over stream stays healthy:
            // fatal errors surface as error state + retry, non-fatal errors
            // call startLoad()/recoverMediaError(), and quality/latency updates
            // keep flowing. Without this the promoted hls is a dead shell whose
            // warm-up handlers were already consumed by the preloader.
            this._onPlaybackFatal = null;
            bindHlsPlaybackHandlers(this, this.hls, generation);
            syncHlsPlaybackState(this, this.hls, this.video);
        }

        this._recycleStagingVideo();
        this._promoteFrontVideo();
        if (this.videoMount) {
            this.videoMount.classList.remove('is-hidden');
            this._syncVideoMount();
        }
        if (this.videoMount !== this.videoHolder) {
            this.videoHolder.classList.add('is-hidden');
        }

        this.channel = normalizeChannel(channel, channel.providerId) || channel;
        this.preparing = false;
        this.preparedTarget = null;
        swapCompleted = true;

        this._recordLastChannel?.(key, channel);

        const v = this.video;
        if (!(v && v.readyState >= 2)) {
            return this._failPreparedSwitch(switchGen);
        }

        this.loading = false;
        this.loadPhase = 'idle';
        this.posterDataUrl = null;

        try {
            const played = await playAfterAttach(this, {
                generation,
                transportAtStart,
                retryAbort: true
            });
            if (!played) return false;
        } catch {
            return this._failPreparedSwitch(switchGen);
        }

        this._refreshAudioAfterSwap();

        if (!shouldContinuePlayAfterAttach({
            generation,
            playGeneration: this.playGeneration,
            wantPlaying: this.wantPlaying,
            transportGen: this.transportGen,
            transportAtStart
        })) {
            try { this.video?.pause(); } catch { /* ignore */ }
            return this._failPreparedSwitch(switchGen);
        }

        this.playing = true;
        this.wantPlaying = true;
        this.connection = 'connected';
        this._enterPauseAt = 0;
        this._pausedFillArmed = false;
        releasePausedFill(this.id);
        this.emitState();

        if (swapCompleted) {
            if (switchGen == null || switchGen === this.switchGeneration) {
                evictPrefetchedKey(this.id, key);
                scheduleSlotPrefetch(this.id, this);
            }
            return true;
        }
        return false;
    }
};

/**
 * Wire prepare/commit methods onto a player, injecting recents persistence.
 * @param {object} player
 * @param {{ shouldRecordRecents: () => boolean }} deps
 */
export function attachPrepareCommitMethods(player, { shouldRecordRecents }) {
    Object.assign(player, prepareCommitMethods);
    player._recordLastChannel = (key, channel) => {
        if (!shouldRecordRecents()) return;
        savePlayerState({
            lastChannelKey: key,
            lastChannelName: channel.name || ''
        });
    };
}
