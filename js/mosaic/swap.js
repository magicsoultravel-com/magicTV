/**
 * Mosaic tile swap + animations. Methods mix into MultiView (this === MultiView).
 */
import { el } from '../tvUtils.js';
import { SettingsStore } from '../storage/settingsStore.js';
import {
    TILE_SWAP_DURATIONS,
    resolveViewTransition,
    runWipeTransition
} from '../ui/viewTransitions.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    prefersReducedMotion,
    waitMs,
    clearSwapClasses
} from './constants.js';
import {
    captureSwapPlaybackState,
    applySwapPlaybackContinuity
} from './swapPlayback.js';
import {
    resolveChannelSwitchMode,
    runTileContentTransition
} from './tileTransition.js';
import { cancelSlotPrefetch } from '../player/channelPrefetch.js';

const SWAP_DURATIONS = TILE_SWAP_DURATIONS;

/**
 * Compute the <video> relocation moves needed before a slot→player pointer
 * permutation is remounted. Without this, the first slot to mount calls
 * `_syncVideoMount`, which pauses/removes every OTHER player's still-lingering
 * `<video>` in its surface — killing live streams whose owner hasn't mounted
 * at its new slot yet (the classic swap/rotation black-screen bug).
 * Pure-ish (reads DOM only to resolve surfaces) so it is unit-testable.
 * @param {Record<string, { enabled?: boolean, player?: object | null } | undefined>} slots
 * @returns {{ id: string, kind: 'video'|'videoBack', player: object, to: (Node|null) }[]}
 */
export function computeSlotVideoRelocations(slots) {
    const moves = [];
    SLOT_IDS.forEach((id) => {
        const slot = slots?.[id];
        const player = slot?.player;
        if (!slot?.enabled || !player) return;
        const surface = el(`tv-playback-surface-${id}`);
        if (player.video && player.video.parentElement !== surface) {
            moves.push({ id, kind: 'video', player, to: surface });
        }
        if (player.videoBack && player.videoBack.parentElement !== player.videoHolder) {
            moves.push({ id, kind: 'videoBack', player, to: player.videoHolder });
        }
    });
    return moves;
}

