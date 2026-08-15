/**
 * TileFrames — live stream snapshot thumbnails for channel tiles.
 *
 * States: waiting (queued / below-fold) → loading (hot capture) → captured | offline
 * Heavy HLS only for hot / IntersectionObserver-promoted tiles (no spinner sea).
 * Cache: IndexedDB JPEG keyed by stream URL only. Logos are never avatars.
 */

import { FrameCache } from './storage/frameCache.js';
import { loadHlsLibrary, isHlsUrl, canPlayNativeHls } from './tvHls.js';

const MAX_HEAVY_IDLE = 3;
const MAX_HEAVY_BUSY = 2;
/** Idle overall / media-ready budgets (top-of-list grabs). */
const CAPTURE_BUDGET_MS = 5000;
const MEDIA_READY_TIMEOUT = 3500;
const FRAME_POLL_MS = 1000;
/** Tighter budgets while the main player is busy (Caribbean autoplay, etc.). */
const CAPTURE_BUDGET_BUSY_MS = 3500;
const MEDIA_READY_BUSY_MS = 2500;
const FRAME_POLL_BUSY_MS = 600;
/** First-screen hot budget — only these get HLS grabs until scrolled. */
const DEFAULT_HOT_BUDGET = 24;

const CAPTURE_HLS_CONFIG = {
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

const state = {
    observer: null,
    observerRoot: null,
    hot: [],
    /** @deprecated kept empty — heavy work is hot-only; below-fold stays waiting. */
    warm: [],
    pending: new Set(),
    running: 0,
    playbackBusy: false,
    refreshEpoch: 0,
    liveRefreshKey: null
};

function captureBudgets() {
    if (state.playbackBusy) {
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

// ===== UI STATE =====

/**
 * @param {HTMLElement} frame
 * @param {'waiting'|'loading'|'captured'|'offline'} next
 * @param {string} [src]
 */
export function setFrameState(frame, next, src) {
    if (!frame || !next) return;
    const img = frame.querySelector('.channel-tile__logo-img');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const waiting = frame.querySelector('.channel-tile__frame-waiting');
    const loading = frame.querySelector('.channel-tile__frame-loading');
    const badge = frame.querySelector('.channel-tile__offline-badge');
    const hide = (el) => el && el.classList.add('is-hidden');
    const show = (el) => el && el.classList.remove('is-hidden');
    const clearOfflineHint = () => {
        if (!badge) return;
        badge.removeAttribute('title');
        badge.removeAttribute('aria-label');
        badge.setAttribute('aria-hidden', 'true');
    };

    frame.dataset.frameState = next;
    if (next !== 'offline') delete frame.dataset.frameFail;

    if (next === 'waiting') {
        if (img) {
            img.removeAttribute('src');
            hide(img);
        }
        show(letter);
        show(waiting);
        hide(loading);
        hide(badge);
        clearOfflineHint();
        delete frame.dataset.captured;
        return;
    }

    if (next === 'loading') {
        if (img) hide(img);
        show(letter);
        hide(waiting);
        show(loading);
        hide(badge);
        clearOfflineHint();
        delete frame.dataset.captured;
        return;
    }

    if (next === 'captured') {
        const paintSrc = src || img?.getAttribute('src') || '';
        if (paintSrc && img) {
            img.loading = 'eager';
            img.classList.remove('is-hidden');
            if (letter) letter.classList.remove('is-hidden');
            if (img.getAttribute('src') !== paintSrc) img.src = paintSrc;
            const hideLetter = () => {
                if (!frame.isConnected) return;
                if (frame.dataset.frameState !== 'captured') return;
                if (letter) letter.classList.add('is-hidden');
            };
            if (typeof img.decode === 'function') {
                img.decode().then(hideLetter).catch(() => {
                    if (letter && frame.isConnected) letter.classList.remove('is-hidden');
                });
            } else if (img.complete) {
                hideLetter();
            } else {
                img.addEventListener('load', hideLetter, { once: true });
            }
        } else if (img?.getAttribute('src')) {
            show(img);
            hide(letter);
        }
        hide(waiting);
        hide(loading);
        hide(badge);
        clearOfflineHint();
        frame.dataset.captured = '1';
        return;
    }

    if (next === 'offline') {
        if (img) {
            img.removeAttribute('src');
            hide(img);
        }
        hide(letter);
        hide(waiting);
        hide(loading);
        show(badge);
        if (badge) {
            badge.title = 'Unable to connect';
            badge.setAttribute('aria-label', 'Unable to connect');
            badge.setAttribute('aria-hidden', 'false');
        }
        frame.dataset.captured = '1';
    }
}

/**
 * Apply the final UI state after a grab settles. Never leaves `loading`.
 * @param {HTMLElement} frame
 * @param {string|null} dataUrl
 * @param {string} url
 * @param {number} epoch
 * @param {'hls-lib'|'timeout'|'media'|'black'|null} [failReason]
 */
export function settleFrameCapture(frame, dataUrl, url, epoch, failReason = null) {
    if (dataUrl && url) {
        FrameCache.setFrame(url, dataUrl).catch(() => {});
    }
    if (epoch !== state.refreshEpoch) return;
    if (!frame?.isConnected) return;
    if (dataUrl) {
        delete frame.dataset.frameFail;
        setFrameState(frame, 'captured', dataUrl);
        return;
    }
    if (failReason) {
        frame.dataset.frameFail = failReason;
        try { console.debug('[TileFrames] capture fail', failReason, url); } catch { /* ignore */ }
    } else {
        delete frame.dataset.frameFail;
    }
    setFrameState(frame, 'offline');
}

// ===== BLACK FRAME HELPERS =====

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

function snapshotVideoFrame(video) {
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function destroyCapture(session) {
    if (!session || session.cleaned) return;
    session.cleaned = true;
    session.aborted = true;
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

// ===== ONE-SHOT CAPTURE (abortable) =====

/**
 * Grab a JPEG from a live stream. Lowest HLS rung, snap on first buffered
 * frame. Returns { dataUrl, fail } so settle can set data-frame-fail.
 */
async function captureStreamFrame(url) {
    if (typeof document === 'undefined' || !url) {
        return { dataUrl: null, fail: 'media' };
    }

    const budgets = captureBudgets();
    const session = { video: null, hls: null, aborted: false, cleaned: false };
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

// ===== QUEUE =====

function heavyLimit() {
    return state.playbackBusy ? MAX_HEAVY_BUSY : MAX_HEAVY_IDLE;
}

function streamUrl(frame) {
    return (frame.closest('.channel-tile')?.dataset?.url || '').trim();
}

function hotBudget(container) {
    const panel = container?.closest?.('.tv-panel') || container;
    const panelH = panel?.clientHeight || 0;
    const panelW = panel?.clientWidth || 0;
    if (!panelH || !panelW) return DEFAULT_HOT_BUDGET;
    const tileW = 180;
    const tileH = 72;
    const cols = Math.max(1, Math.floor(panelW / Math.max(60, tileW)));
    const rows = Math.max(3, Math.ceil(panelH / tileH) + 1);
    return Math.max(DEFAULT_HOT_BUDGET, cols * rows);
}

function pruneQueues() {
    for (const queue of [state.hot, state.warm]) {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (!queue[i].isConnected) {
                state.pending.delete(queue[i]);
                queue.splice(i, 1);
            }
        }
    }
}

function enqueue(frame, hot = true) {
    if (!frame || frame.dataset.captured || state.pending.has(frame)) return false;
    const url = streamUrl(frame);
    if (!url) {
        setFrameState(frame, 'offline');
        return false;
    }
    // Heavy HLS only for hot / promoted tiles — warm stays hourglass until scrolled.
    if (!hot) {
        setFrameState(frame, 'waiting');
        return false;
    }
    state.pending.add(frame);
    setFrameState(frame, 'waiting');
    state.hot.push(frame);
    return true;
}

/** Move an already-queued frame to the front of hot (scroll re-prioritize). */
function promoteHot(frame) {
    if (!frame || frame.dataset.captured || !state.pending.has(frame)) return;
    if (frame.dataset.frameState === 'loading') return;
    const i = state.hot.indexOf(frame);
    if (i >= 0) state.hot.splice(i, 1);
    state.hot.unshift(frame);
}

/**
 * Drop a waiting (not in-flight) frame from the heavy queue when it leaves the
 * viewport. Re-enter via IntersectionObserver to capture again. Never aborts loading.
 */
function demoteCold(frame) {
    if (!frame || frame.dataset.captured) return;
    if (frame.dataset.frameState === 'loading') return;
    if (frame.dataset.frameState !== 'waiting') return;
    const i = state.hot.indexOf(frame);
    if (i >= 0) state.hot.splice(i, 1);
    state.pending.delete(frame);
    setFrameState(frame, 'waiting');
}

/** @internal viewport callback — exported for tests */
function onFrameVisibility(frame, isIntersecting) {
    if (!frame || frame.dataset.captured) return;
    if (isIntersecting) {
        if (state.pending.has(frame)) promoteHot(frame);
        else enqueue(frame, true);
    } else {
        demoteCold(frame);
    }
}

function pickNext() {
    pruneQueues();
    if (state.running >= heavyLimit()) return null;
    for (let i = 0; i < state.hot.length; i++) {
        const frame = state.hot[i];
        if (!frame.isConnected) {
            state.pending.delete(frame);
            state.hot.splice(i, 1);
            i--;
            continue;
        }
        if (frame.dataset.captured) {
            state.pending.delete(frame);
            state.hot.splice(i, 1);
            i--;
            continue;
        }
        state.hot.splice(i, 1);
        return frame;
    }
    return null;
}

function drain() {
    let frame;
    while ((frame = pickNext())) {
        const epoch = state.refreshEpoch;
        const url = streamUrl(frame);
        state.running++;
        setFrameState(frame, 'loading');
        captureStreamFrame(url)
            .then((result) => {
                settleFrameCapture(
                    frame,
                    result?.dataUrl || null,
                    url,
                    epoch,
                    result?.fail || null
                );
            })
            .finally(() => {
                state.running--;
                state.pending.delete(frame);
                drain();
            });
    }
}

function ensureObserver(container) {
    if (typeof IntersectionObserver === 'undefined') return null;
    const panel = container?.closest?.('.tv-panel') || null;
    if (state.observer && state.observerRoot !== panel) {
        state.observer.disconnect();
        state.observer = null;
        state.observerRoot = null;
    }
    if (!state.observer) {
        state.observerRoot = panel;
        state.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                onFrameVisibility(entry.target, entry.isIntersecting);
            }
            drain();
        }, {
            root: panel,
            rootMargin: '320px 0px 320px 0px',
            threshold: 0
        });
    }
    return state.observer;
}

/**
 * Mark all tiles waiting; enqueue HLS only for the first hotBudget (DOM order).
 * Below-fold tiles stay hourglass until IntersectionObserver promotes them.
 */
function attachFrames(container) {
    const observer = ensureObserver(container);
    const frames = Array.from(container.querySelectorAll('.channel-tile__capture-frame'));
    const budget = hotBudget(container);
    let hotCount = 0;

    for (const frame of frames) {
        if (frame.dataset.captured) continue;
        const url = streamUrl(frame);
        if (!url) {
            setFrameState(frame, 'offline');
            continue;
        }
        if (hotCount < budget) {
            if (enqueue(frame, true)) hotCount++;
        } else {
            setFrameState(frame, 'waiting');
        }
        if (observer) observer.observe(frame);
    }
    drain();
}

async function primeFromCache(container, { skipCache = false } = {}) {
    if (!container || skipCache) return;
    const frames = [];
    const urls = [];
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured) return;
        const url = streamUrl(frame);
        if (!url) {
            setFrameState(frame, 'offline');
            return;
        }
        frames.push({ frame, url });
        urls.push(url);
    });
    if (!frames.length) return;

    const cached = await FrameCache.getFrames([...new Set(urls)]).catch(() => new Map());
    for (const { frame, url } of frames) {
        if (!frame.isConnected || frame.dataset.captured) continue;
        if (frame.dataset.frameState === 'loading') continue;
        const dataUrl = cached.get(url);
        if (dataUrl) setFrameState(frame, 'captured', dataUrl);
    }
}

