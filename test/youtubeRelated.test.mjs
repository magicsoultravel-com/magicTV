/** Unit tests for js/youtube/youtubeRelated.js (Piped → Invidious chain). */
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
    DEFAULT_YOUTUBE_INVIDIOUS_INSTANCE,
    RELATED_CACHE_TTL_MS,
    RELATED_COOLDOWN_MS,
    RELATED_NEGATIVE_TTL_MS,
    YOUTUBE_RELATED_HEALTH_KEY,
    clearYouTubeRelatedCache,
    clearYouTubeRelatedHealth,
    fetchYouTubeRelated,
    normalizeInvidiousInstance,
    normalizeRelatedProvider,
    parseInvidiousRelated,
    parsePipedRelated,
    readYouTubeRelatedHealth,
    relatedHostCooldownRemaining,
    youtubeRelatedAttempts
} = await import('../js/youtube/youtubeRelated.js');

const ID = 'dQw4w9WgXcQ';
const ID_B = 'M7lc1UVf-VE';
const ID_C = '9bZkp7q19f0';
const ID_D = 'kJQP7kiw5Fk';
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Trimmed from a live api.piped.private.coffee `/streams/{id}` payload. */
const PIPED_PAYLOAD = {
    title: 'Never Gonna Give You Up',
    relatedStreams: [
        {
            url: `/watch?v=${ID}`,
            title: 'Rick Astley - Never Gonna Give You Up',
            uploaderName: 'Rick Astley',
            type: 'stream',
            duration: 213
        },
        {
            url: `/watch?v=${ID_C}`,
            title: 'PSY - GANGNAM STYLE',
            uploaderName: 'officialpsy',
            type: 'stream',
            duration: 253
        },
        { url: '/channel/UCuAXFkgsw1L7xaCfnd5JJOw', title: 'A channel', type: 'channel' },
        { url: `/watch?v=${ID}`, title: 'Duplicate', uploaderName: 'Rick Astley', type: 'stream' },
        { url: '/watch?v=short', title: 'Junk', type: 'stream' }
    ]
};

/** Trimmed from a live invidious.f5.si `/api/v1/videos/{id}` payload. */
const INVIDIOUS_PAYLOAD = {
    title: 'Never Gonna Give You Up',
    recommendedVideos: [
        { videoId: ID_B, title: 'Clip B', author: 'Channel B', authorId: 'UCb', lengthSeconds: 100 },
        { videoId: ID_D, title: 'Clip D', author: 'Channel D', lengthSeconds: 200 },
        { videoId: 'bad', title: 'Junk' },
        { videoId: ID_B, title: 'Duplicate' }
    ]
};

const okJson = (payload) => async () => ({ ok: true, json: async () => payload });

beforeEach(() => {
    store.clear();
    clearYouTubeRelatedCache();
    clearYouTubeRelatedHealth();
});

test('parsePipedRelated keeps playable streams only and canonicalises thumbs', () => {
    const items = parsePipedRelated(PIPED_PAYLOAD);
    assert.deepEqual(items.map((item) => item.videoId), [ID, ID_C]);
    assert.equal(items[0].title, 'Rick Astley - Never Gonna Give You Up');
    assert.equal(items[0].author, 'Rick Astley');
    assert.equal(items[0].thumb, thumb(ID), 'never the instance proxy URL');
    assert.equal(items[0].source, 'related');

    assert.deepEqual(parsePipedRelated(null), []);
    assert.deepEqual(parsePipedRelated({ relatedStreams: 'nope' }), []);
});

test('parseInvidiousRelated reads recommendedVideos and drops duplicates', () => {
    const items = parseInvidiousRelated(INVIDIOUS_PAYLOAD);
    assert.deepEqual(items.map((item) => item.videoId), [ID_B, ID_D]);
    assert.equal(items[0].title, 'Clip B');
    assert.equal(items[0].author, 'Channel B');
    assert.equal(items[1].thumb, thumb(ID_D));

    assert.deepEqual(parseInvidiousRelated({}), []);
    assert.deepEqual(parseInvidiousRelated(null), []);
});

test('provider and instance inputs normalize leniently', () => {
    assert.equal(normalizeRelatedProvider('PIPED'), 'piped');
    assert.equal(normalizeRelatedProvider('invidious'), 'invidious');
    assert.equal(normalizeRelatedProvider('nonsense'), 'auto');
    assert.equal(normalizeRelatedProvider(null), 'auto');

    assert.equal(normalizeInvidiousInstance('invidious.example'), 'https://invidious.example');
    assert.equal(normalizeInvidiousInstance('https://invidious.example/'), 'https://invidious.example');
    assert.equal(normalizeInvidiousInstance('www.invidious.example/api/v1'), 'https://invidious.example');
    assert.equal(normalizeInvidiousInstance(''), '');
    assert.equal(normalizeInvidiousInstance('   '), '');
});

