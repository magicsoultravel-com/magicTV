/**
 * Stateful unit tests for the extracted TV player + provider registry.
 *
 * No DOM is required: we inject tiny global stubs for localStorage and
 * window before dynamically importing the modules (tvPlayer reads saved
 * state at module evaluation time and dispatches a CustomEvent on change).
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
let Registry;

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    Registry = (await import('../js/tvProviders/registry.js')).TvProviderRegistry;
});

beforeEach(() => store.clear());

const CHANNEL = {
    id: 'CNN.us',
    name: 'CNN',
    country: 'US',
    logo: 'https://example.com/cnn.png',
    url_resolved: 'https://example.com/cnn.m3u8',
    categories: ['news']
};

// ----- Favorites -----

test('favorites toggle on and off', () => {
    assert.equal(TvPlayer.isFavorite(CHANNEL), false);
    assert.equal(TvPlayer.toggleFavorite(CHANNEL), true, 'adding returns true');
    assert.equal(TvPlayer.isFavorite(CHANNEL), true);
    assert.equal(TvPlayer.toggleFavorite(CHANNEL), false, 'removing returns false');
    assert.equal(TvPlayer.isFavorite(CHANNEL), false);
});

test('favorites are persisted under matrix_tv_state', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.ok(raw.favorites.includes('iptv-org:CNN.us'), 'favorite key persisted');
    assert.equal(TvPlayer.getFavorites()[0], 'iptv-org:CNN.us');
});

test('favorites keep display metadata for instant tab rendering', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const meta = TvPlayer.getFavoritesMeta();
    assert.equal(meta.length, 1);
    assert.equal(meta[0].key, 'iptv-org:CNN.us');
    assert.equal(meta[0].name, 'CNN');
    assert.equal(meta[0].logo, 'https://example.com/cnn.png');

    TvPlayer.toggleFavorite(CHANNEL); // remove
    assert.equal(TvPlayer.getFavoritesMeta().length, 0, 'meta removed with the favorite');
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.ok(!Array.isArray(raw.favoritesMeta) || raw.favoritesMeta.length === 0);
});

test('favorites work with bare channel ids (migration path)', () => {
    TvPlayer.toggleFavorite({ channelId: 'BBC.uk', url_resolved: 'x' });
    assert.equal(TvPlayer.isFavorite('BBC.uk'), true, 'legacy unprefixed ref resolves');
});

// ----- Recents -----

test('recents are recorded newest-first', () => {
    TvPlayer.pushRecent('iptv-org:A');
    TvPlayer.pushRecent('iptv-org:B');
    TvPlayer.pushRecent('iptv-org:A'); // duplicate should move to front, not duplicate
    const meta = TvPlayer.getRecentsMeta();
    assert.equal(meta.length, 2);
    assert.equal(meta[0].key, 'iptv-org:A');
    assert.equal(meta[1].key, 'iptv-org:B');
});

test('recents are capped at 20 entries', () => {
    for (let i = 0; i < 25; i += 1) {
        TvPlayer.pushRecent(`iptv-org:channel-${i}`);
    }
    assert.equal(TvPlayer.getRecents().length, 20);
    assert.equal(TvPlayer.getRecents()[0], 'iptv-org:channel-24', 'newest first');
    assert.ok(!TvPlayer.getRecents().includes('iptv-org:channel-0'), 'oldest dropped');
});

test('clearRecents empties the history', () => {
    TvPlayer.pushRecent('iptv-org:X');
    TvPlayer.clearRecents();
    assert.deepEqual(TvPlayer.getRecents(), []);
});

// ----- Buffer -----

test('buffer size clamps to 5..120 seconds', () => {
    assert.equal(TvPlayer.setBufferSize(3), 5);
    assert.equal(TvPlayer.setBufferSize(500), 120);
    assert.equal(TvPlayer.setBufferSize(30), 30);
    assert.equal(TvPlayer.getBufferSize(), 30);
});

test('buffer size persists', () => {
    TvPlayer.setBufferSize(30);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.bufferSize, 30);
});

// ----- Volume -----

test('volume clamps to 0..1 and persists', () => {
    TvPlayer.setVolume(2);
    assert.equal(TvPlayer.volume, 1);
    TvPlayer.setVolume(-0.5);
    assert.equal(TvPlayer.volume, 0);
    TvPlayer.setVolume(0.42);
    assert.equal(TvPlayer.volume, 0.42);
    assert.equal(JSON.parse(store.get('matrix_tv_state')).volume, 0.42);
});

// ----- Registry settings -----

test('hide-offline defaults to on and toggles', () => {
    assert.equal(Registry.getHideOffline(), true, 'defaults to hiding offline');
    Registry.setHideOffline(false);
    assert.equal(Registry.getHideOffline(), false);
    Registry.setHideOffline(true);
    assert.equal(Registry.getHideOffline(), true);
});

test('registry reports the iptv-org provider', () => {
    const providers = Registry.listProviders();
    assert.ok(providers.some((p) => p.id === 'iptv-org'));
    assert.equal(Registry.getActiveProviderId(), 'iptv-org');
});