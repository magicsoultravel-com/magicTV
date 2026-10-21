/** Sniffer bookmarklet + postMessage protocol (DOM stubbed). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let listeners;
before(() => {
    listeners = new Map();
    globalThis.window = {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type) || [];
            const index = list.indexOf(fn);
            if (index >= 0) list.splice(index, 1);
        }
    };
});

const {
    SNIFF_MESSAGE_TYPE,
    buildSnifferBookmarklet,
    snifferSource,
    lastSniffReport,
    onSniffReport,
    openSniffTarget,
    parseSniffMessage,
    parseSniffText
} = await import('../js/webstream/webStreamSniffer.js');

test('bookmarklet is a javascript: URL that reads network entries and posts back', () => {
    const url = buildSnifferBookmarklet();
    assert.match(url, /^javascript:/);
    const code = decodeURIComponent(url.slice('javascript:'.length));
    assert.match(code, /performance\.getEntriesByType\('resource'\)/);
    assert.match(code, /querySelectorAll\('video,audio,source'\)/);
    assert.match(code, /postMessage/);
    assert.match(code, /magictv:webstream-sniff/);
    assert.match(code, /\.m3u8/);
    assert.ok(snifferSource().includes('postMessage'));

});

test('parseSniffMessage validates type/version and filters non-media URLs', () => {
    const report = parseSniffMessage({
        type: SNIFF_MESSAGE_TYPE,
        version: 1,
        pageUrl: 'https://site.tv/watch',
        title: ' A page ',
        urls: [
            'https://cdn.tv/master.m3u8',
            'https://cdn.tv/clip.mp4',
            'https://cdn.tv/page.html',
            'https://cdn.tv/master.m3u8',
            42
        ]
    });
    assert.equal(report.pageUrl, 'https://site.tv/watch');
    assert.equal(report.title, 'A page');
    assert.deepEqual(report.candidates, [
        { url: 'https://cdn.tv/master.m3u8', kind: 'hls' },
        { url: 'https://cdn.tv/clip.mp4', kind: 'video' }
    ]);

    assert.equal(parseSniffMessage(null), null);
    assert.equal(parseSniffMessage({ type: 'other', version: 1, urls: [] }), null);
    assert.equal(parseSniffMessage({ type: SNIFF_MESSAGE_TYPE, version: 99, urls: [] }), null);
});

test('parseSniffText accepts pasted reports and bare URL lists', () => {
    const fromJson = parseSniffText(JSON.stringify({
        urls: ['https://cdn.tv/a.m3u8', 'https://cdn.tv/b.mp4?v=2']
    }));
    assert.equal(fromJson.length, 2);
    const bare = parseSniffText('try https://cdn.tv/c.m3u8, thanks');
    assert.deepEqual(bare, [{ url: 'https://cdn.tv/c.m3u8', kind: 'hls' }]);
    assert.deepEqual(parseSniffText(''), []);
});

test('onSniffReport hears postMessage payloads and unsubscribes', () => {
    const seen = [];
    const stop = onSniffReport((report) => seen.push(report));
    const handler = (listeners.get('message') || [])[0];
    assert.equal(typeof handler, 'function');

    handler({ data: { type: SNIFF_MESSAGE_TYPE, version: 1, pageUrl: 'https://a.tv', urls: ['https://cdn.tv/x.m3u8'] } });
    assert.equal(seen.length, 1);
    assert.equal(lastSniffReport().candidates[0].url, 'https://cdn.tv/x.m3u8');

    handler({ data: { type: 'noise' } });
    assert.equal(seen.length, 1);

    stop();
    handler({ data: { type: SNIFF_MESSAGE_TYPE, version: 1, urls: ['https://cdn.tv/y.m3u8'] } });
    assert.equal(seen.length, 1);
});

test('only the opened sniff popup may post reports back', () => {
    const popup = { focus() {}, closed: false };
    const originalOpen = globalThis.window.open;
    globalThis.window.open = () => popup;
    const seen = [];
    const stop = onSniffReport((report) => seen.push(report));
    try {
        assert.equal(openSniffTarget('https://site.tv/watch/42'), true);
        const handler = (listeners.get('message') || [])[0];
        const payload = {
            type: SNIFF_MESSAGE_TYPE,
            version: 1,
            pageUrl: 'https://site.tv/watch/42',
            urls: ['https://cdn.tv/a.m3u8']
        };

        handler({ data: payload, source: { evil: true } });
        assert.equal(seen.length, 0, 'foreign windows are ignored');

        handler({ data: payload, source: popup });
        assert.equal(seen.length, 1);
    } finally {
        stop();
        globalThis.window.open = originalOpen;
    }
});

