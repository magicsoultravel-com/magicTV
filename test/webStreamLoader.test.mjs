/** hls.js proxy loader: unwrap / rewrite / fallback behaviour. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createProxyLoader,
    rewriteRequestUrl,
    unwrapProxyUrl,
    withProxyLoader
} from '../js/webstream/webStreamLoader.js';

const RAW = 'https://proxy.tv/?url={url}';
const ENC = 'https://proxy.tv/?u={url_encoded}';

test('unwrapProxyUrl reverses both template tokens', () => {
    assert.equal(
        unwrapProxyUrl(RAW, 'https://proxy.tv/?url=https://cdn.tv/a.m3u8?x=1'),
        'https://cdn.tv/a.m3u8?x=1'
    );
    assert.equal(
        unwrapProxyUrl(ENC, `https://proxy.tv/?u=${encodeURIComponent('https://cdn.tv/a.m3u8')}`),
        'https://cdn.tv/a.m3u8'
    );
    assert.equal(unwrapProxyUrl(RAW, 'https://other.tv/?url=https://cdn.tv/a.m3u8'), '');
    assert.equal(unwrapProxyUrl('', 'https://proxy.tv/?url=x'), '');
});

test('rewriteRequestUrl proxies absolutes and resolves relatives against the original', () => {
    const absolute = rewriteRequestUrl({ url: 'https://cdn.tv/master.m3u8', template: RAW });
    assert.equal(absolute.url, 'https://proxy.tv/?url=https://cdn.tv/master.m3u8');
    assert.equal(absolute.original, 'https://cdn.tv/master.m3u8');

    // Already proxied → pass through, keep learning the original.
    const again = rewriteRequestUrl({
        url: 'https://proxy.tv/?url=https://cdn.tv/master.m3u8',
        template: RAW
    });
    assert.equal(again.url, 'https://proxy.tv/?url=https://cdn.tv/master.m3u8');
    assert.equal(again.original, 'https://cdn.tv/master.m3u8');

    // hls.js resolves relative segments against the *proxied* playlist URL;
    // the loader must restore the real base before proxying again.
    const relative = rewriteRequestUrl({
        url: 'seg-1.ts',
        template: RAW,
        lastOriginal: 'https://cdn.tv/live/master.m3u8'
    });
    assert.equal(relative.original, 'https://cdn.tv/live/seg-1.ts');
    assert.equal(relative.url, 'https://proxy.tv/?url=https://cdn.tv/live/seg-1.ts');

    const blob = rewriteRequestUrl({ url: 'blob:https://site.tv/123', template: RAW });
    assert.equal(blob.url, 'blob:https://site.tv/123');
    assert.equal(blob.original, '');

    // Relative with no known base is left alone (never invented).
    const orphan = rewriteRequestUrl({ url: 'seg-9.ts', template: RAW });
    assert.equal(orphan.url, 'seg-9.ts');
    assert.equal(orphan.original, '');
});

test('createProxyLoader extends the hls.js loader and rewrites every request', () => {
    class BaseLoader {
        constructor(config) {
            this.config = config;
            this.requests = [];
        }
        load(context, config, callbacks) {
            this.requests.push(context.url);
            if (callbacks?.onSuccess) callbacks.onSuccess();
        }
    }
    const Hls = { DefaultConfig: { loader: BaseLoader } };
    const Loader = createProxyLoader(Hls, RAW);
    assert.equal(typeof Loader, 'function');
    const instance = new Loader({});

    const context = { url: 'https://cdn.tv/master.m3u8' };
    instance.load(context, {}, {});
    assert.equal(context.url, 'https://proxy.tv/?url=https://cdn.tv/master.m3u8');

    const segment = { url: 'chunk-1.ts' };
    instance.load(segment, {}, {});
    assert.equal(segment.url, 'https://proxy.tv/?url=https://cdn.tv/chunk-1.ts');
    assert.deepEqual(instance.requests, [
        'https://proxy.tv/?url=https://cdn.tv/master.m3u8',
        'https://proxy.tv/?url=https://cdn.tv/chunk-1.ts'
    ]);
});

test('createProxyLoader / withProxyLoader are no-ops without a usable template', () => {
    class BaseLoader { load() {} }
    const Hls = { DefaultConfig: { loader: BaseLoader } };
    assert.equal(createProxyLoader(Hls, ''), null);
    assert.equal(createProxyLoader(null, RAW), null);
    assert.equal(createProxyLoader({}, RAW), null);

    const base = { maxBufferLength: 30 };
    assert.equal(withProxyLoader(base, { Hls, proxyTemplate: '' }), base);
    const merged = withProxyLoader(base, { Hls, proxyTemplate: RAW });
    assert.notEqual(merged, base);
    assert.equal(typeof merged.loader, 'function');
    assert.equal(merged.maxBufferLength, 30);
});
