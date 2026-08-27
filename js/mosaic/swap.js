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

const SWAP_DURATIONS = TILE_SWAP_DURATIONS;

export const swapMethods = {
    async withChannelSwitchTransition(slotId, onMidpoint, opts = {}) {
        if (this.swapBusy) {
            await onMidpoint?.();
            return;
        }
        const tile = el(`player-tile-${slotId || 'center'}`);
        const mode = resolveChannelSwitchMode(this);
        this.swapBusy = true;
        try {
            await runTileContentTransition(tile, onMidpoint, {
                mode,
                skipOut: opts.skipOut === true
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
