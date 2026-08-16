/**
 * Pure helpers for mosaic tile swap playback continuity.
 * Resume is keyed to player/stream identity — never to slot position.
 */

/**
 * After remounting swapped players, resume only streams that were live
 * and not explicitly stopped.
 * @param {{ wasPlaying?: boolean, stopped?: boolean }} state
 * @returns {boolean}
 */
export function shouldResumeAfterSwap({ wasPlaying = false, stopped = false } = {}) {
    return wasPlaying === true && stopped !== true;
}

/**
 * Snapshot transport flags from a player before slot pointers are swapped.
 * @param {{ playing?: boolean, stopped?: boolean } | null | undefined} player
 */
export function captureSwapPlaybackState(player) {
    return {
        wasPlaying: player?.playing === true,
        stopped: player?.stopped === true
    };
}

/**
 * Decide poster clear + resume for one player after mountAll.
 * @param {{ wasPlaying: boolean, stopped: boolean }} before
 * @param {{ playing?: boolean, channel?: object | null } | null | undefined} player
 * @returns {{ clearPoster: boolean, resume: boolean }}
 */
export function resolveSwapPlaybackAction(before, player) {
    const stillPlaying = player?.playing === true;
    const resume = shouldResumeAfterSwap(before)
        && Boolean(player?.channel)
        && !stillPlaying;
    const clearPoster = stillPlaying || resume;
    return { clearPoster, resume };
}

/**
 * Apply post-swap continuity for one player (mutate in place).
 * @param {{ wasPlaying: boolean, stopped: boolean }} before
 * @param {{ playing?: boolean, channel?: object | null, posterDataUrl?: string | null, resume?: () => void } | null | undefined} player
 */
export function applySwapPlaybackContinuity(before, player) {
    if (!player) return;
    const action = resolveSwapPlaybackAction(before, player);
    if (action.clearPoster) player.posterDataUrl = null;
    if (action.resume) player.resume();
}
