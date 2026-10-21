/** Unit tests for js/youtube/youtubeQueue.js (deterministic tile queue). */
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
    YOUTUBE_QUEUE_KEY,
    YOUTUBE_HISTORY_KEY,
    YOUTUBE_QUEUE_LIMIT,
    YOUTUBE_HISTORY_LIMIT,
    appendYouTubeRelated,
    buildYouTubeQueue,
    clearYouTubeHistory,
    clearYouTubeQueue,
    listYouTubeHistory,
    loadYouTubeQueue,
    normalizeYouTubeQueue,
    normalizeYouTubeQueueItem,
    queueIndexOf,
    queueItemAt,
    recordYouTubeHistory,
    resolveYouTubeQueueStep,
    retargetYouTubeQueue,
    saveYouTubeQueue,
    selectYouTubeQueueIndex
} = await import('../js/youtube/youtubeQueue.js');

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'M7lc1UVf-VE';
const ID_C = '9bZkp7q19f0';
const ID_D = 'kJQP7kiw5Fk';
const ID_E = '3JZ_D3ELwOQ';

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

beforeEach(() => {
    store.clear();
});

test('normalizeYouTubeQueueItem rejects junk and canonicalises fields', () => {
    assert.equal(normalizeYouTubeQueueItem(null), null);
    assert.equal(normalizeYouTubeQueueItem({ videoId: 'nope' }), null);

    assert.deepEqual(normalizeYouTubeQueueItem({ videoId: ID_A }), {
        videoId: ID_A,
        title: `YouTube ${ID_A}`,
        thumb: thumb(ID_A),
        author: '',
        source: 'related'
    });

    const full = normalizeYouTubeQueueItem({
        videoId: ID_B,
        title: '  A clip  ',
        thumb: 'https://piped.example/proxy.jpg',
        author: '  Uploader  ',
        source: 'library'
    });
    assert.equal(full.title, 'A clip');
    assert.equal(full.author, 'Uploader');
    assert.equal(full.source, 'library');
    assert.equal(full.thumb, thumb(ID_B), 'provider thumbnails are never trusted');

    // Unknown sources fall back to `related`; uploaderName is accepted too.
    const piped = normalizeYouTubeQueueItem({ id: ID_C, uploaderName: 'Piped Author', source: 'bogus' });
    assert.equal(piped.source, 'related');
    assert.equal(piped.author, 'Piped Author');
});

test('normalizeYouTubeQueue dedupes, keeps the index on its clip, and survives corruption', () => {
    const queue = normalizeYouTubeQueue({
        videoId: ID_B,
        index: 0,
        items: [
            { videoId: ID_A },
            { videoId: ID_B },
            { videoId: ID_A, title: 'dup' },
            { videoId: ID_C }
        ]
    });
    assert.deepEqual(queue.items.map((i) => i.videoId), [ID_A, ID_B, ID_C]);
    assert.equal(queue.index, 1, 'index follows the recorded current clip, not the raw index');

    // Unknown current id degrades to the clamped raw index.
    const clamped = normalizeYouTubeQueue({ videoId: 'bad', index: 9, items: [{ videoId: ID_A }] });
    assert.equal(clamped.index, 0);
    assert.equal(clamped.videoId, ID_A);

    assert.deepEqual(normalizeYouTubeQueue(null), { videoId: '', index: -1, items: [], updatedAt: 0 });
    assert.deepEqual(normalizeYouTubeQueue({ items: 'nope' }), { videoId: '', index: -1, items: [], updatedAt: 0 });
});

test('buildYouTubeQueue orders current → same author → library → related → history', () => {
    const queue = buildYouTubeQueue({
        current: { videoId: ID_A, title: 'Current', author: 'Same Channel' },
        library: [
            { videoId: ID_A, title: 'Current duplicate' },
            { videoId: ID_B, title: 'Same author', author: 'same channel' },
            { videoId: ID_C, title: 'Other library', author: 'Elsewhere' }
        ],
        related: [{ videoId: ID_C }, { videoId: ID_D, title: 'Related' }],
        history: [{ videoId: ID_E }]
    });

    assert.deepEqual(queue.items.map((i) => i.videoId), [ID_A, ID_B, ID_C, ID_D, ID_E]);
    assert.deepEqual(queue.items.map((i) => i.source), ['current', 'author', 'library', 'related', 'history']);
    assert.equal(queue.index, 0);
    assert.equal(queue.videoId, ID_A);

    // Invalid current clip → empty queue (nothing to navigate from).
    assert.deepEqual(buildYouTubeQueue({ current: { videoId: 'bad' } }), {
        videoId: '', index: -1, items: [], updatedAt: 0
    });
});

