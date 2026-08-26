import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEW_TRANSITION_POOL,
    getCatalogViewTransitionFrames,
    resolveViewTransition
} from '../js/ui/viewTransitions.js';

test('VIEW_TRANSITION_POOL excludes instant and random', () => {
    assert.ok(!VIEW_TRANSITION_POOL.includes('instant'));
    assert.ok(!VIEW_TRANSITION_POOL.includes('random'));
    assert.ok(VIEW_TRANSITION_POOL.includes('glitch'));
    assert.ok(VIEW_TRANSITION_POOL.includes('spiralin'));
});

test('resolveViewTransition random never draws instant', () => {
    const seen = new Set();
    for (let i = 0; i < VIEW_TRANSITION_POOL.length * 3; i++) {
        seen.add(resolveViewTransition('random', 'catalog-test'));
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
