/** Occupancy rule for mosaic empty label (remembered slots hide “Pick a channel”). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors MultiView.refreshTiles occupancy:
 * a slot is occupied if it has a live channel OR a remembered mosaicSlots key.
 */
function slotIsOccupied(playerChannel, rememberedKey) {
    return Boolean(playerChannel) || Boolean(rememberedKey);
}

test('remembered mosaic key hides Pick a channel without live channel', () => {
    assert.equal(slotIsOccupied(null, 'iptv-org:qwest'), true);
    assert.equal(slotIsOccupied(undefined, 'iptv-org:trace'), true);
});

test('empty slot with no memory shows Pick a channel', () => {
    assert.equal(slotIsOccupied(null, ''), false);
    assert.equal(slotIsOccupied(null, null), false);
});

test('live channel occupies slot even without remembered key', () => {
    assert.equal(slotIsOccupied({ name: 'Qwest TV' }, ''), true);
});
