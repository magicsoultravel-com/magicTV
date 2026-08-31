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
 * @returns {Promise<boolean>} true if channel changed
 */
export async function navigateChannel(slotId, direction) {
    const { showAppToast } = await import('./ui/toast.js');
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
