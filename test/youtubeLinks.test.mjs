/** Unit tests for js/youtube/youtubeLinks.js (pure URL/key helpers). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatYouTubeClock,
    isYouTubeEntry,
    isYouTubeRef,
    normalizeYouTubeId,
    parseYouTubeId,
    youtubeEmbedUrl,
    youtubeEntryConfig,
    youtubeIdFromKey,
    youtubeKey,
    youtubeOEmbedUrl,
    youtubeThumbCandidates,
    youtubeThumbUrl,
    youtubeWatchUrl
} from '../js/youtube/youtubeLinks.js';

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeId accepts every common share/embed shape', () => {
    assert.equal(parseYouTubeId(ID), ID);
    assert.equal(parseYouTubeId(`  ${ID}  `), ID);
    assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYouTubeId(`https://youtube.com/watch?feature=share&v=${ID}`), ID);
    assert.equal(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYouTubeId(`https://music.youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYouTubeId(`https://youtu.be/${ID}?t=30`), ID);
    assert.equal(parseYouTubeId(`youtu.be/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${ID}?autoplay=1`), ID);
    assert.equal(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://www.youtube.com/live/${ID}`), ID);
});

test('parseYouTubeId rejects non-YouTube / malformed input', () => {
    assert.equal(parseYouTubeId(''), '');
    assert.equal(parseYouTubeId(null), '');
    assert.equal(parseYouTubeId('not a link'), '');
    assert.equal(parseYouTubeId('https://vimeo.com/123456789'), '');
    assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=short'), '');
    assert.equal(parseYouTubeId(`https://evil.example/watch?v=${ID}`), '');
    assert.equal(normalizeYouTubeId('https://youtu.be/too-short'), '');
});

test('youtubeKey / youtubeIdFromKey round-trip and reject foreign keys', () => {
    assert.equal(youtubeKey(ID), `youtube:${ID}`);
    assert.equal(youtubeIdFromKey(`youtube:${ID}`), ID);
    assert.equal(youtubeIdFromKey('iptv-org:CNN.us'), '');
    assert.equal(youtubeIdFromKey('youtube:nope'), '');
    assert.equal(youtubeKey('bad'), '');
});

test('persisted entries: kind flag or youtube: key both count', () => {
    assert.equal(isYouTubeEntry({ kind: 'youtube', videoId: ID }), true);
    assert.equal(isYouTubeEntry({ key: `youtube:${ID}` }), true);
    assert.equal(isYouTubeEntry(`youtube:${ID}`), true);
    assert.equal(isYouTubeEntry({ key: 'iptv-org:CNN.us' }), false);
    assert.equal(isYouTubeEntry(null), false);
    assert.equal(isYouTubeRef({ providerId: 'youtube', channelId: ID }), true);
    assert.equal(isYouTubeRef('iptv-org:CNN.us'), false);

    assert.deepEqual(
        youtubeEntryConfig({ kind: 'youtube', videoId: ID, name: 'Clip', startAt: 12 }),
        { videoId: ID, title: 'Clip', startAt: 12 }
    );
    assert.deepEqual(
        youtubeEntryConfig({ key: `youtube:${ID}` }),
        { videoId: ID, title: '', startAt: 0 }
    );
    assert.equal(youtubeEntryConfig({ key: 'iptv-org:CNN.us' }), null);
    assert.equal(youtubeEntryConfig({ kind: 'youtube', videoId: 'nope' }), null);
});

test('embed / watch / thumb / oEmbed URLs are well formed', () => {
    assert.equal(youtubeWatchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
    const embed = new URL(youtubeEmbedUrl(ID, { autoplay: true, start: 42, origin: 'https://tv.local' }));
    assert.equal(embed.origin + embed.pathname, `https://www.youtube.com/embed/${ID}`);
    assert.equal(embed.searchParams.get('enablejsapi'), '1');
    assert.equal(embed.searchParams.get('playsinline'), '1');
    assert.equal(embed.searchParams.get('autoplay'), '1');
    assert.equal(embed.searchParams.get('start'), '42');
    assert.equal(embed.searchParams.get('origin'), 'https://tv.local');
    assert.equal(youtubeEmbedUrl('bad'), '');

    assert.equal(youtubeThumbUrl(ID), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    assert.equal(youtubeThumbUrl(ID, 'maxresdefault'), `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
    assert.equal(youtubeThumbCandidates(ID).length, 3);
    assert.deepEqual(youtubeThumbCandidates('bad'), []);

    const oembed = new URL(youtubeOEmbedUrl(ID));
    assert.equal(oembed.origin + oembed.pathname, 'https://www.youtube.com/oembed');
    assert.equal(oembed.searchParams.get('url'), `https://www.youtube.com/watch?v=${ID}`);
    assert.equal(oembed.searchParams.get('format'), 'json');
});

test('formatYouTubeClock renders m:ss and h:mm:ss', () => {
    assert.equal(formatYouTubeClock(0), '0:00');
    assert.equal(formatYouTubeClock(9), '0:09');
    assert.equal(formatYouTubeClock(75), '1:15');
    assert.equal(formatYouTubeClock(3675), '1:01:15');
    assert.equal(formatYouTubeClock(-4), '0:00');
    assert.equal(formatYouTubeClock('nope'), '0:00');
});
