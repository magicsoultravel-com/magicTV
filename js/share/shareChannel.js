/**
 * Share Channel — two magic remote actions:
 *   1. Copy stream link  — the raw HLS url_resolved for the focused channel.
 *   2. Copy magicTV link — a deep link the recipient opens in magicTV; the app
 *      resolves the channel itself (survives token/geo expiry of the raw URL).
 *
 * Deep link format:
 *   <appDir>/index.html?ch=<encodeURIComponent("iptv-org:CNBC")>&name=CNBC&country=us
 *
 * The boot resolver (app.js) reads `ch`, resolves the channel via the active
 * provider catalog, and plays it on a TV screen.
 */
import { appDirectoryUrl } from '../ui/popoutWindows.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { showAppToast } from '../ui/toast.js';

export const SHARE_PARAM = 'ch';

/** Default fill order — mirrors PLAY_FILL_ORDER in mosaic/constants.js. */
const PLAY_FILL_ORDER = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/**
 * Raw stream URL to copy for a channel.
 * @param {object | null | undefined} channel
 * @returns {string}
 */
export function buildStreamLink(channel) {
    return channel?.url_resolved || channel?.url || '';
}

/**
 * Build the magicTV deep link for a channel.
 * Uses the app directory URL so it works at any base path (e.g. GitHub Pages).
 * Falls back to a relative `./index.html?...` when outside a browser (node tests).
 * @param {object | string | null} channel
 * @returns {string}
 */
export function buildDeepLink(channel) {
    if (!channel) return '';
    const key = channelKey(channel);
    if (!key) return '';

    const params = new URLSearchParams();
    params.set(SHARE_PARAM, key);
    if (channel.name) params.set('name', channel.name);
    if (channel.countrycode) params.set('country', channel.countrycode);

    const query = params.toString();
    let base;
    try {
        base = appDirectoryUrl();
    } catch {
        base = null;
    }
    if (base) {
        return new URL(`index.html?${query}`, base).href;
    }
    return `./index.html?${query}`;
}


/**
 * Parse a magicTV deep link into a shareable channel reference.
 * Works in-browser (reads window.location.href) or with an explicit href.
 * @param {string} [href]
 * @returns {{ providerId: string, channelId: string, name: string, country: string } | null}
 */
export function parseDeepLink(href) {
    let resolved;
    try {
        resolved = new URL(href || (typeof window !== 'undefined' ? window.location.href : ''));
    } catch {
        try {
            resolved = new URL(href || '', 'http://local.invalid');
        } catch {
            return null;
        }
    }
    const key = resolved.searchParams.get(SHARE_PARAM);
    if (!key) return null;
    const parsed = parseChannelKey(key);
    if (!parsed?.channelId) return null;

    return {
        providerId: parsed.providerId,
        channelId: parsed.channelId,
        name: resolved.searchParams.get('name') || '',
        country: resolved.searchParams.get('country') || ''
    };
}

/**
 * Resolve a parsed deep-link reference to a full playable channel object
 * (includes url_resolved). Returns null if the channel is unavailable.
 * @param {{ providerId: string, channelId: string, name?: string, country?: string }} shared
 */
export async function resolveDeepLinkChannel(shared) {
    if (!shared?.channelId) return null;
    try {
        const channel = await TvProviderRegistry.getChannel({
            providerId: shared.providerId,
            channelId: shared.channelId
        });
        if (!channel?.url_resolved) return null;
        if (!channel.name && shared.name) channel.name = shared.name;
        if (!channel.countrycode && shared.country) channel.countrycode = shared.country;
        return channel;
    } catch {
        return null;
    }
}

/**
 * Choose the target mosaic slot for a shared deep-link play (pure).
 *
 * Rules (per product decision: "throw it into a last — or new if the user is
 * not at max — TV screen"):
 *   - If a slot is free, use the first free slot in fill order (resolves to
 *     'center' → a single, clean TV for recipients with nothing running).
 *   - If all slots are occupied, replace the last screen, preferring `fallback`
 *     (the most-recently focused slot) when it is a real slot.
 * @param {string[]} [occupiedIds]
 * @param {{ max?: number, fallback?: string | null }} [opts]
 * @returns {string}
 */
export function chooseSharedPlayTarget(occupiedIds = [], { max = 5, fallback = null } = {}) {
    const order = PLAY_FILL_ORDER.slice(0, Math.max(1, max));
    const occupied = new Set(occupiedIds || []);
    for (const id of order) {
        if (!occupied.has(id)) return id;
    }
    if (fallback && order.includes(fallback) && occupied.has(fallback)) return fallback;
    return order[order.length - 1];
}

/**
 * Copy text to the clipboard with a toast/fallback.
 * @returns {Promise<boolean>}
 */
export async function copyShareText(text, successLabel = 'Link copied') {
    if (!text) {
        showAppToast('Nothing to copy yet.');
        return false;
    }
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            showAppToast(successLabel);
            return true;
        }
    } catch { /* fall through */ }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = !!document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        showAppToast(ok ? successLabel : 'Could not copy link');
        return !!ok;
    } catch {
        showAppToast('Could not copy link');
        return false;
    }
}
