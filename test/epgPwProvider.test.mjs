/**
 * Unit tests for the epg.pw channel-index loader.
 * Regression: epg.pw moved their per-country XMLTV index files from
 * `epg_CC.xml` (plain) to `epg_CC.xml.gz` (uppercase code, raw gzip payload),
 * which 404'd the old URL and killed guide name-matching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
    epgPwIndexUrl,
    epgPwIndexUrlLegacy,
    fetchEpgPwIndexHead,
    warmEpgPwIndexForCountry
} from '../js/epg/providers/epgPwProvider.js';
import { parseChannelIndex } from '../js/epg/channelIndex.js';

const INDEX_XML = `<?xml version="1.0"?>
<tv>
  <channel id="464745"><display-name lang="US">HBO East</display-name></channel>
  <channel id="464746"><display-name lang="US">BBC News (North America) HD</display-name></channel>
  <programme start="20260902120000 +0000" stop="20260902130000 +0000" channel="464745"><title>Show</title></programme>
</tv>`;

async function withMockedFetch(responder, run) {
    const original = globalThis.fetch;
    globalThis.fetch = responder;
    try {
        return await run();
    } finally {
        globalThis.fetch = original;
    }
}

test('epgPwIndexUrl targets the gzipped uppercase index file', () => {
    assert.equal(epgPwIndexUrl('US'), 'https://epg.pw/xmltv/epg_US.xml.gz');
    assert.equal(epgPwIndexUrlLegacy('US'), 'https://epg.pw/xmltv/epg_US.xml');
});

test('fetchEpgPwIndexHead reads the gzipped index head', async () => {
    const gz = zlib.gzipSync(Buffer.from(INDEX_XML, 'utf8'));
    const requested = [];
    await withMockedFetch(
        async (url) => {
            requested.push(String(url));
            return new Response(new Uint8Array(gz), { status: 200 });
        },
        async () => {
            const head = await fetchEpgPwIndexHead('US');
            assert.deepEqual(requested, ['https://epg.pw/xmltv/epg_US.xml.gz']);
            const idx = parseChannelIndex(head);
            assert.equal(idx.length, 2);
            assert.deepEqual(idx[0].names, ['HBO East']);
        }
    );
});

test('fetchEpgPwIndexHead falls back to legacy plain XML when gz is gone', async () => {
    const requested = [];
    await withMockedFetch(
        async (url) => {
            requested.push(String(url));
            if (String(url).endsWith('.xml.gz')) return new Response('404 Not Found', { status: 404 });
            return new Response(INDEX_XML, { status: 200 });
        },
        async () => {
            const head = await fetchEpgPwIndexHead('GB');
            assert.deepEqual(requested, [
                'https://epg.pw/xmltv/epg_GB.xml.gz',
                'https://epg.pw/xmltv/epg_GB.xml'
            ]);
            assert.equal(parseChannelIndex(head).length, 2);
        }
    );
});

test('warmEpgPwIndexForCountry parses and returns the full index', async () => {
    const gz = zlib.gzipSync(Buffer.from(INDEX_XML, 'utf8'));
    await withMockedFetch(
        async () => new Response(new Uint8Array(gz), { status: 200 }),
        async () => {
            const index = await warmEpgPwIndexForCountry('US');
            assert.equal(index.length, 2);
            assert.equal(index[1].id, '464746');
        }
    );
});


test('epg.pw JSON list maps to programmes with inferred stop times', () => {
    const list = [
        { title: 'Show A', start_date: '2026-08-22T12:00:00+00:00', desc: 'a' },
        { title: 'Show B', start_date: '2026-08-22T13:00:00+00:00', desc: 'b' }
    ];
    const programmes = list.map((item, i) => {
        const start = new Date(item.start_date).getTime();
        const next = list[i + 1];
        const stop = next ? new Date(next.start_date).getTime() : start + 3600000;
        return { title: item.title, start, stop };
    });
    assert.equal(programmes.length, 2);
    assert.equal(programmes[0].stop, programmes[1].start);
    assert.equal(programmes[1].stop, programmes[1].start + 3600000);
});