test('appendYouTubeRelated never moves existing entries or the live index', () => {
    const base = buildYouTubeQueue({
        current: { videoId: ID_A },
        library: [{ videoId: ID_B }]
    });
    const moved = selectYouTubeQueueIndex(base, 1);

    const grown = appendYouTubeRelated(moved, [
        { videoId: ID_B, title: 'already queued' },
        { videoId: ID_C, title: 'New one' },
        { videoId: ID_D, title: 'Another' }
    ]);

    assert.equal(grown.index, 1);
    assert.equal(grown.videoId, ID_B);
    assert.deepEqual(grown.items.map((i) => i.videoId), [ID_A, ID_B, ID_C, ID_D]);
    assert.equal(grown.items[2].source, 'related');

    // Appending an empty/absent payload is a no-op (negative lookups).
    for (const empty of [[], null, undefined]) {
        const unchanged = appendYouTubeRelated(moved, empty);
        assert.deepEqual(unchanged.items.map((i) => i.videoId), grown.items.slice(0, 2).map((i) => i.videoId));
        assert.equal(unchanged.index, 1);
        assert.equal(unchanged.videoId, ID_B);
    }
});

test('appendYouTubeRelated caps the tail only, never items behind the index', () => {
    const items = Array.from({ length: YOUTUBE_QUEUE_LIMIT }, (_, i) => ({
        videoId: `vid${String(i).padStart(8, '0')}`
    }));
    const queue = normalizeYouTubeQueue({ videoId: items[4].videoId, items });
    assert.equal(queue.index, 4);

    const grown = appendYouTubeRelated(queue, [{ videoId: ID_A }, { videoId: ID_B }]);
    assert.equal(grown.items.length, YOUTUBE_QUEUE_LIMIT);
    assert.deepEqual(grown.items.slice(0, 5).map((i) => i.videoId), items.slice(0, 5).map((i) => i.videoId));
    assert.equal(grown.index, 4);
    assert.deepEqual(grown.items.slice(-2).map((i) => i.videoId), [ID_A, ID_B]);
});

test('step / select / retarget keep the cursor inside the queue', () => {
    const queue = buildYouTubeQueue({
        current: { videoId: ID_A },
        library: [{ videoId: ID_B }, { videoId: ID_C }]
    });

    assert.deepEqual(resolveYouTubeQueueStep(queue, 1), { index: 1, item: queue.items[1] });
    assert.equal(resolveYouTubeQueueStep(queue, -1), null, 'no previous at the head');
    assert.equal(resolveYouTubeQueueStep(queue, 5), null, 'no wrap past the tail');
    assert.equal(resolveYouTubeQueueStep(queue, 0).index, 0);

    const last = selectYouTubeQueueIndex(queue, 2);
    assert.equal(last.videoId, ID_C);
    assert.equal(selectYouTubeQueueIndex(queue, 99).index, 0, 'out-of-range keeps the cursor');

    assert.equal(queueIndexOf(queue, ID_B), 1);
    assert.equal(queueIndexOf(queue, 'bad'), -1);
    assert.equal(queueItemAt(queue, 1).videoId, ID_B);
    assert.equal(queueItemAt(queue, -1), null);

    // Already-queued clip → jump to it; brand new clip → prepend and reset.
    const jumped = retargetYouTubeQueue(queue, { videoId: ID_C });
    assert.equal(jumped.index, 2);
    assert.equal(jumped.items.length, 3);

    const fresh = retargetYouTubeQueue(queue, { videoId: ID_D, title: 'Fresh' });
    assert.equal(fresh.index, 0);
    assert.equal(fresh.videoId, ID_D);
    assert.deepEqual(fresh.items.slice(0, 2).map((i) => i.videoId), [ID_D, ID_A]);
});

test('queue storage round-trips, degrades on junk, and clears', () => {
    assert.deepEqual(loadYouTubeQueue(), { videoId: '', index: -1, items: [], updatedAt: 0 });

    const queue = buildYouTubeQueue({ current: { videoId: ID_A }, library: [{ videoId: ID_B }] });
    const saved = saveYouTubeQueue(queue);
    assert.ok(store.has(YOUTUBE_QUEUE_KEY));
    assert.deepEqual(loadYouTubeQueue().items.map((i) => i.videoId), [ID_A, ID_B]);
    assert.equal(saved.videoId, ID_A);

    store.set(YOUTUBE_QUEUE_KEY, '{not json');
    assert.deepEqual(loadYouTubeQueue(), { videoId: '', index: -1, items: [], updatedAt: 0 });

    clearYouTubeQueue();
    assert.equal(store.has(YOUTUBE_QUEUE_KEY), false);
});

test('watch history moves repeats to the front, caps, and clears', () => {
    assert.deepEqual(listYouTubeHistory(), []);

    recordYouTubeHistory({ videoId: ID_A, title: 'A', author: 'One' });
    recordYouTubeHistory({ videoId: ID_B, title: 'B' });
    recordYouTubeHistory({ videoId: ID_A, title: 'A v2' });

    const history = listYouTubeHistory();
    assert.deepEqual(history.map((i) => i.videoId), [ID_A, ID_B]);
    assert.equal(history[0].title, 'A v2');
    assert.equal(history[0].author, 'One');
    assert.ok(store.has(YOUTUBE_HISTORY_KEY));

    for (let i = 0; i < YOUTUBE_HISTORY_LIMIT + 6; i += 1) {
        recordYouTubeHistory({ videoId: `hist${String(i).padStart(7, '0')}` });
    }
    assert.equal(listYouTubeHistory().length, YOUTUBE_HISTORY_LIMIT);

    clearYouTubeHistory();
    assert.deepEqual(listYouTubeHistory(), []);
    assert.equal(recordYouTubeHistory({ videoId: 'bad' }), null);
});
