/**
 * Pure pause/resume buffer + tile playback classification helpers.
 * Kept free of DOM so unit tests can lock the play/pause contract.
 */

/** Seek only when headroom is below this fraction of bufferSize. */
export const PARK_HEADROOM_RATIO = 0.9;

/**
 * Target currentTime so headroom ≈ bufferSize (park behind bufferedEnd).
 * @returns {number|null} seek target, or null if already parked / no range
 */
export function computeParkBehindTime(current, bufferedStart, bufferedEnd, bufferSize) {
    if (!Number.isFinite(bufferedStart) || !Number.isFinite(bufferedEnd)) return null;
    if (bufferedEnd <= bufferedStart) return null;
    const target = Number(bufferSize) > 0 ? Number(bufferSize) : 15;
    const now = Number.isFinite(current) ? current : bufferedStart;
    const headroom = bufferedEnd - now;
    if (headroom >= target * PARK_HEADROOM_RATIO) return null;
    const desired = Math.max(bufferedStart, bufferedEnd - target);
    if (!Number.isFinite(desired)) return null;
    if (Math.abs(desired - now) <= 0.05) return null;
    return desired;
}

/**
 * Resume seek: stay parked inside the buffer so play starts with headroom.
 * Never jumps to bufferedEnd tip (stalls) or live present.
 * @returns {number|null} clamp seek if outside range, else null (play as-is)
 */
export function computeResumeSeekTime(current, bufferedStart, bufferedEnd) {
    if (!Number.isFinite(bufferedStart) || !Number.isFinite(bufferedEnd)) return null;
    if (bufferedEnd <= bufferedStart) return null;
    const now = Number.isFinite(current) ? current : bufferedStart;
    if (now < bufferedStart) return bufferedStart;
    if (now > bufferedEnd) return Math.max(bufferedStart, bufferedEnd - 0.1);
    return null;
}

/**
 * Whether a native `playing` event should update player/UI state.
 * Rejects stale events after the user already paused (mash-safe).
 */
export function shouldAcceptPlayingEvent(wantPlaying) {
    return wantPlaying === true;
}

/**
 * Whether a native `pause` event should flip UI to paused.
 * Rejects while user intent is still play (optimistic resume).
 */
export function shouldAcceptPauseEvent(wantPlaying) {
    return wantPlaying !== true;
}

/**
 * Tile overlay classes from player intent (not residual idle).
 */
export function classifyTilePlayback({
    hasChannel = false,
    playing = false,
    posterDataUrl = null,
    pausePhase = 'idle',
    stopped = false
} = {}) {
    const uiPlaying = playing === true;
    const uiPaused = Boolean(
        hasChannel
        && !uiPlaying
        && (posterDataUrl || (pausePhase && pausePhase !== 'idle'))
    );
    const uiStopped = Boolean(
        hasChannel
        && !uiPlaying
        && !uiPaused
        && stopped === true
    );
    return { uiPlaying, uiPaused, uiStopped };
}

/**
 * Reload resume: force muted during autoplay, then restore saved mute preference.
 * @param {boolean|undefined} savedMuted mosaicSlots entry muted (missing → muted)
 * @returns {{ duringPlay: true, afterPlay: boolean }}
 */
export function resolveRestorePlayMute(savedMuted) {
    return {
        duringPlay: true,
        afterPlay: savedMuted !== false
    };
}

/**
 * Autoplay / NotAllowedError must not clear user play intent.
 * Only explicit pause/stop should persist wasPlaying: false.
 */
export function shouldClearWasPlayingOnAutoplayBlock() {
    return false;
}
