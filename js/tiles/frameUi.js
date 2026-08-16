/**
 * Frame tile UI state (waiting → provisional | loading → captured | offline).
 */
import { FrameCache } from '../storage/frameCache.js';

/**
 * @param {HTMLElement} frame
 * @param {'waiting'|'loading'|'provisional'|'captured'|'offline'} next
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
        if (img && !frame.dataset.provisional) {
            img.removeAttribute('src');
            hide(img);
        }
        if (frame.dataset.provisional && img?.getAttribute('src')) {
            show(img);
            hide(letter);
        } else {
            show(letter);
        }
        show(waiting);
        hide(loading);
        hide(badge);
        clearOfflineHint();
        delete frame.dataset.captured;
        return;
    }

    if (next === 'loading') {
        if (frame.dataset.provisional && img?.getAttribute('src')) {
            show(img);
            hide(letter);
        } else {
            if (img) hide(img);
            show(letter);
        }
        hide(waiting);
        show(loading);
        hide(badge);
        clearOfflineHint();
        delete frame.dataset.captured;
        return;
    }

    if (next === 'provisional') {
        const paintSrc = src || img?.getAttribute('src') || '';
        if (paintSrc && img) {
            img.loading = 'eager';
            img.classList.remove('is-hidden');
            if (img.getAttribute('src') !== paintSrc) img.src = paintSrc;
            hide(letter);
        } else {
            show(letter);
            if (img) hide(img);
        }
        show(waiting);
        hide(loading);
        hide(badge);
        clearOfflineHint();
        frame.dataset.provisional = '1';
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
        delete frame.dataset.provisional;
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
        delete frame.dataset.provisional;
    }
}

/**
 * Apply the final UI state after a grab settles. Never leaves `loading`.
 * Skips both cache write and UI when epoch is stale.
 * On fail with a provisional logo, keep that logo as captured instead of offline.
 *
 * @param {HTMLElement} frame
 * @param {string|null} dataUrl
 * @param {string} url
 * @param {number} epoch
 * @param {'hls-lib'|'timeout'|'media'|'black'|null} [failReason]
 * @param {number} currentEpoch
 * @param {string} [channelKey]
 */
export function settleFrameCapture(
    frame,
    dataUrl,
    url,
    epoch,
    failReason = null,
    currentEpoch = epoch,
    channelKey = ''
) {
    if (epoch !== currentEpoch) return;
    if (dataUrl && url) {
        const keys = [url, channelKey].filter(Boolean);
        FrameCache.setFrames(keys, dataUrl).catch(() => {});
    }
    if (!frame?.isConnected) return;
    if (dataUrl) {
        delete frame.dataset.frameFail;
        setFrameState(frame, 'captured', dataUrl);
        return;
    }
    const provisionalSrc = frame.dataset.provisional
        ? (frame.querySelector('.channel-tile__logo-img')?.getAttribute('src') || '')
        : '';
    if (provisionalSrc) {
        delete frame.dataset.frameFail;
        setFrameState(frame, 'captured', provisionalSrc);
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
