/**
 * Mosaic rotation: push every TV's channel around the ring by one screen
 * (TV 1 → 2 → … → N → 1). Methods mix into MultiView (this === MultiView).
 *
 * After rewiring slot pointers, destination tiles FLIP-travel from each
 * source rect (shared tileTravel helper).
 */
import { channelKey } from '../tvProviders/channelShape.js';
import {
    PLAY_FILL_ORDER
} from './constants.js';
import {
    captureTileRects,
    flipContentMoves,
    travelAnimationsEnabled
} from './tileTravel.js';
import {
    captureSwapPlaybackState,
    applySwapPlaybackContinuity
} from './swapPlayback.js';
import { cancelSlotPrefetch } from '../player/channelPrefetch.js';

/**
 * Enabled TV slots in screen-label order (TV 1..N).
 * PLAY_FILL_ORDER matches SLOT_SCREEN_LABELS numbering; SLOT_IDS does not.
 * @param {Record<string, { enabled?: boolean, player?: object | null } | undefined>} slots
 * @returns {string[]}
 */
export function computeRotationRing(slots) {
    if (!slots) return [];
    return PLAY_FILL_ORDER.filter((id) => {
        const slot = slots[id];
        return Boolean(slot?.enabled && slot?.player);
    });
}

/**
 * Rotation moves: the channel on ring[i] travels to ring[i + 1]; the last wraps to TV 1.
 * @param {string[]} ring
 * @returns {{ from: string, to: string }[]}
 */
export function buildRotationMoves(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return [];
    return ring.map((from, i) => ({ from, to: ring[(i + 1) % ring.length] }));
}

/**
 * Pure: apply rotation moves to a slot map — returns a new map with players
 * permuted. Reads only the ORIGINAL map, so move order can never clobber a
 * not-yet-read source slot.
 * @template T
 * @param {Record<string, T>} slots
 * @param {{ from: string, to: string }[]} moves
 * @returns {Record<string, T>}
 */
export function applyRotationMoves(slots, moves) {
    const next = {};
    for (const id of Object.keys(slots)) {
        next[id] = { ...slots[id] };
    }
    for (const { from, to } of moves) {
        const player = slots[from]?.player ?? null;
        next[to] = { ...next[to], player };
    }
    return next;
}

export const rotateMethods = {
    /** Enabled TV slots in screen-label order (drives the Rotate button visibility). */
    getRotationRing() {
        return computeRotationRing(this.slots);
    },

    /**
     * Rewire slot→player pointers along the ring (TV 1 → 2 → … → N → 1),
     * remount, keep per-stream transport state, persist and broadcast.
     * @returns {boolean} whether a rotation was committed
     */
    commitRotation() {
        const ring = computeRotationRing(this.slots);
        const moves = buildRotationMoves(ring);
        if (!moves.length) return false;

        // Snapshot players + transport flags BEFORE any pointer is rewritten.
        const sourcePlayers = new Map(ring.map((id) => [id, this.slots[id].player]));
        const continuity = ring.map((id) => captureSwapPlaybackState(this.slots[id].player));

        moves.forEach(({ from, to }) => {
            const player = sourcePlayers.get(from) ?? null;
            this.slots[to].player = player;
            if (player) player.id = to;
        });

        // Keep remembered stub keys aligned with the rotated assignment so
        // persistSlots never keeps a stale entry behind an empty player.
        ring.forEach((id) => {
            const channel = this.slots[id].player?.channel ?? null;
            const key = channel ? channelKey(channel) : null;
            if (key) this.rememberedSlotKeys[id] = key;
            else delete this.rememberedSlotKeys[id];
        });

        // Move each moved player's <video> into its new slot surface BEFORE
        // remount so mountAll's _syncVideoMount never destroys another
        // player's stream still sitting in the pre-rotation surface.
        ring.forEach((id) => cancelSlotPrefetch(id));
        this.relocateOwnedSlotVideos?.();

        this.mountAll();

        // Resume only streams that were live; never stopped ones (same as swap).
        ring.forEach((id, i) => {
            applySwapPlaybackContinuity(continuity[i], sourcePlayers.get(ring[i]));
        });

        this.persistSlots();
        ring.forEach((id) => this.slots[id].player?.emitState?.());
        this.scheduleRefreshTiles();
        this.syncScreenControls?.();

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
                detail: { primary: 'center', rotated: true }
            }));
        }
        return true;
    },

    /**
     * Pairwise channel swap between two enabled slots (strip drag).
     * @param {string} slotA
     * @param {string} slotB
     * @param {{ animate?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async swapSlotChannels(slotA, slotB, opts = {}) {
        if (!slotA || !slotB || slotA === slotB || this.swapBusy) return false;
        const a = this.slots[slotA];
        const b = this.slots[slotB];
        if (!a?.enabled || !b?.enabled) return false;

        const animate = opts.animate !== false && travelAnimationsEnabled();
        const firstRects = animate ? captureTileRects([slotA, slotB]) : null;
        const moves = [
            { from: slotA, to: slotB },
            { from: slotB, to: slotA }
        ];

        this.swapBusy = true;
        try {
            const playerA = a.player;
            const playerB = b.player;
            const contA = captureSwapPlaybackState(playerA);
            const contB = captureSwapPlaybackState(playerB);

            a.player = playerB;
            b.player = playerA;
            if (a.player) a.player.id = slotA;
            if (b.player) b.player.id = slotB;

            for (const id of [slotA, slotB]) {
                const channel = this.slots[id].player?.channel ?? null;
                const key = channel ? channelKey(channel) : null;
                if (key) this.rememberedSlotKeys[id] = key;
                else delete this.rememberedSlotKeys[id];
                cancelSlotPrefetch(id);
            }

            this.relocateOwnedSlotVideos?.();
            this.mountAll();
            applySwapPlaybackContinuity(contA, playerA);
            applySwapPlaybackContinuity(contB, playerB);

            this.persistSlots();
            a.player?.emitState?.();
            b.player?.emitState?.();
            this.scheduleRefreshTiles();
            this.syncScreenControls?.();

            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
                    detail: { primary: 'center', swappedPair: [slotA, slotB] }
                }));
            }

            if (firstRects) {
                await flipContentMoves(moves, firstRects);
            }
            return true;
        } finally {
            this.swapBusy = false;
        }
    },

    /**
     * Rotate every TV's channel to the next screen with travelling tiles.
     * Skips animation for the `instant` transition setting and
     * prefers-reduced-motion.
     * @param {{ animate?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async rotateScreens(opts = {}) {
        const ring = computeRotationRing(this.slots);
        const moves = buildRotationMoves(ring);
        if (!moves.length || this.swapBusy) return false;

        const animate = opts.animate !== false && travelAnimationsEnabled();
        const firstRects = animate ? captureTileRects(ring) : null;

        this.swapBusy = true;
        try {
            const committed = this.commitRotation();
            if (!committed) return false;
            if (firstRects) {
                await flipContentMoves(moves, firstRects);
            }
            return true;
        } finally {
            this.swapBusy = false;
        }
    },
};
