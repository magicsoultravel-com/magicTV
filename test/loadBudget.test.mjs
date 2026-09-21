/**
 * Load-budget arbitration rules — prefetch gating, mosaic launch stagger,
 * hls-error restart throttle, paused-fill turn rotation, and sibling soft-yield
 * policy (ratio rule, hysteresis, 480p floor, heal defer reasons).
 *
 * MultiView is the sole applicator of yield to players; these tests lock the
 * pure helpers that drive empty↔non-empty / flap / 3-of-4 decisions.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PREFETCH_CONCURRENT_VIDEOS,
    isAnySlotConstrained,
    shouldAllowPrefetch,
    reportSlotLoading,
    reportSlotPressure,
    getSlotPressureReason,
    getConstrainedCount,
    getConstrainedSlotIds,
    countOtherConstrained,
    computeMosaicLaunchDelay,
    shouldRestartHlsOnError,
    takePausedFillTurn,
    releasePausedFill,
    clearLoadBudgetState,
    shouldYieldHealthy,
    resolveYieldState,
    computeYieldLevelCap,
    shouldDeferHealWarm,
    shouldDeferHealWarmForSlot,
    setHealBudgetContext,
    MOSAIC_LAUNCH_STEP_MS,
    HLS_ERROR_RESTART_MIN_INTERVAL_MS,
    PAUSED_FILL_TURN_MS,
    YIELD_HOLD_MS,
    YIELD_MIN_HEIGHT
} from '../js/player/loadBudget.js';

beforeEach(() => {
    clearLoadBudgetState();
});

test('prefetch is refused past the global concurrent cap', () => {
    assert.equal(PREFETCH_CONCURRENT_VIDEOS, 2);
    assert.equal(shouldAllowPrefetch({ count: 0 }), true);
    assert.equal(shouldAllowPrefetch({ count: 1 }), true);
    assert.equal(shouldAllowPrefetch({ count: 2 }), false);
    assert.equal(shouldAllowPrefetch({ count: 99 }), false);
});

test('prefetch is refused while hidden or while any slot is constrained', () => {
    assert.equal(shouldAllowPrefetch({ count: 0 }), true);
    assert.equal(shouldAllowPrefetch({ count: 0, hidden: true }), false);
    reportSlotLoading('center', true);
    assert.equal(isAnySlotConstrained(), true);
    assert.equal(shouldAllowPrefetch({ count: 0 }), false);
    reportSlotLoading('center', false);
    assert.equal(isAnySlotConstrained(), false);
    assert.equal(shouldAllowPrefetch({ count: 0 }), true);
});

test('reportSlotPressure stores reason codes and clears on null', () => {
    reportSlotPressure('center', 'healing');
    assert.equal(getSlotPressureReason('center'), 'healing');
    assert.equal(getConstrainedCount(), 1);
    assert.deepEqual(getConstrainedSlotIds(), ['center']);
    reportSlotPressure('topLeft', 'preparing');
    assert.equal(countOtherConstrained('center'), 1);
    reportSlotPressure('center', null);
    assert.equal(getSlotPressureReason('center'), null);
    assert.equal(getConstrainedCount(), 1);
    reportSlotPressure('topLeft', false);
    assert.equal(isAnySlotConstrained(), false);
});

test('computeMosaicLaunchDelay staggers batch launches', () => {
    assert.equal(computeMosaicLaunchDelay(0), 0);
    assert.equal(computeMosaicLaunchDelay(1), MOSAIC_LAUNCH_STEP_MS);
    assert.equal(computeMosaicLaunchDelay(4), MOSAIC_LAUNCH_STEP_MS * 4);
    assert.equal(computeMosaicLaunchDelay(-3), 0);
    assert.equal(computeMosaicLaunchDelay(1, 120), 120);
});

test('hls error restart throttle only allows one restart per interval', () => {
    const base = 10_000;
    // No restart ever recorded (epoch 0) → allowed on a realistic clock.
    assert.equal(shouldRestartHlsOnError({ lastRestartedAt: 0, now: base }), true);
    // A restart just happened → refused until the interval elapses.
    assert.equal(
        shouldRestartHlsOnError({
            lastRestartedAt: base,
            now: base + HLS_ERROR_RESTART_MIN_INTERVAL_MS - 1
        }),
        false
    );
    // After the interval → allowed again.
    assert.equal(
        shouldRestartHlsOnError({
            lastRestartedAt: base,
            now: base + HLS_ERROR_RESTART_MIN_INTERVAL_MS
        }),
        true
    );
});

test('paused-fill: first requester takes the lone turn and holds it', () => {
    assert.equal(takePausedFillTurn('center'), true);
    // Second slot must wait while center still holds the turn.
    assert.equal(takePausedFillTurn('topLeft'), false);
    // The holder keeps its turn across calls (no repeated startLoad spam).
    assert.equal(takePausedFillTurn('center'), true);
});

test('paused-fill: releasing frees the turn for the next requester', () => {
    assert.equal(takePausedFillTurn('center'), true);
    releasePausedFill('center');
    assert.equal(takePausedFillTurn('topLeft'), true);
    assert.equal(takePausedFillTurn('center'), false);
});

test('paused-fill: turn rotates after the time budget so a wedged slot cannot hog', () => {
    const now = 10_000;
    assert.equal(takePausedFillTurn('center', { now }), true);
    // Still held before the turn budget elapses.
    assert.equal(takePausedFillTurn('bottomRight', { now: now + PAUSED_FILL_TURN_MS - 1 }), false);
    // After the budget, the next requester steals the turn.
    assert.equal(takePausedFillTurn('bottomRight', { now: now + PAUSED_FILL_TURN_MS }), true);
    assert.equal(takePausedFillTurn('center', { now: now + PAUSED_FILL_TURN_MS }), false);
});

test('shouldYieldHealthy: 1 constrained + ≥1 healthy → yield', () => {
    assert.equal(shouldYieldHealthy({ constrainedCount: 1, healthyPlayingCount: 1 }), true);
    assert.equal(shouldYieldHealthy({ constrainedCount: 1, healthyPlayingCount: 3 }), true);
});

test('shouldYieldHealthy: 3-of-4 constrained → nobody yields', () => {
    assert.equal(shouldYieldHealthy({ constrainedCount: 3, healthyPlayingCount: 1 }), false);
    assert.equal(shouldYieldHealthy({ constrainedCount: 2, healthyPlayingCount: 2 }), false);
    assert.equal(shouldYieldHealthy({ constrainedCount: 0, healthyPlayingCount: 4 }), false);
    assert.equal(shouldYieldHealthy({ constrainedCount: 1, healthyPlayingCount: 0 }), false);
});

test('resolveYieldState: enters immediately when worthy', () => {
    const now = 50_000;
    const next = resolveYieldState({
        prevActive: false,
        shouldYieldNow: true,
        lastYieldWorthyAt: 0,
        now,
        holdMs: YIELD_HOLD_MS
    });
    assert.equal(next.active, true);
    assert.equal(next.lastYieldWorthyAt, now);
});

test('resolveYieldState: flap holds yield through 5s hysteresis', () => {
    let state = { active: false, lastYieldWorthyAt: 0 };
    const hold = YIELD_HOLD_MS;
    // t=0 worthy → active
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: true,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: 0,
        holdMs: hold
    });
    assert.equal(state.active, true);
    // t=2000 clear → still held
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: false,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: 2000,
        holdMs: hold
    });
    assert.equal(state.active, true);
    assert.equal(state.lastYieldWorthyAt, 0);
    // t=4000 worthy again → refresh stamp
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: true,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: 4000,
        holdMs: hold
    });
    assert.equal(state.active, true);
    assert.equal(state.lastYieldWorthyAt, 4000);
    // t=6000 clear → still within hold from 4000
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: false,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: 6000,
        holdMs: hold
    });
    assert.equal(state.active, true);
    // t=9001 clear → hold expired
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: false,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: 4000 + hold + 1,
        holdMs: hold
    });
    assert.equal(state.active, false);
});

test('resolveYieldState: empty↔non-empty transition clears after hold', () => {
    const t0 = 100_000;
    let state = resolveYieldState({
        prevActive: false,
        shouldYieldNow: true,
        lastYieldWorthyAt: 0,
        now: t0,
        holdMs: YIELD_HOLD_MS
    });
    assert.equal(state.active, true);
    // Constraint map goes empty (not worthy) — still active during hold.
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: false,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: t0 + 100,
        holdMs: YIELD_HOLD_MS
    });
    assert.equal(state.active, true);
    state = resolveYieldState({
        prevActive: state.active,
        shouldYieldNow: false,
        lastYieldWorthyAt: state.lastYieldWorthyAt,
        now: t0 + YIELD_HOLD_MS,
        holdMs: YIELD_HOLD_MS
    });
    assert.equal(state.active, false);
});

test('computeYieldLevelCap: floors at 480p when available', () => {
    const levels = [
        { height: 240 },
        { height: 360 },
        { height: 480 },
        { height: 720 },
        { height: 1080 }
    ];
    assert.equal(YIELD_MIN_HEIGHT, 480);
    assert.equal(computeYieldLevelCap({ levels }), 2);
    // Never force above a tighter size-based cap.
    assert.equal(computeYieldLevelCap({ levels, sizeBasedCap: 1 }), 1);
});

test('computeYieldLevelCap: all below 480p → highest available (no raise)', () => {
    const levels = [{ height: 240 }, { height: 360 }];
    assert.equal(computeYieldLevelCap({ levels }), 1);
});

test('computeYieldLevelCap: empty levels → -1', () => {
    assert.equal(computeYieldLevelCap({ levels: [] }), -1);
});

test('computeYieldLevelCap: restore token round-trip via sizeBasedCap', () => {
    const levels = [
        { height: 360 },
        { height: 480 },
        { height: 720 }
    ];
    // Pre-yield size cap was 720 index 2; yield wants 480 index 1 → min = 1.
    const savedAutoLevelCapping = 2;
    const cap = computeYieldLevelCap({
        levels,
        sizeBasedCap: savedAutoLevelCapping
    });
    assert.equal(cap, 1);
    // Restoring exactly means callers keep savedAutoLevelCapping=2 for unyield.
    assert.equal(savedAutoLevelCapping, 2);
});

test('shouldDeferHealWarm reason selection', () => {
    assert.equal(
        shouldDeferHealWarm({
            otherConstrainedCount: 1,
            otherPlayingCount: 3,
            yieldActive: true
        }),
        'siblingConstrained'
    );
    assert.equal(
        shouldDeferHealWarm({
            otherConstrainedCount: 0,
            otherPlayingCount: 2,
            yieldActive: false
        }),
        'multiSiblingPlaying'
    );
    assert.equal(
        shouldDeferHealWarm({
            otherConstrainedCount: 0,
            otherPlayingCount: 1,
            yieldActive: true
        }),
        'bandwidthBudget'
    );
    assert.equal(
        shouldDeferHealWarm({
            otherConstrainedCount: 0,
            otherPlayingCount: 1,
            yieldActive: false
        }),
        null
    );
});

test('shouldDeferHealWarmForSlot uses heal budget context', () => {
    reportSlotPressure('topLeft', 'loading');
    setHealBudgetContext({
        yieldActive: false,
        playingIds: ['center', 'topLeft', 'topRight']
    });
    assert.equal(shouldDeferHealWarmForSlot('center'), 'siblingConstrained');

    clearLoadBudgetState();
    setHealBudgetContext({
        yieldActive: false,
        playingIds: ['center', 'topLeft', 'topRight']
    });
    assert.equal(shouldDeferHealWarmForSlot('center'), 'multiSiblingPlaying');

    setHealBudgetContext({
        yieldActive: true,
        playingIds: ['center', 'topLeft']
    });
    assert.equal(shouldDeferHealWarmForSlot('center'), 'bandwidthBudget');
});
