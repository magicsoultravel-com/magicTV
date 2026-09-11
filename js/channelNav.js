/**
 * Favorites-based channel index and chan up/down navigation.
 */
import { parseChannelKey } from './tvProviders/channelShape.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { FavoritesRecents } from './storage/favoritesRecents.js';
import {
    getOccupiedKeysExcept,
    currentSlotChannelKey
} from './mosaic/slotOccupancy.js';

/** @typedef {{ mode: 'favorites' } | { mode: 'folder', folderId: string }} ChanBindScope */

/**
 * @param {ChanBindScope | null | undefined} bindScope
 * @returns {{ keys: string[], numberByKey: Map<string, number> }}
 */
export function buildChannelIndex(bindScope) {
    const scope = bindScope || { mode: 'favorites' };
    const keys = [];
    const numberByKey = new Map();

    if (scope.mode === 'folder') {
        const folder = FavoritesRecents.getFavoriteFolder(scope.folderId);
        if (folder) {
            for (const key of folder.items || []) {
                if (key) keys.push(key);
            }
        }
    } else {
        const folders = FavoritesRecents.getFavoriteFolders();
        for (const folder of folders) {
            for (const key of folder.items || []) {
                if (key) keys.push(key);
            }
        }
        for (const key of FavoritesRecents.getFavoritesRootOrder()) {
            if (key) keys.push(key);
        }
    }

    keys.forEach((key, i) => numberByKey.set(key, i + 1));
    return { keys, numberByKey };
}

/**
 * Prefer accent from digit value (1/4/7→1, 2/5/8→2, 3/6/9/0→3), then
 * reassign so no accent repeats within a 1–3 digit channel number.
 * @param {number} num
 * @returns {{ digit: string, accent: 1|2|3 }[]}
 */
export function chanNumberAccentDigits(num) {
    const n = Math.floor(Number(num));
    if (!Number.isFinite(n) || n < 0) return [];
    const chars = String(n).split('');
    const used = new Set();
    let prev = 0;
    return chars.map((digit) => {
        const d = Number(digit);
        let accent = /** @type {1|2|3} */ (d === 0 ? 3 : ((d - 1) % 3) + 1);
        if (used.size < 3) {
            let guard = 0;
            while (used.has(accent) && guard < 3) {
                accent = /** @type {1|2|3} */ ((accent % 3) + 1);
                guard += 1;
            }
            used.add(accent);
        } else if (accent === prev) {
            accent = /** @type {1|2|3} */ ((accent % 3) + 1);
        }
        prev = accent;
        return { digit, accent };
    });
}

/**
 * Colored digit spans for a channel number (TV overlay / catalog tiles).
 * @param {number} num
 * @returns {string}
 */
export function chanNumberAccentHtml(num) {
    return chanNumberAccentDigits(num)
        .map(({ digit, accent }) => `<span data-accent="${accent}">${digit}</span>`)
        .join('');
}

/**
 * Accent the three TV-label characters (T, V, #) with a rotated palette so
 * each screen gets a distinct color order and no accent repeats within the label.
 * @param {string|number} screenNum 1-based TV index
 * @returns {{ char: string, accent: 1|2|3 }[]}
 */
export function tvLabelAccentChars(screenNum) {
    const n = Math.max(1, Math.floor(Number(screenNum)) || 1);
    const rot = (n - 1) % 3;
    /** @type {(1|2|3)[]} */
    const accents = [1, 2, 3];
    const ordered = /** @type {(1|2|3)[]} */ ([
        accents[rot],
        accents[(rot + 1) % 3],
        accents[(rot + 2) % 3]
    ]);
    return [
        { char: 'T', accent: ordered[0] },
        { char: 'V', accent: ordered[1] },
        { char: String(n), accent: ordered[2] }
    ];
}

/**
 * Walk bind-scope keys to the next/previous candidate ref (no catalog fetch).
 * @param {{ slotId: string, direction: 'up' | 'down', bindScope?: ChanBindScope }} opts
 * @returns {{ key: string, number: number } | null}
 */
