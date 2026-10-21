/**
 * Pseudo player for a mosaic tile running an embedded YouTube video.
 *
 * Mirrors the fields/methods MultiView and the tile chrome read from a real
 * `createPlayerInstance()` so every existing guard (pause classification,
 * volume, watch echo, occupancy, persist) keeps working unchanged.
 * There is no HLS/<video> element — `video` stays null and the iframe is
 * mounted inside the slot's playback surface instead.
 */
import {
    formatYouTubeClock,
    normalizeYouTubeId,
    youtubeKey,
    youtubeThumbUrl
} from './youtubeLinks.js';
import {
    getYouTubeApi,
    loadYouTubeIframeApi,
    YT_PLAYER_STATE
} from './youtubeApi.js';

/**
 * Fallback embed box handed to the IFrame API (16:9, the API's own layout
 * assumption). Tiles that can hold it at least this large get a native,
 * 1:1-sized player; smaller corner tiles render at this box and are scaled
 * down as a whole.
 */
export const YOUTUBE_FRAME_WIDTH = 640;
export const YOUTUBE_FRAME_HEIGHT = 360;
/** Below this the IFrame API layout breaks — keep the base box and scale it. */
export const YOUTUBE_FRAME_MIN_WIDTH = 356;
export const YOUTUBE_FRAME_MIN_HEIGHT = 200;

/**
 * Stub channel so `channelKey()` → `youtube:<videoId>` and every occupancy /
 * persist / chrome helper sees a normal channel object.
 * @param {string} videoId
 * @param {string} [title]
 */
export function createYouTubeChannel(videoId, title = '') {
    const id = normalizeYouTubeId(videoId);
    if (!id) return null;
    return {
        providerId: 'youtube',
        channelId: id,
        channeluuid: youtubeKey(id),
        name: title || `YouTube ${id}`,
        logo: youtubeThumbUrl(id),
        url_resolved: '',
        url: ''
    };
}

const YOUTUBE_ERROR_MESSAGES = {
    2: 'Invalid YouTube link',
    5: 'YouTube player error',
    100: 'Video not found',
    101: 'Video owner blocked embedding',
    150: 'Video owner blocked embedding'
};

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

/**
 * Transport snapshot taken before a YouTube tile is moved to another screen.
 *
 * A cross-origin iframe cannot be re-parented without reloading, so swaps tear
 * the embed down and rebuild it from this snapshot.
 * @param {object|null} player YouTube adapter (or null)
 * @returns {{
 *   videoId: string,
 *   title: string,
 *   startAt: number,
 *   muted: boolean,
 *   volume: number,
 *   autoplay: boolean,
 *   watchSessionSeconds: number
 * }}
 */
export function captureYouTubeSwapState(player) {
    const seek = player?.getSeekInfo?.() || {};
    const current = Number(seek.current);
    return {
        videoId: normalizeYouTubeId(player?.videoId) || '',
        title: player?.channel?.name || '',
        startAt: Math.max(0, Math.floor(Number.isFinite(current) ? current : 0)),
        muted: player?.muted !== false,
        volume: clamp01(player?.volume),
        autoplay: player?.wantPlaying === true || player?.playing === true,
        watchSessionSeconds: Math.max(0, Number(player?.watchSessionSeconds) || 0)
    };
}

/**
 * @param {{
 *   id: string,
 *   videoId: string,
 *   title?: string,
 *   muted?: boolean,
 *   volume?: number,
 *   startAt?: number,
 *   watchSessionSeconds?: number,
 *   getSharedVolume?: () => number,
 *   getLastVolume?: () => number,
 *   onState?: (player: object) => void,
 *   onError?: (message: string, player: object) => void,
 *   onEnded?: (player: object) => void
 * }} options
 */
