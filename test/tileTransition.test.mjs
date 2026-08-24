/**
 * Single-tile channel switch transition helpers.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let reducedMotion = false;

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.window = {
        matchMedia: () => ({ matches: reducedMotion })
    };
});

let SettingsStore;
let resolveChannelSwitchMode;
let runTileContentTransition;

beforeEach(async () => {
    store.clear();
    reducedMotion = false;
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
    ({ resolveChannelSwitchMode, runTileContentTransition } = await import('../js/mosaic/tileTransition.js'));
    SettingsStore.setSwapTransition('flip');
});

function mockTile() {
    const classes = new Set();
    return {
        classList: {
            add(...names) {
                for (const name of names) classes.add(name);
            },
            remove(...names) {
                for (const name of names) classes.delete(name);
            }
        },
        classes,
        offsetWidth: 0
    };
}

test('resolveChannelSwitchMode returns instant under reduced motion', () => {
    SettingsStore.setSwapTransition('flip');
    reducedMotion = true;
    assert.equal(resolveChannelSwitchMode(null), 'instant');
});

test('resolveChannelSwitchMode downgrades transform modes on free layout', () => {
    SettingsStore.setSwapTransition('flip');
    const multiView = { hasCustomPlacement: () => true };
    assert.equal(resolveChannelSwitchMode(multiView), 'crossfade');
});

test('resolveChannelSwitchMode keeps flip on grid layout', () => {
    SettingsStore.setSwapTransition('flip');
    const multiView = { hasCustomPlacement: () => false };
    assert.equal(resolveChannelSwitchMode(multiView), 'flip');
});

test('instant mode calls midpoint immediately without tile', async () => {
    let called = false;
    await runTileContentTransition(null, () => { called = true; }, { mode: 'instant' });
    assert.equal(called, true);
});

test('skipOut skips out-phase classes but runs in-phase', async () => {
    const tile = mockTile();
    let midpointCalled = false;

    await runTileContentTransition(tile, () => { midpointCalled = true; }, {
        mode: 'flip',
        skipOut: true
    });

    assert.equal(midpointCalled, true);
    assert.equal(tile.classes.has('tv-swap-out'), false);
    assert.equal(tile.classes.has('is-swapping'), false);
    assert.equal(tile.classes.has('tv-swap-in'), false);
});

test('css mode applies out then in classes around midpoint', async () => {
    const tile = mockTile();
    const phases = [];

    await runTileContentTransition(tile, () => {
        phases.push('mid');
        assert.equal(tile.classes.has('tv-swap-out'), true);
        assert.equal(tile.classes.has('tv-swap-in'), false);
    }, { mode: 'crossfade', skipOut: false });

    assert.deepEqual(phases, ['mid']);
    assert.equal(tile.classes.has('tv-swap-out'), false);
    assert.equal(tile.classes.has('tv-swap-in'), false);
    assert.equal(tile.classes.has('is-swapping'), false);
});
