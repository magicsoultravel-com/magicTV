/** Unit tests for js/storage/frameCache.js (IndexedDB-backed thumbnail cache). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameCache } from '../js/storage/frameCache.js';

test('setFrame/getFrame round-trips a data URL keyed by channel URL', async () => {
    await FrameCache.clearFrames();
    const url = 'https://example.test/live/fox.m3u8';
    const dataUrl = 'data:image/jpeg;base64,abc';
    assert.equal(await FrameCache.getFrame(url), null, 'cache starts empty');

    const stored = await FrameCache.setFrame(url, dataUrl);
    assert.equal(stored, true);
    assert.equal(await FrameCache.getFrame(url), dataUrl, 'round-trips the stored frame');
});

test('getFrame rejects falsy input and treats unknown keys as a miss', async () => {
    assert.equal(await FrameCache.getFrame(null), null);
    assert.equal(await FrameCache.getFrame(''), null);
    assert.equal(await FrameCache.getFrame('https://example.test/nope.m3u8'), null);
});

test('frames expire after the 7-day TTL', async () => {
    await FrameCache.clearFrames();
    const url = 'https://example.test/live/expires.m3u8';

    const realNow = Date.now;
    try {
        Date.now = () => realNow();
        await FrameCache.setFrame(url, 'data:image/jpeg;base64,expired');
        assert.equal(await FrameCache.getFrame(url), 'data:image/jpeg;base64,expired');

        // Simulate 8 days later — held entry must be expired and dropped.
        Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
        assert.equal(await FrameCache.getFrame(url), null, 'expired frame is a cache miss');
        assert.equal(await FrameCache.getFrame(url), null, 'expired frame stays removed');
    } finally {
        Date.now = realNow;
    }
});

test('removeFrame deletes only the requested key', async () => {
    await FrameCache.clearFrames();
    const a = 'https://example.test/a.m3u8';
    const b = 'https://example.test/b.m3u8';
    await FrameCache.setFrame(a, 'data:image/jpeg;base64,a');
    await FrameCache.setFrame(b, 'data:image/jpeg;base64,b');

    await FrameCache.removeFrame(a);
    assert.equal(await FrameCache.getFrame(a), null);
    assert.equal(await FrameCache.getFrame(b), 'data:image/jpeg;base64,b');
});

test('preloadFrames is a harmless no-op without a DOM (Node)', async () => {
    // Guard for non-browser environments; must not throw.
    await FrameCache.preloadFrames(['https://example.test/x.m3u8']);
    assert.ok(true);
});