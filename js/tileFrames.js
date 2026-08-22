/**
 * TileFrames — fast lazy thumbs for channel tiles.
 *
 * Dual-tier drain (aef5-style): cheap (cache/logo) + heavy (offscreen HLS).
 * Hot = on-screen; warm = below-fold / prefetch. Both drain.
 * Live player snaps (notePlayingVideo) still short-circuit matching tiles.
 */

import { FrameCache } from './storage/frameCache.js';
import { PosterCache } from './storage/posterCache.js';
import { loadHlsLibrary } from './tvHls.js';
import {
    setFrameState,
    settleFrameCapture as settleFrameCaptureUi
} from './tiles/frameUi.js';
import {
    captureStreamFrame,
    abortAllCaptures,
    waitAndSnapshotTileFrame,
    snapshotVideoPoster,
    isMostlyBlackImageData,
    LIVE_TILE_SNAP_BUDGET_MS,
    CAPTURE_BUDGET_MS,
    CAPTURE_BUDGET_BUSY_MS,
    MEDIA_READY_TIMEOUT,
    MEDIA_READY_BUSY_MS
} from './tiles/streamCapture.js';

const MAX_TOTAL = 8;
const MAX_CHEAP = 6;
const MAX_HEAVY = 4;
/** When playback is busy, still allow some heavy grabs but fewer. */
const MAX_HEAVY_BUSY = 2;
const LOGO_TIMEOUT_MS = 3500;
const DEFAULT_HOT_BUDGET = 24;

const state = {
    observer: null,
    observerRoot: null,
    hot: [],
    warm: [],
    pending: new Set(),
    forceHeavy: new WeakSet(),
    /** Soft-fail (timeout/black) frames already given one automatic requeue. */
    softRetry: new WeakSet(),
    running: 0,
    heavyRunning: 0,
    playbackBusy: false,
    refreshEpoch: 0,
    liveRefreshKey: null,
    activeGrid: null
};

/** Facade: injects live refreshEpoch + skipOffline when play owns this stream. */
export function settleFrameCapture(frame, dataUrl, url, epoch, failReason = null, channelKey = '') {
    const stream = (url || '').trim();
    const gate = stream ? liveSnapByUrl.get(stream) : null;
    const skipOffline = !!(gate && (gate.noted || gate.inFlight));
    return settleFrameCaptureUi(
        frame,
        dataUrl,
        url,
        epoch,
        failReason,
        state.refreshEpoch,
        channelKey,
        skipOffline
    );
}

export { setFrameState, isMostlyBlackImageData };

function streamUrl(frame) {
    return (frame.closest('.channel-tile')?.dataset?.url || '').trim();
}

function tileChannelKey(frame) {
    return (frame.closest('.channel-tile')?.dataset?.channel || '').trim();
}

function tileLogo(frame) {
    return (frame.closest('.channel-tile')?.dataset?.logo || '').trim();
}

function isLiveRefreshActive(viewKey) {
    return !!state.liveRefreshKey && state.liveRefreshKey === viewKey;
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

function isNearViewport(frame, margin = 200) {
    if (!frame?.getBoundingClientRect) return false;
    const r = frame.getBoundingClientRect();
    if (!r) return false;
    const panel = frame.closest?.('.tv-panel');
    if (panel?.getBoundingClientRect) {
        const pr = panel.getBoundingClientRect();
        return r.bottom > pr.top - margin
            && r.top < pr.bottom + margin
            && r.right > pr.left
            && r.left < pr.right;
    }
    const h = globalThis.innerHeight || 0;
    return r.bottom > -margin && r.top < h + margin;
}

function isInViewport(frame) {
    return isNearViewport(frame, 0);
}

function applyProvisional(frame, src) {
    if (!frame || !src || frame.dataset.captured) return;
    setFrameState(frame, 'provisional', src);
}

function paintProvisionalLogos(container) {
    if (!container) return;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || frame.dataset.provisional) return;
        const logo = tileLogo(frame);
        if (logo) applyProvisional(frame, logo);
    });
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

