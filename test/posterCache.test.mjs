/** Unit tests for js/storage/posterCache.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterCache } from '../js/storage/posterCache.js';
import { IndexedDBStore } from '../js/storage/indexedDbStore.js';

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

test('persists one record per channel key instead of a single library blob', async () => {
    await PosterCache.clearPosters();
    const key = 'iptv-org:per-record';
    const dataUrl = 'data:image/jpeg;base64,perrecord';
    await PosterCache.setPoster(key, dataUrl);

    assert.equal(
        await IndexedDBStore.get(PosterCache._LEGACY_POSTER_CACHE_KEY),
        null,
        'the legacy whole-library blob is not written any more'
    );
    const recordKey = PosterCache._POSTER_PREFIX + key;
    const records = await IndexedDBStore.getMany([recordKey]);
    assert.equal(records.get(recordKey)?.dataUrl, dataUrl);

    // Rewriting the same channel must update in place, never duplicate.
    await PosterCache.setPoster(key, 'data:image/jpeg;base64,perrecord2');
    const keys = (await IndexedDBStore.getAllKeys()).filter(
        (k) => k === recordKey
    );
    assert.equal(keys.length, 1);
    assert.equal(await PosterCache.getPoster(key), 'data:image/jpeg;base64,perrecord2');
});

test('splits the legacy single-blob poster cache into per-key records on first use', async () => {
    await PosterCache.clearPosters();
    const key = 'iptv-org:legacy.poster';
    const dataUrl = 'data:image/jpeg;base64,legacyposter';
    const legacyKey = PosterCache._LEGACY_POSTER_CACHE_KEY;
    await IndexedDBStore.set(legacyKey, {
        entries: { [key]: { cachedAt: Date.now(), dataUrl } }
    });

    PosterCache._resetForTests();
    assert.equal(await PosterCache.getPoster(key), dataUrl, 'legacy poster survives the split');
    assert.equal(await IndexedDBStore.get(legacyKey), null, 'blob removed after the split');

    PosterCache._resetForTests();
    assert.equal(await PosterCache.getPoster(key), dataUrl, 'readable from per-key records');
});

test('setPoster reports a failed persist instead of faking success', async () => {
    await PosterCache.clearPosters();
    const key = 'iptv-org:quota.poster';
    const dataUrl = 'data:image/jpeg;base64,quota';
    const realSetMany = IndexedDBStore.setMany;
    const realWarn = console.warn;
    const errors = [];
    const off = PosterCache.onStorageError((err) => errors.push(err));
    try {
        console.warn = () => {};
        IndexedDBStore.setMany = async () => false;
        assert.equal(await PosterCache.setPoster(key, dataUrl), false, 'caller sees the failure');
        assert.equal(errors.length, 1, 'subscriber is notified once');
        assert.equal(await PosterCache.getPoster(key), dataUrl);
    } finally {
        IndexedDBStore.setMany = realSetMany;
        console.warn = realWarn;
        off();
    }
});
