/**
 * Last-resort embed: put the page's own player in an iframe inside a tile.
 *
 * This path cannot be controlled (no click, no volume, no seeking, no
 * screenshots) — it exists so a page that refuses extraction can still be
 * watched on a tile. Chrome switches to `is-webpage` mode while it is mounted.
 */

import { applyShieldToFrame, DEFAULT_SHIELD_LEVEL } from './webShield.js';

export const WEB_PAGE_FRAME_CLASS = 'webstream-frame-wrap';

function docOf(surface) {
    return surface?.ownerDocument || (typeof document !== 'undefined' ? document : null);
}

/**
 * @param {Element | null} surface `.tv-playback-surface` of one tile
 * @returns {HTMLIFrameElement | null}
 */
export function frameFor(surface) {
    if (!surface?.querySelector) return null;
    return surface.querySelector(`.${WEB_PAGE_FRAME_CLASS} iframe`);
}

/**
 * Mount (or re-point) the page iframe.
 *
 * `shield` applies the sandbox/permission policy (see `webShield.js`). Because
 * sandbox flags only take effect at navigation, changing the level on an
 * already-loaded frame re-navigates it (same URL) — the page restarts, exactly
 * like the tile's Reload button.
 *
 * @param {Element | null} surface
 * @param {{ url: string, title?: string, shield?: string }} spec
 * @returns {HTMLIFrameElement | null}
 */
export function mountWebPageFrame(surface, { url, title = '', shield = DEFAULT_SHIELD_LEVEL } = {}) {
    const doc = docOf(surface);
    if (!surface || !doc || typeof url !== 'string' || !url) return null;

    let wrap = surface.querySelector?.(`.${WEB_PAGE_FRAME_CLASS}`) || null;
    let created = false;
    if (!wrap) {
        wrap = doc.createElement('div');
        wrap.className = WEB_PAGE_FRAME_CLASS;
        const frame = doc.createElement('iframe');
        frame.className = 'webstream-frame';
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('loading', 'eager');
        frame.setAttribute('title', title || 'Web page player');
        applyShieldToFrame(frame, shield);
        wrap.appendChild(frame);
        surface.appendChild(wrap);
        created = true;
    }

    const frame = wrap.querySelector?.('iframe');
    if (!frame) return null;
    if (title) frame.setAttribute('title', title);

    const { active, changed } = applyShieldToFrame(frame, shield);
    if (frame.dataset) frame.dataset.shield = active ? 'on' : 'off';
    if (wrap.dataset) wrap.dataset.shield = active ? 'on' : 'off';

    const current = frame.getAttribute('src');
    // A shield change needs a fresh navigation; a new frame just gets its src.
    if (current !== url || (!created && changed)) frame.setAttribute('src', url);
    return frame;
}

/**
 * Remove the iframe (keeps the video element untouched underneath).
 * @param {Element | null} surface
 * @returns {boolean} true when something was removed
 */
export function unmountWebPageFrame(surface) {
    const wrap = surface?.querySelector?.(`.${WEB_PAGE_FRAME_CLASS}`);
    if (!wrap) return false;
    try { wrap.remove(); } catch { /* ignore */ }
    return true;
}

/** Reload the embedded page (used by the tile's play button in embed mode). */
export function reloadWebPageFrame(surface) {
    const frame = frameFor(surface);
    if (!frame) return false;
    try {
        // Re-assigning src forces a fresh navigation even for the same URL.
        const src = frame.getAttribute('src') || '';
        frame.setAttribute('src', src);
        return true;
    } catch {
        return false;
    }
}

/** True when the tile is currently showing an embedded page. */
export function hasWebPageFrame(surface) {
    return Boolean(surface?.querySelector?.(`.${WEB_PAGE_FRAME_CLASS}`));
}

/** Same-origin page document, or null — a remote page is unreachable. */
function frameDoc(frame) {
    try {
        return frame?.contentDocument || null;
    } catch {
        return null;
    }
}

/** Every `<video>` / `<audio>` the page exposes (empty when unreachable). */
function mediaIn(doc) {
    if (!doc?.querySelectorAll) return [];
    try {
        return Array.from(doc.querySelectorAll('video, audio'));
    } catch {
        return [];
    }
}

function setMediaMuted(frame, muted) {
    const media = mediaIn(frameDoc(frame));
    media.forEach((el) => {
        try { el.muted = muted; } catch { /* ignore */ }
    });
    return media.length > 0;
}

/**
 * Mirror a tile's mute flag onto the page's own media elements.
 *
 * A cross-origin page exposes no media handles (`contentDocument` is null), so
 * this can only ever be a no-op there — the page keeps its own sound and the
 * caller reports that. Same-origin pages are muted for real; the wanted state
 * is kept on the frame so media that arrives after `load` (typical for a page
 * player) is muted too.
 *
 * @param {Element | null} surface `.tv-playback-surface` of one tile
 * @param {boolean} muted
 * @returns {boolean} true when the page's document was reachable
 */
export function syncPageFrameMuted(surface, muted) {
    const frame = frameFor(surface);
    if (!frame) return false;
    const want = Boolean(muted);
    if (frame.dataset) frame.dataset.magictvMute = want ? 'on' : 'off';
    if (frame.dataset && frame.dataset.magictvMuteHook !== '1') {
        frame.dataset.magictvMuteHook = '1';
        frame.addEventListener?.('load', () => {
            if (frame.dataset?.magictvMute === 'on') setMediaMuted(frame, true);
        });
    }
    setMediaMuted(frame, want);
    return Boolean(frameDoc(frame));
}

/**
 * Fullscreen the embed wrapper (the iframe cannot be fullscreened directly).
 * @param {Element | null} surface
 * @returns {Promise<boolean>}
 */
export async function fullscreenWebPageFrame(surface) {
    const wrap = surface?.querySelector?.(`.${WEB_PAGE_FRAME_CLASS}`);
    if (!wrap?.requestFullscreen) return false;
    try {
        await wrap.requestFullscreen();
        return true;
    } catch {
        return false;
    }
}