test('attempt order is Piped → Invidious and honours the provider filter', () => {
    const auto = youtubeRelatedAttempts(ID, {
        pipedHosts: ['api.piped.private.coffee', 'pipedapi.ducks.party'],
        invidiousInstance: 'https://invidious.test',
        health: { hosts: {} }
    });
    assert.deepEqual(auto.map((a) => a.provider), ['piped', 'piped', 'invidious']);
    assert.equal(auto[0].url, `https://api.piped.private.coffee/streams/${ID}`);
    assert.equal(auto[1].url, `https://pipedapi.ducks.party/streams/${ID}`);
    assert.equal(auto[2].url, `https://invidious.test/api/v1/videos/${ID}`);
    assert.equal(auto[2].host, 'invidious.test');

    const pipedOnly = youtubeRelatedAttempts(ID, { provider: 'piped', health: { hosts: {} } });
    assert.deepEqual(pipedOnly.map((a) => a.provider), ['piped', 'piped']);

    const invidiousOnly = youtubeRelatedAttempts(ID, { provider: 'invidious', health: { hosts: {} } });
    assert.equal(invidiousOnly.length, 1);
    assert.equal(invidiousOnly[0].provider, 'invidious');
    assert.equal(invidiousOnly[0].url, `${DEFAULT_YOUTUBE_INVIDIOUS_INSTANCE}/api/v1/videos/${ID}`);

    assert.deepEqual(youtubeRelatedAttempts('bad'), []);
});

test('cooling hosts are demoted, never dropped, and recover after the cooldown', () => {
    const now = 1_000_000;
    const health = {
        hosts: {
            'api.piped.private.coffee': { fails: 2, cooldownUntil: now + RELATED_COOLDOWN_MS, lastOkAt: 0 }
        }
    };
    const attempts = youtubeRelatedAttempts(ID, {
        pipedHosts: ['api.piped.private.coffee', 'pipedapi.ducks.party'],
        invidiousInstance: 'https://invidious.test',
        health,
        now: () => now
    });
    assert.deepEqual(attempts.map((a) => a.host),
        ['pipedapi.ducks.party', 'invidious.test', 'api.piped.private.coffee']);

    const later = youtubeRelatedAttempts(ID, {
        pipedHosts: ['api.piped.private.coffee', 'pipedapi.ducks.party'],
        invidiousInstance: 'https://invidious.test',
        health,
        now: () => now + RELATED_COOLDOWN_MS + 1
    });
    assert.equal(later[0].host, 'api.piped.private.coffee');
});

test('host health is persisted and parks a flaky host after two failures', async () => {
    const now = 5_000_000;
    const clock = () => now;
    const failing = async () => { throw new Error('offline'); };

    const first = await fetchYouTubeRelated(ID_B, {
        provider: 'piped',
        pipedHosts: ['api.piped.private.coffee'],
        fetchImpl: failing,
        timeoutMs: 500,
        now: clock
    });
    assert.deepEqual(first.items, []);
    assert.equal(readYouTubeRelatedHealth().hosts['api.piped.private.coffee'].fails, 1);
    assert.equal(relatedHostCooldownRemaining('api.piped.private.coffee', now), 0);

    await fetchYouTubeRelated(ID_C, {
        provider: 'piped',
        pipedHosts: ['api.piped.private.coffee'],
        fetchImpl: failing,
        timeoutMs: 500,
        now: clock
    });
    assert.equal(readYouTubeRelatedHealth().hosts['api.piped.private.coffee'].fails, 2);
    assert.equal(relatedHostCooldownRemaining('api.piped.private.coffee', now), RELATED_COOLDOWN_MS);
    assert.ok(store.has(YOUTUBE_RELATED_HEALTH_KEY));

    // One success clears the cooldown again.
    await fetchYouTubeRelated(ID_D, {
        provider: 'piped',
        pipedHosts: ['api.piped.private.coffee'],
        fetchImpl: okJson(PIPED_PAYLOAD),
        now: clock
    });
    assert.equal(readYouTubeRelatedHealth().hosts['api.piped.private.coffee'].fails, 0);
    assert.equal(relatedHostCooldownRemaining('api.piped.private.coffee', now), 0);
});

