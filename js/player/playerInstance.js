import { TvProviderRegistry } from '../tvProviders/registry.js';
import {
    channelKey,
    parseChannelKey,
    normalizeChannel
} from '../tvProviders/channelShape.js';
import {
    loadPlayerState,
    savePlayerState,
    DEFAULT_BUFFER_SIZE,
    MAX_BUFFER_SIZE,
    MIN_BUFFER_SIZE
} from '../storage/playerState.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import {
    addWatchSeconds,
    registerWatchAccrualFlusher,
    unregisterWatchAccrualFlusher,
    registerWatchAccrualAborter,
    unregisterWatchAccrualAborter
} from '../storage/watchStats.js';
import {
    attachStream,
    destroyHls,
    applyHlsBufferConfig,
    applyQualityMode,
    listQualityLevels,
    formatQualityLabel,
    bindHlsPlaybackHandlers,
    syncHlsPlaybackState,
    LIVE_MAX_LATENCY_DURATION_COUNT
} from './hlsAttach.js';
import { snapshotVideoPoster, snapshotVideoFrame } from '../tiles/streamCapture.js';
import { TileFrames } from '../tileFrames.js';
import { PosterCache } from '../storage/posterCache.js';
import { FrameCache } from '../storage/frameCache.js';
import { ChannelPreloader, PRELOAD_STALL_MS } from './channelPreloader.js';
import {
    consumePrefetched,
    cancelSlotPrefetch,
    evictPrefetchedKey,
    scheduleSlotPrefetch
} from './channelPrefetch.js';
import {
    computeParkBehindTime,
    computeResumeSeekTime,
    shouldAcceptPlayingEvent,
    shouldAcceptPauseEvent,
    shouldClearWasPlayingOnAutoplayBlock,
    shouldPauseOnToggle,
    shouldClearWantPlayingOnPlayFail,
    shouldFallbackPlayChannelOnDoubleAbort,
    shouldContinuePlayAfterAttach,
    shouldBumpPlayGenerationOnPause,
    isAutoplayNotAllowedError,
    shouldRetryPlayMuted,
    isHealthyWatchPlayback,
    shouldClearStaleBufferOnTimeupdate,
    shouldFreshResume,
    shouldRecoverStuckLoad
} from './pauseBuffer.js';
import {
    takePausedFillTurn,
    releasePausedFill
} from './loadBudget.js';
import { tvDebug } from './tvDebug.js';

/** Max wall-clock seconds credited in a single flush (guards hidden-tab / stuck windows). */
const WATCH_ACCRUAL_FLUSH_CAP_SEC = 30;

/** No load progress for this long while wanting play ⇒ stall (then one hls.startLoad retry). */
const STUCK_LOAD_STALL_MS = PRELOAD_STALL_MS;

/**
 * Create an independent HLS player instance (one <video> + hls.js).
 * @param {{
 *   id: string,
 *   startMuted?: boolean,
 *   getSharedVolume: () => number,
 *   getLastVolume: () => number,
 *   onSharedVolumeChange?: (volume: number, lastVolume: number) => void,
 *   shouldBroadcast?: () => boolean,
 *   onState?: (player: object) => void,
 *   shouldRecordRecents?: () => boolean
 * }} options
 */
