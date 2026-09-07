import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEW_TRANSITIONS,
    VIEW_TRANSITION_POOL,
    VIEW_MOTION,
    SHUTDOWN_MOTION,
    POWER_STYLE_TRANSITIONS,
    DEFAULT_SHUTDOWN_TRANSITION,
    getCatalogViewTransitionFrames,
    resolveViewTransition,
    normalizeViewTransition,
    normalizeShutdownTransition
} from '../js/ui/viewTransitions.js';

test('VIEW_TRANSITION_POOL excludes instant and random', () => {
    assert.ok(!VIEW_TRANSITION_POOL.includes('instant'));
    assert.ok(!VIEW_TRANSITION_POOL.includes('random'));
    assert.ok(VIEW_TRANSITION_POOL.includes('glitch'));
    assert.ok(VIEW_TRANSITION_POOL.includes('spiralin'));
    assert.ok(VIEW_TRANSITION_POOL.includes('matrix'));
});

test('classical, t800, and t1000 are shared power-style modes', () => {
    assert.ok(VIEW_TRANSITIONS.includes('classical'));
    assert.ok(VIEW_TRANSITIONS.includes('t800'));
    assert.ok(VIEW_TRANSITIONS.includes('t1000'));
    assert.ok(!VIEW_TRANSITIONS.includes('terminator'));
    assert.ok(VIEW_TRANSITION_POOL.includes('classical'));
    assert.ok(VIEW_TRANSITION_POOL.includes('t800'));
    assert.ok(VIEW_TRANSITION_POOL.includes('t1000'));
    assert.ok(POWER_STYLE_TRANSITIONS.has('classical'));
    assert.ok(POWER_STYLE_TRANSITIONS.has('t800'));
    assert.ok(POWER_STYLE_TRANSITIONS.has('t1000'));
    assert.ok(VIEW_MOTION.classical?.duration > 0);
    assert.ok(VIEW_MOTION.t800?.duration > 0);
    assert.ok(VIEW_MOTION.t1000?.duration > 0);
    assert.ok(SHUTDOWN_MOTION.classical.duration > VIEW_MOTION.classical.duration);
    assert.ok(SHUTDOWN_MOTION.t800.duration > VIEW_MOTION.t800.duration);
    assert.ok(SHUTDOWN_MOTION.t1000.duration > VIEW_MOTION.t1000.duration);
});

test('legacy terminator preference maps to t800', () => {
    assert.equal(normalizeViewTransition('terminator'), 't800');
    assert.equal(normalizeShutdownTransition('terminator'), 't800');
});

test('normalizeShutdownTransition defaults to classical', () => {
    assert.equal(DEFAULT_SHUTDOWN_TRANSITION, 'classical');
    assert.equal(normalizeShutdownTransition(undefined), 'classical');
    assert.equal(normalizeShutdownTransition('nope'), 'classical');
    assert.equal(normalizeShutdownTransition('t1000'), 't1000');
});

test('matrix is registered with a longer wipe duration than grain', () => {
    assert.ok(VIEW_TRANSITIONS.includes('matrix'));
    assert.ok(VIEW_MOTION.matrix);
    assert.ok(VIEW_MOTION.matrix.duration >= VIEW_MOTION.grain.duration);
});

test('resolveViewTransition random never draws instant', () => {
    const seen = new Set();
    for (let i = 0; i < VIEW_TRANSITION_POOL.length * 3; i++) {
        seen.add(resolveViewTransition('random', 'catalog-test-t2'));
    }
    assert.ok(!seen.has('instant'), 'random bag must not include instant');
    assert.ok(seen.has('glitch'));
});

test('getCatalogViewTransitionFrames defines glitch and spiral modes', () => {
    const glitch = getCatalogViewTransitionFrames('glitch');
    assert.ok(glitch.outFrames.length > 2);
    assert.ok(glitch.inFrames.length > 2);
    assert.match(String(glitch.outFrames[1].filter || ''), /hue-rotate/);

    const spiralIn = getCatalogViewTransitionFrames('spiralin');
    assert.match(String(spiralIn.outFrames[1].transform || ''), /rotate/);

    const flip = getCatalogViewTransitionFrames('flip');
    assert.equal(flip.needsPerspective, true);
});
