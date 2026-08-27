/**
 * Single-tile channel switch transitions (load/switch/stop).
 * Reuses the same CSS/wipe modes as mosaic corner↔center swap.
 */
import { SettingsStore } from '../storage/settingsStore.js';
import {
    TILE_SWAP_DURATIONS,
    resolveViewTransition,
    runWipeTransition
} from '../ui/viewTransitions.js';
import {
    prefersReducedMotion,
    waitMs,
    clearSwapClasses
} from './constants.js';

const SWAP_DURATIONS = TILE_SWAP_DURATIONS;

const TRANSFORM_DOWNGRADE = new Set(['smooth', 'flip', 'slide', 'spring']);

/**
 * Resolve the Channel switch setting for a single-tile content change.
 * @param {{ hasCustomPlacement?: () => boolean } | null | undefined} multiView
 */
export function resolveChannelSwitchMode(multiView) {
    let mode = resolveViewTransition(SettingsStore.getSwapTransition(), 'swap');
    if (multiView?.hasCustomPlacement?.()
        && TRANSFORM_DOWNGRADE.has(mode)) {
        mode = 'crossfade';
    }
    if (prefersReducedMotion()) return 'instant';
    return mode;
}

/**
 * Run a channel-switch transition on one mosaic tile.
 * @param {HTMLElement | null | undefined} tileEl
 * @param {() => void | Promise<void>} onMidpoint
 * @param {{ mode?: string, skipOut?: boolean }} [opts]
 */
export async function runTileContentTransition(tileEl, onMidpoint, opts = {}) {
    const mode = opts.mode || 'instant';
    const skipOut = opts.skipOut === true;

    if (mode === 'instant' || !tileEl) {
        await onMidpoint?.();
        return;
    }

    if (mode === 'dissolve' || mode === 'grain' || mode === 'matrix') {
        await runWipeTransition(mode, () => onMidpoint?.(), {
            scope: 'tiles',
            fadeTargets: [tileEl],
            grainHosts: [tileEl]
        });
        return;
    }

    const tileMode = mode === 'fade' ? 'fade' : mode;
    if (!SWAP_DURATIONS[tileMode] && !SWAP_DURATIONS[mode]) {
        await onMidpoint?.();
        return;
    }

    const duration = SWAP_DURATIONS[tileMode] || 280;
    const modeClass = `tv-swap--${tileMode}`;

    try {
        tileEl.classList.add('is-swapping', modeClass);
        if (!skipOut) {
            tileEl.classList.add('tv-swap-out');
            void tileEl.offsetWidth;
            await waitMs(duration);
        }

        await onMidpoint?.();

        clearSwapClasses(tileEl);
        tileEl.classList.add('is-swapping', modeClass, 'tv-swap-in');
        void tileEl.offsetWidth;
        await waitMs(duration);
    } finally {
        clearSwapClasses(tileEl);
    }
}
