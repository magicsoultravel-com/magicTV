/**
 * Mosaic slot occupancy helpers — no MultiView import (breaks prefetch cycle).
 */
import { channelKey } from '../tvProviders/channelShape.js';
import { SLOT_IDS, slotIsOccupied } from './constants.js';

/** @type {() => { slots: object, rememberedSlotKeys: object, getPrimary?: () => object|null }} */
let getMosaicState = () => ({ slots: {}, rememberedSlotKeys: {} });

/**
 * Register live mosaic state (called from MultiView.init).
 * @param {() => { slots: object, rememberedSlotKeys: object, getPrimary?: () => object|null }} getter
 */
export function registerMosaicSlotState(getter) {
    getMosaicState = getter;
}

/**
 * Channel keys assigned to other enabled TV slots.
 * @param {string} slotId
 * @returns {Set<string>}
 */
export function getOccupiedKeysExcept(slotId) {
    const { slots, rememberedSlotKeys } = getMosaicState();
    const occupied = new Set();

    for (const id of SLOT_IDS) {
        if (id === slotId) continue;
        const slot = slots[id];
        if (!slot?.enabled) continue;
        const player = slot.player;
        const key = player?.channel
            ? channelKey(player.channel)
            : rememberedSlotKeys[id] || null;
        if (slotIsOccupied(player?.channel, rememberedSlotKeys[id]) && key) {
            occupied.add(key);
        }
    }
    return occupied;
}

/**
 * @param {string} slotId
 * @returns {string | null}
 */
export function currentSlotChannelKey(slotId) {
    const { slots, getPrimary } = getMosaicState();
    const slot = slots[slotId];
    const player = slot?.player || (slotId === 'center' ? getPrimary?.() : null);
    if (player?.channel) return channelKey(player.channel);
    const { rememberedSlotKeys } = getMosaicState();
    return rememberedSlotKeys[slotId] || null;
}
