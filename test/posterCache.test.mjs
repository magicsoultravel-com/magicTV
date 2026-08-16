/** Unit tests for js/storage/posterCache.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterCache } from '../js/storage/posterCache.js';

test('setPoster/getPoster round-trips by channel key', async () => {
    await PosterCache.clearPosters();
    const key = 'iptv-org:poster.roundtrip';
    const dataUrl = 'data:image/jpeg;base64,poster1';
    assert.equal(await PosterCache.getPoster(key), null);
    assert.equal(await PosterCache.setPoster(key, dataUrl), true);
    assert.equal(await PosterCache.getPoster(key), dataUrl);
});

test('getPosters batch-returns hits and skips misses', async () => {
    await PosterCache.clearPosters();
    const a = 'iptv-org:a';
    const b = 'iptv-org:b';
    await PosterCache.setPoster(a, 'data:image/jpeg;base64,a');
    await PosterCache.setPoster(b, 'data:image/jpeg;base64,b');
    const map = await PosterCache.getPosters([a, 'iptv-org:miss', b, '']);
    assert.equal(map.size, 2);
    assert.equal(map.get(a), 'data:image/jpeg;base64,a');
    assert.equal(map.get(b), 'data:image/jpeg;base64,b');
});

test('posters expire after the 7-day TTL', async () => {
    await PosterCache.clearPosters();
    const key = 'iptv-org:expires';
    const realNow = Date.now;
    try {
        Date.now = () => realNow();
        await PosterCache.setPoster(key, 'data:image/jpeg;base64,old');
        assert.equal(await PosterCache.getPoster(key), 'data:image/jpeg;base64,old');
        Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
        assert.equal(await PosterCache.getPoster(key), null);
    } finally {
        Date.now = realNow;
    }
});

test('removePoster deletes only the requested key', async () => {
    await PosterCache.clearPosters();
    const a = 'iptv-org:rm-a';
    const b = 'iptv-org:rm-b';
    await PosterCache.setPoster(a, 'data:image/jpeg;base64,a');
    await PosterCache.setPoster(b, 'data:image/jpeg;base64,b');
    await PosterCache.removePoster(a);
    assert.equal(await PosterCache.getPoster(a), null);
    assert.equal(await PosterCache.getPoster(b), 'data:image/jpeg;base64,b');
});

test('concurrent poster writes after clear all survive', async () => {
    await PosterCache.clearPosters();
    const a = 'iptv-org:race-a';
    const b = 'iptv-org:race-b';
    await Promise.all([
        PosterCache.setPoster(a, 'data:image/jpeg;base64,a'),
        PosterCache.setPoster(b, 'data:image/jpeg;base64,b')
    ]);
    assert.equal(await PosterCache.getPoster(a), 'data:image/jpeg;base64,a');
    assert.equal(await PosterCache.getPoster(b), 'data:image/jpeg;base64,b');
});
