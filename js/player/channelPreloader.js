/**
 * Offscreen HLS warm-up for channel switches — buffers the next stream
 * while the current one keeps playing on the visible video element.
 */
import { loadHlsLibrary, isHlsUrl, canPlayNativeHls } from '../tvHls.js';
import { normalizeChannel, channelKey } from '../tvProviders/channelShape.js';
import { tvDebug } from './tvDebug.js';

/** No media/HLS progress for this long ⇒ true stall (safe-loading may abort). */
export const PRELOAD_STALL_MS = 8000;

/** Absolute wall-clock cap so a wedged warm cannot hang forever. */
export const PRELOAD_MAX_WAIT_MS = 120000;

/** @deprecated Use PRELOAD_STALL_MS — kept for tests importing the old name. */
export const PRELOAD_TIMEOUT_MS = PRELOAD_STALL_MS;

/** Lightweight buffer — enough for first frame, not full playback buffer. */
export const PRELOAD_HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 3,
    maxMaxBufferLength: 6,
    maxBufferSize: 768 * 1024,
    maxBufferHole: 0.5,
    startLevel: 0,
    abrEwmaDefaultEstimate: 200000,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 20000,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 6
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function destroySession(session) {
    if (!session) return;
    if (session.hls) {
        try { session.hls.destroy(); } catch { /* ignore */ }
        session.hls = null;
    }
    if (session.video) {
        try {
            session.video.pause();
            session.video.removeAttribute('src');
            session.video.load();
        } catch { /* ignore */ }
    }
    session.ready = false;
}

function stagingMediaReady(video) {
    return Boolean(video && video.readyState >= 2);
}

/**
 * Warm a live stream on a staging <video> without touching the active player.
 */
export class ChannelPreloader {
    constructor() {
        /** @type {number} */
        this.generation = 0;
        /** @type {{ video: HTMLVideoElement|null, hls: object|null, channel: object|null, url: string, ready: boolean, lastProgressAt: number, fatalError: boolean }|null} */
        this.session = null;
    }

    cancel() {
        this.generation += 1;
        destroySession(this.session);
        this.session = null;
    }

    isReady() {
        return Boolean(this.session?.ready);
    }

    /** True when the warm has seen no progress for PRELOAD_STALL_MS. */
    isStalled() {
        const session = this.session;
        if (!session || session.ready) return false;
        return Date.now() - (session.lastProgressAt || 0) >= PRELOAD_STALL_MS;
    }

    /** Whether fragments/manifest/media events are still arriving. */
    isMakingProgress() {
        const session = this.session;
        if (!session || session.ready) return false;
        return Date.now() - (session.lastProgressAt || 0) < PRELOAD_STALL_MS;
    }

    touchProgress(reason = 'progress') {
        const session = this.session;
        if (!session) return;
        session.lastProgressAt = Date.now();
        tvDebug('preloader', `progress: ${reason}`, { url: session.url });
    }

    getPreparedChannel() {
        return this.session?.channel || null;
    }

    getPreparedKey() {
        const ch = this.getPreparedChannel();
        return ch ? channelKey(ch) : '';
    }

