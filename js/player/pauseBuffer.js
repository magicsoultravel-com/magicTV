/**
 * Pure pause/resume buffer + tile playback classification helpers.
 * Kept free of DOM so unit tests can lock the play/pause contract.
 */

/** Seek only when headroom is below this fraction of bufferSize. */
export const PARK_HEADROOM_RATIO = 0.9;

/** Pause that lasts this long makes the parked live buffer stale. */
export const STALLED_PAUSE_RESTART_MS = 30000;
/** Live latency beyond this while paused declares the parked buffer roadkill. */
export const STALLED_PAUSE_BEHIND_MS = 30000;
/** Stuck-load recovery: no media progress for this long → fresh attach. */
export const STUCK_LOAD_RECOVERY_MS = 5000;

/**
 * Freeze-heal: clock/frame stall must persist this long before acting.
 * Above PRELOAD_STALL (8s) so normal rebuffer settles first. One-size-fits-all.
 */
export const FREEZE_CONFIRM_MS = 12000;
/** Poll cadence for the playing-state freeze ticker. */
export const FREEZE_TICK_MS = 2000;
/** Minimum observed frame rate (fps) that arms the video-only stall detector. */
export const FREEZE_VIDEO_MIN_FPS = 2;
/** Cooldown between heal attempts on the same slot (anti-spree). */
export const FREEZE_HEAL_COOLDOWN_MS = 45000;
/** Failed background heals before falling through to disconnect/retry flow. */
export const FREEZE_HEAL_MAX_FAILS = 3;
/** Continuous healthy motion that forgives past heal failures. */
export const FREEZE_HEALTHY_RESET_MS = 30000;

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
 * Locate the buffered range containing currentTime (hole-aware).
 * TimeRanges can hold several disjoint ranges; callers must not assume
 * start(0)..end(last) is continuous. A small epsilon tolerates fragment
 * boundary jitter so the playhead at a range edge still counts as inside.
 * @param {TimeRanges|{length:number,start:(i:number)=>number,end:(i:number)=>number}|null} buffered
 * @param {number} currentTime
 * @param {number} [epsilon]
 * @returns {{start:number,end:number,index:number}|null}
 */
export function findBufferedRange(buffered, currentTime, epsilon = 0.3) {
    try {
        const count = buffered?.length || 0;
        if (!count || typeof buffered.start !== 'function' || typeof buffered.end !== 'function') return null;
        const now = Number(currentTime);
        const tol = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : 0.3;
        for (let i = 0; i < count; i += 1) {
            const start = buffered.start(i);
            const end = buffered.end(i);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            if (Number.isFinite(now) && now + tol >= start && now - tol <= end) {
                return { start, end, index: i };
            }
        }
    } catch { /* ignore malformed TimeRanges */ }
    return null;
}

/**
 * Start of the first buffered range ahead of currentTime (hole recovery).
 * @returns {number|null}
 */
