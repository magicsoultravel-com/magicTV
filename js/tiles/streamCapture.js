/**
 * Stream → JPEG capture for channel tiles.
 * Offscreen HLS for lazy browsing; live <video> snaps for playing players.
 */
import { loadHlsLibrary, isHlsUrl, canPlayNativeHls } from '../tvHls.js';

/** Idle overall / media-ready budgets (top-of-list grabs). Tuned ~aef5 VIDEO_TIMEOUT. */
export const CAPTURE_BUDGET_MS = 5500;
export const MEDIA_READY_TIMEOUT = 3500;
const FRAME_POLL_MS = 1000;
/** Tighter budgets while the main player is busy. */
export const CAPTURE_BUDGET_BUSY_MS = 3500;
export const MEDIA_READY_BUSY_MS = 2500;
const FRAME_POLL_BUSY_MS = 600;

export const CAPTURE_HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: true,
    maxBufferLength: 1,
    maxMaxBufferLength: 2,
    maxBufferSize: 512 * 1024,
    maxBufferHole: 0.5,
    startLevel: 0,
    abrEwmaDefaultEstimate: 200000,
    manifestLoadingTimeOut: 2000,
    levelLoadingTimeOut: 2000,
    fragLoadingTimeOut: 2000
};

export function captureBudgets(playbackBusy = false) {
    if (playbackBusy) {
        return {
            overall: CAPTURE_BUDGET_BUSY_MS,
            media: MEDIA_READY_BUSY_MS,
            poll: FRAME_POLL_BUSY_MS
        };
    }
    return {
        overall: CAPTURE_BUDGET_MS,
        media: MEDIA_READY_TIMEOUT,
        poll: FRAME_POLL_MS
    };
}

export function isMostlyBlackImageData(data) {
    if (!data?.length) return true;
    let dark = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 32) {
        n++;
        if (data[i] < 18 && data[i + 1] < 18 && data[i + 2] < 18) dark++;
    }
    return n > 0 && dark / n >= 0.92;
}

export function snapshotVideoFrame(video) {
    if (!video?.videoWidth || !video.videoHeight) return { dataUrl: null, fail: null };
    const canvas = document.createElement('canvas');
    canvas.width = 56;
    canvas.height = 56;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { dataUrl: null, fail: 'media' };
    try {
        ctx.drawImage(video, 0, 0, 56, 56);
        const pixels = ctx.getImageData(0, 0, 56, 56).data;
        if (isMostlyBlackImageData(pixels)) return { dataUrl: null, fail: 'black' };
        return { dataUrl: canvas.toDataURL('image/jpeg', 0.6), fail: null };
    } catch {
        return { dataUrl: null, fail: 'media' };
    }
}

/**
 * Larger 16:9-ish JPEG from a live <video> for mosaic pause posters.
 * @returns {string|null} data URL or null
 */