    /**
     * @param {HTMLVideoElement} video staging element (hidden)
     * @param {object} channel normalized or raw channel
     * @param {{ isStale?: () => boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async warmChannel(video, channel, opts = {}) {
        const isStale = opts.isStale || (() => false);

        this.cancel();
        const gen = this.generation;

        const normalized = normalizeChannel(channel, channel?.providerId) || channel;
        const url = (normalized?.url_resolved || '').trim();
        if (!url || !video) return false;

        const session = {
            video,
            hls: null,
            channel: normalized,
            url,
            ready: false,
            lastProgressAt: Date.now(),
            fatalError: false
        };
        this.session = session;

        const touch = (reason) => {
            if (isStale() || gen !== this.generation) return;
            session.lastProgressAt = Date.now();
            tvDebug('preloader', `progress: ${reason}`, { url });
        };

        try {
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.preload = 'auto';

            const useHls = isHlsUrl(url);
            let Hls = null;
            if (useHls) {
                Hls = await loadHlsLibrary();
                if (isStale() || gen !== this.generation) return false;
            }

            if (useHls && !Hls && !canPlayNativeHls(video)) {
                return false;
            }

            let attachDone = false;
            const attachMedia = () => {
                if (attachDone) return;
                attachDone = true;

                if (useHls && Hls && Hls.isSupported?.()) {
                    const hls = new Hls(PRELOAD_HLS_CONFIG);
                    session.hls = hls;
                    try {
                        hls.autoLevelEnabled = false;
                        hls.startLevel = 0;
                    } catch { /* ignore */ }

                    const events = Hls.Events;
                    hls.on(events.MANIFEST_LOADED, () => touch('manifest_loaded'));
                    hls.on(events.MANIFEST_PARSED, () => {
                        touch('manifest_parsed');
                        if (!isStale() && gen === this.generation) hls.startLoad();
                    });
                    hls.on(events.LEVEL_LOADED, () => touch('level_loaded'));
                    hls.on(events.FRAG_LOADED, () => touch('frag_loaded'));
                    hls.on(events.FRAG_BUFFERED, () => touch('frag_buffered'));
                    hls.on(events.ERROR, (_, data) => {
                        if (data?.fatal) {
                            session.fatalError = true;
                            touch('fatal');
                        }
                    });
                    hls.attachMedia(video);
                    hls.loadSource(url);
                } else if (useHls && canPlayNativeHls(video)) {
                    video.src = url;
                    video.load();
                    touch('native_src');
                } else {
                    video.src = url;
                    video.load();
                    touch('src');
                }
            };

            video.addEventListener('loadstart', () => touch('loadstart'));
            video.addEventListener('loadeddata', () => touch('loadeddata'));
            video.addEventListener('canplay', () => touch('canplay'));
            video.addEventListener('progress', () => touch('progress'));
            video.addEventListener('error', () => {
                session.fatalError = true;
                touch('media_error');
            }, { once: true });

            attachMedia();

            const startedAt = Date.now();
            try { await video.play(); } catch { /* muted autoplay */ }

            while (!isStale() && gen === this.generation) {
                if (session.fatalError) {
                    tvDebug('preloader', 'warm failed: fatal', { url });
                    destroySession(session);
                    if (this.session === session) this.session = null;
                    return false;
                }

                if (stagingMediaReady(video)) {
                    session.ready = true;
                    tvDebug('preloader', 'warm ready', {
                        url,
                        readyState: video.readyState,
                        videoWidth: video.videoWidth
                    });
                    return true;
                }

                if (Date.now() - session.lastProgressAt >= PRELOAD_STALL_MS) {
                    tvDebug('preloader', 'warm stalled', { url });
                    destroySession(session);
                    if (this.session === session) this.session = null;
                    return false;
                }

                if (Date.now() - startedAt >= PRELOAD_MAX_WAIT_MS) {
                    tvDebug('preloader', 'warm max wait', { url });
                    destroySession(session);
                    if (this.session === session) this.session = null;
                    return false;
                }

                await sleep(80);
            }

            return false;
        } catch {
            if (gen === this.generation) {
                destroySession(session);
                if (this.session === session) this.session = null;
            }
            return false;
        }
    }

    /**
     * Register an already-warmed staging buffer (e.g. from prefetch).
     */
    adoptPrepared({ video, hls, channel, url }) {
        this.cancel();
        if (!video || !channel) return;
        this.session = {
            video,
            hls: hls || null,
            channel,
            url: url || channel.url_resolved || '',
            ready: true,
            lastProgressAt: Date.now(),
            fatalError: false
        };
    }

    /**
     * Hand off warmed hls + channel without destroying the staging video.
     * @returns {{ hls: object|null, channel: object|null, url: string }}
     */
    takeover() {
        const session = this.session;
        this.session = null;
        if (!session) {
            return { hls: null, channel: null, url: '' };
        }
        const result = {
            hls: session.hls,
            channel: session.channel,
            url: session.url
        };
        session.hls = null;
        session.ready = false;
        return result;
    }
}