function markWaiting(frame) {
    if (!frame || frame.dataset.captured) return;
    if (frame.dataset.provisional) {
        setFrameState(frame, 'provisional', frame.querySelector('.channel-tile__logo-img')?.getAttribute('src') || '');
        return;
    }
    setFrameState(frame, 'waiting');
}

function enqueue(frame, hot = true) {
    if (!frame || frame.dataset.captured || state.pending.has(frame)) return false;
    const url = streamUrl(frame);
    const logo = tileLogo(frame);
    const chKey = tileChannelKey(frame);
    if (!url) {
        if (logo) {
            setFrameState(frame, 'captured', logo);
            return false;
        }
        // Channel-key-only skeletons stay waiting for cache prime — not offline.
        if (chKey) {
            setFrameState(frame, 'waiting');
            return false;
        }
        setFrameState(frame, 'offline');
        return false;
    }
    if (logo && !frame.dataset.provisional) applyProvisional(frame, logo);
    state.pending.add(frame);
    markWaiting(frame);
    if (hot) state.hot.push(frame);
    else state.warm.push(frame);
    return true;
}

function promoteHot(frame) {
    if (!frame || frame.dataset.captured || !state.pending.has(frame)) return;
    if (frame.dataset.frameState === 'loading') return;
    const wi = state.warm.indexOf(frame);
    if (wi >= 0) state.warm.splice(wi, 1);
    const hi = state.hot.indexOf(frame);
    if (hi >= 0) state.hot.splice(hi, 1);
    state.hot.unshift(frame);
}

/**
 * Leave viewport: demote waiting (not loading) frames out of hot into warm
 * so they stay in the cheap/heavy backlog without blocking slots.
 */
function demoteCold(frame) {
    if (!frame || frame.dataset.captured) return;
    if (frame.dataset.frameState === 'loading') return;
    if (!state.pending.has(frame)) return;
    const i = state.hot.indexOf(frame);
    if (i >= 0) {
        state.hot.splice(i, 1);
        if (!state.warm.includes(frame)) state.warm.push(frame);
    }
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

function captureTier(frame) {
    if (state.forceHeavy.has(frame)) return 'heavy';
    const logo = tileLogo(frame);
    // Cache/logo path is cheap; pure URL without logo starts heavy.
    return logo ? 'cheap' : 'heavy';
}

function heavyLimit() {
    return state.playbackBusy ? MAX_HEAVY_BUSY : MAX_HEAVY;
}

function canStartTier(tier) {
    if (state.running >= MAX_TOTAL) return false;
    if (tier === 'heavy') {
        if (state.playbackBusy && state.heavyRunning >= MAX_HEAVY_BUSY) return false;
        return state.heavyRunning < heavyLimit();
    }
    return (state.running - state.heavyRunning) < MAX_CHEAP;
}

function pickNext() {
    pruneQueues();
    for (const queue of [state.hot, state.warm]) {
        for (let i = 0; i < queue.length; i++) {
            const frame = queue[i];
            if (!frame.isConnected) {
                state.pending.delete(frame);
                queue.splice(i, 1);
                i--;
                continue;
            }
            if (frame.dataset.captured) {
                state.pending.delete(frame);
                queue.splice(i, 1);
                i--;
                continue;
            }
            const tier = captureTier(frame);
            if (canStartTier(tier)) {
                queue.splice(i, 1);
                return { frame, tier };
            }
        }
    }
    return null;
}

function imageLoad(src, timeout) {
    return new Promise((resolve) => {
        if (typeof Image === 'undefined' || !src) {
            resolve(false);
            return;
        }
        const img = new Image();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            img.onload = img.onerror = null;
            resolve(ok);
        };
        const t = setTimeout(() => finish(false), timeout);
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = src;
    });
}

