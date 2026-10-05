/**
 * Per-slot previous-channel stacks (keys only), capped by Max recents setting.
 */
import { SLOT_IDS } from './constants.js';
import {
    loadPlayerState,
    savePlayerState,
    getRecentsCap,
    isUnlimitedRecentsCap,
    normalizeMosaicChannelHistory
} from '../storage/playerState.js';

export { normalizeMosaicChannelHistory };

/**
 * @param {Record<string, string[]>} history
 * @param {number} cap
 * @returns {Record<string, string[]>}
 */
export function trimMosaicChannelHistory(history, cap) {
    const normalized = normalizeMosaicChannelHistory(history);
    if (isUnlimitedRecentsCap(cap)) return normalized;
    const n = Math.max(0, Math.floor(Number(cap)) || 0);
    for (const id of SLOT_IDS) {
        if (normalized[id].length > n) normalized[id] = normalized[id].slice(0, n);
    }
    return normalized;
}

function readHistory() {
    return normalizeMosaicChannelHistory(loadPlayerState().mosaicChannelHistory);
}

function writeHistory(history) {
    savePlayerState({ mosaicChannelHistory: normalizeMosaicChannelHistory(history) });
}

/**
 * Push the channel being left onto the slot stack (newest at front).
 * @param {string} slotId
 * @param {string|null|undefined} previousKey
 * @param {string|null|undefined} nextKey
 */
export function pushSlotChannelHistory(slotId, previousKey, nextKey) {
    if (!SLOT_IDS.includes(slotId)) return;
    if (!previousKey || previousKey === nextKey) return;
    const history = readHistory();
    const stack = (history[slotId] || []).filter((k) => k !== previousKey);
    stack.unshift(previousKey);
    const cap = getRecentsCap();
    history[slotId] = isUnlimitedRecentsCap(cap) ? stack : stack.slice(0, Math.max(0, cap));
    writeHistory(history);
}

/**
 * @param {string} slotId
 * @returns {string[]}
 */
export function getSlotChannelHistory(slotId) {
    if (!SLOT_IDS.includes(slotId)) return [];
    return readHistory()[slotId] || [];
}

/**
 * @param {string} slotId
 * @returns {boolean}
 */
export function hasSlotChannelHistory(slotId) {
    return getSlotChannelHistory(slotId).length > 0;
}

/**
 * Pop and return the most recent previous key for a slot.
 * @param {string} slotId
 * @returns {string|null}
 */
export function popSlotChannelHistory(slotId) {
    if (!SLOT_IDS.includes(slotId)) return null;
    const history = readHistory();
    const stack = history[slotId] || [];
    if (!stack.length) return null;
    const [key, ...rest] = stack;
    history[slotId] = rest;
    writeHistory(history);
    return key;
}

/** Trim all slot stacks to the current recents cap (no-op when unlimited). */
export function trimAllSlotChannelHistory() {
    const cap = getRecentsCap();
    writeHistory(trimMosaicChannelHistory(readHistory(), cap));
}
