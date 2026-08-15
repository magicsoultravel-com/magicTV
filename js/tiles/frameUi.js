/**
 * Frame tile UI state machine (waiting → loading → captured | offline).
 * Does not own TileFrames scheduler state — callers pass currentEpoch.
 */
import { FrameCache } from '../storage/frameCache.js';

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
 * Skips both cache write and UI when epoch is stale (manual refresh aborted
 * the grab). Disconnected frames still cache on a live epoch.
 *
 * @param {HTMLElement} frame
 * @param {string|null} dataUrl
 * @param {string} url
 * @param {number} epoch — epoch when capture started
 * @param {'hls-lib'|'timeout'|'media'|'black'|null} [failReason]
 * @param {number} currentEpoch — live scheduler epoch (stale if !== epoch)
 */
export function settleFrameCapture(frame, dataUrl, url, epoch, failReason = null, currentEpoch = epoch) {
    if (epoch !== currentEpoch) return;
    if (dataUrl && url) {
        FrameCache.setFrame(url, dataUrl).catch(() => {});
    }
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
