/**
 * Catalog network robustness tests.
 *
 * Regression coverage for the returning-user boot hang: when the iptv-org CDN
 * stalls (connection accepted but no bytes), every fetch in the catalog load
 * MUST be bounded by a timeout, and callers MUST degrade to an empty catalog /
 * null channel instead of hanging the boot screen forever.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
    IptvOrgTvProvider,
    setCatalogFetchTimeoutMs
} from '../js/tvProviders/iptvOrgTv.js';

setCatalogFetchTimeoutMs(80);

before(() => {
    globalThis.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    // Force IndexedDBStore into its in-memory fallback (no DB in Node).
    globalThis.indexedDB = undefined;
});

function okResponse(body) {
    return {
        ok: true,
        json: async () => JSON.parse(body)
    };
}

test('stalled catalog network times out and degrades to an empty catalog instead of hanging', async () => {
    // A connection that is accepted but never sends anything (no headers, no
    // bytes) is exactly what held the boot screen hostage before the timeout.
    globalThis.fetch = () => new Promise(() => {});

    const t0 = Date.now();
    const countries = await IptvOrgTvProvider.getCountries();
    const elapsed = Date.now() - t0;

    assert.deepEqual(countries, [], 'returns an empty country list');
    assert.ok(
        elapsed < 5000,
        `catalog load must be bounded by the timeout, took ${elapsed}ms`
    );

    // Returning-user boot path: restoring a saved slot must get null, not hang.
    const channel = await IptvOrgTvProvider.getChannelById('BBC:us');
    assert.equal(channel, null, 'degraded catalog resolves channels to null');

    const results = await IptvOrgTvProvider.searchChannels({ query: 'bbc' });
    assert.deepEqual(results, [], 'empty catalog search yields no rows');
});

test('after a stalled load, a manual refresh (refresh=true) recovers from the network', async () => {
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.endsWith('/channels.json')) {
            return okResponse(JSON.stringify([
                { id: 'BBC:us', name: 'BBC', country: 'us', categories: [], logo: '', is_nsfw: false }
            ]));
        }
        if (u.endsWith('/streams.json')) {
            return okResponse(JSON.stringify([
                { channel: 'BBC:us', url: 'https://example.com/bbc.m3u8' }
            ]));
        }
        if (u.endsWith('/countries.json')) {
            return okResponse(JSON.stringify([{ code: 'us', name: 'United States' }]));
        }
        if (u.endsWith('/categories.json')) return okResponse('[]');
        if (u.endsWith('/blocklist.json')) return okResponse('[]');
        throw new Error(`unexpected fetch url: ${u}`);
    };

    const countries = await IptvOrgTvProvider.getCountries({ refresh: true });
    assert.equal(countries.length, 1);
    assert.equal(countries[0].iso_3166_1, 'us');

    const channel = await IptvOrgTvProvider.getChannelById('BBC:us');
    assert.equal(channel?.channelId, 'BBC:us');
    assert.equal(channel?.url_resolved, 'https://example.com/bbc.m3u8');
});