export function nextBufferedStart(buffered, currentTime) {
    try {
        const count = buffered?.length || 0;
        if (!count || typeof buffered.start !== 'function' || typeof buffered.end !== 'function') return null;
        const now = Number.isFinite(currentTime) ? currentTime : -Infinity;
        let best = null;
        for (let i = 0; i < count; i += 1) {
            const start = buffered.start(i);
            const end = buffered.end(i);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            if (start > now && (best == null || start < best)) best = start;
        }
        return best;
    } catch { /* ignore */ }
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
    preparing = false,
    error = null
} = {}) {
    const uiPlaying = playing === true;
    const uiDisconnected = Boolean(
        hasChannel
        && !uiPlaying
        && !!error
    );
    /** Background warm-up while the front stream is still live — keep showing TV, not loading. */
    const tuningWithLivePicture = preparing === true && uiPlaying;
    const awaitingFirstPaint = wantPlaying === true && !uiPlaying && !tuningWithLivePicture;
    const uiLoading = Boolean(
        hasChannel
        && !uiPlaying
        && !uiDisconnected
        && !tuningWithLivePicture
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

/**
 * True when local playback is actively delivering media (not buffering, pause, stop, or error).
 * Hidden tabs still count when the media element is playing (background / PiP).
 * Pass freezePressure / videoPaused when available.
 */
export function isHealthyWatchPlayback(state = {}) {
    if (state.freezePressure === true) return false;
    const { uiPlaying, uiPaused, uiStopped, uiDisconnected } = classifyTilePlayback(state);
    if (!state.hasChannel || !uiPlaying || uiPaused || uiStopped || uiDisconnected) return false;
    if (state.wantPlaying !== true) return false;
    if (state.loadPhase === 'connecting' || state.loadPhase === 'buffering') return false;
    if (state.loading === true) return false;
    // Background / PiP: page may be hidden but video still playing — keep accruing.
    // If the element is paused while hidden, do not bank wall-clock.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (state.videoPaused === true) return false;
    }
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
 * Resuming a live stream that sat paused long enough for the live edge to
 * wander far past the parked buffer will spin (dead buffer, hls re-aligns at
 * the next fragment boundary). Start a fresh attach instead.
 */
export function shouldFreshResume({
    channelUrl = '',
    isLive = true,
    behindLive = null,
    pausedAt = 0,
    now = Date.now(),
    maxStallMs = STALLED_PAUSE_RESTART_MS,
    behindThreshold = STALLED_PAUSE_BEHIND_MS
} = {}) {
    if (!channelUrl) return true;
    if (!isLive) return false;
    if (pausedAt <= 0) return false;
    const pausedFor = Math.max(0, now - pausedAt);
    if (pausedFor < maxStallMs) return false;
    return Number.isFinite(behindLive) && behindLive > behindThreshold;
}

/**
 * A repeated toggle while a load intent is stuck (wantPlaying but no media
 * progress for a while) must recover with a fresh attach — re-running
 * video.play() on the same dead engine only spins.
 */
export function shouldRecoverStuckLoad({
    wantPlaying = false,
    playing = false,
    loading = false,
    loadPhase = 'idle',
    lastProgressAt = 0,
    now = Date.now(),
    hardStallMs = STUCK_LOAD_RECOVERY_MS
} = {}) {
    if (wantPlaying !== true || playing === true) return false;
    const inFlight = loading === true
        || loadPhase === 'connecting'
        || loadPhase === 'buffering';
    if (!inFlight) return false;
    if (lastProgressAt <= 0) return false;
    return now - lastProgressAt >= hardStallMs;
}

/**
 * Autoplay / NotAllowedError must not clear user play intent.
 * Only explicit pause/stop should persist wasPlaying: false.
 */
export function shouldClearWasPlayingOnAutoplayBlock() {
    return false;
}

/**
 * Full freeze: media clock stopped advancing for the full confirm window.
 * elapsedMs is time since the clock last moved (NOT the tick gap) — the tick
 * fires every FREEZE_TICK_MS but a stall only counts after FREEZE_CONFIRM_MS.
 * Pure helper for the freeze ticker — no DOM.
 */
export function isClockStalled({
    lastTime = 0,
    nowTime = 0,
    elapsedMs = 0,
    thresholdMs = FREEZE_CONFIRM_MS
} = {}) {
    if (!Number.isFinite(lastTime) || !Number.isFinite(nowTime)) return false;
    if (!Number.isFinite(elapsedMs) || elapsedMs < thresholdMs) return false;
    return Math.abs(nowTime - lastTime) < 0.05;
}

/**
 * Frames advanced since the previous sample (fps leg of the heal contract).
 */
export function didFramesAdvance({ lastFrames = -1, nowFrames = -1 } = {}) {
    if (!Number.isFinite(nowFrames) || nowFrames < 0) return false;
    if (!Number.isFinite(lastFrames) || lastFrames < 0) return false;
    return nowFrames > lastFrames;
}

/**
 * Media clock advanced since the previous sample (≥50ms of timeline motion).
 */
export function didClockAdvance({ lastTime = 0, nowTime = 0 } = {}) {
    if (!Number.isFinite(lastTime) || !Number.isFinite(nowTime)) return false;
    return Math.abs(nowTime - lastTime) >= 0.05;
}

/**
 * Video-only freeze: audio clock advances but no new decoded video frames for
 * the full confirm window AND the stream previously proved it can decode
 * real motion (minObservedFps). Still-image tracks (cover art) and slideshows
 * never reach FREEZE_VIDEO_MIN_FPS, so they are never mistaken for a freeze.
 */
export function isVideoFrameStalled({
    framesElapsedMs = 0,
    thresholdMs = FREEZE_CONFIRM_MS,
    clockAdvanced = false,
    minObservedFps = 0,
    requiredFps = FREEZE_VIDEO_MIN_FPS
} = {}) {
    if (clockAdvanced !== true) return false;
    if (!Number.isFinite(framesElapsedMs) || framesElapsedMs < thresholdMs) return false;
    if (!Number.isFinite(minObservedFps) || minObservedFps < requiredFps) return false;
    return true;
}

/**
 * Whether the freeze ticker may run at all — mirrors the guards the
 * player tick uses so tests lock the same contract.
 */
export function shouldRunFreezeTick({
    wantPlaying = false,
    playing = false,
    loading = false,
    loadPhase = 'idle',
    paused = false,
    stopped = false,
    seeking = false,
    hidden = false,
    hasChannel = false,
    healing = false,
    prepareBusy = false
} = {}) {
    if (wantPlaying !== true || playing !== true) return false;
    if (hasChannel !== true) return false;
    if (paused === true || stopped === true || seeking === true) return false;
    if (hidden === true || healing === true || prepareBusy === true) return false;
    if (loading === true) return false;
    if (loadPhase === 'connecting' || loadPhase === 'buffering') return false;
    return true;
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
