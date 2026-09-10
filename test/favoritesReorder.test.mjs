import test from 'node:test';
import assert from 'node:assert/strict';
import { dragFloatOffset } from '../js/ui/favoritesReorder.js';

test('dragFloatOffset is viewport-relative when fixed origin is (0,0)', () => {
    const pos = dragFloatOffset(
        { left: 120, top: 340 },
        { left: 0, top: 0 }
    );
    assert.equal(pos.left, 120);
    assert.equal(pos.top, 340);
});

test('dragFloatOffset subtracts transformed containing-block origin (dock sheet)', () => {
    // Dock sheet sits above the bottom of the viewport; fixed(0,0) lands at
    // the sheet's top-left, not the viewport origin — without this offset the
    // floating tile jumps to the bottom of the sheet.
    const tileRect = { left: 80, top: 420 };
    const sheetOrigin = { left: 24, top: 280 };
    const pos = dragFloatOffset(tileRect, sheetOrigin);
    assert.equal(pos.left, 56);
    assert.equal(pos.top, 140);
});