// ===== PUBLIC API =====

function isLiveRefreshActive(viewKey) {
    return !!state.liveRefreshKey && state.liveRefreshKey === viewKey;
}

function observe(container, opts = {}) {
    if (!container) return;
    const viewKey = opts.viewKey || null;
    const skipCache = isLiveRefreshActive(viewKey);

    attachFrames(container);
    primeFromCache(container, { skipCache }).catch(() => {});
}

async function refresh(container, opts = {}) {
    if (!container) return;
    const viewKey = opts.viewKey || null;
    if (viewKey && viewKey !== 'browseCountries' && viewKey !== 'settings') {
        state.liveRefreshKey = viewKey;
    } else {
        state.liveRefreshKey = null;
    }

    state.refreshEpoch++;

    const frames = Array.from(container.querySelectorAll('.channel-tile__capture-frame'));
    const frameSet = new Set(frames);
    for (const queue of [state.hot, state.warm]) {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (frameSet.has(queue[i])) queue.splice(i, 1);
        }
    }

    const keys = [];
    for (const frame of frames) {
        state.pending.delete(frame);
        const url = streamUrl(frame);
        if (url) keys.push(url);
        delete frame.dataset.captured;
        if (url) setFrameState(frame, 'waiting');
        else setFrameState(frame, 'offline');
    }

    // Re-queue hot only (same path as attach).
    const observer = ensureObserver(container);
    const budget = hotBudget(container);
    let hotCount = 0;
    for (const frame of frames) {
        if (frame.dataset.captured) continue;
        const url = streamUrl(frame);
        if (!url) continue;
        if (hotCount < budget) {
            if (enqueue(frame, true)) hotCount++;
        } else {
            setFrameState(frame, 'waiting');
        }
        if (observer) {
            observer.unobserve(frame);
            observer.observe(frame);
        }
    }
    drain();

    if (keys.length) FrameCache.removeFrames(keys).catch(() => {});
}

