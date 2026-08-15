/**
 * TileFrames — live stream snapshot thumbnails for channel tiles.
 *
 * States: waiting (queued / below-fold) → loading (hot capture) → captured | offline
 * Heavy HLS only for hot / IntersectionObserver-promoted tiles (no spinner sea).
 * Cache: IndexedDB JPEG keyed by stream URL only. Logos are never avatars.
 */

import { FrameCache } from './storage/frameCache.js';
import { loadHlsLibrary } from './tvHls.js';
import {
    setFrameState,
    settleFrameCapture as settleFrameCaptureUi
} from './tiles/frameUi.js';
import {
    captureStreamFrame,
    abortAllCaptures,
    snapshotVideoFrame,
    isMostlyBlackImageData,
    CAPTURE_BUDGET_MS,
    CAPTURE_BUDGET_BUSY_MS,
    MEDIA_READY_TIMEOUT,
    MEDIA_READY_BUSY_MS
} from './tiles/streamCapture.js';

const MAX_HEAVY_IDLE = 3;
const MAX_HEAVY_BUSY = 2;
/** First-screen hot budget — only these get HLS grabs until scrolled. */
const DEFAULT_HOT_BUDGET = 24;

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

/** Facade wrapper: injects live refreshEpoch for stale-capture UI skips. */
export function settleFrameCapture(frame, dataUrl, url, epoch, failReason = null) {
    settleFrameCaptureUi(frame, dataUrl, url, epoch, failReason, state.refreshEpoch);
}

export { setFrameState, isMostlyBlackImageData };

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
        captureStreamFrame(url, { playbackBusy: state.playbackBusy })
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
                state.running = Math.max(0, state.running - 1);
                // Stale captures (aborted by refresh) must not clear a re-queued tile.
                if (epoch === state.refreshEpoch) state.pending.delete(frame);
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
 * Mark tiles waiting; enqueue HLS only for the first hotBudget (DOM order).
 * Shared by observe/attach and refresh re-queue.
 */
function queueContainer(container, { reobserve = false } = {}) {
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
        if (observer) {
            if (reobserve) observer.unobserve(frame);
            observer.observe(frame);
        }
    }
    drain();
}

function attachFrames(container) {
    queueContainer(container);
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

    // Stop in-flight grabs before bumping epoch so settle sees a stale epoch
    // and does not refill FrameCache after the clear below.
    abortAllCaptures();
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

    if (keys.length) await FrameCache.removeFrames(keys).catch(() => {});
    // Yield so aborted capture finally-handlers can drop `running` before re-queue.
    await Promise.resolve();

    queueContainer(container, { reobserve: true });
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
