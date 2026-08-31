/**
 * Offscreen HLS warm-up for channel switches — buffers the next stream
 * while the current one keeps playing on the visible video element.
 */
import { loadHlsLibrary, isHlsUrl, canPlayNativeHls } from '../tvHls.js';
import { normalizeChannel, channelKey } from '../tvProviders/channelShape.js';

/** Max wall-clock wait for first playable frame during warm-up. */
export const PRELOAD_TIMEOUT_MS = 8000;

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
    manifestLoadingTimeOut: 8000,
    levelLoadingTimeOut: 8000,
    fragLoadingTimeOut: 8000,
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

/**
 * Warm a live stream on a staging <video> without touching the active player.
 */
export class ChannelPreloader {
    constructor() {
        /** @type {number} */
        this.generation = 0;
        /** @type {{ video: HTMLVideoElement|null, hls: object|null, channel: object|null, url: string, ready: boolean }|null} */
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
     * @param {{ isStale?: () => boolean, timeoutMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    async warmChannel(video, channel, opts = {}) {
        const isStale = opts.isStale || (() => false);
        const timeoutMs = opts.timeoutMs ?? PRELOAD_TIMEOUT_MS;

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
            ready: false
        };
        this.session = session;

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

            const mediaReady = new Promise((resolve, reject) => {
                let settled = false;
                const finish = (err) => {
                    if (settled || isStale() || gen !== this.generation) return;
                    settled = true;
                    clearTimeout(timer);
                    if (err) reject(err);
                    else resolve();
                };
                const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);

                const onReady = () => finish(null);
                video.addEventListener('canplay', onReady, { once: true });
                video.addEventListener('loadeddata', onReady, { once: true });
                video.addEventListener('error', () => finish(new Error('media')), { once: true });

                if (useHls && Hls && Hls.isSupported?.()) {
                    const hls = new Hls(PRELOAD_HLS_CONFIG);
                    session.hls = hls;
                    try {
                        hls.autoLevelEnabled = false;
                        hls.startLevel = 0;
                    } catch { /* ignore */ }
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (isStale() || gen !== this.generation) return;
                        hls.startLoad();
                    });
                    hls.on(Hls.Events.FRAG_BUFFERED, () => onReady());
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        if (data?.fatal) finish(new Error('hls'));
                    });
                    hls.attachMedia(video);
                    hls.loadSource(url);
                } else if (useHls && canPlayNativeHls(video)) {
                    video.src = url;
                    video.load();
                } else {
                    video.src = url;
                    video.load();
                }
            });

            await mediaReady;
            if (isStale() || gen !== this.generation) return false;

            try { await video.play(); } catch { /* muted autoplay */ }
            if (isStale() || gen !== this.generation) return false;

            // Poll briefly for decoded dimensions when canplay fires early.
            const frameDeadline = Date.now() + 800;
            while (Date.now() < frameDeadline) {
                if (isStale() || gen !== this.generation) return false;
                if (video.videoWidth > 0 && video.readyState >= 2) break;
                await sleep(40);
            }

            if (isStale() || gen !== this.generation) return false;
            session.ready = true;
            return true;
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
            ready: true
        };
    }

    /**
     * Hand off warmed hls + channel without destroying the staging video.
     * Caller swaps video elements and owns hls after this returns.
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
