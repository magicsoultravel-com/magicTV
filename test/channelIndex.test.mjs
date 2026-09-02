/** Unit tests for js/epg/channelIndex.js programme extraction + index streaming */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseChannelIndex, extractProgrammesForId, streamChannelSection } from '../js/epg/channelIndex.js';

const SAMPLE = `<?xml version="1.0"?>
<tv>
  <channel id="CNN.us"><display-name>CNN HD</display-name></channel>
  <programme start="20250822120000 +0000" stop="20250822130000 +0000" channel="CNN.us">
    <title>News Hour</title>
  </programme>
  <programme start="20250822130000 +0000" stop="20250822140000 +0000" channel="CNN.us">
    <title>Talk Show</title>
  </programme>
</tv>`;

test('parseChannelIndex extracts ids and display names', () => {
    const idx = parseChannelIndex(SAMPLE);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].id, 'CNN.us');
    assert.deepEqual(idx[0].names, ['CNN HD']);
});

test('extractProgrammesForId returns sorted programmes', () => {
    const progs = extractProgrammesForId(SAMPLE, 'CNN.us');
    assert.equal(progs.length, 2);
    assert.equal(progs[0].title, 'News Hour');
    assert.ok(progs[0].start < progs[1].start);
});

const STREAM_SAMPLE = `<?xml version="1.0"?>
<tv>
  <channel id="CNN.us"><display-name>CNN HD</display-name></channel>
  <channel id="HBO.us"><display-name>HBO East</display-name></channel>
  <programme start="20250822120000 +0000" stop="20250822130000 +0000" channel="CNN.us">
    <title>News Hour</title>
  </programme>
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

test('streamChannelSection returns plain channel head and stops at first programme', async () => {
    await withMockedFetch(
        async () => new Response(STREAM_SAMPLE, { status: 200 }),
        async () => {
            const head = await streamChannelSection('https://example.test/epg.xml');
            assert.ok(head.includes('<channel id="CNN.us">'), 'channel section included');
            assert.ok(!head.includes('<programme'), 'programme section excluded');
            assert.equal(parseChannelIndex(head).length, 2);
        }
    );
});

test('streamChannelSection gunzips raw .gz payloads with { gzip: true }', async () => {
    const gz = zlib.gzipSync(Buffer.from(STREAM_SAMPLE, 'utf8'));
    await withMockedFetch(
        async () => new Response(new Uint8Array(gz), { status: 200 }),
        async () => {
            const head = await streamChannelSection('https://example.test/epg.xml.gz', { gzip: true });
            assert.ok(head.includes('<channel id="HBO.us">'), 'gunzipped channel section included');
            assert.ok(!head.includes('<programme'), 'programme section excluded');
            assert.equal(parseChannelIndex(head).length, 2);
        }
    );
});
