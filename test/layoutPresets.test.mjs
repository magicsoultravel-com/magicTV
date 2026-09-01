import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMosaicLayoutMode } from '../js/storage/playerState.js';
import { freeLayoutMethods } from '../js/mosaic/freeLayout.js';

test('normalizeMosaicLayoutMode migrates legacy grid and defaults to grid-h', () => {
    assert.equal(normalizeMosaicLayoutMode(undefined), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid'), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid-h'), 'grid-h');
    assert.equal(normalizeMosaicLayoutMode('grid-v'), 'grid-v');
    assert.equal(normalizeMosaicLayoutMode('butterfly'), 'butterfly');
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
    const ctx = {
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
