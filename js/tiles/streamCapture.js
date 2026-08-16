/**
 * Canvas snapshots from a live <video> for channel-tile thumbs and mosaic posters.
 * No offscreen HLS — callers snap only from real playback elements.
 */

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
        // CORS / tainted canvas — caller can still rely on the paused <video> frame.
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
 * Prefer calling while the element is still playing — rVFC will not fire after pause.
 *
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
            // CORS / tainted canvas will not recover by waiting.
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