async function isMostlyBlackDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false;
    if (typeof Image === 'undefined' || typeof document === 'undefined') return false;
    try {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = 56;
        canvas.height = 56;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0, 56, 56);
        return isMostlyBlackImageData(ctx.getImageData(0, 0, 56, 56).data);
    } catch {
        return false;
    }
}

/**
 * Cheap → heavy capture path for one frame.
 * @returns {Promise<'requeue-heavy'|'requeue-soft'|void>}
 */
async function captureFrame(frame, tier, epoch) {
    const stale = () => epoch !== state.refreshEpoch || !frame.isConnected;
    const url = streamUrl(frame);
    const chKey = tileChannelKey(frame);
    const logo = tileLogo(frame);
    const alreadyHeavy = state.forceHeavy.has(frame);
    const skipCache = !!state.liveRefreshKey;

    if (!alreadyHeavy && !skipCache) {
        const keys = [url, chKey, logo].filter(Boolean);
        for (const key of keys) {
            const cached = await FrameCache.getFrame(key).catch(() => null);
            if (stale()) return;
            if (!cached) continue;
            if (await isMostlyBlackDataUrl(cached)) {
                FrameCache.removeFrame(key).catch(() => {});
                continue;
            }
            settleFrameCapture(frame, cached, url || key, epoch, null, chKey);
            return;
        }
    }

    if (logo && !alreadyHeavy) {
        if (await imageLoad(logo, LOGO_TIMEOUT_MS)) {
            if (stale()) return;
            // Fast grid fill — does not set captured so heavy can still upgrade.
            applyProvisional(frame, logo);
            if (url) return 'requeue-heavy';
            settleFrameCapture(frame, logo, logo, epoch, null, chKey);
            return;
        }
        if (stale()) return;
    }

    if (!url) {
        if (!stale()) settleFrameCapture(frame, null, '', epoch, 'media', chKey);
        return;
    }
    if (tier === 'cheap') return 'requeue-heavy';

    const result = await captureStreamFrame(url, { playbackBusy: state.playbackBusy });
    if (stale()) return;
    const settled = settleFrameCapture(
        frame,
        result?.dataUrl || null,
        url,
        epoch,
        result?.fail || null,
        chKey
    );
    // One automatic retry for soft misses (timeout/black) — not for hard D/C.
    if (settled === 'waiting' && !state.softRetry.has(frame)) {
        state.softRetry.add(frame);
        return 'requeue-soft';
    }
}

let folderFramePumpQueued = false;
function scheduleFolderFramePump() {
    if (folderFramePumpQueued) return;
    folderFramePumpQueued = true;
    const run = () => {
        folderFramePumpQueued = false;
        if (state.running > 0) return;
        if (!state.liveRefreshKey) return;
        promoteUncapturedFolderFrames(state.activeGrid);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

function drain() {
    pruneQueues();
    let next;
    while ((next = pickNext())) {
        const { frame, tier } = next;
        const epoch = state.refreshEpoch;
        state.running++;
        if (tier === 'heavy') state.heavyRunning++;
        setFrameState(frame, 'loading');
        let requeued = false;
        captureFrame(frame, tier, epoch)
            .then((result) => {
                if (result === 'requeue-heavy') {
                    requeued = true;
                    state.forceHeavy.add(frame);
                    state.pending.add(frame);
                    (isInViewport(frame) ? state.hot : state.warm).unshift(frame);
                    markWaiting(frame);
                    return;
                }
                if (result === 'requeue-soft') {
                    requeued = true;
                    state.pending.add(frame);
                    // Soft retry at the back so fresh tiles stay ahead.
                    (isInViewport(frame) ? state.hot : state.warm).push(frame);
                    markWaiting(frame);
                }
            })
            .finally(() => {
                state.running = Math.max(0, state.running - 1);
                if (tier === 'heavy') state.heavyRunning = Math.max(0, state.heavyRunning - 1);
                if (!requeued && epoch === state.refreshEpoch) {
                    state.pending.delete(frame);
                    state.forceHeavy.delete(frame);
                }
                drain();
                if (state.running === 0 && state.hot.length === 0 && state.warm.length === 0) {
                    scheduleFolderFramePump();
                }
            });
    }
}

function softenPendingWhileBusy() {
    for (const frame of state.pending) {
        if (!frame?.isConnected || frame.dataset.captured) continue;
        const logo = tileLogo(frame);
        if (logo) applyProvisional(frame, logo);
    }
    if (state.activeGrid) paintProvisionalLogos(state.activeGrid);
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
            rootMargin: '200px 0px 200px 0px',
            threshold: 0
        });
    }
    return state.observer;
}

