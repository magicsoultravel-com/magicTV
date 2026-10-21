/** Unit tests for js/youtube/youtubeLibrary.js (clip library + oEmbed lookup). */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i] ?? null
    };
});

const {
    YOUTUBE_LIBRARY_KEY,
    YOUTUBE_LIBRARY_LIMIT,
    addYouTubeClip,
    fetchYouTubeMeta,
    hasYouTubeClip,
    listYouTubeClips,
    loadYouTubeLibrary,
    normalizeYouTubeClip,
    normalizeYouTubeLibrary,
    removeYouTubeClip,
    saveYouTubeLibrary,
    toggleYouTubeClip,
    touchYouTubeClip,
    youtubeClipUrl
} = await import('../js/youtube/youtubeLibrary.js');

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'M7lc1UVf-VE';

beforeEach(() => {
    store.clear();
});

test('normalizeYouTubeClip rejects junk and fills defaults', () => {
    assert.equal(normalizeYouTubeClip(null), null);
    assert.equal(normalizeYouTubeClip({ videoId: 'short' }), null);

    const clip = normalizeYouTubeClip({ videoId: ID_A });
    assert.equal(clip.videoId, ID_A);
    assert.equal(clip.title, `YouTube ${ID_A}`);
    assert.equal(clip.thumb, `https://i.ytimg.com/vi/${ID_A}/hqdefault.jpg`);
    assert.equal(clip.addedAt, 0);

    const full = normalizeYouTubeClip({
        videoId: ID_B,
        title: '  A title  ',
        thumb: 'https://x/t.jpg',
        addedAt: 42,
        author: ' Artist '
    });
    assert.deepEqual(full, {
        videoId: ID_B,
        title: 'A title',
        thumb: 'https://x/t.jpg',
        addedAt: 42,
        author: 'Artist'
    });
});

test('normalizeYouTubeLibrary dedupes, caps, and accepts arrays or { clips }', () => {
    const many = Array.from({ length: YOUTUBE_LIBRARY_LIMIT + 12 }, (_, i) => ({
        videoId: `vid${String(i).padStart(8, '0')}`
    }));
    const capped = normalizeYouTubeLibrary({ clips: many });
    assert.equal(capped.clips.length, YOUTUBE_LIBRARY_LIMIT);

    const deduped = normalizeYouTubeLibrary([
        { videoId: ID_A, title: 'first' },
        { videoId: ID_A, title: 'second' },
        { videoId: ID_B }
    ]);
    assert.equal(deduped.clips.length, 2);
    assert.equal(deduped.clips.find((c) => c.videoId === ID_A).title, 'first');

    assert.deepEqual(normalizeYouTubeLibrary(null), { clips: [] });
    assert.deepEqual(normalizeYouTubeLibrary({ nope: true }), { clips: [] });
});


test('add / has / remove / toggle persist through localStorage', () => {
    assert.deepEqual(listYouTubeClips(), []);
    assert.equal(hasYouTubeClip(ID_A), false);

    addYouTubeClip({ videoId: ID_A, title: 'Alpha' });
    assert.equal(hasYouTubeClip(ID_A), true);
    assert.equal(listYouTubeClips().length, 1);
    assert.ok(store.has(YOUTUBE_LIBRARY_KEY));

    // Re-add refreshes instead of duplicating.
    addYouTubeClip({ videoId: ID_A, title: 'Alpha v2' });
    assert.equal(listYouTubeClips().length, 1);
    assert.equal(listYouTubeClips()[0].title, 'Alpha v2');

    assert.equal(toggleYouTubeClip({ videoId: ID_B }), true);
    assert.equal(hasYouTubeClip(ID_B), true);
    assert.equal(toggleYouTubeClip({ videoId: ID_B }), false);
    assert.equal(hasYouTubeClip(ID_B), false);

    assert.equal(removeYouTubeClip(ID_A), true);
    assert.equal(removeYouTubeClip(ID_A), false);
    assert.deepEqual(loadYouTubeLibrary(), { clips: [] });
});