export function createPlayerInstance(options) {
    const {
        id,
        startMuted = true,
        getSharedVolume,
        getLastVolume,
        onSharedVolumeChange,
        shouldBroadcast = () => false,
        onState = null,
        shouldRecordRecents = () => true
    } = options;

    const watchPlaybackState = () => ({
        hasChannel: Boolean(player.channel),
        playing: player.playing,
        loading: player.loading,
        loadPhase: player.loadPhase,
        wantPlaying: player.wantPlaying,
        error: player.error,
        pausePhase: player.pausePhase,
        stopped: player.stopped,
        posterDataUrl: player.posterDataUrl
    });

    const endWatchAccrual = (credit = true) => {
        if (!player.watchAccrueStartedAt || !player.watchAccrueKey) return;
        if (credit) {
            const elapsed = Math.min(
                (Date.now() - player.watchAccrueStartedAt) / 1000,
                WATCH_ACCRUAL_FLUSH_CAP_SEC
            );
            if (elapsed > 0) {
                addWatchSeconds(player.watchAccrueKey, elapsed, player.channel);
            }
        }
        player.watchAccrueKey = null;
        player.watchAccrueStartedAt = null;
    };

    const flushWatchAccrual = () => endWatchAccrual(true);

    const abortWatchAccrual = () => endWatchAccrual(false);

    const syncWatchAccrual = () => {
        if (!shouldRecordRecents()) return;
        const key = channelKey(player.channel);
        if (!key) {
            flushWatchAccrual();
            return;
        }
        if (isHealthyWatchPlayback(watchPlaybackState())) {
            if (player.watchAccrueKey === key && player.watchAccrueStartedAt) {
                const openFor = (Date.now() - player.watchAccrueStartedAt) / 1000;
                // Bank periodically so long sessions aren't lost to the per-flush safety cap.
                if (openFor < WATCH_ACCRUAL_FLUSH_CAP_SEC) return;
                flushWatchAccrual();
                player.watchAccrueKey = key;
                player.watchAccrueStartedAt = Date.now();
                return;
            }
            flushWatchAccrual();
            player.watchAccrueKey = key;
            player.watchAccrueStartedAt = Date.now();
            return;
        }
        flushWatchAccrual();
    };

    const snapshotWatchAccrual = () => {
        flushWatchAccrual();
        // Do not restart accrual while hidden — wall-clock would inflate in the background.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        syncWatchAccrual();
    };

    const player = {
        id,
        video: null,
        /** Hidden staging buffer swapped in at channel commit. */
        videoBack: null,
        videoHolder: null,
        hls: null,
        channel: null,
        playing: false,
        loading: false,
        /** True while an offscreen warm-up is in flight (current picture stays live). */
        preparing: false,
        preparedTarget: null,
        prepareGeneration: 0,
        /** Bumped on each user channel pick; stale prepare/commit no-op. */
        switchGeneration: 0,
        _prepareSwitchGen: 0,
        _preparePromise: null,
        _preloader: null,
        loadPhase: 'idle',
        error: null,
        resumeBlocked: false,
        recentRecordedForKey: null,
        muted: startMuted,
        /** Per-slot gain 0..1; heard level = master × volume. */
        volume: 1,
        lastVolume: 1,
        videoMount: null,
        posterDataUrl: null,

        bufferSize: loadPlayerState().bufferSize || DEFAULT_BUFFER_SIZE,

        connection: 'idle',
        /** 'auto' or locked level index */
        qualityMode: 'auto',
        qualityLevel: -1,
        qualityLabel: '—',
        bandwidthEstimateBps: null,
        errorCount: 0,
        retryCount: 0,
        maxRetries: 3,
        /** Last user play/pause intent — media events must not fight this. */
        wantPlaying: false,
        /** Bumped on every transport action; stale play() results ignore older gens. */
        transportGen: 0,
        _parkRaf: 0,
        /** Timestamp when the current pause began (0 = never paused this session). */
        _enterPauseAt: 0,
        /** True while this slot owns the lone paused-fill backfill turn. */
        _pausedFillArmed: false,

        pausePhase: 'idle',
        /** True only after an explicit stop(); cleared on play/pause/load. */
        stopped: false,
        playGeneration: 0,
        watchAccrueKey: null,
        watchAccrueStartedAt: null,
        /** Timer id + gen for the stuck-load watchdog (null when idle). */
        _stuckLoadTimer: null,
        _stuckLoadGen: 0,
        _stuckLoadStartedAt: 0,
        _loadLastProgressAt: 0,
        _stuckLoadRetried: false,
        /** Synchronous watchdog tick — also the test seam. */
        _stuckLoadTick: null,

        _bindVideoEvents(videoEl) {
            if (!videoEl) return;
            const isActive = () => videoEl === this.video;

            videoEl.addEventListener('loadstart', () => {
                if (!isActive()) return;
                this._noteLoadProgress('loadstart');
                this.loadPhase = 'connecting';
                this.emitState();
            });
            videoEl.addEventListener('canplay', () => {
                if (!isActive()) return;
                this._noteLoadProgress('canplay');
                if (this.loadPhase !== 'idle') {
                    this.loadPhase = 'idle';
                    this.emitState();
                }
            });
            videoEl.addEventListener('canplaythrough', () => {
                if (!isActive()) return;
                this._noteLoadProgress('canplaythrough');
                if (this.loading) {
                    this.loading = false;
                    this.emitState();
                }
                this._clearStuckLoadWatchdog();
            });
            videoEl.addEventListener('playing', () => {
                if (!isActive()) return;
                this._clearStuckLoadWatchdog();
                if (!shouldAcceptPlayingEvent(this.wantPlaying)) {
                    return;
                }
                this.playing = true;
                this.loading = false;
                this.loadPhase = 'idle';
                this.pausePhase = 'idle';
                this.stopped = false;
                this.error = null;
                this.resumeBlocked = false;
                this.posterDataUrl = null;
                if (shouldRecordRecents()) savePlayerState({ wasPlaying: true });
                const key = channelKey(this.channel);
                if (shouldRecordRecents() && key && this.recentRecordedForKey !== key) {
                    this.recentRecordedForKey = key;
                    FavoritesRecents.pushRecent(key, this.channel);
                    FavoritesRecents.markVisited(key, this.channel);
                }
                this.emitState();
                scheduleSlotPrefetch(this.id, this);
            });
            videoEl.addEventListener('timeupdate', () => {
                if (!isActive()) return;
                this._noteLoadProgress('timeupdate');
                if (this.pausePhase !== 'idle') {
                    this.updatePauseBuffer();
                }
                if (shouldClearStaleBufferOnTimeupdate({
                    wantPlaying: this.wantPlaying,
                    playing: this.playing,
                    videoPaused: this.video?.paused !== false,
                    loading: this.loading,
                    loadPhase: this.loadPhase
                })) {
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.emitState();
                    return;
                }
                this._clearStuckLoadWatchdog();
                syncWatchAccrual();
            });
            videoEl.addEventListener('progress', () => {
                if (!isActive()) return;
                this._noteLoadProgress('progress');
                if (this.pausePhase !== 'idle') {
                    this.updatePauseBuffer();
                }
                this._clearStuckLoadWatchdog();
            });
            videoEl.addEventListener('pause', () => {
                if (!isActive()) return;
                if (!shouldAcceptPauseEvent(this.wantPlaying)) {
                    return;
                }
                this.playing = false;
                if (this.pausePhase !== 'idle') {
                    this.updatePauseBuffer();
                }
                this.emitState();
            });
            videoEl.addEventListener('waiting', () => {
                if (!isActive()) return;
                if (this.wantPlaying !== true) return;
                this.loading = true;
                this.loadPhase = 'buffering';
                if (this.pausePhase !== 'idle') {
                    this.pausePhase = 'buffering';
                }
                this._armStuckLoadWatchdog();
                this.emitState();
            });
            videoEl.addEventListener('stalled', () => {
                if (!isActive()) return;
                if (this.wantPlaying !== true) return;
                if (this.playing || this.loading) {
                    this.loadPhase = 'buffering';
                    if (this.pausePhase !== 'idle') {
                        this.pausePhase = 'buffering';
                    }
                    this._armStuckLoadWatchdog();
                    this.emitState();
                }
            });
            videoEl.addEventListener('error', () => {
                if (!isActive()) return;
                this._clearStuckLoadWatchdog();
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                this.error = 'Stream unavailable';
                this.emitState();
            });
            videoEl.addEventListener('ended', () => {
                if (!isActive()) return;
                this._clearStuckLoadWatchdog();
                this.playing = false;
                this.loadPhase = 'idle';
                this.emitState();
            });
        },

        init() {
            if (this.video) return;
            registerWatchAccrualFlusher(snapshotWatchAccrual);
            registerWatchAccrualAborter(abortWatchAccrual);

            this._preloader = new ChannelPreloader();

            this.videoHolder = document.createElement('div');
            this.videoHolder.className = 'tv-video-holder is-hidden';
            this.videoHolder.setAttribute('aria-hidden', 'true');
            this.videoHolder.dataset.playerId = id;
            document.body.appendChild(this.videoHolder);

            this.video = document.createElement('video');
            this.video.className = 'tv-video';
            this.video.playsInline = true;
            this.video.setAttribute('playsinline', '');
            this.video.preload = 'auto';
            this.video.dataset.playerId = id;

            this.videoBack = document.createElement('video');
            this.videoBack.className = 'tv-video tv-video--staging';
            this.videoBack.playsInline = true;
            this.videoBack.setAttribute('playsinline', '');
            this.videoBack.preload = 'auto';
            this.videoBack.muted = true;
            this.videoBack.defaultMuted = true;
            this.videoBack.dataset.playerId = `${id}-staging`;

            this.applyAudioToVideo();
            this.videoHolder.appendChild(this.videoBack);
            this.videoHolder.appendChild(this.video);

            this._bindVideoEvents(this.video);
            this._bindVideoEvents(this.videoBack);
        },

        applyAudioToVideo() {
            if (!this.video) return;
            const master = getSharedVolume();
            const slot = Number.isFinite(this.volume) ? this.volume : 1;
            const heard = Math.min(1, Math.max(0, master * slot));
            this.video.volume = heard;
            this.video.muted = this.muted || heard === 0;
        },

        /** Set this slot’s gain (0..1). Master volume is unchanged. */
        setVolume(value) {
            const clamped = Math.min(1, Math.max(0, Number(value) || 0));
            this.volume = clamped;
            if (clamped > 0) {
                this.lastVolume = clamped;
                this.muted = false;
            }
            this.applyAudioToVideo();
            this.emitState();
            return clamped;
        },

        mountVideo(targetEl) {
            if (!this.video) return;
            const mount = targetEl || this.videoHolder;
            this.videoMount = mount;
            this._syncVideoMount();
            mount.classList?.remove('is-hidden');
            this.videoHolder.classList.toggle('is-hidden', mount !== this.videoHolder);
        },

        /**
         * Keep exactly one visible <video> in the tile surface; staging stays in videoHolder.
         * Removes untracked orphan videos left by buffer swaps.
         */
        _syncVideoMount() {
            const mount = this.videoMount;
            if (!mount?.querySelectorAll) return;

            if (this.videoBack && this.videoBack.parentElement === mount && this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }

            for (const el of [...mount.querySelectorAll('video')]) {
                if (el === this.video) continue;
                if (el === this.videoBack) {
                    if (this.videoHolder) this.videoHolder.appendChild(el);
                    continue;
                }
                try { el.pause(); } catch { /* ignore */ }
                el.removeAttribute('src');
                try { el.load(); } catch { /* ignore */ }
                el.remove();
            }

            if (this.video && mount) {
                if (this.video.parentElement !== mount) {
                    mount.appendChild(this.video);
                }
            }

            if (this.videoBack && this.videoHolder
                && this.videoBack.parentElement !== this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }
        },

        _recycleStagingVideo() {
            if (!this.videoBack) return;
            try { this.videoBack.pause(); } catch { /* ignore */ }
            this.videoBack.removeAttribute('src');
            try { this.videoBack.load(); } catch { /* ignore */ }
            this.videoBack.classList.add('tv-video--staging');
            this.videoBack.style.cssText = '';
            this.videoBack.muted = true;
            this.videoBack.defaultMuted = true;
            if (this.videoBack.parentElement !== this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }
        },

        async _exitPresentationBeforeSwap() {
            if (typeof document === 'undefined') return;
            const pipEl = document.pictureInPictureElement;
            if (pipEl === this.video || pipEl === this.videoBack) {
                try { await document.exitPictureInPicture(); } catch { /* ignore */ }
            }
            const fsEl = document.fullscreenElement;
            if (fsEl === this.video || fsEl === this.videoBack) {
                try { await document.exitFullscreen(); } catch { /* ignore */ }
            }
        },

        async _fallbackPlayChannel(channel) {
            await this.playChannel(channel);
            const ok = Boolean(this.channel && !this.error);
            if (!ok) this._abortSwitchIntent();
            return ok;
        },

        /**
         * Clear stuck switch intent when prepare/commit fails without a new stream.
         */
        _abortSwitchIntent() {
            this.cancelPrepare();
            this.loading = false;
            this.loadPhase = 'idle';
            this.preparing = false;
            const frontLive = Boolean(
                this.video
                && this.video.videoWidth > 0
                && !this.video.paused
            );
            if (frontLive) {
                this.playing = true;
            }
            this.wantPlaying = this.playing === true;
            this.emitState();
        },

        _failPreparedSwitch(switchGen) {
            if (switchGen == null || switchGen === this.switchGeneration) {
                this._abortSwitchIntent();
            }
            return false;
        },

        /**
         * Progress-aware stuck-load watchdog — only fires after no progress for STUCK_LOAD_STALL_MS.
         */
        _noteLoadProgress(reason = 'progress') {
            this._loadLastProgressAt = Date.now();
            tvDebug('player', `load progress: ${reason}`, { slot: this.id });
            if (this._stuckLoadTimer && this.wantPlaying === true) {
                this._armStuckLoadWatchdog();
            }
        },

        _armStuckLoadWatchdog() {
            this._clearStuckLoadWatchdog();
            const transportGen = this.transportGen;
            const playGen = this.playGeneration;
            const channelKeyStr = channelKey(this.channel);
            this._stuckLoadGen = playGen;
            this._stuckLoadStartedAt = Date.now();
            if (!this._loadLastProgressAt) {
                this._loadLastProgressAt = Date.now();
            }

            this._stuckLoadTick = () => {
                if (this.wantPlaying !== true) return;
                if (transportGen !== this.transportGen) return;
                if (playGen !== this.playGeneration) return;
                if (channelKeyStr && channelKeyStr !== channelKey(this.channel)) return;
                if (this.playing) return;
                if (!(this.loading || this.loadPhase === 'connecting' || this.loadPhase === 'buffering')) return;

                const sinceProgress = Date.now() - (this._loadLastProgressAt || 0);
                if (sinceProgress < STUCK_LOAD_STALL_MS) {
                    this._stuckLoadTimer = setTimeout(() => {
                        this._stuckLoadTimer = null;
                        this._stuckLoadTick?.();
                    }, STUCK_LOAD_STALL_MS - sinceProgress);
                    return;
                }

                if (this.hls && !this._stuckLoadRetried) {
                    this._stuckLoadRetried = true;
                    tvDebug('player', 'stuck-load retry startLoad', { slot: this.id });
                    try { this.hls.startLoad(); } catch { /* ignore */ }
                    this._loadLastProgressAt = Date.now();
                    this._armStuckLoadWatchdog();
                    return;
                }

                tvDebug('player', 'stuck-load giving up', { slot: this.id });
                this.loading = false;
                this.loadPhase = 'idle';
                this.preparing = false;
                this.error = 'Stream unavailable';
                this.emitState();
                scheduleSlotPrefetch(this.id, this);
            };

            const sinceProgress = Date.now() - (this._loadLastProgressAt || 0);
            const delay = Math.max(0, STUCK_LOAD_STALL_MS - sinceProgress);
            this._stuckLoadTimer = setTimeout(() => {
                this._stuckLoadTimer = null;
                this._stuckLoadTick?.();
            }, delay);
        },

        _clearStuckLoadWatchdog() {
            if (this._stuckLoadTimer) {
                clearTimeout(this._stuckLoadTimer);
                this._stuckLoadTimer = null;
            }
        },

        /** Clear offscreen prefetch/staging styling so swapped-in video is visible in the tile. */
        _promoteFrontVideo() {
            const v = this.video;
            if (!v) return;
            const wasOffscreen = v.classList.contains('tv-video--staging')
                || v.classList.contains('tv-video--prefetch');
            v.classList.remove('tv-video--staging', 'tv-video--prefetch');
            if (wasOffscreen) {
                v.style.cssText = '';
                v.defaultMuted = false;
            }
            this._syncVideoMount();
        },

        /** Re-apply audible output after promoting a muted staging buffer. */
        _refreshAudioAfterSwap() {
            if (!this.video) return;
            this.video.defaultMuted = false;
            this.applyAudioToVideo();
            const master = getSharedVolume();
            const slot = Number.isFinite(this.volume) ? this.volume : 1;
            const heard = Math.min(1, Math.max(0, master * slot));
            if (!this.muted && heard > 0) {
                this.video.muted = false;
                this.video.volume = heard;
            }
        },

        async _resolveChannelInput(channelOrKey, generation) {
            let channel = typeof channelOrKey === 'object' && channelOrKey !== null
                ? channelOrKey
                : null;

            if (!channel && typeof channelOrKey === 'string') {
                const parsed = parseChannelKey(channelOrKey);
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation != null && generation !== this.switchGeneration) {
                    return null;
                }
            }

            if (channel && !channel.url_resolved) {
                const parsed = parseChannelKey(channelKey(channel));
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation != null && generation !== this.switchGeneration) {
                    return null;
                }
            }

            const key = channelKey(channel);
            if (!key || !channel?.url_resolved) return null;
            return { channel, key };
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

        async _awaitPrepareReady(switchGen) {
            await this.waitForPrepareReady(switchGen);
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
         * @deprecated Use startPrepareChannel — kept for callers that await warm-up.
         */
        prepareChannel(channelOrKey, switchGen) {
            const gen = switchGen ?? ++this.switchGeneration;
            return this.startPrepareChannel(channelOrKey, gen);
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

            await this._awaitPrepareReady(switchGen);
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

            if (shouldRecordRecents()) {
                savePlayerState({
                    lastChannelKey: key,
                    lastChannelName: channel.name || ''
                });
            }

            const v = this.video;
            if (!(v && v.readyState >= 2)) {
                return this._failPreparedSwitch(switchGen);
            }

            this.loading = false;
            this.loadPhase = 'idle';
            this.posterDataUrl = null;

            const playPromoted = async () => {
                try {
                    await this.video.play();
                } catch (playErr) {
                    if (!shouldContinuePlayAfterAttach({
                        generation,
                        playGeneration: this.playGeneration,
                        wantPlaying: this.wantPlaying,
                        transportGen: this.transportGen,
                        transportAtStart
                    })) {
                        return false;
                    }
                    if (shouldRetryPlayMuted({
                        blocked: isAutoplayNotAllowedError(playErr),
                        muted: this.muted
                    })) {
                        this.muted = true;
                        this.applyAudioToVideo();
                        await this.video.play();
                        return true;
                    }
                    if (playErr?.name === 'AbortError') {
                        await new Promise((r) => setTimeout(r, 50));
                        await this.video.play();
                        return true;
                    }
                    throw playErr;
                }
                return true;
            };

            try {
                const played = await playPromoted();
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
        },

        emitState() {
            syncWatchAccrual();
            onState?.(this);
            if (!shouldBroadcast()) return;
            window.dispatchEvent(new CustomEvent('tv:state_changed', {
                detail: {
                    channel: this.channel,
                    playing: this.playing,
                    wantPlaying: this.wantPlaying,
                    loading: this.loading,
                    loadPhase: this.loadPhase,
                    pausePhase: this.pausePhase,
                    error: this.error,
                    resumeBlocked: this.resumeBlocked,
                    volume: getSharedVolume(),
                    muted: this.muted,
                    favorites: FavoritesRecents.getFavorites(),
                    favoritesMeta: FavoritesRecents.getFavoritesMeta(),
                    recents: FavoritesRecents.getRecents(),
                    recentsMeta: FavoritesRecents.getRecentsMeta(),
                    seekInfo: this.getSeekInfo(),
                    slotId: this.id
                }
            }));
        },

        mute() {
            this.muted = true;
            this.applyAudioToVideo();
            this.emitState();
        },

        unmute() {
            this.muted = false;
            const master = getSharedVolume();
            if (master <= 0) {
                const restored = getLastVolume() > 0 ? getLastVolume() : 0.85;
                onSharedVolumeChange?.(restored, restored);
            }
            if ((this.volume ?? 1) <= 0) {
                this.volume = this.lastVolume > 0 ? this.lastVolume : 1;
            }
            this.applyAudioToVideo();
            this.emitState();
        },

        toggleMute() {
            const slotSilent = (this.volume ?? 1) <= 0;
            if (this.muted || getSharedVolume() === 0 || slotSilent) this.unmute();
            else this.mute();
        },

        setBufferSize(size) {
            const clamped = Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, size));
            this.bufferSize = clamped;
            applyHlsBufferConfig(this.hls, clamped);
            return clamped;
        },

        getBufferSize() {
            return this.bufferSize || loadPlayerState().bufferSize || DEFAULT_BUFFER_SIZE;
        },

        getBufferInfo() {
            const video = this.video;
            if (!video || !video.buffered || video.buffered.length === 0) {
                return { buffered: 0, duration: 0 };
            }
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const duration = video.duration || 0;
            return {
                buffered: Math.max(0, bufferedEnd - (video.currentTime || 0)),
                duration
            };
        },

        getBandwidthKbps() {
            let estimate = this.hls?.bandwidthEstimate;
            if (!Number.isFinite(estimate) || estimate <= 0) {
                estimate = this.bandwidthEstimateBps;
            }
            if (!Number.isFinite(estimate) || estimate <= 0) return null;
            return Math.round(estimate / 1000);
        },

        getQualityLevels() {
            return listQualityLevels(this.hls, this.video?.videoHeight || 0);
        },

        setQualityMode(mode) {
            const next = mode === 'auto' || mode == null ? 'auto' : Number(mode);
            this.qualityMode = applyQualityMode(this.hls, next);
            if (this.hls && this.qualityMode !== 'auto') {
                const level = this.hls.levels?.[this.qualityMode];
                if (level) {
                    this.qualityLevel = this.qualityMode;
                    this.qualityLabel = formatQualityLabel(level, this.video?.videoHeight || 0);
                }
            }
            this.emitState();
            return this.qualityMode;
        },

        getSeekInfo() {
            const video = this.video;
            if (!video || !video.buffered || video.buffered.length === 0) {
                return {
                    current: 0,
                    bufferedStart: 0,
                    bufferedEnd: 0,
                    isLive: !Number.isFinite(video?.duration),
                    progress: 0,
                    behindLive: null
                };
            }
            const duration = video.duration;
            const isLive = !Number.isFinite(duration);
            const current = video.currentTime || 0;
            const bufferedStart = video.buffered.start(0);
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const seekableDuration = Math.max(0, bufferedEnd - bufferedStart);
            const progress = seekableDuration > 0
                ? ((current - bufferedStart) / seekableDuration) * 100
                : 0;
            let behindLive = null;
            if (isLive && this.hls && typeof this.hls.latency === 'number') {
                behindLive = this.hls.latency;
            }
            return {
                current,
                bufferedStart,
                bufferedEnd,
                isLive,
                progress: Math.min(100, Math.max(0, progress)),
                behindLive
            };
        },

        updatePauseBuffer() {
            if (this.pausePhase === 'idle') return;
            const prevPhase = this.pausePhase;
            const info = this.getBufferInfo();
            const target = this.bufferSize || DEFAULT_BUFFER_SIZE;
            if (info.buffered >= target * 0.9) {
                this.pausePhase = 'ready';
                this._pausedFillArmed = false;
                releasePausedFill(this.id);
            } else {
                this.pausePhase = 'buffering';
                // Only ONE paused slot backfills its buffer at a time (turn
                // rotates via loadBudget) so paused refills cannot starve the
                // active player's connections.
                if (takePausedFillTurn(this.id)) {
                    if (!this._pausedFillArmed) {
                        if (this.hls) this.hls.startLoad();
                        this._pausedFillArmed = true;
                    }
                } else {
                    this._pausedFillArmed = false;
                }
            }
            if (this.pausePhase !== prevPhase) {
                this.emitState();
            }
        },

        /**
         * While pause-buffering, disable hls.js live-edge yank so the playhead
         * stays parked behind the buffer instead of jumping to present.
         */
        setPauseLiveSync(paused) {
            if (!this.hls?.config) return;
            this.hls.config.liveMaxLatencyDurationCount = paused
                ? Infinity
                : LIVE_MAX_LATENCY_DURATION_COUNT;
        },

        /** Park currentTime so headroom ≈ bufferSize (behind bufferedEnd). */
        parkBehindBuffer() {
            const video = this.video;
            if (!video?.buffered?.length) return;
            const bufferedStart = video.buffered.start(0);
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const desired = computeParkBehindTime(
                video.currentTime || 0,
                bufferedStart,
                bufferedEnd,
                this.bufferSize || DEFAULT_BUFFER_SIZE
            );
            if (desired != null) video.currentTime = desired;
        },

        /**
         * Clamp into buffered range if needed; never seek to tip/live.
         * Resume plays from the parked position so headroom stays intact.
         * @returns {boolean} true if currentTime was changed (caller should await seeked)
         */
        prepareResumePosition() {
            const video = this.video;
            if (!video?.buffered?.length) return false;
            const bufferedStart = video.buffered.start(0);
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const desired = computeResumeSeekTime(
                video.currentTime || 0,
                bufferedStart,
                bufferedEnd
            );
            if (desired == null) return false;
            video.currentTime = desired;
            return true;
        },

        async destroyHls() {
            await destroyHls(this);
        },

        async attachStream(url, generation = this.playGeneration) {
            return attachStream(this, url, generation);
        },

        beginTransport(wantPlaying) {
            this.transportGen += 1;
            this.wantPlaying = wantPlaying === true;
            if (this._parkRaf) {
                cancelAnimationFrame(this._parkRaf);
                this._parkRaf = 0;
            }
            if (this.wantPlaying) {
                this.pausePhase = 'idle';
            }
            return this.transportGen;
        },

        /**
         * Flip play/pause intent. Stuck resume/load recovery is handled here:
         * once a load intent has seen no progress, a repeated toggle restarts
         * with a fresh attach instead of re-running play() on the dead engine.
         */
        toggle() {
            if (shouldPauseOnToggle(this.wantPlaying, this.playing)) {
                this.pause();
                return;
            }
            if (
                shouldRecoverStuckLoad({
                    wantPlaying: this.wantPlaying,
                    playing: this.playing,
                    loading: this.loading,
                    loadPhase: this.loadPhase,
                    lastProgressAt: this._loadLastProgressAt
                })
                && this.channel?.url_resolved
            ) {
                void this.playChannel(this.channel);
                return;
            }
            this.resume();
        },

        /**
         * Kick video.play(); AbortError retries once, then falls back to playChannel.
         */
        _runPlay(gen) {
            const video = this.video;
            if (!video?.play) return;
            const attempt = () => {
                const p = video.play();
                if (!p?.then) return;
                p.then(() => {
                    if (gen !== this.transportGen || !this.wantPlaying) {
                        try { video.pause(); } catch { /* ignore */ }
                    }
                }).catch((err) => {
                    if (gen !== this.transportGen || !this.wantPlaying) return;
                    const name = err?.name || '';
                    // Interrupted by pause/seek during mash — retry once.
                    if (name === 'AbortError') {
                        const retry = video.play();
                        retry?.catch((err2) => {
                            if (gen !== this.transportGen || !this.wantPlaying) return;
                            if (err2?.name === 'AbortError') {
                                // Never leave wantPlaying stuck — same recovery as STOP.
                                if (
                                    shouldFallbackPlayChannelOnDoubleAbort()
                                    && this.channel?.url_resolved
                                ) {
                                    void this.playChannel(this.channel);
                                } else {
                                    this._failResume(gen);
                                }
                                return;
                            }
                            this._failResume(gen);
                        });
                        return;
                    }
                    if (
                        shouldRetryPlayMuted({
                            blocked: isAutoplayNotAllowedError(err),
                            muted: this.muted
                        })
                    ) {
                        this.muted = true;
                        this.applyAudioToVideo();
                        const mutedPlay = video.play();
                        mutedPlay?.then(() => {
                            if (gen !== this.transportGen || !this.wantPlaying) {
                                try { video.pause(); } catch { /* ignore */ }
                            }
                        }).catch(() => {
                            if (gen !== this.transportGen || !this.wantPlaying) return;
                            this._failResume(gen);
                        });
                        return;
                    }
                    this._failResume(gen);
                });
            };
            attempt();
        },

        _failResume(gen) {
            if (gen !== this.transportGen || !this.wantPlaying) return;
            this.playing = false;
            this.wantPlaying = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = this.posterDataUrl ? 'ready' : 'idle';
            this.error = 'Playback blocked';
            this.resumeBlocked = true;
            // Autoplay block is not a user pause — keep wasPlaying.
            if (shouldClearWasPlayingOnAutoplayBlock() && shouldRecordRecents()) {
                savePlayerState({ wasPlaying: false });
            }
            this.emitState();
        },

        /**
         * Resume attached media from the parked pause-buffer position.
         * Keep loading until the native playing event — avoids a black gap after play click.
         * If resume seeks, wait for seeked before play() to avoid AbortError races.
         */
        resume() {
            this.resumeBlocked = false;
            this.stopped = false;

            if (!this.channel?.url_resolved) {
                // Never leave a silent dead click — fall through to a fresh
                // attach so the user always sees loading/error feedback.
                void this.playChannel(this.channel);
                return;
            }

            const seek = this.getSeekInfo();
            if (shouldFreshResume({
                channelUrl: this.channel.url_resolved,
                isLive: seek.isLive,
                behindLive: seek.behindLive,
                pausedAt: this._enterPauseAt
            })) {
                // Live wandered too far while paused — the parked buffer would
                // spin; rejoin at the live edge with a fresh attach instead.
                void this.playChannel(this.channel);
                return;
            }

            if (!(this.video?.src || this.hls)) {
                void this.playChannel(this.channel);
                return;
            }

            const gen = this.beginTransport(true);
            const didSeek = this.prepareResumePosition();
            // Keep liveMaxLatency Infinity from pause-buffer — do not yank to live.
            this.pausePhase = 'idle';
            this.playing = false;
            this.loading = true;
            this.loadPhase = 'buffering';
            this.emitState();

            if (!didSeek || !this.video) {
                this._runPlay(gen);
                return;
            }

            let started = false;
            let timer = 0;
            const start = () => {
                if (started) return;
                started = true;
                this.video?.removeEventListener('seeked', start);
                clearTimeout(timer);
                if (gen !== this.transportGen || !this.wantPlaying) return;
                this._runPlay(gen);
            };
            this.video.addEventListener('seeked', start);
            timer = setTimeout(start, 400);
        },

        /**
         * Persist mosaic poster + list thumb under the current channel (fire-and-forget).
         */
        persistPauseCaches() {
            const key = channelKey(this.channel);
            const url = (this.channel?.url_resolved || this.channel?.url || '').trim();
            if (key && this.posterDataUrl) {
                PosterCache.setPoster(key, this.posterDataUrl).catch(() => {});
            }
            if (!(this.video?.videoWidth > 0)) return;
            const snap = snapshotVideoFrame(this.video);
            if (!snap?.dataUrl) return;
            const keys = [key, url].filter(Boolean);
            if (!keys.length) return;
            FrameCache.setFrames(keys, snap.dataUrl).catch(() => {});
            TileFrames.paintPlayingFrame(url, snap.dataUrl, key);
        },

        /**
         * Instant pause — snap stays off the click path via rAF.
         * Always refresh poster when the video has a decoded frame so stubs
         * do not block a fresher pause freeze into IDB.
         */
        pause() {
            this._clearStuckLoadWatchdog();
            const gen = this.beginTransport(false);
            this._enterPauseAt = Date.now();
            this._pausedFillArmed = false;
            this.switchGeneration += 1;
            this.prepareGeneration += 1;
            this._preloader?.cancel();
            this._preparePromise = null;
            this.preparing = false;
            this.preparedTarget = null;
            this.stopped = false;
            // Cancel in-flight playChannel attach so pause mid-load cannot restart play.
            if (shouldBumpPlayGenerationOnPause({
                loading: this.loading,
                loadPhase: this.loadPhase
            })) {
                this.playGeneration += 1;
            }

            if (this.video?.videoWidth > 0) {
                const poster = snapshotVideoPoster(this.video, { rejectBlack: false });
                if (poster) this.posterDataUrl = poster;
            }

            this.pausePhase = this.posterDataUrl ? 'pausing' : 'ready';
            this.setPauseLiveSync(true);
            this.video?.pause();
            this.playing = false;
            this.loading = false;
            this.loadPhase = 'idle';
            if (shouldRecordRecents()) savePlayerState({ wasPlaying: false });
            this.emitState();

            // Park + buffer fill off the click path; cancelled if user resumes first.
            this._parkRaf = requestAnimationFrame(() => {
                this._parkRaf = 0;
                if (gen !== this.transportGen || this.wantPlaying) return;
                this.parkBehindBuffer();
                this.persistPauseCaches();
                if (this.posterDataUrl) {
                    if (this.hls) this.hls.startLoad();
                    this.updatePauseBuffer();
                } else {
                    this.pausePhase = 'ready';
                    this.emitState();
                }
            });
        },

        updateBufferSize() {
            const size = this.bufferSize || this.getBufferSize();
            this.bufferSize = size;
            applyHlsBufferConfig(this.hls, size);
            if (this.video) {
                this.video.preload = size > 60 ? 'auto' : 'metadata';
            }
            this.emitState();
        },

        async resumeIfWasPlaying() {
            if (!this.channel || loadPlayerState().wasPlaying !== true) return;
            try {
                await this.playChannel(this.channel);
            } catch (e) {
                const blocked = isAutoplayNotAllowedError(e);
                if (blocked) {
                    this.resumeBlocked = true;
                    // Autoplay block is not a user pause — keep wasPlaying.
                    if (shouldClearWasPlayingOnAutoplayBlock() && shouldRecordRecents()) {
                        savePlayerState({ wasPlaying: false });
                    }
                    this.emitState();
                }
            }
        },

        async playChannel(channelOrKey) {
            this.init();
            this.switchGeneration += 1;
            this.prepareGeneration += 1;
            this._preloader?.cancel();
            this._preparePromise = null;
            this.preparing = false;
            this.preparedTarget = null;
            const generation = ++this.playGeneration;
            let channel = typeof channelOrKey === 'object' && channelOrKey !== null
                ? channelOrKey
                : null;

            if (!channel && typeof channelOrKey === 'string') {
                const parsed = parseChannelKey(channelOrKey);
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation !== this.playGeneration) return;
            }

            if (channel && !channel.url_resolved) {
                const parsed = parseChannelKey(channelKey(channel));
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation !== this.playGeneration) return;
            }

            const key = channelKey(channel);
            if (!key || !channel) return;

            this.recentRecordedForKey = null;
            this.loading = true;
            this.loadPhase = 'connecting';
            this.error = null;
            this.resumeBlocked = false;
            this.stopped = false;
            this.pausePhase = 'idle';
            this._stuckLoadRetried = false;
            this._loadLastProgressAt = Date.now();
            const transportAtStart = this.beginTransport(true);
            this.setPauseLiveSync(false);
            // A fresh play supersedes any paused-buffer backfill turn.
            this._enterPauseAt = 0;
            this._pausedFillArmed = false;
            releasePausedFill(this.id);
            // Every intentional PLAY arms a fresh channel-tile snap (even same URL).
            TileFrames.armLiveSnap(channel.url_resolved || '');
            this._armStuckLoadWatchdog();
            this.emitState();

            try {
                if (!channel.url_resolved) {
                    throw new Error('No stream URL');
                }

                this.channel = normalizeChannel(channel, channel.providerId) || channel;
                // Keep last poster until live video paints (cleared on playing).
                if (shouldRecordRecents()) {
                    savePlayerState({
                        lastChannelKey: key,
                        lastChannelName: channel.name || ''
                    });
                }

                await this.attachStream(channel.url_resolved, generation);
                if (!shouldContinuePlayAfterAttach({
                    generation,
                    playGeneration: this.playGeneration,
                    wantPlaying: this.wantPlaying,
                    transportGen: this.transportGen,
                    transportAtStart
                })) {
                    if (generation === this.playGeneration && !this.wantPlaying) {
                        this.loading = false;
                        this.loadPhase = 'idle';
                    }
                    return;
                }
                this.applyAudioToVideo();
                try {
                    await this.video.play();
                } catch (playErr) {
                    if (!shouldContinuePlayAfterAttach({
                        generation,
                        playGeneration: this.playGeneration,
                        wantPlaying: this.wantPlaying,
                        transportGen: this.transportGen,
                        transportAtStart
                    })) {
                        if (generation === this.playGeneration && !this.wantPlaying) {
                            this.loading = false;
                            this.loadPhase = 'idle';
                        }
                        return;
                    }
                    if (shouldRetryPlayMuted({
                        blocked: isAutoplayNotAllowedError(playErr),
                        muted: this.muted
                    })) {
                        this.muted = true;
                        this.applyAudioToVideo();
                        await this.video.play();
                    } else {
                        throw playErr;
                    }
                }
                if (!shouldContinuePlayAfterAttach({
                    generation,
                    playGeneration: this.playGeneration,
                    wantPlaying: this.wantPlaying,
                    transportGen: this.transportGen,
                    transportAtStart
                })) {
                    try { this.video?.pause(); } catch { /* ignore */ }
                    if (generation === this.playGeneration && !this.wantPlaying) {
                        this.loading = false;
                        this.loadPhase = 'idle';
                    }
                    return;
                }
                scheduleSlotPrefetch(this.id, this);
            } catch (e) {
                if (generation !== this.playGeneration) return;
                if (!this.wantPlaying || this.transportGen !== transportAtStart) return;
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                if (shouldClearWantPlayingOnPlayFail()) {
                    this.wantPlaying = false;
                }
                const blocked = isAutoplayNotAllowedError(e);
                if (blocked) {
                    this.error = null;
                    this.resumeBlocked = true;
                    // Autoplay block is not a user pause — keep wasPlaying.
                    if (shouldClearWasPlayingOnAutoplayBlock() && shouldRecordRecents()) {
                        savePlayerState({ wasPlaying: false });
                    }
                } else {
                    this.error = 'Stream unavailable';
                }
                if (typeof channelOrKey === 'object' && channelOrKey?.name) {
                    this.channel = normalizeChannel(channelOrKey, channelOrKey.providerId) || channelOrKey;
                }
                this.emitState();
                if (blocked) throw e;
            }
        },

        async stop({ clearChannel = false } = {}) {
            this._clearStuckLoadWatchdog();
            this.playGeneration += 1;
            this.switchGeneration += 1;
            this.prepareGeneration += 1;
            this._preloader?.cancel();
            this._preparePromise = null;
            cancelSlotPrefetch(this.id);
            this.preparing = false;
            this.preparedTarget = null;
            this.beginTransport(false);
            if (document.pictureInPictureElement === this.video
                && typeof document.exitPictureInPicture === 'function') {
                try { await document.exitPictureInPicture(); } catch { /* ignore */ }
            }
            if (this.hls) {
                await this.destroyHls();
            }
            if (this.video) {
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.load();
            }
            if (this.videoBack) {
                try {
                    this.videoBack.pause();
                    this.videoBack.removeAttribute('src');
                    this.videoBack.load();
                } catch { /* ignore */ }
            }
            if (clearChannel) this.channel = null;
            this.playing = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            this.connection = 'idle';
            this.pausePhase = 'idle';
            this.stopped = true;
            this.posterDataUrl = null;
            this._enterPauseAt = 0;
            this._pausedFillArmed = false;
            releasePausedFill(this.id);
            this.qualityMode = 'auto';
            this.qualityLevel = -1;
            this.qualityLabel = '—';
            this.bandwidthEstimateBps = null;
            if (shouldRecordRecents()) savePlayerState({ wasPlaying: false });
            this.emitState();
        },

        async dispose() {
            flushWatchAccrual();
            unregisterWatchAccrualFlusher(snapshotWatchAccrual);
            unregisterWatchAccrualAborter(abortWatchAccrual);
            this._clearStuckLoadWatchdog();
            this._preloader?.cancel();
            cancelSlotPrefetch(this.id);
            await this.stop({ clearChannel: true });
            if (this.video?.parentElement) {
                this.video.parentElement.removeChild(this.video);
            }
            if (this.videoBack?.parentElement) {
                this.videoBack.parentElement.removeChild(this.videoBack);
            }
            if (this.videoHolder?.parentElement) {
                this.videoHolder.parentElement.removeChild(this.videoHolder);
            }
            this.video = null;
            this.videoBack = null;
            this.videoHolder = null;
            this.videoMount = null;
            this._preloader = null;
        }
    };

    return player;
}
