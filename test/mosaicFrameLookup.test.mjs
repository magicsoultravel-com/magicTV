import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    collectFrameLookupKeys,
    resolveStoredFrameDataUrl
} from '../js/mosaic/frameLookup.js';

test('collectFrameLookupKeys gathers channel key and stream urls', () => {
    const keys = collectFrameLookupKeys(
        { key: 'iptv-org:abc', url: 'https://example.com/a.m3u8' },
        { url_resolved: 'https://example.com/b.m3u8' }
    );
    assert.deepEqual(keys.sort(), [
        'https://example.com/a.m3u8',
        'https://example.com/b.m3u8',
        'iptv-org:abc'
    ].sort());
});

test('resolveStoredFrameDataUrl prefers poster cache then frame cache keys', () => {
    const posterMap = new Map([['iptv-org:abc', 'poster:data']]);
    const frameMap = new Map([
        ['https://example.com/stream.m3u8', 'frame:data'],
        ['iptv-org:abc', 'frame-by-key']
    ]);

    assert.equal(
        resolveStoredFrameDataUrl('iptv-org:abc', ['https://example.com/stream.m3u8'], posterMap, frameMap),
        'poster:data'
    );

    assert.equal(
        resolveStoredFrameDataUrl('iptv-org:xyz', ['https://example.com/stream.m3u8'], posterMap, frameMap),
        'frame:data'
    );

    assert.equal(
        resolveStoredFrameDataUrl('iptv-org:abc', [], new Map(), frameMap),
        'frame-by-key'
    );
});