/**
 * Queue frames: first hotBudget → hot, rest → warm (both drain).
 */
function queueContainer(container, { reobserve = false } = {}) {
    if (!container) return;
    state.activeGrid = container;
    const observer = ensureObserver(container);
    const frames = Array.from(container.querySelectorAll('.channel-tile__capture-frame'));
    const budget = hotBudget(container);
    let hotCount = 0;

    for (const frame of frames) {
        if (frame.dataset.captured) continue;
        const url = streamUrl(frame);
        const logo = tileLogo(frame);
        const chKey = tileChannelKey(frame);
        if (!url) {
            if (logo) {
                setFrameState(frame, 'captured', logo);
            } else if (chKey) {
                setFrameState(frame, 'waiting');
            } else {
                setFrameState(frame, 'offline');
            }
            if (observer) {
                if (reobserve) observer.unobserve(frame);
                observer.observe(frame);
            }
            continue;
        }
        if (hotCount < budget) {
            if (enqueue(frame, true)) hotCount++;
        } else {
            enqueue(frame, false);
        }
        if (observer) {
            if (reobserve) observer.unobserve(frame);
            observer.observe(frame);
        }
    }
    drain();
}

async function primeFromCache(container, { skipCache = false } = {}) {
    if (!container || skipCache) return;
    const frames = [];
    const keys = [];
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured) return;
        const url = streamUrl(frame);
        const chKey = tileChannelKey(frame);
        const logo = tileLogo(frame);
        if (!url && !chKey && !logo) {
            setFrameState(frame, 'waiting');
            return;
        }
        frames.push({ frame, url, chKey, logo });
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
        if (logo) keys.push(logo);
    });
    if (!frames.length) return;

    const cached = await FrameCache.getFrames([...new Set(keys)]).catch(() => new Map());
    for (const { frame, url, chKey, logo } of frames) {
        if (!frame.isConnected || frame.dataset.captured) continue;
        if (frame.dataset.frameState === 'loading') continue;
        const dataUrl = (url && cached.get(url))
            || (chKey && cached.get(chKey))
            || (logo && cached.get(logo))
            || null;
        if (dataUrl) setFrameState(frame, 'captured', dataUrl);
    }
}

// ===== PUBLIC API =====

function observe(container, opts = {}) {
    if (!container) return;
    const viewKey = opts.viewKey || null;
    const skipCache = isLiveRefreshActive(viewKey);
    state.activeGrid = container;

    paintProvisionalLogos(container);
    queueContainer(container);
    primeFromCache(container, { skipCache }).catch(() => {});

    if (state.liveRefreshKey) {
        enqueueFolderFramesForRefresh(container);
    }
}

/**
 * Wipe cache for this grid and requeue hot+warm live grabs.
 * @param {HTMLElement} container
 * @param {{ viewKey?: string }} [opts]
 */
async function refresh(container, opts = {}) {
    if (!container) return;
    const viewKey = opts.viewKey || null;
    if (viewKey && viewKey !== 'browseCountries' && viewKey !== 'settings') {
        state.liveRefreshKey = viewKey;
    } else {
        state.liveRefreshKey = null;
    }

    abortAllCaptures();
    state.refreshEpoch++;
    state.activeGrid = container;

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
        state.forceHeavy.delete(frame);
        state.softRetry.delete(frame);
        const url = streamUrl(frame);
        const chKey = tileChannelKey(frame);
        const logo = tileLogo(frame);
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
        if (logo) keys.push(logo);
        delete frame.dataset.captured;
        delete frame.dataset.provisional;
        if (logo) applyProvisional(frame, logo);
        else if (url) setFrameState(frame, 'waiting');
        else setFrameState(frame, 'offline');
    }

    if (keys.length) await FrameCache.removeFrames(keys).catch(() => {});
    await Promise.resolve();

    queueContainer(container, { reobserve: true });
}

