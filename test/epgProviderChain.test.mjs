/** Unit tests for js/epg/providers/registry.js chain helpers */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderChain, attachNowNext } from '../js/epg/providers/registry.js';

test('resolveProviderChain includes epg-pw for US channel', () => {
    const chain = resolveProviderChain({ name: 'CNN', countrycode: 'US' });
    assert.ok(chain.some((p) => p.id === 'epg-pw'));
});

test('resolveProviderChain includes xmltv-index for MX channel', () => {
    const chain = resolveProviderChain({ name: 'Canal 5', countrycode: 'MX' });
    assert.ok(chain.some((p) => p.id === 'xmltv-index'));
});

test('resolveProviderChain includes epg-pw for UK via GB alias support', () => {
    const chain = resolveProviderChain({ name: 'BBC One', countrycode: 'UK' });
    assert.ok(chain.some((p) => p.id === 'epg-pw'));
});

test('attachNowNext picks current and next programmes', () => {
    const now = Date.now();
    const programmes = [
        { title: 'Past', start: now - 7200000, stop: now - 3600000, channelId: 'x' },
        { title: 'Live', start: now - 600000, stop: now + 600000, channelId: 'x' },
        { title: 'Later', start: now + 3600000, stop: now + 7200000, channelId: 'x' }
    ];
    const result = attachNowNext({ status: 'ok', programmes }, now);
    assert.equal(result.current?.title, 'Live');
    assert.equal(result.next?.title, 'Later');
});

test('attachNowNext picks next programme that starts after midnight', () => {
    // 23:30 local — the next programme starts tomorrow (00:30). The epg.pw
    // provider returns today + tomorrow, so "next" must survive the day roll.
    const d = new Date();
    d.setHours(23, 30, 0, 0);
    const now = d.getTime();
    const programmes = [
        { title: 'Evening', start: now - 3600000, stop: now + 1800000, channelId: 'x' },
        { title: 'Late Night', start: now + 3600000, stop: now + 7200000, channelId: 'x' }
    ];
    const result = attachNowNext({ status: 'ok', programmes }, now);
    assert.equal(result.current?.title, 'Evening');
    assert.equal(result.next?.title, 'Late Night');
});