export function resolveAdjacentChannelKey({ slotId, direction, bindScope }) {
    const scope = bindScope || FavoritesRecents.getChanBindScope(slotId);
    const { keys, numberByKey } = buildChannelIndex(scope);
    if (!keys.length) return null;

    const occupied = getOccupiedKeysExcept(slotId);
    const currentKey = currentSlotChannelKey(slotId);
    let startIdx = keys.indexOf(currentKey);
    if (startIdx < 0) {
        startIdx = direction === 'up' ? -1 : 0;
    }

    const step = direction === 'up' ? 1 : -1;
    const len = keys.length;

    for (let n = 1; n <= len; n += 1) {
        const idx = ((startIdx + step * n) % len + len) % len;
        const key = keys[idx];
        if (!occupied.has(key)) {
            return { key, number: numberByKey.get(key) || idx + 1 };
        }
    }
    return null;
}

/**
 * @param {{ slotId: string, direction: 'up' | 'down', bindScope?: ChanBindScope }} opts
 * @returns {Promise<{ channel: object, number: number } | null>}
 */
export async function resolveAdjacentChannel({ slotId, direction, bindScope }) {
    const scope = bindScope || FavoritesRecents.getChanBindScope(slotId);
    const { keys, numberByKey } = buildChannelIndex(scope);
    if (!keys.length) return null;

    const occupied = getOccupiedKeysExcept(slotId);
    const currentKey = currentSlotChannelKey(slotId);
    let startIdx = keys.indexOf(currentKey);
    if (startIdx < 0) {
        startIdx = direction === 'up' ? -1 : 0;
    }

    const step = direction === 'up' ? 1 : -1;
    const len = keys.length;

    for (let n = 1; n <= len; n += 1) {
        const idx = ((startIdx + step * n) % len + len) % len;
        const key = keys[idx];
        if (occupied.has(key)) continue;

        const parsed = parseChannelKey(key);
        const channel = await TvProviderRegistry.getChannel(parsed);
        if (channel?.url_resolved) {
            return { channel, number: numberByKey.get(key) || idx + 1 };
        }
    }
    return null;
}

/**
 * Navigate chan up/down on a slot.
 * @param {string} slotId
 * @param {'up' | 'down'} direction
 * @param {{ showToast?: Function }} [options] optional toast override (test seam)
 * @returns {Promise<boolean>} true if channel changed
 */
export async function navigateChannel(slotId, direction, { showToast = null } = {}) {
    const showAppToast = showToast || (await import('./ui/toast.js')).showAppToast;
    const result = await resolveAdjacentChannel({ slotId, direction });
    if (!result) {
        const { keys } = buildChannelIndex(FavoritesRecents.getChanBindScope(slotId));
        if (!keys.length) {
            showAppToast('No channels bound');
        } else {
            showAppToast('No other channels available');
        }
        return false;
    }
    const { MultiView } = await import('./multiView.js');
    await MultiView.playOnSlot(slotId, result.channel);
    return true;
}

/**
 * Tune a slot to a 1-based bind-scope channel number (favorites / folder index).
 * @param {string} slotId
 * @param {number} number
 * @param {{ showToast?: Function }} [options] optional toast override (test seam)
 * @returns {Promise<boolean>}
 */
export async function navigateToChannelNumber(slotId, number, { showToast = null } = {}) {
    const showAppToast = showToast || (await import('./ui/toast.js')).showAppToast;
    const n = Math.floor(Number(number));
    if (!Number.isFinite(n) || n < 1 || n > 9999) {
        showAppToast('Invalid channel number');
        return false;
    }

    const scope = FavoritesRecents.getChanBindScope(slotId);
    const { keys } = buildChannelIndex(scope);
    if (!keys.length) {
        showAppToast('No channels bound');
        return false;
    }

    const key = keys[n - 1];
    if (!key) {
        showAppToast(`No channel ${n}`);
        return false;
    }

    const parsed = parseChannelKey(key);
    const channel = await TvProviderRegistry.getChannel(parsed);
    if (!channel?.url_resolved) {
        showAppToast(`No channel ${n}`);
        return false;
    }

    const { MultiView } = await import('./multiView.js');
    await MultiView.playOnSlot(slotId, channel);
    return true;
}