/**
 * Re-grab a single tile preview without aborting other captures or bumping epoch.
 * @param {HTMLElement} frameOrTile capture-frame or channel-tile
 */
async function refreshFrame(frameOrTile) {
    if (!frameOrTile) return;
    const frame = frameOrTile.classList?.contains('channel-tile__capture-frame')
        ? frameOrTile
        : frameOrTile.querySelector?.('.channel-tile__capture-frame');
    if (!frame?.isConnected) return;

    for (const queue of [state.hot, state.warm]) {
        const i = queue.indexOf(frame);
        if (i >= 0) queue.splice(i, 1);
    }
    state.pending.delete(frame);
    state.forceHeavy.delete(frame);
    state.softRetry.delete(frame);

    const url = streamUrl(frame);
    const chKey = tileChannelKey(frame);
    const logo = tileLogo(frame);
    const keys = [url, chKey, logo].filter(Boolean);
    if (keys.length) await FrameCache.removeFrames(keys).catch(() => {});

    delete frame.dataset.captured;
    delete frame.dataset.provisional;
    delete frame.dataset.frameFail;

    if (!url) {
        if (logo) {
            setFrameState(frame, 'captured', logo);
        } else if (chKey) {
            setFrameState(frame, 'waiting');
        } else {
            setFrameState(frame, 'offline');
        }
        return;
    }

    if (logo) applyProvisional(frame, logo);
    else setFrameState(frame, 'waiting');

    // Skip cache/logo short-circuit — force a live heavy grab for this tile only.
    state.forceHeavy.add(frame);
    state.pending.add(frame);
    state.hot.unshift(frame);
    markWaiting(frame);
    drain();
}

function enqueueFolderFramesForRefresh(container) {
    if (!container || !state.liveRefreshKey) return;
    paintProvisionalLogos(container);
    const keys = [];
    const hot = [];
    const warm = [];
    const budget = Math.max(0, hotBudget(container) - state.hot.length);
    let added = false;

    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || state.pending.has(frame)) return;
        const url = streamUrl(frame);
        const chKey = tileChannelKey(frame);
        const logo = tileLogo(frame);
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
        if (logo) keys.push(logo);
        if (!url) return;
        if (logo && !frame.dataset.provisional) applyProvisional(frame, logo);
        state.pending.add(frame);
        markWaiting(frame);
        if (hot.length < budget) hot.push(frame);
        else warm.push(frame);
        added = true;
    });

    state.hot.push(...hot);
    state.warm.push(...warm);
    if (keys.length) FrameCache.removeFrames(keys).catch(() => {});
    if (added) drain();
}

function promoteUncapturedFolderFrames(container) {
    if (!container || !state.liveRefreshKey) return;
    paintProvisionalLogos(container);
    const keys = [];
    const hot = [];
    const warm = [];
    const budget = hotBudget(container);
    let added = false;

    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || state.pending.has(frame)) return;
        const url = streamUrl(frame);
        if (!url) return;
        if (!isNearViewport(frame)) return;
        const logo = tileLogo(frame);
        const chKey = tileChannelKey(frame);
        if (logo) applyProvisional(frame, logo);
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
        if (logo) keys.push(logo);
        state.pending.add(frame);
        markWaiting(frame);
        if (hot.length < budget) hot.push(frame);
        else warm.push(frame);
        added = true;
    });
    if (!added) return;
    state.hot.unshift(...hot);
    state.warm.push(...warm);
    if (keys.length) FrameCache.removeFrames(keys).catch(() => {});
    drain();
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
    if (next) softenPendingWhileBusy();
    else drain();
}

