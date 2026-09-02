/**
 * Load-budget arbitration rules — prefetch gating, mosaic launch stagger,
 * hls-error restart throttle, and paused-fill turn rotation.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PREFETCH_CONCURRENT_VIDEOS,
    isAnySlotConstrained,
    shouldAllowPrefetch,
    reportSlotLoading,
    computeMosaicLaunchDelay,
    shouldRestartHlsOnError,
    takePausedFillTurn,
    releasePausedFill,
    clearLoadBudgetState,
    MOSAIC_LAUNCH_STEP_MS,
    HLS_ERROR_RESTART_MIN_INTERVAL_MS,
    PAUSED_FILL_TURN_MS
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