/**
 * Share Channel tests.
 *
 * Covers the pure, DOM-free surface of the share feature:
 *   - buildStreamLink / buildDeepLink link construction
 *   - deep-link round-trip (build → parse) incl. provider, name, country
 *   - chooseSharedPlayTarget slot policy (free → center; full → last/fallback)
 *
 * copyShareText intentionally not exercised here (needs DOM/navigator) — it is a
 * thin wrapper guarded by try/catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildStreamLink,
    buildDeepLink,
    parseDeepLink,
    chooseSharedPlayTarget,
    SHARE_PARAM
} from '../js/share/shareChannel.js';

const SAMPLE = {
    providerId: 'iptv-org',
    channelId: 'CNBC',
    name: 'CNBC',
    countrycode: 'us'
};

test('buildStreamLink returns url_resolved, falls back to url', () => {
    assert.equal(buildStreamLink({ url_resolved: 'https://a.m3u8', url: 'https://b.m3u8' }), 'https://a.m3u8');
    assert.equal(buildStreamLink({ url: 'https://b.m3u8' }), 'https://b.m3u8');
    assert.equal(buildStreamLink({}), '');
    assert.equal(buildStreamLink(null), '');
});

test('buildDeepLink encodes the channel key with the share param', () => {
    const link = buildDeepLink(SAMPLE);
    assert.ok(link.includes('index.html'), 'link points at the app shell');
    assert.ok(link.includes(`${SHARE_PARAM}=`), 'link carries the share param');
    assert.ok(link.includes(encodeURIComponent('iptv-org:CNBC')), 'channel key is URL-encoded');
});

test('round-trip: a built deep link parses back to the same channel + meta', () => {
    const link = buildDeepLink(SAMPLE);
    const abs = new URL(link, 'http://local.invalid/').href;
    const parsed = parseDeepLink(abs);
    assert.deepEqual(parsed, {
        providerId: 'iptv-org',
        channelId: 'CNBC',
        name: 'CNBC',
        country: 'us'
    });
});

test('round-trip survives keys with ampersand, hash and unicode', () => {
    const weird = {
        providerId: 'iptv-org',
        channelId: 'SkyNews&A&ç☃',
        name: 'News & Stuff#1',
        countrycode: 'gb'
    };
    const abs = new URL(buildDeepLink(weird), 'http://local.invalid/').href;
    const parsed = parseDeepLink(abs);
    assert.equal(parsed.channelId, 'SkyNews&A&ç☃');
    assert.equal(parsed.name, 'News & Stuff#1');
    assert.equal(parsed.country, 'gb');
});

test('parseDeepLink returns null without a ch param or with an empty one', () => {
    assert.equal(parseDeepLink('http://host/index.html'), null);
    assert.equal(parseDeepLink(`http://host/index.html?${SHARE_PARAM}=`), null);
});

test('chooseSharedPlayTarget: free slots open the first one (center when clean)', () => {
    assert.equal(chooseSharedPlayTarget([]), 'center');
    assert.equal(chooseSharedPlayTarget(['center']), 'topLeft');
    assert.equal(chooseSharedPlayTarget(['center', 'topLeft', 'topRight']), 'bottomLeft');
});

test('chooseSharedPlayTarget: when every slot is full, replace last (or fallback)', () => {
    const all = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    assert.equal(chooseSharedPlayTarget(all), 'bottomRight');
    assert.equal(chooseSharedPlayTarget(all, { fallback: 'topRight' }), 'topRight');
    assert.equal(chooseSharedPlayTarget(all, { fallback: 'nope' }), 'bottomRight');
});

test('chooseSharedPlayTarget respects a reduced max (platform cap)', () => {
    // Only 3 screens supported → 3 slots.
    assert.equal(chooseSharedPlayTarget([], { max: 3 }), 'center');
    assert.equal(chooseSharedPlayTarget(['center'], { max: 3 }), 'topLeft');
    assert.equal(chooseSharedPlayTarget(['center', 'topLeft', 'topRight'], { max: 3 }), 'topRight');
    assert.equal(chooseSharedPlayTarget(['center', 'topLeft', 'topRight'], { max: 3, fallback: 'center' }), 'center');
});
