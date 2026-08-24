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
 * Disconnected (stream unavailable) wins over loading/pause/stop.
 * Loading wins over pause/stop so only one status icon shows.
 * Between play click and first paint: wantPlaying without playing → loading.
 */
export function classifyTilePlayback({
    hasChannel = false,
    playing = false,
    posterDataUrl = null,
    pausePhase = 'idle',
    stopped = false,
    loading = false,
    loadPhase = 'idle',
    wantPlaying = false,
    error = null
} = {}) {
    const uiPlaying = playing === true;
    const uiDisconnected = Boolean(
        hasChannel
        && !uiPlaying
        && !!error
    );
    const awaitingFirstPaint = wantPlaying === true && !uiPlaying;
    const uiLoading = Boolean(
        hasChannel
        && !uiPlaying
        && !uiDisconnected
        && (
            loading === true
            || loadPhase === 'connecting'
            || loadPhase === 'buffering'
            || awaitingFirstPaint
        )
    );
    const uiPaused = Boolean(
        hasChannel
        && !uiPlaying
        && !uiDisconnected
        && !uiLoading
        && pausePhase && pausePhase !== 'idle'
    );
    const uiStopped = Boolean(
        hasChannel
        && !uiPlaying
        && !uiDisconnected
        && !uiLoading
        && !uiPaused
        && stopped === true
    );
    return { uiPlaying, uiLoading, uiPaused, uiStopped, uiDisconnected };
}

/** True when playback is actively delivering media (not buffering, pause, stop, or error). */
export function isHealthyWatchPlayback(state = {}) {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    const { uiPlaying, uiPaused, uiStopped, uiDisconnected } = classifyTilePlayback(state);
    if (!state.hasChannel || !uiPlaying || uiPaused || uiStopped || uiDisconnected) return false;
    if (state.wantPlaying !== true) return false;
    if (state.loadPhase === 'connecting' || state.loadPhase === 'buffering') return false;
    if (state.loading === true) return false;
    return true;
}

/**
 * Mid-stream hitch often leaves loading/buffering stuck because `playing` may not re-fire.
 * A later `timeupdate` means media time advanced again — safe to clear those flags.
 */
export function shouldClearStaleBufferOnTimeupdate({
    wantPlaying = false,
    playing = false,
    videoPaused = true,
    loading = false,
    loadPhase = 'idle'
} = {}) {
    return wantPlaying === true
        && playing === true
        && videoPaused !== true
        && (loading === true || loadPhase === 'buffering');
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

/**
 * Toggle pauses only when media is actually playing with play intent.
 * Stuck resume (wantPlaying && !playing) must retry play, not pause.
 */
export function shouldPauseOnToggle(wantPlaying, playing) {
    return wantPlaying === true && playing === true;
}

/**
 * playChannel / transport failure must clear wantPlaying so the next ▶ resumes.
 */
export function shouldClearWantPlayingOnPlayFail() {
    return true;
}

/**
 * Second AbortError while still wanting play must recover (playChannel), not no-op.
 */
export function shouldFallbackPlayChannelOnDoubleAbort() {
    return true;
}

/**
 * After attachStream, playChannel may call video.play() only while the same
 * load + transport intent is still active (pause mid-load must not restart play).
 */
export function shouldContinuePlayAfterAttach({
    generation,
    playGeneration,
    wantPlaying,
    transportGen,
    transportAtStart
}) {
    return generation === playGeneration
        && wantPlaying === true
        && transportGen === transportAtStart;
}

/**
 * Pause during an in-flight load must bump playGeneration so attach cancels.
 */
export function shouldBumpPlayGenerationOnPause({ loading, loadPhase }) {
    return loading === true || (loadPhase != null && loadPhase !== 'idle');
}

/**
 * Browser autoplay policy / gesture requirement.
 */
export function isAutoplayNotAllowedError(err) {
    if (!err) return false;
    if (err.name === 'NotAllowedError') return true;
    return String(err.message || '').toLowerCase().includes('not allowed');
}

/**
 * On NotAllowedError, mute once and retry play when still unmuted.
 */
export function shouldRetryPlayMuted({ blocked, muted }) {
    return blocked === true && muted !== true;
}