export function snapshotVideoPoster(video, {
    maxWidth = 720,
    quality = 0.72,
    rejectBlack = true
} = {}) {
    if (!video?.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
        ctx.drawImage(video, 0, 0, w, h);
        if (rejectBlack) {
            const sample = ctx.getImageData(0, 0, Math.min(64, w), Math.min(64, h)).data;
            if (isMostlyBlackImageData(sample)) return null;
        }
        return canvas.toDataURL('image/jpeg', quality);
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Budget for snapping a channel-tile thumb from the live primary player. */
export const LIVE_TILE_SNAP_BUDGET_MS = 3000;

/**
 * Wait for a usable (non-black) 56×56 JPEG from a playing <video>.
 * @param {HTMLVideoElement} video
 * @param {number} [budgetMs]
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<{ dataUrl: string|null, fail: string|null }>}
 */
export async function waitAndSnapshotTileFrame(
    video,
    budgetMs = LIVE_TILE_SNAP_BUDGET_MS,
    isCancelled = null
) {
    if (!video) return { dataUrl: null, fail: null };
    const deadline = Date.now() + Math.max(0, budgetMs);
    let lastFail = 'black';
    while (Date.now() < deadline) {
        if (isCancelled?.()) return { dataUrl: null, fail: 'timeout' };
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            const snap = snapshotVideoFrame(video);
            if (snap.dataUrl) return snap;
            if (snap.fail) lastFail = snap.fail;
            if (snap.fail === 'media') return snap;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        if (typeof video.requestVideoFrameCallback === 'function' && !video.paused) {
            await new Promise((resolve) => {
                const id = video.requestVideoFrameCallback(() => resolve());
                setTimeout(() => {
                    try { video.cancelVideoFrameCallback?.(id); } catch { /* ignore */ }
                    resolve();
                }, Math.min(250, remaining));
            });
        } else {
            await sleep(Math.min(100, remaining));
        }
    }
    if (isCancelled?.()) return { dataUrl: null, fail: 'timeout' };
    return { dataUrl: null, fail: lastFail };
}

async function waitForVideoFrame(video, budgetMs, isAborted) {
    const deadline = Date.now() + Math.max(0, budgetMs);
    let lastFail = 'black';
    while (Date.now() < deadline) {
        if (isAborted?.()) return { dataUrl: null, fail: 'timeout' };
        if (video.videoWidth > 0 && video.readyState >= 2) {
            const snap = snapshotVideoFrame(video);
            if (snap.dataUrl) return snap;
            if (snap.fail) lastFail = snap.fail;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        if (typeof video.requestVideoFrameCallback === 'function') {
            await new Promise((resolve) => {
                const id = video.requestVideoFrameCallback(() => resolve());
                setTimeout(() => {
                    try { video.cancelVideoFrameCallback?.(id); } catch { /* ignore */ }
                    resolve();
                }, Math.min(200, remaining));
            });
        } else {
            await sleep(Math.min(120, remaining));
        }
    }
    return { dataUrl: null, fail: lastFail };
}

/** In-flight one-shot capture sessions — aborted on manual tile refresh. */
const activeSessions = new Set();

function destroyCapture(session) {
    if (!session || session.cleaned) return;
    session.cleaned = true;
    session.aborted = true;
    activeSessions.delete(session);
    const { hls, video } = session;
    if (hls) {
        try { hls.destroy(); } catch { /* ignore */ }
        session.hls = null;
    }
    if (video) {
        try {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
        } catch { /* ignore */ }
        session.video = null;
    }
}

/** Abort every in-flight capture so refresh does not race stale HLS grabs. */
export function abortAllCaptures() {
    for (const session of [...activeSessions]) {
        destroyCapture(session);
    }
}

/**
 * Grab a JPEG from a live stream. Lowest HLS rung, snap on first buffered frame.
 * @param {string} url
 * @param {{ playbackBusy?: boolean }} [opts]
 */
export async function captureStreamFrame(url, { playbackBusy = false } = {}) {
    if (typeof document === 'undefined' || !url) {
        return { dataUrl: null, fail: 'media' };
    }

    const budgets = captureBudgets(playbackBusy);
    const session = { video: null, hls: null, aborted: false, cleaned: false };
    activeSessions.add(session);
    const started = Date.now();

    const work = (async () => {
        try {
            const video = document.createElement('video');
            session.video = video;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.preload = 'auto';
            video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:90px;opacity:0;pointer-events:none;';
            document.body.appendChild(video);

            if (session.aborted) return { dataUrl: null, fail: 'timeout' };

            const useHls = isHlsUrl(url);
            let Hls = null;
            if (useHls) {
                try { Hls = await loadHlsLibrary(); } catch { Hls = null; }
            }
            if (session.aborted) return { dataUrl: null, fail: 'timeout' };

            if (useHls && !Hls && !canPlayNativeHls(video)) {
                return { dataUrl: null, fail: 'hls-lib' };
            }

            let mediaFail = 'timeout';
            const mediaReady = new Promise((resolve, reject) => {
                let settled = false;
                const finish = (err, isError) => {
                    if (settled || session.aborted) return;
                    settled = true;
                    clearTimeout(t);
                    if (isError) reject(err || new Error('media'));
                    else resolve();
                };
                const t = setTimeout(() => {
                    mediaFail = 'timeout';
                    finish(new Error('timeout'), true);
                }, budgets.media);

                video.addEventListener('loadeddata', () => finish(null, false), { once: true });
                video.addEventListener('error', () => {
                    mediaFail = 'media';
                    finish(new Error('media error'), true);
                }, { once: true });

                if (useHls && Hls && (Hls.isSupported?.() !== false)) {
                    const hls = new Hls(CAPTURE_HLS_CONFIG);
                    session.hls = hls;
                    try {
                        hls.autoLevelEnabled = false;
                        hls.startLevel = 0;
                    } catch { /* ignore */ }
                    if (typeof window !== 'undefined' && window.Hls?.Events) {
                        hls.on(window.Hls.Events.FRAG_BUFFERED, () => finish(null, false));
                        hls.on(window.Hls.Events.ERROR, (_e, data) => {
                            if (data?.fatal) {
                                mediaFail = 'media';
                                finish(new Error('hls error'), true);
                            }
                        });
                    }
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

            try {
                await mediaReady;
            } catch {
                return { dataUrl: null, fail: mediaFail };
            }
            if (session.aborted) return { dataUrl: null, fail: 'timeout' };

            let snap = snapshotVideoFrame(video);
            if (snap.dataUrl) return snap;

            try { await video.play(); } catch { /* muted autoplay */ }
            if (session.aborted) return { dataUrl: null, fail: 'timeout' };

            snap = snapshotVideoFrame(video);
            if (snap.dataUrl) return snap;

            const remaining = Math.min(
                budgets.poll,
                budgets.overall - (Date.now() - started)
            );
            return await waitForVideoFrame(video, remaining, () => session.aborted);
        } catch {
            return { dataUrl: null, fail: 'media' };
        } finally {
            destroyCapture(session);
        }
    })();

    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(value && typeof value === 'object'
                ? value
                : { dataUrl: null, fail: 'timeout' });
        };
        const timer = setTimeout(() => {
            destroyCapture(session);
            finish({ dataUrl: null, fail: 'timeout' });
        }, budgets.overall);
        work.then(finish, () => finish({ dataUrl: null, fail: 'media' }));
    });
}
