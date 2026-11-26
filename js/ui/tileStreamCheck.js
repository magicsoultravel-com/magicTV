/**
 * "Check if online" for settings tiles (Hidden / Visited sections).
 *
 * Reuses the catalog preview pipeline so "online" means exactly what it means
 * on a catalog tile: TileFrames could load the stream and decode a frame.
 * Settings metadata stores no stream URL (see storage/hiddenChannels.js), so
 * the channel is re-resolved through the provider registry first.
 *
 * Verdicts: decoded snapshot (data: URL) → online, disconnect badge → offline,
 * a forced grab that ended on the logo only → "no picture", a frame that never
 * settles → unknown. Soft fails (timeout/black) stay `waiting` by design, so
 * the verdict is observed through the frame state — never assumed.
 */
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { TileFrames } from '../tileFrames.js';
import { showAppToast } from './toast.js';

export const VERDICT_TOAST = {
    online: 'Channel is online',
    offline: 'Channel is offline',
    nopicture: 'No picture — channel may be offline',
    unknown: "Couldn't verify — timed out",
    unresolved: "Channel unavailable — can't check"
};

/** Capture budget plus drain/settle slack before we give up waiting. */
export const SETTLE_TIMEOUT_MS = TileFrames.CAPTURE_BUDGET_MS + 2500;

function defaultResolve(ref) {
    // getChannel() needs its registry receiver — never pass it unbound.
    return TvProviderRegistry.getChannel(ref);
}

/**
 * Recover a playable stream URL for a settings-tile channel.
 * @param {object} channel meta-derived channel (may have no url_resolved)
 * @param {{ resolve?: (ref: object) => Promise<object|null> }} [opts]
 * @returns {Promise<{ channel: object, url: string }|null>} null when the
 *   catalog cannot resolve the ref or the resolved channel has no stream.
 */
export async function resolveTileStream(channel, { resolve = defaultResolve } = {}) {
    if (!channel) return null;
    const existing = (channel.url_resolved || '').trim();
    if (existing) return { channel, url: existing };

    const key = (channel.channeluuid || channelKey(channel) || '').trim();
    const ref = key ? parseChannelKey(key) : null;
    if (!ref?.channelId) return null;

    let found = null;
    try {
        found = await resolve(ref);
    } catch {
        return null;
    }
    const url = (found?.url_resolved || '').trim();
    if (!url) return null;
    return {
        // Stored name/logo win so the tile keeps what the list shows; the
        // provider fills in everything else the preview pipeline wants.
        channel: {
            ...found,
            name: channel.name || found?.name || '',
            logo: channel.logo || found?.logo || '',
            url_resolved: url
        },
        url
    };
}

/**
 * Painted preview source. A real decode is a data: URL; a bare logo URL means
 * frameUi fell back to the logo, so no picture was actually decoded.
 */
function frameSnapshotSrc(frame) {
    return frame?.querySelector?.('.channel-tile__logo-img')?.getAttribute?.('src') || '';
}

function frameVerdict(frame) {
    const state = frame?.dataset?.frameState || '';
    if (state === 'offline') return 'offline';
    // Under a forced grab a "captured" frame only carries a picture when a
    // snapshot (data: URL) was decoded; the bare logo means the grab failed.
    if (state === 'captured') return frameSnapshotSrc(frame).startsWith('data:') ? 'online' : 'nopicture';
    return '';
}

/**
 * Wait until a capture frame settles into a verdict.
 * @param {HTMLElement} frame
 * @param {{ timeoutMs?: number, Observer?: Function }} [opts]
 * @returns {Promise<'online'|'offline'|'nopicture'|'unknown'>}
 */
export function watchFrameState(frame, { timeoutMs = SETTLE_TIMEOUT_MS, Observer = globalThis.MutationObserver } = {}) {
    return new Promise((resolveVerdict) => {
        let timer = null;
        let observer = null;
        let done = false;
        const finish = (verdict) => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            timer = null;
            observer?.disconnect?.();
            observer = null;
            resolveVerdict(verdict);
        };

        const current = frameVerdict(frame);
        if (current) {
            resolveVerdict(current);
            return;
        }

        if (frame && typeof Observer === 'function') {
            observer = new Observer(() => {
                const verdict = frameVerdict(frame);
                if (verdict) finish(verdict);
            });
            observer.observe(frame, { attributes: true, attributeFilter: ['data-frame-state'] });
        }

        timer = setTimeout(() => finish('unknown'), Math.max(0, Number(timeoutMs) || 0));
    });
}

/**
 * Click handler body for `.channel-tile__refresh-btn` in settings lists.
 * @param {object} channel meta-derived channel (no url_resolved required)
 * @param {HTMLElement} tile `.channel-tile` element
 * @param {{
 *   resolve?: (ref: object) => Promise<object|null>,
 *   frames?: object,
 *   watch?: (frame: HTMLElement) => Promise<string>,
 *   notify?: (message: string) => void,
 *   timeoutMs?: number
 * }} [opts]
 * @returns {Promise<'online'|'offline'|'nopicture'|'unknown'|'unresolved'|'pending'>}
 */
export async function checkTileOnline(channel, tile, opts = {}) {
    const {
        resolve = defaultResolve,
        frames = TileFrames,
        notify = showAppToast,
        timeoutMs = SETTLE_TIMEOUT_MS
    } = opts;

    const frame = tile?.querySelector?.('.channel-tile__capture-frame') || null;
    if (!frame) return 'unresolved';
    if (tile.dataset?.checking) return 'pending';

    const btn = tile.querySelector?.('.channel-tile__refresh-btn') || null;
    const watch = opts.watch || ((el) => watchFrameState(el, { timeoutMs }));

    tile.dataset.checking = '1';
    if (btn) {
        btn.disabled = true;
        btn.classList?.add('is-checking');
    }

    try {
        const resolved = await resolveTileStream(channel, { resolve });
        if (!resolved) {
            frames.setFrameState(frame, 'offline');
            notify(VERDICT_TOAST.unresolved);
            return 'unresolved';
        }

        // TileFrames reads the stream/logo straight off the tile.
        tile.dataset.url = resolved.url;
        if (resolved.channel?.logo) tile.dataset.logo = resolved.channel.logo;

        await frames.refreshFrame(frame);
        const verdict = await watch(frame);
        // Unhidden mid-check → tile is gone; don't toast a verdict about nothing.
        if (frame.isConnected === false) return 'unknown';
        const key = verdict === 'online' || verdict === 'offline' || verdict === 'nopicture'
            ? verdict
            : 'unknown';
        notify(VERDICT_TOAST[key]);
        return key;
    } catch {
        notify(VERDICT_TOAST.unknown);
        return 'unknown';
    } finally {
        delete tile.dataset.checking;
        if (btn) {
            btn.disabled = false;
            btn.classList?.remove('is-checking');
        }
    }
}
