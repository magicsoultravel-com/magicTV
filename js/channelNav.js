/**
 * Favorites-based channel index and chan up/down navigation.
 */
import { channelKey } from './tvProviders/channelShape.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { FavoritesRecents } from './storage/favoritesRecents.js';
import { MultiView } from './multiView.js';
import { SLOT_IDS, slotIsOccupied } from './mosaic/constants.js';

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
 * Channel keys assigned to other enabled TV slots.
 * @param {string} slotId
 * @returns {Set<string>}
 */
export function getOccupiedKeysExcept(slotId) {
    const occupied = new Set();
    const slots = MultiView.slots || {};
    const remembered = MultiView.rememberedSlotKeys || {};

    for (const id of SLOT_IDS) {
        if (id === slotId) continue;
        const slot = slots[id];
        if (!slot?.enabled) continue;
        const player = slot.player;
        const key = player?.channel
            ? channelKey(player.channel)
            : remembered[id] || null;
        if (slotIsOccupied(player?.channel, remembered[id]) && key) {
            occupied.add(key);
        }
    }
    return occupied;
}

/**
 * @param {string} slotId
 * @returns {string | null}
 */
function currentSlotChannelKey(slotId) {
    const slot = MultiView.slots?.[slotId];
    const player = slot?.player || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    if (player?.channel) return channelKey(player.channel);
    return MultiView.rememberedSlotKeys?.[slotId] || null;
}

/**
 * @param {{ slotId: string, direction: 'up' | 'down', bindScope?: ChanBindScope }} opts
 * @returns {Promise<{ channel: object, number: number } | null>}
 */
export async function resolveAdjacentChannel({ slotId, direction, bindScope }) {
    const scope = bindScope || FavoritesRecents.getChanBindScope(slotId);
    const { keys, numberByKey } = buildChannelIndex(scope);
    if (!keys.length) return null;

    const channels = await TvProviderRegistry.getChannelsByRefs(keys);
    const channelByRef = new Map();
    keys.forEach((key, i) => {
        const ch = channels[i];
        if (ch) channelByRef.set(key, ch);
    });
    const availableKeys = keys.filter((k) => channelByRef.has(k));
    if (!availableKeys.length) return null;

    const occupied = getOccupiedKeysExcept(slotId);
    const currentKey = currentSlotChannelKey(slotId);
    let startIdx = availableKeys.indexOf(currentKey);
    if (startIdx < 0) {
        startIdx = direction === 'up' ? -1 : 0;
    }

    const step = direction === 'up' ? 1 : -1;
    const len = availableKeys.length;

    for (let n = 1; n <= len; n += 1) {
        const idx = ((startIdx + step * n) % len + len) % len;
        const key = availableKeys[idx];
        if (!occupied.has(key)) {
            return { channel: channelByRef.get(key), number: numberByKey.get(key) || idx + 1 };
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
    await MultiView.playOnSlot(slotId, result.channel);
    return true;
}
