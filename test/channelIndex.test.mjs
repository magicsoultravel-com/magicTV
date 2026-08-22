/** Unit tests for js/epg/channelIndex.js programme extraction */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChannelIndex, extractProgrammesForId } from '../js/epg/channelIndex.js';

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