function warmup() {
    loadHlsLibrary().catch(() => {});
}

/** @type {Map<string, { noted: boolean, inFlight: boolean, gen: number, retries: number, retryTimer: ReturnType<typeof setTimeout>|null }>} */
const liveSnapByUrl = new Map();
/** @internal test seam */
let liveTileSnap = waitAndSnapshotTileFrame;
/** Delay between live-snap retries while a laggy channel is playing. */
let liveSnapRetryMs = 2000;
/** Max deferred retries after the first attempt (total attempts = 1 + max). */
let liveSnapMaxRetries = 8;

function snapGate(stream) {
    let gate = liveSnapByUrl.get(stream);
    if (!gate) {
        gate = { noted: false, inFlight: false, gen: 0, retries: 0, retryTimer: null };
        liveSnapByUrl.set(stream, gate);
    }
    return gate;
}

function clearLiveSnapRetry(gate) {
    if (!gate?.retryTimer) return;
    clearTimeout(gate.retryTimer);
    gate.retryTimer = null;
}

function armLiveSnap(url) {
    const stream = (url || '').trim();
    if (!stream) return;
    const gate = snapGate(stream);
    clearLiveSnapRetry(gate);
    gate.noted = false;
    gate.inFlight = false;
    gate.retries = 0;
    gate.gen += 1;
}

function scheduleLiveSnapRetry(stream, video, chKey, generation) {
    const gate = snapGate(stream);
    clearLiveSnapRetry(gate);
    if (gate.retries >= liveSnapMaxRetries) return;
    gate.retryTimer = setTimeout(() => {
        gate.retryTimer = null;
        const g = snapGate(stream);
        if (g.gen !== generation || g.noted || g.inFlight) return;
        g.retries += 1;
        notePlayingVideo(stream, video, chKey);
    }, liveSnapRetryMs);
}

function paintPlayingFrame(stream, dataUrl, chKey = '') {
    try {
        document.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
            if (!frame.isConnected) return;
            const url = streamUrl(frame);
            const key = tileChannelKey(frame);
            const matchUrl = Boolean(stream && url && url === stream);
            const matchKey = Boolean(chKey && key && key === chKey);
            if (!matchUrl && !matchKey) return;
            delete frame.dataset.frameFail;
            setFrameState(frame, 'captured', dataUrl);
            state.pending.delete(frame);
            state.forceHeavy.delete(frame);
            state.softRetry.delete(frame);
            for (const queue of [state.hot, state.warm]) {
                const i = queue.indexOf(frame);
                if (i >= 0) queue.splice(i, 1);
            }
        });
    } catch { /* ignore */ }
}

/**
 * Playback started but live snap was still black/null — clear a sticky D/C badge.
 * Channel works; thumb can catch up on a later snap.
 */
function clearOfflineForPlaying(stream, chKey = '') {
    try {
        document.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
            if (!frame.isConnected) return;
            if (frame.dataset.frameState !== 'offline') return;
            const url = streamUrl(frame);
            const key = tileChannelKey(frame);
            const matchUrl = Boolean(stream && url && url === stream);
            const matchKey = Boolean(chKey && key && key === chKey);
            if (!matchUrl && !matchKey) return;
            delete frame.dataset.frameFail;
            const logo = tileLogo(frame);
            if (logo) applyProvisional(frame, logo);
            else setFrameState(frame, 'waiting');
            state.pending.delete(frame);
            state.forceHeavy.delete(frame);
            state.softRetry.delete(frame);
            for (const queue of [state.hot, state.warm]) {
                const i = queue.indexOf(frame);
                if (i >= 0) queue.splice(i, 1);
            }
        });
    } catch { /* ignore */ }
}

/**
 * Snap from a real playing <video>, cache, and paint matching tiles.
 * On black/null, clears D/C and schedules capped retries for laggy streams.
 */