export function createYouTubePlayer({
    id,
    videoId,
    title = '',
    muted = true,
    volume = 1,
    startAt = 0,
    watchSessionSeconds = 0,
    getSharedVolume = () => 1,
    getLastVolume = () => 1,
    onState = null,
    onError = null,
    onEnded = null
}) {
    const normalizedId = normalizeYouTubeId(videoId);
    const player = {
        id,
        /** Discriminates this adapter from a real player everywhere in the app. */
        kind: 'youtube',
        videoId: normalizedId,
        startAt: Math.max(0, Math.round(Number(startAt) || 0)),
        video: null,
        videoBack: null,
        videoHolder: null,
        videoMount: null,
        hls: null,
        channel: createYouTubeChannel(normalizedId, title),
        posterDataUrl: youtubeThumbUrl(normalizedId),

        playing: false,
        wantPlaying: false,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'idle',
        /** CUED until the user presses ▶ (same stopped-slate contract as restore). */
        stopped: true,
        banking: false,
        preparing: false,
        healing: false,
        error: null,
        resumeBlocked: false,
        ended: false,
        connection: 'idle',
        qualityLabel: '—',
        qualityLevel: -1,
        qualityMode: 'auto',
        bufferSize: 0,

        muted,
        volume: clamp01(volume),
        lastVolume: clamp01(volume) || 1,

        /** Session-only watch time (never written to lifetime stats). */
        watchSessionSeconds: Math.max(0, Math.round(Number(watchSessionSeconds) || 0)),
        watchSessionKey: youtubeKey(normalizedId),
        watchAccrueKey: null,
        watchAccrueStartedAt: null,
        watchAccrueMediaAt: NaN,

        _destroyed: false,
        _apiReady: false,
        _ytPlayer: null,
        _frameWrap: null,
        _frameEl: null,
        _mountEl: null,
        _resizeObserver: null,
        _pendingCommands: [],
        _playStartedAt: 0,
        _onResize: null,
        /** Last applied frame box — avoids redundant iframe layout churn. */
        _fitKey: '',


        // ---- lifecycle -----------------------------------------------------
        init() {
            // Nothing to create until the tile actually mounts a surface.
        },

        mountVideo(targetEl) {
            if (this._destroyed) return;
            const surface = targetEl || null;
            if (!surface) return;
            this.videoMount = surface;
            if (!this._frameWrap) {
                this._buildFrame(surface);
            } else if (this._frameWrap.parentElement !== surface) {
                try { surface.appendChild(this._frameWrap); } catch { /* ignore */ }
            }
            surface.classList?.remove?.('is-hidden');
            this._fitFrame();
        },

        _buildFrame(surface) {
            const doc = surface.ownerDocument
                || (typeof document !== 'undefined' ? document : null);
            if (!doc) return;

            const wrap = doc.createElement('div');
            wrap.className = 'yt-frame-wrap';
            wrap.dataset.slot = this.id;
            // Stable scaled box: the API replaces only its child with an iframe.
            const frame = doc.createElement('div');
            frame.className = 'yt-frame';
            const mount = doc.createElement('div');
            mount.className = 'yt-frame-mount';
            frame.appendChild(mount);
            wrap.appendChild(frame);
            surface.replaceChildren(wrap);

            this.videoHolder = wrap;
            this._frameWrap = wrap;
            this._frameEl = frame;
            this._mountEl = mount;
            this._watchResize(surface);
            this._fitFrame();
            this._createApiPlayer(mount);
        },

        _watchResize(surface) {
            const fit = () => this._fitFrame();
            this._onResize = fit;
            if (typeof ResizeObserver === 'function') {
                try {
                    this._resizeObserver = new ResizeObserver(fit);
                    this._resizeObserver.observe(surface);
                } catch { /* ignore */ }
            }
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener('resize', fit);
            }
        },

        _fitFrame() {
            const surface = this.videoMount;
            if (!this._frameWrap || !surface || !this._frameEl) return;
            const width = surface.clientWidth || 0;
            const height = surface.clientHeight || 0;
            if (!width || !height) return;

            // Contain-fit, exactly like `<video>` on a TV tile: the whole 16:9
            // player stays visible (letterboxed by the wrapper's black
            // background). Cover-fitting magnified YouTube's own chrome and
            // cropped its control bar on non-16:9 tiles.
            const fitWidth = Math.min(width, (height * 16) / 9);
            const fitHeight = (fitWidth * 9) / 16;

            let boxWidth = fitWidth;
            let boxHeight = fitHeight;
            let scale = 1;
            if (fitWidth < YOUTUBE_FRAME_MIN_WIDTH || fitHeight < YOUTUBE_FRAME_MIN_HEIGHT) {
                // Tiny corner: keep the API's base box and shrink the whole
                // player so its responsive chrome scales down with it.
                boxWidth = YOUTUBE_FRAME_WIDTH;
                boxHeight = YOUTUBE_FRAME_HEIGHT;
                scale = fitWidth / YOUTUBE_FRAME_WIDTH;
            }

            const w = Math.max(1, Math.round(boxWidth));
            const h = Math.max(1, Math.round(boxHeight));
            const key = `${w}x${h}@${scale.toFixed(3)}`;
            if (key === this._fitKey) return;
            this._fitKey = key;

            this._frameEl.style.width = `${w}px`;
            this._frameEl.style.height = `${h}px`;
            this._frameEl.style.transform = scale === 1
                ? 'translate(-50%, -50%)'
                : `translate(-50%, -50%) scale(${scale})`;
        },

        _createApiPlayer(frameEl) {
            if (this._destroyed || this._ytPlayer) return;
            const api = getYouTubeApi();
            if (!api) {
                loadYouTubeIframeApi()
                    .then(() => {
                        if (!this._destroyed && this._mountEl) this._createApiPlayer(this._mountEl);
                    })
                    .catch(() => this._fail('YouTube is unavailable'));
                return;
            }
            try {
                const instance = new api.Player(frameEl, {
                    videoId: this.videoId,
                    playerVars: {
                        autoplay: 0,
                        controls: 1,
                        disablekb: 1,
                        enablejsapi: 1,
                        playsinline: 1,
                        rel: 0,
                        modestbranding: 1,
                        iv_load_policy: 3,
                        start: this.startAt || 0,
                        origin: typeof window !== 'undefined' ? window.location?.origin : ''
                    },
                    events: {
                        onReady: () => this._handleReady(),
                        onStateChange: (event) => this._handleApiState(event?.data),
                        onError: (event) => {
                            const code = Number(event?.data);
                            this._fail(YOUTUBE_ERROR_MESSAGES[code] || 'YouTube playback error');
                        }
                    }
                });
                this._ytPlayer = instance;
                // The API replaces the mount node with its own iframe; the
                // scaled `.yt-frame` box stays our stable layout anchor.
                const iframe = instance?.getIframe?.();
                if (iframe) iframe.classList?.add?.('yt-frame-iframe');
                this._fitFrame();
            } catch {
                this._fail('YouTube player failed to start');
            }
        },

        _handleReady() {
            if (this._destroyed) return;
            this._apiReady = true;
            this._applyAudio();
            const queue = this._pendingCommands;
            this._pendingCommands = [];
            queue.forEach(([name, args]) => this._invoke(name, args));
            this.emitState();
        },

        _invoke(name, args = []) {
            const yt = this._ytPlayer;
            if (!yt || !this._apiReady) return false;
            const fn = yt[name];
            if (typeof fn !== 'function') return false;
            try {
                fn.apply(yt, args);
                return true;
            } catch {
                return false;
            }
        },

        _command(name, args = []) {
            if (!this._apiReady || !this._ytPlayer) {
                this._pendingCommands.push([name, args]);
                return;
            }
            this._invoke(name, args);
        },

        _fail(message) {
            if (this._destroyed) return;
            this.error = { code: 'youtube', message };
            this.playing = false;
            this.wantPlaying = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = 'idle';
            this.stopped = false;
            this._bankWatch();
            try { onError?.(message, this); } catch { /* ignore */ }
            this.emitState();
        },


        _handleApiState(state) {
            if (this._destroyed) return;
            const S = YT_PLAYER_STATE;
            let endedNow = false;
            switch (state) {
                case S.PLAYING:
                    this.playing = true;
                    this.wantPlaying = true;
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.pausePhase = 'idle';
                    this.stopped = false;
                    this.ended = false;
                    this.error = null;
                    this.resumeBlocked = false;
                    this.connection = 'ok';
                    this._startWatch();
                    break;
                case S.BUFFERING:
                    this.playing = false;
                    if (this.wantPlaying) {
                        this.loading = true;
                        this.loadPhase = 'buffering';
                    } else {
                        this.loading = false;
                        this.loadPhase = 'idle';
                    }
                    break;
                case S.PAUSED:
                    this._bankWatch();
                    this.playing = false;
                    this.wantPlaying = false;
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.pausePhase = 'paused';
                    this.stopped = false;
                    break;
                case S.ENDED:
                    this._bankWatch();
                    this.playing = false;
                    this.wantPlaying = false;
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.pausePhase = 'idle';
                    this.stopped = true;
                    this.ended = true;
                    endedNow = true;
                    break;
                case S.CUED:
                    this._bankWatch();
                    this.playing = false;
                    this.wantPlaying = false;
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.pausePhase = 'idle';
                    this.stopped = true;
                    break;
                default:
                    if (this.wantPlaying) {
                        this.loading = true;
                        this.loadPhase = 'connecting';
                    }
                    break;
            }
            this.emitState();
            if (endedNow) {
                try { onEnded?.(this); } catch { /* ignore */ }
            }
        },

        // ---- watch accrual (session only) ---------------------------------
        _startWatch() {
            this._bankWatch();
            this._playStartedAt = Date.now();
        },

        _bankWatch() {
            if (!this._playStartedAt) return;
            const elapsed = Math.max(0, (Date.now() - this._playStartedAt) / 1000);
            this.watchSessionSeconds += elapsed;
            this._playStartedAt = 0;
        },

        syncWatchAccrual() {
            if (this.playing) {
                const now = Date.now();
                if (this._playStartedAt) {
                    this.watchSessionSeconds += Math.max(0, (now - this._playStartedAt) / 1000);
                }
                this._playStartedAt = now;
            } else {
                this._bankWatch();
            }
        },

        snapshotWatchAccrual() {},

        abortWatchAccrual() {},

        // ---- transport -----------------------------------------------------
        wantsToPlay() {
            return this.playing === true || this.wantPlaying === true;
        },

        toggle() {
            if (this.wantsToPlay()) this.pause();
            else this.resume();
        },

        resume() {
            if (this._destroyed) return;
            this.wantPlaying = true;
            this.stopped = false;
            this.error = null;
            if (!this.playing) {
                this.loading = true;
                this.loadPhase = 'connecting';
            }
            if (this.ended) {
                this.ended = false;
                this._command('seekTo', [this.startAt || 0, true]);
            }
            this._command('playVideo');
            this.emitState();
        },

        /**
         * Re-point the adapter (channel / poster / watch key / transport flags)
         * at another clip while keeping the same iframe and audio state.
         * @param {string} videoId
         * @param {{ title?: string, startAt?: number }} [opts]
         * @returns {boolean}
         */
        _applyClip(videoId, { title = '', startAt = 0 } = {}) {
            const id = normalizeYouTubeId(videoId);
            if (!id) return false;
            this._bankWatch();
            this.videoId = id;
            this.startAt = Math.max(0, Math.round(Number(startAt) || 0));
            this.channel = createYouTubeChannel(id, title);
            this.posterDataUrl = youtubeThumbUrl(id);
            this.watchSessionKey = youtubeKey(id);
            this.watchSessionSeconds = 0;
            this.playing = false;
            this.wantPlaying = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = 'idle';
            this.stopped = true;
            this.ended = false;
            this.error = null;
            this.resumeBlocked = false;
            this.connection = 'idle';
            return true;
        },

        /**
         * Load another clip through the IFrame API — no iframe teardown, so the
         * flip is instant and mute/volume carry over untouched.
         * @param {string} videoId
         * @param {number} [startAt]
         * @param {{ title?: string, autoplay?: boolean }} [opts]
         * @returns {boolean}
         */
        loadVideoById(videoId, startAt = 0, { title = '', autoplay = false } = {}) {
            if (this._destroyed) return false;
            if (!this._applyClip(videoId, { title, startAt })) return false;
            if (autoplay) {
                this.wantPlaying = true;
                this.stopped = false;
                this.loading = true;
                this.loadPhase = 'connecting';
            }
            this._command('loadVideoById', [{
                videoId: this.videoId,
                startSeconds: this.startAt || 0
            }]);
            if (autoplay) this._command('playVideo');
            this._applyAudio();
            this.emitState();
            return true;
        },

        /**
         * Queue navigation entry point: same clip resumes, a new clip swaps in.
         * @param {string} videoId
         * @param {{ title?: string, startAt?: number, autoplay?: boolean }} [opts]
         * @returns {boolean}
         */
        swapVideo(videoId, { title = '', startAt = 0, autoplay = true } = {}) {
            if (this._destroyed) return false;
            const id = normalizeYouTubeId(videoId);
            if (!id) return false;
            if (id === this.videoId) {
                if (autoplay) this.resume();
                return true;
            }
            return this.loadVideoById(id, startAt, { title, autoplay });
        },

        pause() {
            if (this._destroyed) return;
            this._bankWatch();
            this.wantPlaying = false;
            this.playing = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = 'paused';
            this.stopped = false;
            this._command('pauseVideo');
            this.emitState();
        },

        async stop({ clearChannel = false } = {}) {
            this._bankWatch();
            this.playing = false;
            this.wantPlaying = false;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = 'idle';
            this.stopped = true;
            this.banking = false;
            this._command('pauseVideo');
            if (clearChannel) this.channel = null;
            this.emitState();
        },

        resumeIfWasPlaying() {
            return Promise.resolve(false);
        },

        playChannel() {
            // Channel playback never reaches the adapter: prepareSlotForPlay()
            // detaches YouTube mode before any TV tune starts.
            return Promise.resolve(false);
        },

        destroy() {
            this._destroyed = true;
            this._bankWatch();
            try { this._resizeObserver?.disconnect?.(); } catch { /* ignore */ }
            this._resizeObserver = null;
            if (this._onResize
                && typeof window !== 'undefined'
                && typeof window.removeEventListener === 'function') {
                window.removeEventListener('resize', this._onResize);
            }
            this._onResize = null;
            try { this._ytPlayer?.destroy?.(); } catch { /* ignore */ }
            this._ytPlayer = null;
            try { this._frameWrap?.remove?.(); } catch { /* ignore */ }
            this._frameWrap = null;
            this._frameEl = null;
            this._mountEl = null;
            this.videoHolder = null;
            this.videoMount = null;
            this._pendingCommands = [];
        },

        // ---- audio ---------------------------------------------------------
        applyAudioToVideo() {
            this._applyAudio();
        },

        _applyAudio() {
            const master = Number(getSharedVolume());
            const slot = Number.isFinite(this.volume) ? this.volume : 1;
            const heard = clamp01((Number.isFinite(master) ? master : 1) * slot);
            const shouldMute = this.muted === true || heard <= 0;
            if (!this._apiReady || !this._ytPlayer) return;
            if (shouldMute) {
                this._invoke('mute');
                return;
            }
            this._invoke('unMute');
            this._invoke('setVolume', [Math.round(heard * 100)]);
        },

        setVolume(value) {
            const clamped = clamp01(value);
            this.volume = clamped;
            if (clamped > 0) {
                this.lastVolume = clamped;
                this.muted = false;
            }
            this._applyAudio();
            this.emitState();
            return clamped;
        },

        mute() {
            this.muted = true;
            this._applyAudio();
            this.emitState();
        },

        unmute() {
            this.muted = false;
            if (!(this.volume > 0)) {
                const restored = Number(getLastVolume());
                this.volume = restored > 0 ? clamp01(restored) : 1;
            }
            this._applyAudio();
            this.emitState();
        },

        toggleMute() {
            if (this.muted) this.unmute();
            else this.mute();
        },

        // ---- chrome readouts ----------------------------------------------
        getSeekInfo() {
            const yt = this._ytPlayer;
            const duration = Number(yt?.getDuration?.()) || 0;
            const current = Number(yt?.getCurrentTime?.()) || 0;
            const progress = duration > 0 ? clamp01(current / duration) * 100 : 0;
            return {
                current,
                bufferedStart: 0,
                bufferedEnd: duration,
                isLive: false,
                progress: Math.min(100, Math.max(0, progress)),
                behindLive: null
            };
        },

        getBufferInfo() {
            const yt = this._ytPlayer;
            const duration = Number(yt?.getDuration?.()) || 0;
            const fraction = clamp01(yt?.getVideoLoadedFraction?.());
            return { buffered: duration * fraction, duration };
        },

        getBandwidthKbps() {
            return null;
        },

        getQualityLevels() {
            return [];
        },

        setQualityMode() {},

        setBufferSize() {},

        setReattemptInterval() {},

        setReattempts() {},

        toggleBankBuffer() {
            return false;
        },

        startBankBuffer() {
            return false;
        },

        cancelBankBuffer() {
            return false;
        },

        emitState() {
            if (this._destroyed) return;
            try { onState?.(this); } catch { /* ignore */ }
            if (this.id !== 'center') return;
            if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
            window.dispatchEvent(new CustomEvent('tv:state_changed', {
                detail: {
                    channel: this.channel,
                    playing: this.playing,
                    wantPlaying: this.wantPlaying,
                    loading: this.loading,
                    loadPhase: this.loadPhase,
                    pausePhase: this.pausePhase,
                    banking: false,
                    bankPartialFill: false,
                    error: this.error,
                    resumeBlocked: this.resumeBlocked,
                    volume: Number(getSharedVolume()),
                    muted: this.muted,
                    seekInfo: this.getSeekInfo(),
                    slotId: this.id,
                    kind: 'youtube'
                }
            }));
        },

        /** `m:ss` playhead for chrome/tests. */
        getClock() {
            return formatYouTubeClock(this.getSeekInfo().current);
        }
    };

    return player;
}
