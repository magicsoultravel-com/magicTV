/**
 * Occupancy + saved mosaic map helpers (production exports).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotIsOccupied } from '../js/mosaic/constants.js';
import {
    resolveSavedMosaicMap,
    stubChannelFromEntry
} from '../js/mosaic/persist.js';

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

test('resolveSavedMosaicMap prefers mosaicSlots', () => {
    const map = resolveSavedMosaicMap({
        mosaicSlots: { center: { key: 'a:1', name: 'A' } },
        lastChannelKey: 'b:2',
        lastChannelName: 'B'
    });
    assert.equal(map.center.key, 'a:1');
});

test('resolveSavedMosaicMap falls back to lastChannelKey center-only', () => {
    const map = resolveSavedMosaicMap({
        lastChannelKey: 'iptv-org:trace',
        lastChannelName: 'Trace'
    });
    assert.deepEqual(map, {
        center: {
            key: 'iptv-org:trace',
            name: 'Trace',
            muted: true,
            url: ''
        }
    });
});

test('resolveSavedMosaicMap returns null with nothing saved', () => {
    assert.equal(resolveSavedMosaicMap({}), null);
    assert.equal(resolveSavedMosaicMap({ mosaicSlots: {} }), null);
});

test('stubChannelFromEntry builds channel from mosaic entry', () => {
    const stub = stubChannelFromEntry({
        key: 'iptv-org:qwest',
        name: 'Qwest',
        url: 'https://example.com/live.m3u8'
    });
    assert.equal(stub.channeluuid, 'iptv-org:qwest');
    assert.equal(stub.name, 'Qwest');
    assert.equal(stub.url_resolved, 'https://example.com/live.m3u8');
    assert.equal(stub.providerId, 'iptv-org');
    assert.equal(stub.channelId, 'qwest');
});