function clearLiveRefresh() {
    state.liveRefreshKey = null;
}

function syncLiveRefresh(viewKey) {
    if (!isLiveRefreshActive(viewKey)) clearLiveRefresh();
}

function setPlaybackBusy(busy) {
    const next = !!busy;
    if (state.playbackBusy === next) return;
    state.playbackBusy = next;
    drain();
}

/** Prefetch hls.js so the first country open does not pay CDN cost. */
function warmup() {
    loadHlsLibrary().catch(() => {});
}

/**
 * When the main player is playing a channel, cache one non-black frame from
 * the real <video> so the matching tile can skip a second HLS grab.
 * Retries on later ticks until a usable frame appears (or URL changes).
 */
let notedPlayingUrl = null;

function notePlayingVideo(url, video) {
    const stream = (url || '').trim();
    if (!stream || !video) return false;
    if (notedPlayingUrl === stream) return false;
    if (!video.videoWidth || !video.videoHeight) return false;
    if (typeof document === 'undefined') return false;

    const snap = snapshotVideoFrame(video);
    if (!snap.dataUrl) return false;

    notedPlayingUrl = stream;
    FrameCache.setFrame(stream, snap.dataUrl).catch(() => {});

    try {
        document.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
            if (streamUrl(frame) !== stream) return;
            if (!frame.isConnected) return;
            delete frame.dataset.frameFail;
            setFrameState(frame, 'captured', snap.dataUrl);
        });
    } catch { /* ignore */ }
    return true;
}

function _resetForTests() {
    state.hot.length = 0;
    state.warm.length = 0;
    state.pending.clear();
    state.running = 0;
    state.playbackBusy = false;
    state.refreshEpoch++;
    state.liveRefreshKey = null;
    notedPlayingUrl = null;
    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
        state.observerRoot = null;
    }
}

export const TileFrames = {
    observe,
    refresh,
    clearLiveRefresh,
    syncLiveRefresh,
    isLiveRefreshActive,
    setPlaybackBusy,
    warmup,
    notePlayingVideo,
    setFrameState,
    settleFrameCapture,
    isMostlyBlackImageData,
    _resetForTests,
    /** @internal */
    _onFrameVisibility: onFrameVisibility,
    /** @internal */
    _state: state,
    MAX_HEAVY_IDLE,
    MAX_HEAVY_BUSY,
    CAPTURE_BUDGET_MS,
    CAPTURE_BUDGET_BUSY_MS,
    MEDIA_READY_TIMEOUT,
    MEDIA_READY_BUSY_MS,
    DEFAULT_HOT_BUDGET
};
