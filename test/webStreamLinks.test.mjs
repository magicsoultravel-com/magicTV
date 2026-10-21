/** Web Video link/channel helpers (pure). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyProxyTemplate,
    classifyStreamUrl,
    hostLabel,
    isDirectMediaUrl,
    isWebStreamEntry,
    normalizeProxyTemplate,
    parsePageUrl,
    pickBestStream,
    sanitizeStreamUrl,
    webStreamEntryConfig,
    webStreamStatusMessage,
    webstreamChannel,
    webstreamChannelId,
    webstreamKey
} from '../js/webstream/webStreamLinks.js';

test('parsePageUrl adds https, drops hashes, rejects non-web schemes', () => {
    assert.equal(parsePageUrl('example.com/watch?v=1#t=5'), 'https://example.com/watch?v=1');
    assert.equal(parsePageUrl('  https://a.tv/x  '), 'https://a.tv/x');
    assert.equal(parsePageUrl('javascript:alert(1)'), '');
    assert.equal(parsePageUrl('ftp://a.tv/x'), '');
    assert.equal(parsePageUrl('localhost'), '');
    assert.equal(parsePageUrl(''), '');
});

test('sanitizeStreamUrl unescapes JSON/HTML URLs and rejects data/blob', () => {
    assert.equal(
        sanitizeStreamUrl('https:\\/\\/cdn.tv\\/live.m3u8?x=1&amp;y=2'),
        'https://cdn.tv/live.m3u8?x=1&y=2'
    );
    assert.equal(sanitizeStreamUrl('data:video/mp4;base64,AAAA'), '');
    assert.equal(sanitizeStreamUrl('blob:https://a.tv/123'), '');
    assert.equal(sanitizeStreamUrl('not a url'), '');
});

test('classifyStreamUrl maps extensions and query hints', () => {
    assert.equal(classifyStreamUrl('https://x/master.m3u8'), 'hls');
    assert.equal(classifyStreamUrl('https://x/clip.mp4?token=1'), 'video');
    assert.equal(classifyStreamUrl('https://x/clip.webm'), 'video');
    assert.equal(classifyStreamUrl('https://x/page.html'), '');
    assert.equal(classifyStreamUrl('https://x/live?format=.m3u8'), 'hls');
    assert.equal(classifyStreamUrl('https://x/manifest.mpd'), '');
    assert.equal(isDirectMediaUrl('https://x/a.m3u8'), true);
});

test('webstreamKey/channel use a stable page-derived id', () => {
    const page = 'https://site.tv/watch/42';
    const id = webstreamChannelId(page);
    assert.match(id, /^ws_[a-z0-9]+$/);
    assert.equal(webstreamKey(page), `webstream:${id}`);
    assert.equal(webstreamChannelId(page, 'https://cdn.tv/a.m3u8'), id, 'stream URL does not change the id');

    const channel = webstreamChannel({ pageUrl: page, streamUrl: 'https://cdn.tv/a.m3u8', kind: 'hls' });
    assert.equal(channel.providerId, 'webstream');
    assert.equal(channel.channelId, id);
    assert.equal(channel.channeluuid, `webstream:${id}`);
    assert.equal(channel.url_resolved, 'https://cdn.tv/a.m3u8');
    assert.equal(channel.streamKind, 'hls');
    assert.equal(channel.webStreamPageUrl, page);
    assert.equal(channel.name, 'site.tv');
});

test('webstreamChannel keeps proxy hints only when proxied', () => {
    const tpl = 'https://proxy.tv/?url={url}';
    const plain = webstreamChannel({ streamUrl: 'https://cdn.tv/a.m3u8' });
    assert.equal(plain.proxyTemplate, undefined);
    const proxied = webstreamChannel({
        pageUrl: 'https://site.tv/x',
        streamUrl: 'https://cdn.tv/a.m3u8',
        proxyTemplate: tpl,
        proxied: true,
        kind: 'hls'
    });
    assert.equal(proxied.proxyTemplate, tpl);
    assert.equal(proxied.name, 'site.tv');
});

test('proxy template validation and substitution', () => {
    assert.equal(normalizeProxyTemplate('https://p.tv/?url={url}'), 'https://p.tv/?url={url}');
    assert.equal(normalizeProxyTemplate('https://p.tv/?u={url_encoded}'), 'https://p.tv/?u={url_encoded}');
    assert.equal(normalizeProxyTemplate('https://p.tv/?url='), '');
    assert.equal(normalizeProxyTemplate('/relative?url={url}'), '');
    assert.equal(normalizeProxyTemplate(''), '');
    assert.equal(
        applyProxyTemplate('https://p.tv/?url={url}', 'https://cdn.tv/a.m3u8?x=1&y=2'),
        'https://p.tv/?url=https://cdn.tv/a.m3u8?x=1&y=2'
    );
    assert.equal(
        applyProxyTemplate('https://p.tv/?u={url_encoded}', 'https://cdn.tv/a.m3u8'),
        `https://p.tv/?u=${encodeURIComponent('https://cdn.tv/a.m3u8')}`
    );
});

test('pickBestStream prefers HLS masters and skips segment noise', () => {
    const best = pickBestStream([
        'https://cdn.tv/seg-1.m4s.mp4',
        'https://cdn.tv/clip.mp4',
        'https://cdn.tv/master.m3u8'
    ]);
    assert.equal(best.kind, 'hls');
    assert.equal(best.url, 'https://cdn.tv/master.m3u8');
    assert.equal(pickBestStream([]), null);
    assert.equal(pickBestStream(['https://cdn.tv/page.html']), null);
});

test('entry helpers round-trip a saved Web Video slot', () => {
    const page = 'https://site.tv/watch/9';
    const stream = 'https://cdn.tv/live.m3u8';
    const entry = {
        kind: 'webstream',
        pageUrl: page,
        streamUrl: stream,
        mode: 'media',
        name: 'Site',
        muted: true,
        volume: 0.4
    };
    assert.equal(isWebStreamEntry(entry), true);
    assert.equal(isWebStreamEntry({ kind: 'youtube' }), false);
    const config = webStreamEntryConfig(entry);
    assert.equal(config.pageUrl, page);
    assert.equal(config.streamUrl, stream);
    assert.equal(config.kind, 'hls');
    assert.equal(config.name, 'Site');
    assert.equal(config.channelId, webstreamChannelId(page, stream));
    assert.equal(config.shield, '', 'no per-page shield until one is chosen');
    assert.equal(webStreamEntryConfig({ ...entry, shield: 'strict' }).shield, 'strict');
    assert.equal(webStreamEntryConfig({ ...entry, shield: 'maximum' }).shield, '', 'junk is dropped');
    assert.equal(webStreamEntryConfig({ kind: 'webstream' }), null);
});

test('hostLabel strips www and status messages exist for every rung', () => {
    assert.equal(hostLabel('https://www.bbc.co.uk/iplayer'), 'bbc.co.uk');
    for (const status of ['embed', 'needs-sniff', 'blocked', 'drm', 'unsupported', 'invalid']) {
        assert.ok(webStreamStatusMessage(status).length > 10, status);
    }
    assert.equal(webStreamStatusMessage('resolved'), '');
});
