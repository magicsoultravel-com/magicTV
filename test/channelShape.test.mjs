/** Unit tests for js/tvProviders/channelShape.js (pure functions). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    channelKey,
    parseChannelKey,
    normalizeChannel,
    migrateFavoriteRef,
    PROVIDER_IPTV_ORG
} from '../js/tvProviders/channelShape.js';

test('channelKey builds provider-prefixed keys', () => {
    assert.equal(channelKey({ channelId: 'CNN.us' }), 'iptv-org:CNN.us');
    assert.equal(channelKey({ providerId: 'x', channelId: 'y' }), 'x:y');
    assert.equal(channelKey('bare-id'), 'iptv-org:bare-id');
    assert.equal(channelKey('already:x'), 'already:x');
    assert.equal(channelKey(null), '');
    assert.equal(channelKey({}), 'iptv-org:');
});

test('parseChannelKey splits provider and id', () => {
    assert.deepEqual(parseChannelKey('iptv-org:CNN.us'), { providerId: 'iptv-org', channelId: 'CNN.us' });
    assert.deepEqual(parseChannelKey('CNBC.us'), { providerId: 'iptv-org', channelId: 'CNBC.us' });
    assert.equal(parseChannelKey(null), null);
    assert.equal(parseChannelKey(''), null);
});

test('channelKey/parseChannelKey round-trips', () => {
    const key = 'iptv-org:CNN.us';
    const { providerId, channelId } = parseChannelKey(key);
    assert.equal(channelKey({ providerId, channelId }), key);
});

test('normalizeChannel maps raw iptv-org shapes', () => {
    const out = normalizeChannel({
        id: 'CNN.us',
        name: 'CNN',
        country: 'US',
        logo: 'https://x/cnn.png',
        categories: ['news'],
        url_resolved: 'https://stream'
    }, PROVIDER_IPTV_ORG);

    assert.equal(out.providerId, 'iptv-org');
    assert.equal(out.channelId, 'CNN.us');
    assert.equal(out.name, 'CNN');
    assert.equal(out.countrycode, 'US');
    assert.equal(out.url_resolved, 'https://stream');
    assert.equal(out.lastcheckok, 1);
});

test('normalizeChannel returns null for unusable input', () => {
    assert.equal(normalizeChannel(null), null);
    assert.equal(normalizeChannel({ id: 'no-url' }), null);
    assert.equal(normalizeChannel({ url_resolved: 'x' }), null);
});

test('migrateFavoriteRef normalizes legacy unprefixed refs', () => {
    assert.equal(migrateFavoriteRef('CNN.us'), 'iptv-org:CNN.us');
    assert.equal(migrateFavoriteRef('iptv-org:CNN.us'), 'iptv-org:CNN.us');
    assert.equal(migrateFavoriteRef({ channelId: 'BBC.uk' }), 'iptv-org:BBC.uk');
});