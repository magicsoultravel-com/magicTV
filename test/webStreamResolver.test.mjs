/** Web Video resolver ladder (pure extraction + fetch behaviour). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlaybackSpec,
    detectDrm,
    extractFrameCandidates,
    extractStreamCandidates,
    fetchPageHtml,
    resolveWebStream
} from '../js/webstream/webStreamResolver.js';

const PAGE = 'https://site.tv/watch/42';

function htmlResponse(html, { ok = true, status = 200 } = {}) {
    return { ok, status, text: async () => html };
}

function fakeFetch(handler) {
    const calls = [];
    const fn = async (url) => {
        calls.push(url);
        return handler(url, calls.length);
    };
    fn.calls = calls;
    return fn;
}

test('extractStreamCandidates finds escaped JSON, relative sources and og:video', () => {
    const html = `
        <meta property="og:video" content="https://cdn.tv/og.mp4">
        <video><source src="/media/live/master.m3u8"></video>
        <script>window.__DATA__ = {"hls":"https:\\/\\/cdn.tv\\/escaped\\/index.m3u8?token=1&amp;b=2"};</script>
    `;
    const found = extractStreamCandidates(html, PAGE);
    const urls = found.map((c) => c.url);
    assert.ok(urls.includes('https://site.tv/media/live/master.m3u8'), 'relative src resolved');
    assert.ok(urls.includes('https://cdn.tv/og.mp4'));
    assert.ok(urls.includes('https://cdn.tv/escaped/index.m3u8?token=1&b=2'));
    assert.equal(found.find((c) => c.url.endsWith('.m3u8')).kind, 'hls');
});

test('extractFrameCandidates + detectDrm', () => {
    const html = '<iframe src="https://player.tv/embed/1"></iframe><iframe src="/local/player"></iframe>';
    assert.deepEqual(extractFrameCandidates(html, PAGE), [
        'https://player.tv/embed/1',
        'https://site.tv/local/player'
    ]);
    assert.equal(detectDrm('<script src="widevine.js"></script>'), true);
    assert.equal(detectDrm('<video src="a.mp4"></video>'), false);
});

test('fetchPageHtml omits credentials and reports network vs http failures', async () => {
    let seenOptions = null;
    const ok = await fetchPageHtml('https://a.tv', {
        fetchImpl: async (url, options) => {
            seenOptions = options;
            return htmlResponse('hi');
        }
    });
    assert.equal(ok.ok, true);
    assert.equal(seenOptions.credentials, 'omit');

    const denied = await fetchPageHtml('https://a.tv', {
        fetchImpl: async () => htmlResponse('', { ok: false, status: 403 })
    });
    assert.equal(denied.reason, 'http');

    const blocked = await fetchPageHtml('https://a.tv', {
        fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
    });
    assert.equal(blocked.reason, 'network');
});

test('direct media URL resolves without any network request', async () => {
    const fetchImpl = fakeFetch(() => { throw new Error('should not fetch'); });
    const result = await resolveWebStream('https://cdn.tv/live.m3u8', { fetchImpl });
    assert.equal(result.status, 'resolved');
    assert.equal(result.url, 'https://cdn.tv/live.m3u8');
    assert.equal(result.kind, 'hls');
    assert.equal(fetchImpl.calls.length, 0);
});

test('page scrape resolves the best stream (rung 1)', async () => {
    const fetchImpl = fakeFetch(() => htmlResponse(`
        <video src="https://cdn.tv/low.mp4"></video>
        <script>var src = "https://cdn.tv/master.m3u8";</script>
    `));
    const result = await resolveWebStream(PAGE, { fetchImpl });
    assert.equal(result.status, 'resolved');
    assert.equal(result.url, 'https://cdn.tv/master.m3u8');
    assert.equal(result.pageUrl, PAGE);
    assert.equal(result.viaProxy, false);
    assert.equal(fetchImpl.calls[0], PAGE);
});

test('CORS failure falls back to the proxy template (rung 1b)', async () => {
    const tpl = 'https://proxy.tv/?url={url}';
    const fetchImpl = fakeFetch((url) => {
        if (url.startsWith('https://proxy.tv/')) {
            return htmlResponse('<video src="https://cdn.tv/proxied.m3u8"></video>');
        }
        throw new TypeError('Failed to fetch');
    });
    const result = await resolveWebStream(PAGE, { fetchImpl, proxyTemplate: tpl });
    assert.equal(result.status, 'resolved');
    assert.equal(result.url, 'https://cdn.tv/proxied.m3u8');
    assert.equal(result.viaProxy, true);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1], `https://proxy.tv/?url=${PAGE}`);
});

test('no media but an iframe resolves to embed (rung 4)', async () => {
    const fetchImpl = fakeFetch(() => htmlResponse('<iframe src="https://player.tv/embed/9"></iframe>'));
    const result = await resolveWebStream(PAGE, { fetchImpl });
    assert.equal(result.status, 'embed');
    assert.deepEqual(result.frames, ['https://player.tv/embed/9']);
    assert.match(result.message, /embed/i);
});

test('DRM pages are refused', async () => {
    const fetchImpl = fakeFetch(() => htmlResponse('<script>var drm = "widevine";</script>'));
    const result = await resolveWebStream(PAGE, { fetchImpl });
    assert.equal(result.status, 'drm');
    assert.match(result.message, /DRM/i);
});

test('unreadable pages ask for the sniffer; HTTP denials report blocked', async () => {
    const cors = await resolveWebStream(PAGE, {
        fetchImpl: fakeFetch(() => { throw new TypeError('Failed to fetch'); })
    });
    assert.equal(cors.status, 'needs-sniff');

    const denied = await resolveWebStream(PAGE, {
        fetchImpl: fakeFetch(() => htmlResponse('', { ok: false, status: 403 }))
    });
    assert.equal(denied.status, 'blocked');
});

test('invalid / unsupported input never fetches', async () => {
    const fetchImpl = fakeFetch(() => { throw new Error('should not fetch'); });
    const invalid = await resolveWebStream('not a url', { fetchImpl });
    assert.equal(invalid.status, 'invalid');
    const unsupported = await resolveWebStream('https://cdn.tv/manifest.mpd', { fetchImpl });
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(fetchImpl.calls.length, 0);
});

test('buildPlaybackSpec keeps the HLS hint when proxied', () => {
    const tpl = 'https://proxy.tv/?url={url}';
    const direct = buildPlaybackSpec(
        { pageUrl: PAGE, url: 'https://cdn.tv/a.m3u8', kind: 'hls' },
        { title: 'Site' }
    );
    assert.equal(direct.streamUrl, 'https://cdn.tv/a.m3u8');
    assert.equal(direct.kind, 'hls');
    assert.equal(direct.proxied, false);

    const proxied = buildPlaybackSpec(
        { pageUrl: PAGE, url: 'https://cdn.tv/a.m3u8', kind: 'hls' },
        { proxyTemplate: tpl, useProxy: true, title: 'Site' }
    );
    assert.equal(proxied.streamUrl, 'https://proxy.tv/?url=https://cdn.tv/a.m3u8');
    assert.equal(proxied.proxyTemplate, tpl);
    assert.equal(proxied.kind, 'hls', 'proxy URL does not end in .m3u8 — hint must survive');
    assert.equal(buildPlaybackSpec({ url: '' }), null);
});

