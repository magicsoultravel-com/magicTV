import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMosaicLayoutMode } from '../js/storage/playerState.js';
import { freeLayoutMethods } from '../js/mosaic/freeLayout.js';

function placementCtx(slots) {
    return {
        slots,
        mosaicPlacement: {},
        placementZTop: 1,
        syncLayout() {},
        applyFreeLayout() {},
        persistPlacement() {},
        mountAll() {},
        scheduleRefreshTiles() {},
        syncPlacementChrome() {},
        ensureCenterOnTop() {}
    };
}

test('normalizeMosaicLayoutMode migrates legacy grid and defaults to grid-h', () => {
    assert.equal(normalizeMosaicLayoutMode(undefined), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid'), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid-h'), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid-v'), 'grid-v');
    assert.equal(normalizeMosaicLayoutMode('butterfly'), 'butterfly');
    assert.equal(normalizeMosaicLayoutMode('theatre'), 'theatre');
});

test('applyGridLayoutPreset maps six slots for horizontal and vertical grids', () => {
    const slots = {
        center: { enabled: true },
        topLeft: { enabled: true },
        topRight: { enabled: true },
        bottomLeft: { enabled: true },
        bottomRight: { enabled: true },
        bottomCenter: { enabled: true }
    };
    const ctx = placementCtx(slots);

    freeLayoutMethods.applyGridLayoutPreset.call(ctx, 'grid-h');
    assert.equal(ctx.mosaicPlacement.center.x, 0);
    assert.equal(ctx.mosaicPlacement.center.w, 1 / 3);
    assert.equal(ctx.mosaicPlacement.center.h, 1 / 2);
    assert.equal(ctx.mosaicPlacement.bottomCenter.x, 2 / 3);
    assert.equal(ctx.mosaicPlacement.bottomCenter.y, 1 / 2);

    freeLayoutMethods.applyGridLayoutPreset.call(ctx, 'grid-v');
    assert.equal(ctx.mosaicPlacement.center.x, 0);
    assert.equal(ctx.mosaicPlacement.center.w, 1 / 2);
    assert.equal(ctx.mosaicPlacement.center.h, 1 / 3);
    assert.equal(ctx.mosaicPlacement.bottomCenter.x, 1 / 2);
    assert.equal(ctx.mosaicPlacement.bottomCenter.y, 2 / 3);
});

test('applyTheatreLayoutPreset places nine-TV canonical stage and satellites', () => {
    const slots = {
        center: { enabled: true },
        topLeft: { enabled: true },
        topRight: { enabled: true },
        bottomLeft: { enabled: true },
        bottomRight: { enabled: true },
        bottomCenter: { enabled: true },
        topCenter: { enabled: true },
        midLeft: { enabled: true },
        midRight: { enabled: true }
    };
    const ctx = placementCtx(slots);
    freeLayoutMethods.applyTheatreLayoutPreset.call(ctx);

    assert.equal(ctx.mosaicPlacement.center.x, 0.25);
    assert.equal(ctx.mosaicPlacement.center.y, 0);
    assert.equal(ctx.mosaicPlacement.center.w, 0.5);
    assert.equal(ctx.mosaicPlacement.center.h, 2 / 3);
    assert.equal(ctx.mosaicPlacement.topLeft.x, 0);
    assert.equal(ctx.mosaicPlacement.topLeft.y, 2 / 3);
    assert.equal(ctx.mosaicPlacement.midRight.x, 0.75);
    assert.equal(ctx.mosaicPlacement.midRight.y, 0);
});

test('applyTheatreLayoutPreset expands stage when right column empty (six TVs)', () => {
    const slots = {
        center: { enabled: true },
        topLeft: { enabled: true },
        topRight: { enabled: true },
        bottomLeft: { enabled: true },
        bottomRight: { enabled: true },
        bottomCenter: { enabled: true },
        topCenter: { enabled: false },
        midLeft: { enabled: false },
        midRight: { enabled: false }
    };
    const ctx = placementCtx(slots);
    freeLayoutMethods.applyTheatreLayoutPreset.call(ctx);

    assert.equal(ctx.mosaicPlacement.center.x, 0.25);
    assert.equal(ctx.mosaicPlacement.center.w, 0.75);
    assert.equal(ctx.mosaicPlacement.center.h, 2 / 3);
    assert.equal(ctx.mosaicPlacement.bottomCenter.x, 0);
    assert.equal(ctx.mosaicPlacement.bottomCenter.y, 1 / 3);
    assert.equal(ctx.mosaicPlacement.midLeft, undefined);
});

test('applyTheatreLayoutPreset uses full top stage when no side satellites', () => {
    const slots = {
        center: { enabled: true },
        topLeft: { enabled: true },
        topRight: { enabled: true },
        bottomLeft: { enabled: true },
        bottomRight: { enabled: true },
        bottomCenter: { enabled: false },
        topCenter: { enabled: false },
        midLeft: { enabled: false },
        midRight: { enabled: false }
    };
    const ctx = placementCtx(slots);
    freeLayoutMethods.applyTheatreLayoutPreset.call(ctx);

    assert.equal(ctx.mosaicPlacement.center.x, 0);
    assert.equal(ctx.mosaicPlacement.center.y, 0);
    assert.equal(ctx.mosaicPlacement.center.w, 1);
    assert.equal(ctx.mosaicPlacement.center.h, 2 / 3);
    assert.equal(ctx.mosaicPlacement.topRight.x, 0.25);
    assert.equal(ctx.mosaicPlacement.topRight.y, 2 / 3);
});
