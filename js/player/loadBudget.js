/**
 * Central network budget for concurrent stream loads.
 *
 * Every stream attach (front play, staging warm, prefetch warm, tile-frame
 * capture, paused-buffer backfill) competes for the same connection pool.
 * Without arbitration one slow/buffering slot drags every other slot down:
 * each hls.js instance downshifts quality, drops fragments and restarts,
 * which in turn starves the sibling streams. This module owns the
 * prioritisation rules so background work yields to active playback.
 *
 * Kept DOM-free and mostly pure so unit tests can lock the arbitration.
 */

/** Max simultaneous offscreen prefetch <video>s across ALL slots. */
export const PREFETCH_CONCURRENT_VIDEOS = 2;

/** Max warm targets per slot (adjacent channels cached per direction). */
export const PREFETCH_WARM_PER_SLOT = 2;

/** Prefetch does not start while a slot is actively loading/buffering. */
export function isAnySlotConstrained() {
    return loadConstraints.size > 0;
}

/**
 * Whether a background work item (prefetch/tile capture) may start now.
 * @param {{ count?: number, hidden?: boolean, max?: number }} [opts]
 * @returns {boolean}
 */
export function shouldAllowPrefetch({
    count = 0,
    hidden = false,
    max = PREFETCH_CONCURRENT_VIDEOS
} = {}) {
    if (hidden) return false;
    if (isAnySlotConstrained()) return false;
    return count < max;
}

/** Stagger between consecutive fresh stream launches (Play-favorites etc). */
export const MOSAIC_LAUNCH_STEP_MS = 250;

export function computeMosaicLaunchDelay(index, stepMs = MOSAIC_LAUNCH_STEP_MS) {
    return Math.max(0, Number(index) || 0) * Math.max(0, stepMs);
}

/** Minimum gap between hls.js network restarts per slot. */
export const HLS_ERROR_RESTART_MIN_INTERVAL_MS = 2500;

/**
 * Token bucket for hls error auto-restart: NETWORK_ERROR calls startLoad()
 * only if the slot hasn't restarted within minIntervalMs.
 * @returns {boolean} whether a restart is allowed now
 */
export function shouldRestartHlsOnError({
    lastRestartedAt = 0,
    now = Date.now(),
    minIntervalMs = HLS_ERROR_RESTART_MIN_INTERVAL_MS
} = {}) {
    return now - lastRestartedAt >= minIntervalMs;
}

/** Rotate the single paused-buffer backfill slot after this many ms. */
export const PAUSED_FILL_TURN_MS = 10000;

// ===== module-scoped state (resettable for tests) =====

/** slotId -> true while that slot is actively loading / buffering. */
const loadConstraints = new Map();

/** Which paused slot currently owns the lone paused-fill backfill turn. */
let currentPausedFillSlot = null;
let currentPausedFillSince = 0;

/**
 * Report a slot's load state so prefetch/capture can back off.
 * @param {string} slotId
 * @param {boolean|undefined} loading
 */
export function reportSlotLoading(slotId, loading) {
    if (!slotId) return;
    if (loading) loadConstraints.set(slotId, true);
    else if (loadConstraints.has(slotId)) loadConstraints.delete(slotId);
}

export function clearLoadBudgetState() {
    loadConstraints.clear();
    currentPausedFillSlot = null;
    currentPausedFillSince = 0;
}

/**
 * Elect a single paused slot to fill its pause-buffer right now. A slot holds
 * the turn for up to PAUSED_FILL_TURN_MS, then the next requester steals it
 * so one wedged paused stream cannot hog the entire background budget.
 * @param {string} slotId
 * @returns {boolean} true when this slot may startLoad() now
 */
export function takePausedFillTurn(slotId, { now = Date.now(), turnMs = PAUSED_FILL_TURN_MS } = {}) {
    if (!slotId) return false;
    if (currentPausedFillSlot === slotId) return true;
    if (currentPausedFillSlot == null) {
        currentPausedFillSlot = slotId;
        currentPausedFillSince = now;
        return true;
    }
    if (now - currentPausedFillSince >= turnMs) {
        currentPausedFillSlot = slotId;
        currentPausedFillSince = now;
        return true;
    }
    return false;
}

export function releasePausedFill(slotId) {
    if (currentPausedFillSlot === slotId) {
        currentPausedFillSlot = null;
        currentPausedFillSince = 0;
    }
}