test('touchYouTubeClip refreshes a saved clip without adding suggestions', () => {
    addYouTubeClip({ videoId: ID_A, title: 'Old title', author: 'Artist' });
    addYouTubeClip({ videoId: ID_B, title: 'Other' });

    const refreshed = touchYouTubeClip({ videoId: ID_A, title: 'New title', author: 'Artist 2' });
    assert.equal(refreshed.title, 'New title');
    assert.equal(refreshed.author, 'Artist 2');
    assert.equal(listYouTubeClips().length, 2, 'no duplicate entry');
    assert.equal(listYouTubeClips()[0].videoId, ID_A, 'refreshed clip sorts as most recent');

    // Unknown clips are left alone: the queue must never evict saved clips.
    assert.equal(touchYouTubeClip({ videoId: '9bZkp7q19f0', title: 'Suggestion' }), null);
    assert.equal(hasYouTubeClip('9bZkp7q19f0'), false);
    assert.equal(touchYouTubeClip('bad'), null);
});

test('corrupt library JSON degrades to an empty library', () => {
    store.set(YOUTUBE_LIBRARY_KEY, '{not json');
    assert.deepEqual(loadYouTubeLibrary(), { clips: [] });

    store.set(YOUTUBE_LIBRARY_KEY, JSON.stringify({ clips: [{ videoId: 'bad' }, { videoId: ID_A }] }));
    assert.deepEqual(loadYouTubeLibrary().clips.map((c) => c.videoId), [ID_A]);
});

test('saveYouTubeLibrary writes normalized data', () => {
    const saved = saveYouTubeLibrary({ clips: [{ videoId: ID_A, title: 'x' }, { videoId: ID_A }] });
    assert.equal(saved.clips.length, 1);
    const raw = JSON.parse(store.get(YOUTUBE_LIBRARY_KEY));
    assert.equal(raw.clips[0].videoId, ID_A);
});


test('fetchYouTubeMeta maps the oEmbed payload', async () => {
    const calls = [];
    const meta = await fetchYouTubeMeta(ID_A, {
        fetchImpl: async (url) => {
            calls.push(String(url));
            return {
                ok: true,
                json: async () => ({
                    title: '  Never Gonna Give You Up  ',
                    author_name: ' Rick ',
                    thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg'
                })
            };
        }
    });
    assert.deepEqual(meta, {
        videoId: ID_A,
        title: 'Never Gonna Give You Up',
        author: 'Rick',
        thumb: 'https://i.ytimg.com/vi/x/hq.jpg'
    });
    assert.match(calls[0], /^https:\/\/www\.youtube\.com\/oembed\?/);
    assert.match(calls[0], /format=json/);
});

test('fetchYouTubeMeta never throws and resolves null on failure', async () => {
    assert.equal(await fetchYouTubeMeta('bad', { fetchImpl: async () => ({ ok: true }) }), null);
    assert.equal(await fetchYouTubeMeta(ID_A, {
        fetchImpl: async () => ({ ok: false, json: async () => ({}) })
    }), null);
    assert.equal(await fetchYouTubeMeta(ID_A, {
        fetchImpl: async () => { throw new Error('offline'); }
    }), null);
    assert.equal(await fetchYouTubeMeta(ID_A, {
        fetchImpl: async () => ({ ok: true, json: async () => ({ title: '' }) })
    }), null);
});

test('fetchYouTubeMeta times out to null instead of hanging', async () => {
    const meta = await fetchYouTubeMeta(ID_A, {
        timeoutMs: 500,
        fetchImpl: () => new Promise(() => {})
    });
    assert.equal(meta, null);
});

test('youtubeClipUrl normalizes clips and ids', () => {
    assert.equal(youtubeClipUrl(ID_A), `https://www.youtube.com/watch?v=${ID_A}`);
    assert.equal(youtubeClipUrl({ videoId: ID_A }), `https://www.youtube.com/watch?v=${ID_A}`);
    assert.equal(youtubeClipUrl('bad'), '');
});
