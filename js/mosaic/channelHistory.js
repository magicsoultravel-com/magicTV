/**
 * Per-slot previous / next channel stacks (keys only), capped by Max recents.
 * Back = channels you left; Forward = channels you stepped back from (cleared on fresh tune).
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

function readBack() {
    return normalizeMosaicChannelHistory(loadPlayerState().mosaicChannelHistory);
}

function readForward() {
    return normalizeMosaicChannelHistory(loadPlayerState().mosaicChannelForward);
}

function writeStacks(back, forward) {
    savePlayerState({
        mosaicChannelHistory: normalizeMosaicChannelHistory(back),
        mosaicChannelForward: normalizeMosaicChannelHistory(forward)
    });
}

function applyCap(stack) {
    const cap = getRecentsCap();
    if (isUnlimitedRecentsCap(cap)) return stack;
    return stack.slice(0, Math.max(0, cap));
}

/**
 * Push the channel being left onto the back stack (newest at front).
 * Clears the forward stack (fresh tune — same as browser history).
 * @param {string} slotId
 * @param {string|null|undefined} previousKey
 * @param {string|null|undefined} nextKey
 */
export function pushSlotChannelHistory(slotId, previousKey, nextKey) {
    if (!SLOT_IDS.includes(slotId)) return;
    if (!previousKey || previousKey === nextKey) return;
    const back = readBack();
    const stack = (back[slotId] || []).filter((k) => k !== previousKey);
    stack.unshift(previousKey);
    back[slotId] = applyCap(stack);
    const forward = readForward();
    forward[slotId] = [];
    writeStacks(back, forward);
}

/**
 * @param {string} slotId
 * @returns {string[]}
 */
export function getSlotChannelHistory(slotId) {
    if (!SLOT_IDS.includes(slotId)) return [];
    return readBack()[slotId] || [];
}

/**
 * @param {string} slotId
 * @returns {string[]}
 */
export function getSlotChannelForward(slotId) {
    if (!SLOT_IDS.includes(slotId)) return [];
    return readForward()[slotId] || [];
}

/**
 * @param {string} slotId
 * @returns {boolean}
 */
export function hasSlotChannelHistory(slotId) {
    return getSlotChannelHistory(slotId).length > 0;
}

/**
 * @param {string} slotId
 * @returns {boolean}
 */
export function hasSlotChannelForward(slotId) {
    return getSlotChannelForward(slotId).length > 0;
}

/**
 * Step back: leave `currentKey` on the forward stack, return previous key.
 * @param {string} slotId
 * @param {string|null|undefined} currentKey
 * @returns {string|null}
 */
export function stepSlotChannelBack(slotId, currentKey) {
    if (!SLOT_IDS.includes(slotId)) return null;
    const back = readBack();
    const forward = readForward();
    const stack = back[slotId] || [];
    if (!stack.length) return null;
    const [key, ...rest] = stack;
    back[slotId] = rest;
    if (currentKey && currentKey !== key) {
        const fwd = (forward[slotId] || []).filter((k) => k !== currentKey);
        fwd.unshift(currentKey);
        forward[slotId] = applyCap(fwd);
    }
    writeStacks(back, forward);
    return key;
}

/**
 * Step forward: leave `currentKey` on the back stack, return next key.
 * @param {string} slotId
 * @param {string|null|undefined} currentKey
 * @returns {string|null}
 */
export function stepSlotChannelForward(slotId, currentKey) {
    if (!SLOT_IDS.includes(slotId)) return null;
    const back = readBack();
    const forward = readForward();
    const stack = forward[slotId] || [];
    if (!stack.length) return null;
    const [key, ...rest] = stack;
    forward[slotId] = rest;
    if (currentKey && currentKey !== key) {
        const b = (back[slotId] || []).filter((k) => k !== currentKey);
        b.unshift(currentKey);
        back[slotId] = applyCap(b);
    }
    writeStacks(back, forward);
    return key;
}

/** @deprecated Use stepSlotChannelBack — kept for older call sites/tests. */
export function popSlotChannelHistory(slotId) {
    return stepSlotChannelBack(slotId, null);
}

/** Trim all slot stacks to the current recents cap (no-op when unlimited). */
export function trimAllSlotChannelHistory() {
    const cap = getRecentsCap();
    writeStacks(
        trimMosaicChannelHistory(readBack(), cap),
        trimMosaicChannelHistory(readForward(), cap)
    );
}
