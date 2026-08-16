/**
 * TileFrames — paint channel-tile thumbs from IndexedDB + live player snaps.
 *
 * No offscreen HLS. Cache hits show immediately; missing frames keep letter avatars
 * until the user actually plays that channel (notePlayingVideo).
 */

import { FrameCache } from './storage/frameCache.js';
import { setFrameState } from './tiles/frameUi.js';
import {
    waitAndSnapshotTileFrame,
    snapshotVideoPoster,
    LIVE_TILE_SNAP_BUDGET_MS,
    isMostlyBlackImageData
} from './tiles/streamCapture.js';
import { PosterCache } from './storage/posterCache.js';

const state = {
    refreshEpoch: 0
};

export { setFrameState, isMostlyBlackImageData };

function streamUrl(frame) {
    return (frame.closest('.channel-tile')?.dataset?.url || '').trim();
}

function tileChannelKey(frame) {
    return (frame.closest('.channel-tile')?.dataset?.channel || '').trim();
}

async function primeFromCache(container) {
    if (!container) return;
    const frames = [];
    const keys = [];
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured) return;
        const url = streamUrl(frame);
        const chKey = tileChannelKey(frame);
        if (!url && !chKey) {
            setFrameState(frame, 'waiting');
            return;
        }
        frames.push({ frame, url, chKey });
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
    });
    if (!frames.length) return;

    const cached = await FrameCache.getFrames([...new Set(keys)]).catch(() => new Map());
    for (const { frame, url, chKey } of frames) {
        if (!frame.isConnected || frame.dataset.captured) continue;
        const dataUrl = (url && cached.get(url)) || (chKey && cached.get(chKey)) || null;
        if (dataUrl) setFrameState(frame, 'captured', dataUrl);
        else setFrameState(frame, 'waiting');
    }
}

function markWaiting(container) {
    if (!container) return;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured) return;
        setFrameState(frame, 'waiting');
    });
}

// ===== PUBLIC API =====

function observe(container) {
    if (!container) return;
    markWaiting(container);
    primeFromCache(container).catch(() => {});
}

/**
 * Clear cached thumbs for tiles in this container and reset to letter avatars.
 * New frames only appear after the user plays those channels again.
 */
async function refresh(container) {
    if (!container) return;

    state.refreshEpoch++;

    const frames = Array.from(container.querySelectorAll('.channel-tile__capture-frame'));
    const keys = [];
    for (const frame of frames) {
        const url = streamUrl(frame);
        const chKey = tileChannelKey(frame);
        if (url) keys.push(url);
        if (chKey) keys.push(chKey);
        delete frame.dataset.captured;
        setFrameState(frame, 'waiting');
    }

    if (keys.length) await FrameCache.removeFrames(keys).catch(() => {});
}

/** @type {Map<string, { noted: boolean, inFlight: boolean, gen: number }>} */
const liveSnapByUrl = new Map();
/** @internal test seam — swap to stub live snaps without canvas/video. */
let liveTileSnap = waitAndSnapshotTileFrame;

function snapGate(stream) {
    let gate = liveSnapByUrl.get(stream);
    if (!gate) {
        gate = { noted: false, inFlight: false, gen: 0 };
        liveSnapByUrl.set(stream, gate);
    }
    return gate;
}

/**
 * Arm a fresh live-tile snap for this stream URL.
 * Does not cancel in-flight snaps for other URLs.
 * @param {string} [url]
 */
function armLiveSnap(url) {
    const stream = (url || '').trim();
    if (!stream) return;
    const gate = snapGate(stream);
    gate.noted = false;
    gate.inFlight = false;
    gate.gen += 1;
}

/**
 * Paint channel tiles matching stream URL and/or channel key.
 * @param {string} stream
 * @param {string} dataUrl
 * @param {string} [chKey]
 */
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
        });
    } catch { /* ignore */ }
}

/**
 * When a player is playing a channel, wait for a usable frame from that
 * <video>, cache it, and paint matching tiles.
 *
 * @param {string} url
 * @param {HTMLVideoElement} video
 * @param {string} [channelKey] — optional `providerId:channelId` for reload priming
 * @returns {boolean|Promise<boolean>} false sync on hard gates; Promise once wait starts
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
            if (!snap?.dataUrl) return false;

            gate.noted = true;
            const keys = [stream, chKey].filter(Boolean);
            FrameCache.setFrames(keys, snap.dataUrl).catch(() => {});
            paintPlayingFrame(stream, snap.dataUrl, chKey);

            // Best-effort mosaic poster from the same live frame (already decoded).
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
    state.refreshEpoch++;
    liveSnapByUrl.clear();
    liveTileSnap = waitAndSnapshotTileFrame;
}

function _setLiveTileSnapForTests(fn) {
    liveTileSnap = typeof fn === 'function' ? fn : waitAndSnapshotTileFrame;
}

export const TileFrames = {
    observe,
    refresh,
    armLiveSnap,
    notePlayingVideo,
    paintPlayingFrame,
    setFrameState,
    isMostlyBlackImageData,
    _resetForTests,
    _setLiveTileSnapForTests,
    /** @internal */
    _state: state,
    LIVE_TILE_SNAP_BUDGET_MS
};
