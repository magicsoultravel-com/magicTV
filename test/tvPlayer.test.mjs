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
import { MultiView } from '../js/multiView.js';

let Registry;
let SettingsStore;

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    Registry = (await import('../js/tvProviders/registry.js')).TvProviderRegistry;
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
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

test('reorderFavorites persists key and meta order', () => {
    const a = { id: 'A.us', name: 'Alpha', logo: 'a.png', url_resolved: 'x' };
    const b = { id: 'B.us', name: 'Beta', logo: 'b.png', url_resolved: 'x' };
    const c = { id: 'C.us', name: 'Gamma', logo: 'c.png', url_resolved: 'x' };
    TvPlayer.toggleFavorite(a);
    TvPlayer.toggleFavorite(b);
    TvPlayer.toggleFavorite(c);
    // Newest-first: C, B, A
    assert.deepEqual(TvPlayer.getFavorites(), ['iptv-org:C.us', 'iptv-org:B.us', 'iptv-org:A.us']);

    assert.equal(
        TvPlayer.reorderFavorites(['iptv-org:A.us', 'iptv-org:C.us', 'iptv-org:B.us']),
        true
    );
    assert.deepEqual(TvPlayer.getFavorites(), ['iptv-org:A.us', 'iptv-org:C.us', 'iptv-org:B.us']);
    assert.deepEqual(
        TvPlayer.getFavoritesMeta().map((e) => e.key),
        ['iptv-org:A.us', 'iptv-org:C.us', 'iptv-org:B.us']
    );
    assert.equal(TvPlayer.getFavoritesMeta()[0].name, 'Alpha');

    assert.equal(
        TvPlayer.reorderFavorites(['iptv-org:A.us', 'iptv-org:C.us', 'iptv-org:B.us']),
        false,
        'unchanged order is a no-op'
    );
    assert.equal(
        TvPlayer.reorderFavorites(['iptv-org:A.us', 'iptv-org:Z.us']),
        false,
        'rejects incomplete / unknown sets'
    );
});

test('mergeVisibleFavoriteOrder keeps non-visible slots', async () => {
    const { mergeVisibleFavoriteOrder } = await import('../js/storage/favoritesRecents.js');
    const full = ['A', 'B', 'C', 'D', 'E'];
    const visible = ['E', 'B', 'D'];
    // Visible slots (B,D,E) filled in new order; A and C stay put.
    assert.deepEqual(mergeVisibleFavoriteOrder(full, visible), ['A', 'E', 'C', 'B', 'D']);
    assert.deepEqual(
        mergeVisibleFavoriteOrder(full, ['B', 'C', 'D', 'E', 'A']),
        ['B', 'C', 'D', 'E', 'A'],
        'full visible reorder replaces entire list'
    );
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

test('hide-offline API is a no-op (catalog has no offline health)', () => {
    assert.equal(Registry.getHideOffline(), true);
    Registry.setHideOffline(false);
    assert.equal(Registry.getHideOffline(), true, 'offline filter is not configurable');
});

test('registry reports the iptv-org provider', () => {
    const providers = Registry.listProviders();
    assert.ok(providers.some((p) => p.id === 'iptv-org'));
    assert.equal(Registry.getActiveProviderId(), 'iptv-org');
});

// ----- Appearance Settings (SettingsStore) -----

test('textSize defaults to 16 and can be set and retrieved', () => {
    assert.equal(SettingsStore.getTextSize(), 16, 'defaults to 16px');
    SettingsStore.setTextSize(14);
    assert.equal(SettingsStore.getTextSize(), 14);
    SettingsStore.setTextSize(18);
    assert.equal(SettingsStore.getTextSize(), 18);
});

test('textSize clamps to range', () => {
    SettingsStore.setTextSize(100);
    assert.equal(SettingsStore.getTextSize(), 18, 'above max clamps to 18');
    SettingsStore.setTextSize(3);
    assert.equal(SettingsStore.getTextSize(), 8, 'below min clamps to 8');
    SettingsStore.setTextSize('invalid');
    assert.equal(SettingsStore.getTextSize(), 16, 'non-number falls back to default');
});

test('textSize persists in localStorage', () => {
    SettingsStore.setTextSize(14);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.textSize, 14);
});

test('tileWidth defaults to 180 and can be set and retrieved', () => {
    assert.equal(SettingsStore.getTileWidth(), 180, 'defaults to 180px');
    SettingsStore.setTileWidth(150);
    assert.equal(SettingsStore.getTileWidth(), 150);
    SettingsStore.setTileWidth(220);
    assert.equal(SettingsStore.getTileWidth(), 220);
});

test('tileWidth clamps to range', () => {
    SettingsStore.setTileWidth(500);
    assert.equal(SettingsStore.getTileWidth(), 300, 'above max clamps to 300');
    SettingsStore.setTileWidth(40);
    assert.equal(SettingsStore.getTileWidth(), 100, 'below min clamps to 100');
    SettingsStore.setTileWidth('invalid');
    assert.equal(SettingsStore.getTileWidth(), 180, 'non-number falls back to default');
});

test('tileWidth persists in localStorage', () => {
    SettingsStore.setTileWidth(150);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.tileWidth, 150);
});

test('textSizeOptions and tileWidthOptions return valid arrays', () => {
    const textOptions = SettingsStore.getTextSizeOptions();
    assert.ok(Array.isArray(textOptions));
    assert.ok(textOptions.includes(16));
    assert.equal(textOptions[0], 8);
    assert.equal(textOptions[textOptions.length - 1], 18);

    const tileOptions = SettingsStore.getTileWidthOptions();
    assert.ok(Array.isArray(tileOptions));
    assert.ok(tileOptions.includes(180));
});
test('screen toggles persist and retrieve correctly', () => {
    assert.equal(SettingsStore.getScreenTopLeft(), false, 'defaults to false');
    SettingsStore.setScreenTopLeft(true);
    assert.equal(SettingsStore.getScreenTopLeft(), true);
    let raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.screenTopLeft, true);

    assert.equal(SettingsStore.getScreenTopRight(), false);
    SettingsStore.setScreenTopRight(true);
    assert.equal(SettingsStore.getScreenTopRight(), true);

    assert.equal(SettingsStore.getScreenBottomLeft(), false);
    SettingsStore.setScreenBottomLeft(true);
    assert.equal(SettingsStore.getScreenBottomLeft(), true);

    assert.equal(SettingsStore.getScreenBottomRight(), false);
    SettingsStore.setScreenBottomRight(true);
    assert.equal(SettingsStore.getScreenBottomRight(), true);
});

test('dismissing or disabling a screen clears it from mosaicSlots and settings', () => {
    globalThis.document = {
        getElementById: () => ({ style: {}, dataset: {}, classList: { toggle() {}, remove() {} }, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] }),
        querySelector: () => null,
        body: { classList: { toggle() {} } }
    };
    SettingsStore.setScreenTopLeft(true);
    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topLeft.player = { channel: { providerId: 'iptv-org', channelId: 'Test', name: 'Test' }, muted: true, stop: async () => {} };
    MultiView.slotsHydrated = true;

    MultiView.persistSlots();
    let state = JSON.parse(store.get('matrix_tv_state'));
    assert.ok(state.mosaicSlots.topLeft);

    MultiView.setSideEnabled('topLeft', false);
    assert.equal(SettingsStore.getScreenTopLeft(), false);
    state = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(state.screenTopLeft, false);
    assert.equal(state.screenLeft, false);
    assert.equal(state.mosaicSlots.topLeft, undefined);
    globalThis.document = undefined;
});



