/** Unit tests for js/epg/xmltvParser.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseXmltvDate,
    parseXmltvRegex,
    programmesForChannel,
    programmesForDay,
    pickNowNext,
    localDayBounds,
    formatProgrammeTime
} from '../js/epg/xmltvParser.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20250822120000 +0000" stop="20250822130000 +0000" channel="CNN.us">
    <title>News Hour</title>
    <desc>Breaking news</desc>
  </programme>
  <programme start="20250822130000 +0000" stop="20250822140000 +0000" channel="CNN.us">
    <title>Talk Show</title>
  </programme>
  <programme start="20250822120000 +0000" stop="20250822130000 +0000" channel="BBCOne.uk">
    <title>Breakfast</title>
  </programme>
</tv>`;

test('parseXmltvDate parses XMLTV datetime with timezone', () => {
    const ms = parseXmltvDate('20250822120000 +0000');
    const d = new Date(ms);
    assert.equal(d.getUTCFullYear(), 2025);
    assert.equal(d.getUTCMonth(), 7);
    assert.equal(d.getUTCDate(), 22);
    assert.equal(d.getUTCHours(), 12);
});

test('parseXmltvRegex extracts programmes by channel', () => {
    const byChannel = parseXmltvRegex(SAMPLE_XML);
    assert.equal(byChannel.size, 2);
    assert.equal(byChannel.get('CNN.us').length, 2);
    assert.equal(byChannel.get('CNN.us')[0].title, 'News Hour');
    assert.equal(byChannel.get('CNN.us')[0].desc, 'Breaking news');
});

test('programmesForChannel matches exact and feed suffix ids', () => {
    const byChannel = parseXmltvRegex(SAMPLE_XML);
    assert.equal(programmesForChannel(byChannel, 'CNN.us').length, 2);
    assert.equal(programmesForChannel(byChannel, 'Missing.us').length, 0);
});

test('programmesForDay filters by local day bounds', () => {
    const byChannel = parseXmltvRegex(SAMPLE_XML);
    const progs = byChannel.get('CNN.us');
    const noon = parseXmltvDate('20250822120000 +0000');
    const bounds = localDayBounds(noon, 0);
    const day = programmesForDay(progs, bounds.start, bounds.end);
    assert.equal(day.length, 2);
});

test('pickNowNext finds current and next programme', () => {
    const byChannel = parseXmltvRegex(SAMPLE_XML);
    const progs = byChannel.get('CNN.us');
    const duringFirst = parseXmltvDate('20250822123000 +0000');
    const { current, next } = pickNowNext(progs, duringFirst);
    assert.equal(current?.title, 'News Hour');
    assert.equal(next?.title, 'Talk Show');
});

test('formatProgrammeTime returns localized time string', () => {
    const ms = parseXmltvDate('20250822120000 +0000');
    const s = formatProgrammeTime(ms, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    assert.match(s, /12:00/);
});