export const swapMethods = {
    /**
     * Move every enabled player's <video>/<videoBack> into its CURRENT slot's
     * surface (+ own holder for the staging buffer) before mountAll() runs.
     * Guarantees _syncVideoMount only ever sees true stray videos after a
     * slot-pointer permutation — never another player's live stream.
     * @returns {number} number of relocations applied
     */
    relocateOwnedSlotVideos() {
        let applied = 0;
        for (const move of computeSlotVideoRelocations(this.slots)) {
            try {
                if (move.to && move.player[move.kind] && move.player[move.kind].parentElement !== move.to) {
                    move.to.appendChild(move.player[move.kind]);
                    applied += 1;
                }
            } catch { /* ignore per-slot relocation */ }
        }
        return applied;
    },

    async withChannelSwitchTransition(slotId, handlers, opts = {}) {
        const callbacks = typeof handlers === 'function'
            ? { onMidpoint: handlers }
            : (handlers || {});

        if (this.swapBusy) {
            if (callbacks.onPrepare && callbacks.onCommit) {
                void Promise.resolve(callbacks.onPrepare?.());
                await callbacks.onCommit?.();
            } else {
                await callbacks.onMidpoint?.();
            }
            return;
        }
        const tile = el(`player-tile-${slotId || 'center'}`);
        const mode = resolveChannelSwitchMode(this);
        this.swapBusy = true;
        try {
            await runTileContentTransition(tile, callbacks, {
                mode,
                skipOut: opts.skipOut === true,
                skipIn: opts.skipIn === true
            });
        } finally {
            this.swapBusy = false;
        }
    },

    swapWithCenter(sideId) {
        if (!CORNER_IDS.includes(sideId)) return;
        if (this.swapBusy) return;
        const side = this.slots[sideId];
        const center = this.slots.center;
        if (!side.enabled || !side.player || !center.player) return;

        let mode = resolveViewTransition(SettingsStore.getSwapTransition(), 'swap');
        // Absolute free-layout tiles fight scale/flip transforms — keep opacity only.
        if (this.hasCustomPlacement() && (mode === 'smooth' || mode === 'flip' || mode === 'slide' || mode === 'spring')) {
            mode = 'crossfade';
        }
        if (mode === 'instant' || prefersReducedMotion()) {
            this.commitSwap(sideId);
            return;
        }
        if (mode === 'dissolve' || mode === 'grain' || mode === 'matrix') {
            this.animateSwapWipe(sideId, mode);
            return;
        }
        // fade shares tile CSS with crossfade naming when needed
        const tileMode = mode === 'fade' ? 'fade' : mode;
        if (!SWAP_DURATIONS[tileMode] && !SWAP_DURATIONS[mode]) {
            this.commitSwap(sideId);
            return;
        }
        this.animateSwap(sideId, tileMode);
    },

    commitSwap(sideId) {
        const side = this.slots[sideId];
        const center = this.slots.center;
        if (!side?.player || !center?.player) return;

        // Capture per-player state before swapping slot pointers (stream identity).
        const centerPlayer = center.player;
        const sidePlayer = side.player;
        const centerBefore = captureSwapPlaybackState(centerPlayer);
        const sideBefore = captureSwapPlaybackState(sidePlayer);

        center.player = sidePlayer;
        side.player = centerPlayer;

        center.player.id = 'center';
        side.player.id = sideId;

        // Move each player's <video> into its new slot surface BEFORE remount:
        // the first mount's _syncVideoMount would otherwise destroy the other
        // player's stream still sitting in the swapped surface.
        this.relocateOwnedSlotVideos?.();
        cancelSlotPrefetch('center');
        cancelSlotPrefetch(sideId);

        this.mountAll();

        // Resume only streams that were already live — never stopped, never by slot.
        applySwapPlaybackContinuity(centerBefore, centerPlayer);
        applySwapPlaybackContinuity(sideBefore, sidePlayer);

        center.player.emitState();
        this.persistSlots();
        window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
            detail: { primary: 'center', swapped: sideId }
        }));
    },

    async animateSwapWipe(sideId, mode) {
        const centerTile = el('player-tile-center');
        const sideTile = el(`player-tile-${sideId}`);
        if (!centerTile || !sideTile) {
            this.commitSwap(sideId);
            return;
        }
        this.swapBusy = true;
        try {
            // Grain/dissolve/matrix only the two tiles in the swap — leave the rest of the mosaic alone.
            await runWipeTransition(mode, () => this.commitSwap(sideId), {
                scope: 'tiles',
                fadeTargets: [centerTile, sideTile],
                grainHosts: [centerTile, sideTile]
            });
        } finally {
            this.swapBusy = false;
        }
    },

    async animateSwap(sideId, mode) {
        const centerTile = el('player-tile-center');
        const sideTile = el(`player-tile-${sideId}`);
        if (!centerTile || !sideTile) {
            this.commitSwap(sideId);
            return;
        }

        this.swapBusy = true;
        const duration = SWAP_DURATIONS[mode] || 280;
        const modeClass = `tv-swap--${mode}`;

        try {
            centerTile.classList.add('is-swapping', modeClass, 'tv-swap-out');
            sideTile.classList.add('is-swapping', modeClass, 'tv-swap-out');
            // Force style application before waiting
            void centerTile.offsetWidth;
            await waitMs(duration);

            this.commitSwap(sideId);

            clearSwapClasses(centerTile);
            clearSwapClasses(sideTile);
            centerTile.classList.add('is-swapping', modeClass, 'tv-swap-in');
            sideTile.classList.add('is-swapping', modeClass, 'tv-swap-in');
            void centerTile.offsetWidth;
            await waitMs(duration);
        } finally {
            clearSwapClasses(centerTile);
            clearSwapClasses(sideTile);
            this.swapBusy = false;
        }
    },
};
