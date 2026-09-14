import {
    channelKey,
    normalizeChannel
} from '../tvProviders/channelShape.js';
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
} from '../storage/playerState.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import {
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
    LIVE_MAX_LATENCY_DURATION_COUNT
} from './hlsAttach.js';
import { snapshotVideoPoster, snapshotVideoFrame } from '../tiles/streamCapture.js';
import { TileFrames } from '../tileFrames.js';
import { PosterCache } from '../storage/posterCache.js';
import { FrameCache } from '../storage/frameCache.js';
import { ChannelPreloader, PRELOAD_STALL_MS } from './channelPreloader.js';
import {
    cancelSlotPrefetch,
    scheduleSlotPrefetch
} from './channelPrefetch.js';
import {
    computeParkBehindTime,
    computeResumeSeekTime,
    findBufferedRange,
    nextBufferedStart,
    shouldClearWasPlayingOnAutoplayBlock,
    shouldPauseOnToggle,
    shouldClearWantPlayingOnPlayFail,
    shouldFallbackPlayChannelOnDoubleAbort,
    shouldContinuePlayAfterAttach,
    shouldBumpPlayGenerationOnPause,
    isAutoplayNotAllowedError,
    shouldFreshResume,
    shouldRecoverStuckLoad,
    isClockStalled,
    isVideoFrameStalled,
    shouldRunFreezeTick,
    FREEZE_CONFIRM_MS,
    FREEZE_TICK_MS,
    FREEZE_VIDEO_CONFIRM_WINDOWS,
    FREEZE_HEAL_COOLDOWN_MS,
    FREEZE_HEAL_MAX_FAILS
} from './pauseBuffer.js';
import {
    takePausedFillTurn,
    releasePausedFill,
    shouldAllowPrefetch,
    shouldRestartHlsOnError
} from './loadBudget.js';
import { tvDebug } from './tvDebug.js';
import { createWatchAccrualControllers } from './watchAccrual.js';
import { bindPlayerVideoEvents } from './videoEvents.js';
import {
    attachPrepareCommitMethods,
    resolveChannelInput,
    playAfterAttach,
    tryMutedAutoplayRetry
} from './prepareCommit.js';

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

    /** @type {ReturnType<typeof createWatchAccrualControllers>} */
    let watchCtrl;
    const syncWatchAccrual = () => watchCtrl.syncWatchAccrual();
    const abortWatchAccrual = () => watchCtrl.abortWatchAccrual();
    const snapshotWatchAccrual = () => watchCtrl.snapshotWatchAccrual();

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
        reattemptInterval: loadPlayerState().reattemptInterval ?? DEFAULT_REATTEMPT_INTERVAL,
        reattempts: loadPlayerState().reattempts ?? DEFAULT_REATTEMPTS,

        connection: 'idle',
        /** 'auto' or locked level index */
        qualityMode: 'auto',
        qualityLevel: -1,
        qualityLabel: '—',
        bandwidthEstimateBps: null,
        errorCount: 0,
        /** Non-fatal hls restarts since last healthy paint; escalates to D/C. */
        _hlsNonFatalRestarts: 0,
        /** Auto-reconnect attempts already used in the current disconnect cycle. */
        _autoRetryAttemptsUsed: 0,
        _autoRetryTimer: null,
        _autoRetryTickTimer: null,
        _autoRetryDeadlineAt: 0,
        _autoRetryGen: 0,
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
        /** Freeze-heal tracker: healing keeps front picture/audio, warms backstage. */
        healing: false,
        _freezeTimer: null,
        _freezeGen: 0,
        _freezeLastTime: NaN,
        _freezeLastFrames: -1,
        _freezeLastTickAt: 0,
        _freezeStalledWindows: 0,
        _freezeQuickKickDone: false,
        _freezeFails: 0,
        _freezeCooldownUntil: 0,
        /** Test seam: synchronous freeze tick. */
        _freezeTick: null,

        _bindVideoEvents(videoEl) {
            bindPlayerVideoEvents(this, videoEl, { shouldRecordRecents, syncWatchAccrual });
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

        /** Decoded video frames advanced? -1 when the API is unavailable. */
        _readDecodedFrames(video) {
            if (!video) return -1;
            try {
                if (typeof video.getVideoPlaybackQuality === 'function') {
                    const q = video.getVideoPlaybackQuality();
                    if (q && Number.isFinite(Number(q.totalVideoFrames))) {
                        return Number(q.totalVideoFrames);
                    }
                }
            } catch { /* ignore */ }
            const legacy = Number(video.webkitDecodedFrameCount ?? video.mozPaintedFrames ?? NaN);
            return Number.isFinite(legacy) ? legacy : -1;
        },

        /** Reset freeze observation without touching cooldown/fail/kick state. */
        _resetFreezeObservation(now = Date.now(), { resetKick = false } = {}) {
            this._freezeLastTime = Number(this.video?.currentTime ?? NaN);
            this._freezeLastFrames = this._readDecodedFrames(this.video);
            this._freezeLastTickAt = now;
            this._freezeStalledWindows = 0;
            if (resetKick) this._freezeQuickKickDone = false;
        },

        _clearFreezeTicker() {
            if (this._freezeTimer) {
                clearInterval(this._freezeTimer);
                this._freezeTimer = null;
            }
            this._freezeTick = null;
        },

        /** Playing-state freeze ticker; cheap kicks + background warm keep A/V. */
        _armFreezeTicker() {
            this._clearFreezeTicker();
            const freezeGen = ++this._freezeGen;
            const playGen = this.playGeneration;
            const transportGen = this.transportGen;
            const chanKey = channelKey(this.channel);
            this._resetFreezeObservation(Date.now(), { resetKick: true });

            this._freezeTick = () => {
                if (freezeGen !== this._freezeGen) return;
                if (playGen !== this.playGeneration) return;
                if (transportGen !== this.transportGen) return;
                if (chanKey && chanKey !== channelKey(this.channel)) return;
                if (this.wantPlaying !== true || this.playing !== true) return;
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                this._runFreezeCheck();
            };

            // setInterval keeps node:test alive and jsdom-free unit tests
            // hanging (their document mock has no real timers/video).
            // Browser check: real DOM has document.hidden as a boolean.
            const canArmLiveTimer = typeof setInterval === 'function'
                && typeof document !== 'undefined'
                && typeof document.hidden === 'boolean';
            if (canArmLiveTimer) {
                this._freezeTimer = setInterval(() => {
                    this._freezeTick?.();
                }, FREEZE_TICK_MS);
                if (typeof this._freezeTimer?.unref === 'function') {
                    try { this._freezeTimer.unref(); } catch { /* ignore */ }
                }
            }
        },

        _runFreezeCheck(now = Date.now()) {
            const v = this.video;
            if (!shouldRunFreezeTick({
                wantPlaying: this.wantPlaying,
                playing: this.playing,
                loading: this.loading,
                loadPhase: this.loadPhase,
                paused: v?.paused === true,
                stopped: this.stopped,
                seeking: v?.seeking === true,
                hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
                hasChannel: Boolean(this.channel),
                healing: this.healing,
                prepareBusy: this.preparing === true || this._preparePromise != null
            })) {
                return;
            }
            const nowTime = Number(v?.currentTime ?? NaN);
            const nowFrames = this._readDecodedFrames(v);
            const lastTick = this._freezeLastTickAt || now;
            const elapsed = Math.max(0, now - lastTick);
            const fullStall = isClockStalled({
                lastTime: this._freezeLastTime,
                nowTime,
                elapsedMs: elapsed,
                thresholdMs: FREEZE_CONFIRM_MS
            });
            const clockAdvanced = Number.isFinite(this._freezeLastTime)
                && Number.isFinite(nowTime)
                && Math.abs(nowTime - this._freezeLastTime) >= 0.05;
            const videoStall = isVideoFrameStalled({
                lastFrames: this._freezeLastFrames,
                nowFrames,
                clockAdvanced,
                stalledWindows: this._freezeStalledWindows,
                requiredWindows: FREEZE_VIDEO_CONFIRM_WINDOWS
            });
            if (!fullStall && !videoStall) {
                if (clockAdvanced && nowFrames >= 0 && nowFrames === this._freezeLastFrames) {
                    this._freezeStalledWindows += 1;
                } else {
                    this._freezeStalledWindows = 0;
                    this._freezeLastTime = nowTime;
                    this._freezeLastFrames = nowFrames;
                }
                this._freezeLastTickAt = now;
                return;
            }
            const kind = fullStall ? 'full' : 'video-only';
            tvDebug('player', `freeze suspected (${kind})`, { slot: this.id });
            this._freezeStalledWindows = 0;
            this._freezeLastTime = nowTime;
            this._freezeLastFrames = nowFrames;
            this._freezeLastTickAt = now;
            void this._healFrozenStream(kind);
        },

        /** Cheap in-place kick: startLoad (full) / recoverMediaError (video-only). */
        _quickKickFrozenStream(kind) {
            if (this._freezeQuickKickDone) return false;
            this._freezeQuickKickDone = true;
            try {
                if (kind === 'video-only' && this.hls && typeof this.hls.recoverMediaError === 'function') {
                    this.hls.recoverMediaError();
                    tvDebug('player', 'freeze quick kick recoverMediaError', { slot: this.id });
                    return true;
                }
                if (this.hls && typeof this.hls.startLoad === 'function') {
                    if (!shouldRestartHlsOnError({ lastRestartedAt: this._lastHlsNetworkRestartAt || 0 })) {
                        return false;
                    }
                    this._lastHlsNetworkRestartAt = Date.now();
                    this.hls.startLoad();
                    tvDebug('player', 'freeze quick kick startLoad', { slot: this.id });
                    return true;
                }
                if (this.video && !this.hls) {
                    try { this.video.load(); } catch { /* ignore */ }
                    return true;
                }
            } catch { /* ignore */ }
            return false;
        },

        /** Heal frozen stream via background warm; front <video> untouched. */
        async _healFrozenStream(kind = 'full') {
            if (this.healing) return;
            if (!this.channel || this.stopped || this.wantPlaying !== true || this.playing !== true) return;
            if (this.preparing || this._preparePromise) return;
            const now = Date.now();
            if (now < (this._freezeCooldownUntil || 0)) return;
            if ((this._freezeFails || 0) >= FREEZE_HEAL_MAX_FAILS) {
                this._declareFreezeDead();
                return;
            }
            if (!this._freezeQuickKickDone) {
                this._quickKickFrozenStream(kind);
                this._resetFreezeObservation();
                return;
            }
            this.healing = true;
            this._freezeCooldownUntil = now + FREEZE_HEAL_COOLDOWN_MS;
            const healGen = this._freezeGen;
            tvDebug('player', 'freeze background heal start', { slot: this.id, kind });
            try {
                const switchGen = this.switchGeneration;
                const ok = await this._runPrepare(this.channel, switchGen, { suppressUi: true });
                if (healGen !== this._freezeGen) return;
                if (!ok || !this._preloader?.isReady()) throw new Error('heal warm not ready');
                const staging = this.videoBack;
                if (!(staging && staging.readyState >= 2)) throw new Error('heal warm no frame');
                const committed = await this.commitPreparedChannel(this.channel, switchGen, {
                    allowFallback: false,
                    fromHeal: true
                });
                if (committed !== true) throw new Error('heal swap rejected');
                this._freezeFails = 0;
                this._resetFreezeObservation(Date.now(), { resetKick: true });
            } catch {
                this.cancelPrepare();
                this._freezeFails = (this._freezeFails || 0) + 1;
                this._resetFreezeObservation();
                if ((this._freezeFails || 0) >= FREEZE_HEAL_MAX_FAILS) {
                    this._declareFreezeDead();
                    return;
                }
            } finally {
                if (healGen === this._freezeGen) this.healing = false;
                try { this.emitState(); } catch { /* ignore */ }
            }
        },

        /** Give up: enter the existing disconnect/retry flow. */
        _declareFreezeDead() {
            this.healing = false;
            this._clearFreezeTicker();
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            tvDebug('player', 'freeze heal exhausted - disconnect', { slot: this.id });
            this.emitState();
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

        emitState() {
            syncWatchAccrual();
            if (this.playing && !this.error) {
                this._clearAutoRetry({ full: true });
            } else {
                this._maybeScheduleAutoRetry();
            }
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
                    slotId: this.id,
                    autoRetryDeadlineAt: this._autoRetryDeadlineAt || 0,
                    autoRetryAttemptsUsed: this._autoRetryAttemptsUsed || 0
                }
            }));
        },

        /**
         * Wipe auto-retry timers; with `full` also reset the attempt budget.
         * User overrides always pass `{ full: true }`.
         */
        _clearAutoRetry({ full = false } = {}) {
            if (this._autoRetryTimer) {
                clearTimeout(this._autoRetryTimer);
                this._autoRetryTimer = null;
            }
            if (this._autoRetryTickTimer) {
                clearInterval(this._autoRetryTickTimer);
                this._autoRetryTickTimer = null;
            }
            if (this._autoRetryDeadlineAt) {
                this._autoRetryGen += 1;
                this._autoRetryDeadlineAt = 0;
            }
            if (full) this._autoRetryAttemptsUsed = 0;
        },

        _maybeScheduleAutoRetry() {
            if (this._autoRetryDeadlineAt) return;
            if (this.playing) return;
            if (!this.error || this.error === 'Playback blocked') return;
            if (this.resumeBlocked) return;
            if (!this.channel) return;
            if (this.stopped) return;
            if (this.wantPlaying !== true) return;
            const max = this.getReattempts();
            if (max <= 0) return;
            if ((this._autoRetryAttemptsUsed || 0) >= max) return;
            this._scheduleAutoRetry();
        },

        _scheduleAutoRetry() {
            const intervalSec = this.getReattemptInterval();
            const gen = ++this._autoRetryGen;
            this._autoRetrySwitchGen = this.switchGeneration;
            // Stagger herd: base interval + up to 2s jitter so N dead tiles don't slam at once.
            const jitterMs = Math.floor(Math.random() * 2000);
            const delayMs = (intervalSec * 1000) + jitterMs;
            this._autoRetryDeadlineAt = Date.now() + delayMs;

            this._autoRetryTickTimer = setInterval(() => {
                if (gen !== this._autoRetryGen) return;
                this.emitState();
            }, 1000);

            this._autoRetryTimer = setTimeout(() => {
                if (gen !== this._autoRetryGen) return;
                this._fireAutoRetry();
            }, delayMs);
        },

        _fireAutoRetry() {
            // Clear timers/deadline only — keep attemptsUsed until success or user reset.
            this._clearAutoRetry();
            const max = this.getReattempts();
            if (max <= 0) return;
            if ((this._autoRetryAttemptsUsed || 0) >= max) return;
            if (!this.channel || this.stopped || this.wantPlaying !== true) return;
            // Never clobber a newer user channel pick racing the countdown.
            if (this._autoRetrySwitchGen != null && this._autoRetrySwitchGen !== this.switchGeneration) return;

            this._autoRetryAttemptsUsed = (this._autoRetryAttemptsUsed || 0) + 1;
            if (this.playing === true && (this.video?.videoWidth > 0 || this.posterDataUrl)) {
                // Have something worth keeping: heal in background, front untouched.
                this._freezeFails = 0;
                this._freezeQuickKickDone = true;
                void this._healFrozenStream('full');
                return;
            }
            // Snapshot a fresh poster so the retry gap covers black, not D/C badge alone.
            try {
                if (!this.posterDataUrl && this.video?.videoWidth > 0) {
                    const poster = snapshotVideoPoster(this.video, { rejectBlack: false });
                    if (poster) this.posterDataUrl = poster;
                }
            } catch { /* ignore */ }
            void this.playChannel(this.channel, { fromAutoRetry: true });
        },

        setReattemptInterval(seconds) {
            this.reattemptInterval = clampReattemptInterval(seconds);
            return this.reattemptInterval;
        },

        getReattemptInterval() {
            return this.reattemptInterval
                ?? loadPlayerState().reattemptInterval
                ?? DEFAULT_REATTEMPT_INTERVAL;
        },

        setReattempts(count) {
            this.reattempts = clampReattempts(count);
            return this.reattempts;
        },

        getReattempts() {
            return this.reattempts
                ?? loadPlayerState().reattempts
                ?? DEFAULT_REATTEMPTS;
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
            const current = video.currentTime || 0;
            // Hole-aware: headroom is measured inside the range holding the
            // playhead. Spanning start(0)..end(last) across a gap would count
            // unbuffered seconds as playable and park the head into the hole.
            const active = findBufferedRange(video.buffered, current);
            if (active) {
                return {
                    buffered: Math.max(0, active.end - current),
                    duration: video.duration || 0
                };
            }
            // Playhead sits in a gap: nothing playable ahead of us.
            const upcoming = nextBufferedStart(video.buffered, current);
            const duration = video.duration || 0;
            return {
                buffered: 0,
                duration,
                gapToNext: upcoming == null ? null : Math.max(0, upcoming - current)
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
            // Report the active (playhead) range, not the outer span: the outer
            // span misplaces seek-bar progress when a live playlist holds a gap.
            // Fall back to the outer span only when the playhead is in a hole.
            const active = findBufferedRange(video.buffered, current);
            const bufferedStart = active ? active.start : video.buffered.start(0);
            const bufferedEnd = active
                ? active.end
                : video.buffered.end(video.buffered.length - 1);
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

        /**
         * Re-arm normal live-edge latency once media actually flows again.
         * Called from the playing event: safe because playback already has
         * headroom, so the guard cannot yank a fresh resume to live.
         */
        _restoreLiveSyncOnPlaying() {
            this.setPauseLiveSync(false);
        },

        /** Park currentTime so headroom ≈ bufferSize (behind bufferedEnd). */
        parkBehindBuffer() {
            const video = this.video;
            if (!video?.buffered?.length) return;
            const current = video.currentTime || 0;
            // In a gap there is no contiguous headroom to park inside: jump to
            // the next buffered range start instead of computing inside a hole.
            const active = findBufferedRange(video.buffered, current);
            if (!active) {
                const upcoming = nextBufferedStart(video.buffered, current);
                if (upcoming != null) video.currentTime = upcoming;
                return;
            }
            const desired = computeParkBehindTime(
                current,
                active.start,
                active.end,
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
            const current = video.currentTime || 0;
            // Resume from a gap would spin at an unbuffered timestamp: recover
            // forward into the next buffered range (+0.05s so we are inside it).
            const active = findBufferedRange(video.buffered, current);
            if (!active) {
                const upcoming = nextBufferedStart(video.buffered, current);
                if (upcoming == null) return false;
                video.currentTime = upcoming + 0.05;
                return true;
            }
            const desired = computeResumeSeekTime(
                current,
                active.start,
                active.end
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
                    void tryMutedAutoplayRetry(this, err).then((retried) => {
                        if (!retried) {
                            this._failResume(gen);
                            return;
                        }
                        if (gen !== this.transportGen || !this.wantPlaying) {
                            try { video.pause(); } catch { /* ignore */ }
                        }
                    }).catch(() => {
                        if (gen !== this.transportGen || !this.wantPlaying) return;
                        this._failResume(gen);
                    });
                    return;
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
            // Live-edge guard was disabled (Infinity) while pause-buffered.
            // Resume keeps the parked playhead, then playing re-arms normal
            // latency via _restoreLiveSyncOnPlaying — never yank to live here.
            this.pausePhase = 'idle';
            this._pausedFillArmed = false;
            releasePausedFill(this.id);
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
            this._clearAutoRetry({ full: true });
            this._clearStuckLoadWatchdog();
            this._clearFreezeTicker();
            this.healing = false;
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
                // Live HLS appends ahead of currentTime; a restrictive preload
                // like metadata lets Safari throttle native-HLS buffering and
                // starves the pause backfill. Keep auto on all sizes.
                this.video.preload = 'auto';
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

        async playChannel(channelOrKey, { fromAutoRetry = false } = {}) {
            this.init();
            if (fromAutoRetry) {
                this._clearAutoRetry();
            } else {
                this._clearAutoRetry({ full: true });
            }
            this.switchGeneration += 1;
            this.prepareGeneration += 1;
            this._preloader?.cancel();
            this._preparePromise = null;
            this.preparing = false;
            this.preparedTarget = null;
            const generation = ++this.playGeneration;

            const resolved = await resolveChannelInput(
                this,
                channelOrKey,
                () => generation === this.playGeneration,
                { requireUrl: false }
            );
            if (!resolved) return;
            const { channel, key } = resolved;

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
                const played = await playAfterAttach(this, { generation, transportAtStart });
                if (!played) {
                    if (generation === this.playGeneration && !this.wantPlaying) {
                        this.loading = false;
                        this.loadPhase = 'idle';
                    }
                    try { this.video?.pause(); } catch { /* ignore */ }
                    return;
                }
                scheduleSlotPrefetch(this.id, this);
            } catch (e) {
                if (generation !== this.playGeneration) return;
                if (!this.wantPlaying || this.transportGen !== transportAtStart) return;
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                if (shouldClearWantPlayingOnPlayFail() && !fromAutoRetry) {
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
            this._clearAutoRetry({ full: true });
            this._clearStuckLoadWatchdog();
            this._clearFreezeTicker();
            this.healing = false;
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
            this._clearFreezeTicker();
            this.healing = false;
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

    attachPrepareCommitMethods(player, { shouldRecordRecents });
    watchCtrl = createWatchAccrualControllers({
        getPlayer: () => player,
        shouldRecordRecents
    });

    return player;
}
