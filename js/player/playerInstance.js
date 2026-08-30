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
    LIVE_MAX_LATENCY_DURATION_COUNT
} from './hlsAttach.js';
import { snapshotVideoPoster, snapshotVideoFrame } from '../tiles/streamCapture.js';
import { TileFrames } from '../tileFrames.js';
import { PosterCache } from '../storage/posterCache.js';
import { FrameCache } from '../storage/frameCache.js';
import { ChannelPreloader } from './channelPreloader.js';
import {
    consumePrefetched,
    cancelSlotPrefetch,
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
    shouldClearStaleBufferOnTimeupdate
} from './pauseBuffer.js';

/** Max wall-clock seconds credited in a single flush (guards hidden-tab / stuck windows). */
const WATCH_ACCRUAL_FLUSH_CAP_SEC = 30;

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

        pausePhase: 'idle',
        /** True only after an explicit stop(); cleared on play/pause/load. */
        stopped: false,
        playGeneration: 0,
        watchAccrueKey: null,
        watchAccrueStartedAt: null,

        _bindVideoEvents(videoEl) {
            if (!videoEl) return;
            const isActive = () => videoEl === this.video;

            videoEl.addEventListener('loadstart', () => {
                if (!isActive()) return;
                this.loadPhase = 'connecting';
                this.emitState();
            });
            videoEl.addEventListener('canplay', () => {
                if (!isActive()) return;
                if (this.loadPhase !== 'idle') {
                    this.loadPhase = 'idle';
                    this.emitState();
                }
            });
            videoEl.addEventListener('canplaythrough', () => {
                if (!isActive()) return;
                if (this.loading) {
                    this.loading = false;
                    this.emitState();
                }
            });
            videoEl.addEventListener('playing', () => {
                if (!isActive()) return;
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
                syncWatchAccrual();
            });
            videoEl.addEventListener('progress', () => {
                if (!isActive()) return;
                if (this.pausePhase !== 'idle') {
                    this.updatePauseBuffer();
                }
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
                    this.emitState();
                }
            });
            videoEl.addEventListener('error', () => {
                if (!isActive()) return;
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                this.error = 'Stream unavailable';
                this.emitState();
            });
            videoEl.addEventListener('ended', () => {
                if (!isActive()) return;
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
            if (this.video.parentElement !== mount) {
                mount.appendChild(this.video);
            }
            this.videoMount = mount;
            mount.classList?.remove('is-hidden');
            this.videoHolder.classList.toggle('is-hidden', mount !== this.videoHolder);
            if (this.videoBack && this.videoBack.parentElement !== this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }
        },

        _recycleStagingVideo() {
            if (!this.videoBack) return;
            try { this.videoBack.pause(); } catch { /* ignore */ }
            this.videoBack.removeAttribute('src');
            try { this.videoBack.load(); } catch { /* ignore */ }
            if (this.videoBack.parentElement !== this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }
        },

        async _resolveChannelInput(channelOrKey, generation) {
            let channel = typeof channelOrKey === 'object' && channelOrKey !== null
                ? channelOrKey
                : null;

            if (!channel && typeof channelOrKey === 'string') {
                const parsed = parseChannelKey(channelOrKey);
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation != null && generation !== this.prepareGeneration) {
                    return null;
                }
            }

            if (channel && !channel.url_resolved) {
                const parsed = parseChannelKey(channelKey(channel));
                channel = await TvProviderRegistry.getChannel(parsed);
                if (generation != null && generation !== this.prepareGeneration) {
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
            if (this.videoBack && this.videoBack !== prefetched.video) {
                try {
                    if (this.videoBack.parentElement) {
                        this.videoBack.parentElement.removeChild(this.videoBack);
                    }
                } catch { /* ignore */ }
            }
            this.videoBack = prefetched.video;
            this.videoBack.classList.add('tv-video--staging');
            this.videoBack.muted = true;
            this.videoBack.defaultMuted = true;
            if (this.videoBack.parentElement !== this.videoHolder) {
                this.videoHolder.appendChild(this.videoBack);
            }
            this._preloader.adoptPrepared({
                video: this.videoBack,
                hls: prefetched.hls,
                channel: prefetched.channel,
                url: prefetched.channel?.url_resolved || ''
            });
            return true;
        },

        /**
         * Warm the next channel offscreen while the current stream keeps playing.
         * @param {object|string} channelOrKey
         * @returns {Promise<boolean>}
         */
        async prepareChannel(channelOrKey) {
            this.init();
            this.prepareGeneration += 1;
            const gen = this.prepareGeneration;
            this._preloader.cancel();

            const resolved = await this._resolveChannelInput(channelOrKey, gen);
            if (!resolved || gen !== this.prepareGeneration) return false;

            const { channel, key } = resolved;
            const prefetched = consumePrefetched(this.id, key);
            if (prefetched && this._adoptPrefetchedStaging(prefetched)) {
                this.preparedTarget = channel;
                this.preparing = false;
                this.emitState();
                return true;
            }

            this.preparedTarget = channel;
            this.preparing = true;
            this.emitState();

            const ok = await this._preloader.warmChannel(this.videoBack, channel, {
                isStale: () => gen !== this.prepareGeneration
            });

            if (gen !== this.prepareGeneration) return false;
            this.preparing = false;
            if (ok) this.preparedTarget = channel;
            else this.preparedTarget = null;
            this.emitState();
            return ok;
        },

        /**
         * Swap the warmed staging buffer into the visible player.
         * Falls back to playChannel when warm-up did not complete.
         * @param {object|string} [channelOrKey]
         */
        async commitPreparedChannel(channelOrKey) {
            this.init();
            const fallbackInput = channelOrKey || this.preparedTarget;
            const fallbackResolved = fallbackInput
                ? await this._resolveChannelInput(fallbackInput, null)
                : null;

            if (!this._preloader.isReady()) {
                if (fallbackResolved?.channel) {
                    return this.playChannel(fallbackResolved.channel);
                }
                return;
            }

            const generation = ++this.playGeneration;
            const taken = this._preloader.takeover();
            const channel = taken.channel || fallbackResolved?.channel;
            const key = channelKey(channel);
            if (!key || !channel?.url_resolved) {
                if (fallbackResolved?.channel) {
                    return this.playChannel(fallbackResolved.channel);
                }
                return;
            }

            this.recentRecordedForKey = null;
            this.error = null;
            this.resumeBlocked = false;
            this.stopped = false;
            this.pausePhase = 'idle';
            const transportAtStart = this.beginTransport(true);
            this.setPauseLiveSync(false);
            TileFrames.armLiveSnap(channel.url_resolved || '');

            await destroyHls(this);
            try { this.video?.pause(); } catch { /* ignore */ }

            const oldFront = this.video;
            this.video = this.videoBack;
            this.videoBack = oldFront;
            this.hls = taken.hls;
            if (this.hls) {
                applyHlsBufferConfig(this.hls, this.getBufferSize());
                this.qualityMode = applyQualityMode(this.hls, this.qualityMode);
            }

            if (this.videoMount) {
                if (this.video.parentElement !== this.videoMount) {
                    this.videoMount.appendChild(this.video);
                }
                this.videoMount.classList.remove('is-hidden');
            }
            this._recycleStagingVideo();
            this.videoHolder.classList.add('is-hidden');

            this.channel = normalizeChannel(channel, channel.providerId) || channel;
            this.loading = false;
            this.loadPhase = 'idle';
            this.preparing = false;
            this.preparedTarget = null;

            if (shouldRecordRecents()) {
                savePlayerState({
                    lastChannelKey: key,
                    lastChannelName: channel.name || ''
                });
            }

            this.connection = 'connected';
            this.applyAudioToVideo();
            this.emitState();

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
                return;
            }

            cancelSlotPrefetch(this.id);
            scheduleSlotPrefetch(this.id, this);
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
            } else {
                this.pausePhase = 'buffering';
                if (this.hls) this.hls.startLoad();
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
         * Flip play/pause intent. Stuck resume (want && !playing) retries play.
         */
        toggle() {
            if (shouldPauseOnToggle(this.wantPlaying, this.playing)) {
                this.pause();
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
            if (!this.channel?.url_resolved) return;
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
            const gen = this.beginTransport(false);
            this.prepareGeneration += 1;
            this._preloader?.cancel();
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
            this.prepareGeneration += 1;
            this._preloader?.cancel();
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
            const transportAtStart = this.beginTransport(true);
            this.setPauseLiveSync(false);
            // Every intentional PLAY arms a fresh channel-tile snap (even same URL).
            TileFrames.armLiveSnap(channel.url_resolved || '');
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

        /**
         * Resolve + attach a channel but leave the video paused (mosaic restore).
         * Uses an existing PosterCache / posterDataUrl freeze-frame when present;
         * does not invent frames via muted play→snap.
         */
        async loadChannelPaused(channelOrKey) {
            this.init();
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

            this.loading = true;
            this.loadPhase = 'connecting';
            this.error = null;
            this.resumeBlocked = false;
            this.stopped = false;
            this.emitState();

            const desiredMuted = this.muted;
            const prevPoster = this.posterDataUrl;

            try {
                if (!channel.url_resolved) {
                    throw new Error('No stream URL');
                }

                this.channel = normalizeChannel(channel, channel.providerId) || channel;
                // Keep last poster until real playback clears it.
                await this.attachStream(channel.url_resolved, generation);
                if (generation !== this.playGeneration) return;

                this.posterDataUrl = prevPoster || this.posterDataUrl;
                this.playing = false;
                this.loading = false;
                this.loadPhase = 'idle';
                this.stopped = false;
                this.beginTransport(false);
                this.pausePhase = 'pausing';
                this.setPauseLiveSync(true);
                this.muted = desiredMuted;
                this.applyAudioToVideo();
                try { this.video?.pause(); } catch { /* ignore */ }
                this.parkBehindBuffer();
                if (this.posterDataUrl) {
                    if (this.hls) this.hls.startLoad();
                    this.emitState();
                    this.updatePauseBuffer();
                } else {
                    this.pausePhase = 'ready';
                    this.emitState();
                }
            } catch (e) {
                if (generation !== this.playGeneration) return;
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                this.error = 'Stream unavailable';
                this.channel = normalizeChannel(channel, channel.providerId) || channel;
                this.posterDataUrl = this.posterDataUrl || prevPoster;
                this.muted = desiredMuted;
                this.applyAudioToVideo();
                this.emitState();
            }
        },

        async stop({ clearChannel = false } = {}) {
            this.playGeneration += 1;
            this.prepareGeneration += 1;
            this._preloader?.cancel();
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
