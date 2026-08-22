/** Unit tests for js/epg/feedResolver.js (legacy feedKey) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedKey } from '../js/epg/feedResolver.js';

test('feedKey sanitizes URLs for cache keys', () => {
    const k = feedKey('https://example.com/guide.xml?x=1');
    assert.match(k, /^https/);
    assert.ok(!k.includes('?'));
});
