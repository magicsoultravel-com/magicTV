/**
 * Central network budget for concurrent stream loads.
 *
 * Every stream attach (front play, staging warm, prefetch warm, tile-frame
 * capture, paused-buffer backfill) competes for the same connection pool.
 * Without arbitration one slow/buffering slot drags every other slot down:
 * each hls.js instance downshifts quality, drops fragments and restarts,
 * which in turn starves the sibling streams. This module owns the
 * prioritisation rules so background work yields to active playback, and
 * healthy mosaic siblings soft-yield (ABR cap / buffer shrink) when exactly
 * one slot is struggling.
 *
 * Kept DOM-free and mostly pure so unit tests can lock the arbitration.
 * MultiView is the sole coordinator that applies sibling yield to players.
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

/** Stay yielded this long after the ratio rule stops being true (anti-thrash). */
export const YIELD_HOLD_MS = 5000;

/** Don't force ABR below this height when such a level exists. */
export const YIELD_MIN_HEIGHT = 480;

/** Temporary maxBufferLength while healthy siblings yield. */
export const YIELD_BUFFER_LENGTH = 4;

// ===== module-scoped state (resettable for tests) =====

/** slotId -> pressure reason string while that slot is struggling. */
const loadConstraints = new Map();

/** Which paused slot currently owns the lone paused-fill backfill turn. */
let currentPausedFillSlot = null;
let currentPausedFillSince = 0;

/**
 * Snapshot MultiView pushes so heal-warm gating stays DOM-free.
 * @type {{ yieldActive: boolean, playingIds: string[] }}
 */
let healBudgetContext = { yieldActive: false, playingIds: [] };

/**
 * Report a slot's load/pressure state so prefetch/capture/sibling-yield can
 * back off. Pass a reason string to constrain; null/undefined/false clears.
 * @param {string} slotId
 * @param {string|null|undefined|false} reason
 */
export function reportSlotPressure(slotId, reason) {
    if (!slotId) return;
    if (reason) loadConstraints.set(slotId, String(reason));
    else if (loadConstraints.has(slotId)) loadConstraints.delete(slotId);
}

/**
 * Report a slot's load state so prefetch/capture can back off.
 * @param {string} slotId
 * @param {boolean|undefined} loading
 */
export function reportSlotLoading(slotId, loading) {
    reportSlotPressure(slotId, loading ? 'loading' : null);
}

/** @param {string} slotId */
export function getSlotPressureReason(slotId) {
    if (!slotId) return null;
    return loadConstraints.get(slotId) || null;
}

export function getConstrainedCount() {
    return loadConstraints.size;
}

/** @returns {string[]} */
export function getConstrainedSlotIds() {
    return [...loadConstraints.keys()];
}

/**
 * @param {string} excludeSlotId
 * @returns {number}
 */
export function countOtherConstrained(excludeSlotId) {
    let n = 0;
    for (const id of loadConstraints.keys()) {
        if (id !== excludeSlotId) n += 1;
    }
    return n;
}

/**
 * Yield healthy siblings only when exactly one playing slot is constrained.
 * ≥2 constrained ⇒ pipe is broadly dead — don't punish the last healthy stream.
 * @param {{ constrainedCount?: number, healthyPlayingCount?: number }} [opts]
 * @returns {boolean}
 */
export function shouldYieldHealthy({
    constrainedCount = 0,
    healthyPlayingCount = 0
} = {}) {
    if (constrainedCount !== 1) return false;
    return healthyPlayingCount >= 1;
}

/**
 * Hysteretic yield latch: enter immediately, exit only after holdMs without
 * a yield-worthy condition (covers flap buffering↔playing).
 * @returns {{ active: boolean, lastYieldWorthyAt: number }}
 */
export function resolveYieldState({
    prevActive = false,
    shouldYieldNow = false,
    lastYieldWorthyAt = 0,
    now = Date.now(),
    holdMs = YIELD_HOLD_MS
} = {}) {
    if (shouldYieldNow) {
        return { active: true, lastYieldWorthyAt: now };
    }
    if (!prevActive) {
        return { active: false, lastYieldWorthyAt };
    }
    const since = Math.max(0, now - (Number(lastYieldWorthyAt) || 0));
    if (since < holdMs) {
        return { active: true, lastYieldWorthyAt };
    }
    return { active: false, lastYieldWorthyAt };
}

/**
 * Pick an autoLevelCapping index for sibling yield.
 * Caps at the lowest level that still meets minHeight (≈480p), never forces
 * below that when such a level exists; if all levels are shorter, caps at the
 * highest available. Also mins with sizeBasedCap when ≥ 0.
 * @param {{ levels?: Array<{ height?: number }>, minHeight?: number, sizeBasedCap?: number }} [opts]
 * @returns {number} level index, or -1 when nothing to cap
 */
export function computeYieldLevelCap({
    levels = [],
    minHeight = YIELD_MIN_HEIGHT,
    sizeBasedCap = -1
} = {}) {
    if (!Array.isArray(levels) || levels.length === 0) return -1;

    const withHeight = levels.map((level, index) => ({
        index,
        height: Number(level?.height) || 0
    }));

    const atOrAboveFloor = withHeight.filter((entry) => entry.height >= minHeight);
    let capIdx;
    if (atOrAboveFloor.length) {
        atOrAboveFloor.sort((a, b) => a.height - b.height || a.index - b.index);
        capIdx = atOrAboveFloor[0].index;
    } else {
        capIdx = levels.length - 1;
    }

    if (Number.isInteger(sizeBasedCap) && sizeBasedCap >= 0) {
        capIdx = Math.min(capIdx, sizeBasedCap);
    }
    return capIdx;
}

/**
 * Whether freeze background heal (second HLS warm) should wait.
 * @returns {null|'siblingConstrained'|'multiSiblingPlaying'|'bandwidthBudget'}
 */
export function shouldDeferHealWarm({
    otherConstrainedCount = 0,
    otherPlayingCount = 0,
    yieldActive = false
} = {}) {
    if (otherConstrainedCount > 0) return 'siblingConstrained';
    if (otherPlayingCount >= 2) return 'multiSiblingPlaying';
    if (yieldActive) return 'bandwidthBudget';
    return null;
}

/**
 * MultiView pushes mosaic playback/yield snapshot for heal gating.
 * @param {{ yieldActive?: boolean, playingIds?: string[] }} ctx
 */
export function setHealBudgetContext(ctx = {}) {
    healBudgetContext = {
        yieldActive: ctx.yieldActive === true,
        playingIds: Array.isArray(ctx.playingIds) ? ctx.playingIds.slice() : []
    };
}

export function getHealBudgetContext() {
    return {
        yieldActive: healBudgetContext.yieldActive === true,
        playingIds: healBudgetContext.playingIds.slice()
    };
}

/**
 * Defer reason for a specific slot's freeze warm heal, or null to proceed.
 * @param {string} slotId
 * @returns {null|'siblingConstrained'|'multiSiblingPlaying'|'bandwidthBudget'}
 */
export function shouldDeferHealWarmForSlot(slotId) {
    const playingIds = healBudgetContext.playingIds || [];
    const otherPlayingCount = playingIds.filter((id) => id !== slotId).length;
    const otherConstrainedCount = countOtherConstrained(slotId);
    return shouldDeferHealWarm({
        otherConstrainedCount,
        otherPlayingCount,
        yieldActive: healBudgetContext.yieldActive === true
    });
}

export function clearLoadBudgetState() {
    loadConstraints.clear();
    currentPausedFillSlot = null;
    currentPausedFillSince = 0;
    healBudgetContext = { yieldActive: false, playingIds: [] };
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
