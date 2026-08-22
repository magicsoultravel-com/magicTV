/** Unit tests for js/epg/countryFeedMap.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    epgPwFeedCode,
    regionalFeedsFor,
    PRIORITY_COUNTRIES,
    EPG_PW_ALIASES
} from '../js/epg/countryFeedMap.js';

test('epgPwFeedCode maps UK to GB', () => {
    assert.equal(epgPwFeedCode('UK'), 'GB');
    assert.equal(EPG_PW_ALIASES.UK, 'GB');
});

test('epgPwFeedCode returns code for supported countries', () => {
    assert.equal(epgPwFeedCode('US'), 'US');
    assert.equal(epgPwFeedCode('DE'), 'DE');
    assert.equal(epgPwFeedCode('ES'), 'ES');
    assert.equal(epgPwFeedCode('CA'), 'CA');
});

test('epgPwFeedCode returns null for unsupported countries', () => {
    assert.equal(epgPwFeedCode('MX'), null);
    assert.equal(epgPwFeedCode('SE'), null);
});

test('regionalFeedsFor returns MX epgshare feed', () => {
    const feeds = regionalFeedsFor('MX');
    assert.equal(feeds.length, 1);
    assert.match(feeds[0].url, /epg_ripper_MX1/);
});

test('regionalFeedsFor resolves GB inherit from UK', () => {
    const feeds = regionalFeedsFor('GB');
    assert.equal(feeds.length, 1);
    assert.match(feeds[0].url, /Freeview-EPG/);
});

test('PRIORITY_COUNTRIES includes user-requested set', () => {
    for (const cc of ['US', 'UK', 'IT', 'ES', 'SE', 'PE', 'MX', 'AR', 'CA', 'DE']) {
        assert.ok(PRIORITY_COUNTRIES.includes(cc), `missing ${cc}`);
    }
});