test('fetchYouTubeRelated returns parsed Piped items and reports the source', async () => {
    const calls = [];
    const result = await fetchYouTubeRelated(ID, {
        provider: 'piped',
        pipedHosts: ['api.piped.private.coffee'],
        fetchImpl: async (url) => {
            calls.push(String(url));
            return { ok: true, json: async () => PIPED_PAYLOAD };
        }
    });
    assert.equal(result.provider, 'piped');
    assert.equal(result.host, 'api.piped.private.coffee');
    assert.equal(result.videoId, ID);
    assert.deepEqual(result.items.map((item) => item.videoId), [ID, ID_C]);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/api\.piped\.private\.coffee\/streams\//);
});

test('fetchYouTubeRelated falls back to the next host, then Invidious', async () => {
    const calls = [];
    const result = await fetchYouTubeRelated(ID_C, {
        pipedHosts: ['dead.example', 'alsodead.example'],
        invidiousInstance: 'https://invidious.test',
        fetchImpl: async (url) => {
            calls.push(String(url));
            if (String(url).includes('invidious.test')) {
                return { ok: true, json: async () => INVIDIOUS_PAYLOAD };
            }
            return { ok: false, json: async () => ({}) };
        }
    });
    assert.deepEqual(calls, [
        `https://dead.example/streams/${ID_C}`,
        `https://alsodead.example/streams/${ID_C}`,
        `https://invidious.test/api/v1/videos/${ID_C}`
    ]);
    assert.equal(result.provider, 'invidious');
    assert.equal(result.host, 'invidious.test');
    assert.deepEqual(result.items.map((item) => item.videoId), [ID_B, ID_D]);
});

test('fetchYouTubeRelated never throws and caches hits and misses', async () => {
    const now = 10_000_000;
    let fetches = 0;
    const counting = async () => {
        fetches += 1;
        return { ok: true, json: async () => PIPED_PAYLOAD };
    };
    const opts = {
        provider: 'piped',
        pipedHosts: ['cache.example'],
        fetchImpl: counting,
        now: () => now
    };

    const first = await fetchYouTubeRelated(ID_D, opts);
    assert.equal(fetches, 1);
    assert.ok(first.items.length > 0);

    // Cache hit: the fetch impl would throw if it ran again.
    const cached = await fetchYouTubeRelated(ID_D, {
        ...opts,
        fetchImpl: async () => { throw new Error('boom'); }
    });
    assert.deepEqual(cached.items.map((item) => item.videoId), first.items.map((item) => item.videoId));
    assert.equal(fetches, 1);

    // Expired positive entry → refetch.
    await fetchYouTubeRelated(ID_D, { ...opts, now: () => now + RELATED_CACHE_TTL_MS + 1 });
    assert.equal(fetches, 2);

    // Negative entries live 15 minutes, then the chain runs again.
    let misses = 0;
    const miss = async () => {
        misses += 1;
        return { ok: false, json: async () => ({}) };
    };
    const missOpts = {
        provider: 'piped',
        pipedHosts: ['miss.example'],
        fetchImpl: miss,
        now: () => now
    };
    assert.deepEqual((await fetchYouTubeRelated(ID, missOpts)).items, []);
    assert.deepEqual((await fetchYouTubeRelated(ID, missOpts)).items, []);
    assert.equal(misses, 1, 'negative cache absorbed the second lookup');
    await fetchYouTubeRelated(ID, { ...missOpts, now: () => now + RELATED_NEGATIVE_TTL_MS + 1 });
    assert.equal(misses, 2);
});

test('concurrent lookups share one request (in-flight de-dupe)', async () => {
    let fetches = 0;
    const slow = async () => {
        fetches += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, json: async () => PIPED_PAYLOAD };
    };
    const opts = { provider: 'piped', pipedHosts: ['dedupe.example'], fetchImpl: slow };
    const [a, b] = await Promise.all([
        fetchYouTubeRelated(ID_B, opts),
        fetchYouTubeRelated(ID_B, opts)
    ]);
    assert.equal(fetches, 1);
    assert.deepEqual(a.items.map((i) => i.videoId), b.items.map((i) => i.videoId));
});

test('a hanging provider times out to an empty result instead of stalling', async () => {
    const started = Date.now();
    const result = await fetchYouTubeRelated(ID_B, {
        provider: 'piped',
        pipedHosts: ['hang.example'],
        fetchImpl: () => new Promise(() => {}),
        timeoutMs: 500,
        cache: false
    });
    assert.deepEqual(result.items, []);
    assert.ok(Date.now() - started < 3000, 'bounded by the request timeout');
});

