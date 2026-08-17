/**
 * Unit tests for hidden channel persistence and filtering.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        matchMedia: () => ({ matches: true })
    };
});

let TvPlayer;
let HiddenChannels;

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    HiddenChannels = (await import('../js/storage/hiddenChannels.js')).HiddenChannels;
});

beforeEach(() => store.clear());

const CHANNEL = {
    id: 'BBC.uk',
    name: 'BBC One',
    countrycode: 'GB',
    logo: 'https://example.com/bbc.png',
    url_resolved: 'https://example.com/bbc.m3u8'
};

const OTHER = {
    id: 'CNN.us',
    name: 'CNN',
    countrycode: 'US',
    logo: 'https://example.com/cnn.png',
    url_resolved: 'https://example.com/cnn.m3u8'
};

test('hide and unhide channel', () => {
    assert.equal(TvPlayer.isHidden(CHANNEL), false);
    assert.equal(TvPlayer.hideChannel(CHANNEL), true);
    assert.equal(TvPlayer.isHidden(CHANNEL), true);
    assert.equal(TvPlayer.hideChannel(CHANNEL), false, 'already hidden');
    assert.equal(TvPlayer.unhideChannel(CHANNEL), true);
    assert.equal(TvPlayer.isHidden(CHANNEL), false);
});

test('hidden channels are persisted under matrix_tv_state', () => {
    TvPlayer.hideChannel(CHANNEL);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.ok(raw.hiddenChannels.includes('iptv-org:BBC.uk'));
    assert.equal(raw.hiddenChannelsMeta[0].name, 'BBC One');
    assert.equal(raw.hiddenChannelsMeta[0].countrycode, 'GB');
});

test('filterVisible removes hidden channels', () => {
    HiddenChannels.hideChannel(CHANNEL);
    const list = HiddenChannels.filterVisible([CHANNEL, OTHER]);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'CNN.us');
});

test('hiding preserves metadata for settings display', () => {
    TvPlayer.hideChannel(CHANNEL);
    const meta = TvPlayer.getHiddenMeta();
    assert.equal(meta.length, 1);
    assert.equal(meta[0].key, 'iptv-org:BBC.uk');
    assert.equal(meta[0].name, 'BBC One');
    assert.equal(meta[0].logo, 'https://example.com/bbc.png');
    assert.equal(meta[0].countrycode, 'GB');
});

test('favorite status survives hide and unhide', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    TvPlayer.hideChannel(CHANNEL);
    assert.equal(TvPlayer.isFavorite(CHANNEL), true);
    TvPlayer.unhideChannel(CHANNEL);
    assert.equal(TvPlayer.isFavorite(CHANNEL), true);
});