function notePlayingVideo(url, video, channelKey = '') {
    const stream = (url || '').trim();
    const chKey = (channelKey || '').trim();
    if (!stream || !video) return false;
    if (typeof document === 'undefined') return false;

    const gate = snapGate(stream);
    if (gate.noted) return false;
    if (gate.inFlight) return false;

    const generation = gate.gen;
    gate.inFlight = true;

    return (async () => {
        try {
            const snap = await liveTileSnap(
                video,
                LIVE_TILE_SNAP_BUDGET_MS,
                () => snapGate(stream).gen !== generation
            );
            if (snapGate(stream).gen !== generation) return false;
            if (!snap?.dataUrl) {
                // Playback already proved the stream works — do not leave D/C frozen.
                clearOfflineForPlaying(stream, chKey);
                scheduleLiveSnapRetry(stream, video, chKey, generation);
                return false;
            }

            gate.noted = true;
            clearLiveSnapRetry(gate);
            const keys = [stream, chKey].filter(Boolean);
            FrameCache.setFrames(keys, snap.dataUrl).catch(() => {});
            paintPlayingFrame(stream, snap.dataUrl, chKey);

            if (chKey) {
                try {
                    const poster = snapshotVideoPoster(video, { rejectBlack: true })
                        || snapshotVideoPoster(video, { rejectBlack: false });
                    if (poster) PosterCache.setPoster(chKey, poster).catch(() => {});
                } catch { /* ignore */ }
            }
            return true;
        } catch {
            return false;
        } finally {
            const g = snapGate(stream);
            if (g.gen === generation) g.inFlight = false;
        }
    })();
}

function _resetForTests() {
    for (const gate of liveSnapByUrl.values()) clearLiveSnapRetry(gate);
    state.hot.length = 0;
    state.warm.length = 0;
    state.pending.clear();
    state.forceHeavy = new WeakSet();
    state.softRetry = new WeakSet();
    state.running = 0;
    state.heavyRunning = 0;
    state.playbackBusy = false;
    state.refreshEpoch++;
    state.liveRefreshKey = null;
    state.activeGrid = null;
    liveSnapByUrl.clear();
    liveTileSnap = waitAndSnapshotTileFrame;
    liveSnapRetryMs = 2000;
    liveSnapMaxRetries = 8;
    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
        state.observerRoot = null;
    }
}

function _setLiveTileSnapForTests(fn) {
    liveTileSnap = typeof fn === 'function' ? fn : waitAndSnapshotTileFrame;
}

function _setLiveSnapRetryForTests({ ms, max } = {}) {
    if (Number.isFinite(ms)) liveSnapRetryMs = Math.max(0, ms);
    if (Number.isFinite(max)) liveSnapMaxRetries = Math.max(0, max);
}

export const TileFrames = {
    observe,
    refresh,
    refreshFrame,
    clearLiveRefresh,
    syncLiveRefresh,
    isLiveRefreshActive,
    setPlaybackBusy,
    warmup,
    enqueueFolderFramesForRefresh,
    promoteUncapturedFolderFrames,
    armLiveSnap,
    notePlayingVideo,
    paintPlayingFrame,
    setFrameState,
    settleFrameCapture,
    isMostlyBlackImageData,
    _resetForTests,
    _setLiveTileSnapForTests,
    _setLiveSnapRetryForTests,
    /** @internal */
    _onFrameVisibility: onFrameVisibility,
    /** @internal */
    _state: state,
    /** @internal */
    _liveSnapByUrl: liveSnapByUrl,
    MAX_TOTAL,
    MAX_CHEAP,
    MAX_HEAVY,
    MAX_HEAVY_BUSY,
    CAPTURE_BUDGET_MS,
    CAPTURE_BUDGET_BUSY_MS,
    MEDIA_READY_TIMEOUT,
    MEDIA_READY_BUSY_MS,
    DEFAULT_HOT_BUDGET,
    LIVE_TILE_SNAP_BUDGET_MS
};
