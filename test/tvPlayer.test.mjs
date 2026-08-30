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
let FavoritesRecents;

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    Registry = (await import('../js/tvProviders/registry.js')).TvProviderRegistry;
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
    FavoritesRecents = (await import('../js/storage/favoritesRecents.js')).FavoritesRecents;
});

beforeEach(() => store.clear());

const CHANNEL = {
    id: 'CNN.us',
    name: 'CNN',
    country: 'US',
    countrycode: 'US',
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

test('favorites root order migrates from legacy favorites list', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.deepEqual(raw.favoritesRootOrder, ['iptv-org:CNN.us']);
    assert.deepEqual(raw.favoriteFolders, []);
});

test('create and delete empty favorite folder', () => {
    const folder = TvPlayer.createFavoriteFolder('News');
    assert.equal(folder.name, 'News');
    assert.deepEqual(folder.items, []);
    assert.deepEqual(TvPlayer.getFavoriteFolders().map((f) => f.id), [folder.id]);
    assert.deepEqual(TvPlayer.getFavoritesRootOrder(), []);
    assert.equal(TvPlayer.deleteFavoriteFolder(folder.id), true);
    assert.deepEqual(TvPlayer.getFavoriteFolders(), []);
    assert.deepEqual(TvPlayer.getFavoritesRootOrder(), []);
});

test('rename favorite folder persists name', () => {
    const folder = TvPlayer.createFavoriteFolder('Old name');
    assert.equal(TvPlayer.renameFavoriteFolder(folder.id, 'New name'), true);
    assert.equal(TvPlayer.getFavoriteFolder(folder.id).name, 'New name');
});

test('favorite folders render before root channels in storage order', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const folder = TvPlayer.createFavoriteFolder('Top');
    const b = { id: 'B.us', name: 'Beta', url_resolved: 'x' };
    TvPlayer.toggleFavorite(b);
    assert.deepEqual(TvPlayer.getFavoriteFolders()[0].id, folder.id);
    assert.ok(TvPlayer.getFavoritesRootOrder().includes('iptv-org:B.us'));
    assert.ok(!TvPlayer.getFavoritesRootOrder().includes(folder.id));
});

test('delete favorite folder rejects non-empty folder', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const folder = TvPlayer.createFavoriteFolder('News');
    TvPlayer.moveFavoriteToFolder('iptv-org:CNN.us', folder.id);
    assert.equal(TvPlayer.deleteFavoriteFolder(folder.id), false);
    assert.ok(TvPlayer.getFavoriteFolder(folder.id));
});

test('move favorite into folder and back to root', () => {
    const b = { id: 'B.us', name: 'Beta', url_resolved: 'x' };
    TvPlayer.toggleFavorite(CHANNEL);
    TvPlayer.toggleFavorite(b);
    const folder = TvPlayer.createFavoriteFolder('Group');
    assert.equal(TvPlayer.moveFavoriteToFolder('iptv-org:CNN.us', folder.id), true);
    assert.deepEqual(TvPlayer.getFavoriteFolder(folder.id).items, ['iptv-org:CNN.us']);
    assert.ok(!TvPlayer.getFavoritesRootOrder().includes('iptv-org:CNN.us'));
    assert.ok(TvPlayer.getFavoritesRootOrder().includes('iptv-org:B.us'));
    assert.equal(TvPlayer.moveFavoriteToRoot('iptv-org:CNN.us', { index: 0 }), true);
    assert.deepEqual(TvPlayer.getFavoriteFolder(folder.id).items, []);
    assert.equal(TvPlayer.getFavoritesRootOrder()[0], 'iptv-org:CNN.us');
});

test('unfavorite removes channel from folder layout', () => {
    TvPlayer.toggleFavorite(CHANNEL);
    const folder = TvPlayer.createFavoriteFolder('Group');
    TvPlayer.moveFavoriteToFolder('iptv-org:CNN.us', folder.id);
    TvPlayer.toggleFavorite(CHANNEL);
    assert.equal(TvPlayer.isFavorite(CHANNEL), false);
    assert.deepEqual(TvPlayer.getFavoriteFolder(folder.id).items, []);
});

test('mergeVisibleRootOrder keeps non-visible root channel keys', async () => {
    const { mergeVisibleRootOrder } = await import('../js/storage/favoritesRecents.js');
    const full = ['A', 'B', 'C'];
    const visible = ['C', 'B'];
    assert.deepEqual(mergeVisibleRootOrder(full, visible), ['A', 'C', 'B']);
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

// ----- Visited channels -----

test('markVisited records a channel and isVisited resolves it', () => {
    assert.equal(TvPlayer.isVisited('iptv-org:CNN.us'), false);
    assert.equal(TvPlayer.markVisited(CHANNEL), true);
    assert.equal(TvPlayer.isVisited(CHANNEL), true, 'object form resolves');
    assert.equal(TvPlayer.isVisited('iptv-org:CNN.us'), true, 'prefixed key resolves');
    assert.equal(TvPlayer.isVisited('CNN.us'), true, 'bare key resolves through migration');
});

test('markVisited is idempotent and persists without duplicates', () => {
    assert.equal(FavoritesRecents.markVisited('iptv-org:CNN.us'), true);
    assert.equal(FavoritesRecents.markVisited('CNN.us'), false, 'bare ref maps to same key');
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.visitedChannels.filter((k) => k === 'iptv-org:CNN.us').length, 1);
    assert.equal(FavoritesRecents.isVisited('iptv-org:CNN.us'), true);
});

test('reconciliation seeds visited from recents, favorites and last channel exactly once', () => {
    store.set('matrix_tv_state', JSON.stringify({
        favorites: ['iptv-org:CNN.us'],
        recentsMeta: [{ key: 'iptv-org:BBC.uk', name: 'BBC', at: 1 }],
        lastChannelKey: 'bbc-world' // legacy bare id → resolves to iptv-org:bbc-world
    }));

    FavoritesRecents.reconcileVisitedChannels();
    assert.equal(FavoritesRecents.isVisited('iptv-org:CNN.us'), true, 'favorite seeded');
    assert.equal(FavoritesRecents.isVisited('iptv-org:BBC.uk'), true, 'recent seeded');
    assert.equal(FavoritesRecents.isVisited('bbc-world'), true, 'lastChannelKey seeded with migration');

    let raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.visitedChannelsReconciled, true, 'reconcile flag persisted');
    assert.ok(raw.visitedChannels.includes('iptv-org:bbc-world'));

    // Second run must not re-add anything (flag short-circuits).
    FavoritesRecents.markVisited('iptv-org:NOW.us');
    raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.visitedChannels.includes('iptv-org:bbc-world'), true);
});

test('visited channels persist alongside recents after playback-record path', () => {
    TvPlayer.pushRecent('iptv-org:CNN.us', CHANNEL);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    // pushRecent alone does not mark visited; the player calls markVisited explicitly.
    assert.equal(raw.visitedChannels.length, 0);
    TvPlayer.markVisited('iptv-org:CNN.us');
    assert.equal(TvPlayer.isVisited('iptv-org:CNN.us'), true);
});

test('markVisited with channel object stores metadata for the settings browser', () => {
    TvPlayer.markVisited(CHANNEL);
    const meta = TvPlayer.getVisitedMeta();
    assert.equal(meta.length, 1);
    assert.equal(meta[0].key, 'iptv-org:CNN.us');
    assert.equal(meta[0].name, 'CNN');
    assert.equal(meta[0].logo, 'https://example.com/cnn.png');
    assert.equal(meta[0].countrycode, 'US');
});

test('unvisitChannel removes the channel from visited keys and meta', () => {
    TvPlayer.markVisited(CHANNEL);
    assert.equal(TvPlayer.isVisited(CHANNEL), true);
    assert.equal(TvPlayer.getVisitedMeta().length, 1);
    assert.equal(TvPlayer.unvisitChannel(CHANNEL), true, 'unvisit returns true');
    assert.equal(TvPlayer.isVisited(CHANNEL), false, 'no longer visited');
    assert.equal(TvPlayer.getVisitedMeta().length, 0, 'meta cleared');
    assert.equal(TvPlayer.unvisitChannel(CHANNEL), false, 'second call returns false');
});

test('reconciliation seeds visitedChannelsMeta alongside keys', () => {
    store.set('matrix_tv_state', JSON.stringify({
        favorites: [],
        recentsMeta: [{ key: 'iptv-org:BBC.uk', name: 'BBC', logo: '', countrycode: 'GB', at: 1 }],
        lastChannelKey: null
    }));
    FavoritesRecents.reconcileVisitedChannels();
    const meta = FavoritesRecents.getVisitedMeta();
    assert.ok(meta.some((m) => m.key === 'iptv-org:BBC.uk' && m.name === 'BBC'), 'meta seeded from recents');
});

// ----- Recents cap -----

test('recents cap defaults to 20 entries', () => {
    assert.equal(SettingsStore.getRecentsCap(), 20);
});

test('recents cap clamps to the 0..100 range', () => {
    assert.equal(SettingsStore.setRecentsCap(-1), 0, 'below min clamps to 0');
    assert.equal(SettingsStore.setRecentsCap(500), 100, 'above max clamps to 100');
    assert.equal(SettingsStore.setRecentsCap(0), 0, 'zero is allowed');
    assert.equal(SettingsStore.setRecentsCap(42), 42);
    assert.equal(SettingsStore.setRecentsCap('nope'), 20, 'non-number falls back to default');
});

test('pushRecent honors a custom cap', () => {
    SettingsStore.setRecentsCap(3);
    for (let i = 0; i < 6; i += 1) {
        TvPlayer.pushRecent(`iptv-org:cap-${i}`);
    }
    const recents = TvPlayer.getRecents();
    assert.equal(recents.length, 3);
    assert.equal(recents[0], 'iptv-org:cap-5', 'newest first');
});

test('lowering the recents cap trims existing history', () => {
    for (let i = 0; i < 8; i += 1) {
        TvPlayer.pushRecent(`iptv-org:t-${i}`);
    }
    SettingsStore.setRecentsCap(3);
    const meta = TvPlayer.getRecentsMeta();
    assert.equal(meta.length, 3);
    assert.equal(meta[0].key, 'iptv-org:t-7');
});

test('recents cap persists in localStorage', () => {
    SettingsStore.setRecentsCap(5);
    assert.equal(JSON.parse(store.get('matrix_tv_state')).recentsCap, 5);
});

// ----- Visited style setting -----

test('visited style defaults to accent-2', () => {
    assert.equal(SettingsStore.getVisitedStyle(), 'accent-2');
});

test('visited style accepts the accent options and falls back', () => {
    SettingsStore.setVisitedStyle('accent-2');
    assert.equal(SettingsStore.getVisitedStyle(), 'accent-2');
    SettingsStore.setVisitedStyle('accent-1');
    assert.equal(SettingsStore.getVisitedStyle(), 'accent-1');
    SettingsStore.setVisitedStyle('bogus');
    assert.equal(SettingsStore.getVisitedStyle(), 'accent-2', 'invalid falls back to default');
});

test('visited style persists in localStorage', () => {
    SettingsStore.setVisitedStyle('accent-3');
    assert.equal(JSON.parse(store.get('matrix_tv_state')).visitedStyle, 'accent-3');
});

// ----- Non-visited style setting -----

test('non-visited style defaults to undistinguished', () => {
    assert.equal(SettingsStore.getNonVisitedStyle(), 'undistinguished');
});

test('non-visited style accepts the accent options and falls back', () => {
    SettingsStore.setNonVisitedStyle('accent-2');
    assert.equal(SettingsStore.getNonVisitedStyle(), 'accent-2');
    SettingsStore.setNonVisitedStyle('accent-1');
    assert.equal(SettingsStore.getNonVisitedStyle(), 'accent-1');
    SettingsStore.setNonVisitedStyle('bogus');
    assert.equal(SettingsStore.getNonVisitedStyle(), 'undistinguished', 'invalid falls back to default');
});

test('non-visited style persists in localStorage', () => {
    SettingsStore.setNonVisitedStyle('accent-3');
    assert.equal(JSON.parse(store.get('matrix_tv_state')).nonVisitedStyle, 'accent-3');
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

test('mosaicSlots per-TV volume normalizes and defaults to 1', async () => {
    const { savePlayerState, loadPlayerState } = await import('../js/storage/playerState.js');
    savePlayerState({
        mosaicSlots: {
            center: { key: 'iptv-org:a', name: 'A', muted: false, volume: 1.7 },
            topLeft: { key: 'iptv-org:b', name: 'B', muted: true }
        }
    });
    const slots = loadPlayerState().mosaicSlots;
    assert.equal(slots.center.volume, 1);
    assert.equal(slots.topLeft.volume, 1);
    savePlayerState({
        mosaicSlots: {
            center: { key: 'iptv-org:a', name: 'A', muted: false, volume: 0.35 }
        }
    });
    assert.equal(loadPlayerState().mosaicSlots.center.volume, 0.35);
});

// ----- Registry settings -----

test('registry reports the iptv-org provider', () => {
    const providers = Registry.listProviders();
    assert.ok(providers.some((p) => p.id === 'iptv-org'));
    assert.equal(Registry.getActiveProviderId(), 'iptv-org');
});

// ----- Appearance Settings (SettingsStore) -----

test('textSize defaults to 12 (75%) and can be set and retrieved', () => {
    assert.equal(SettingsStore.getTextSize(), 12, 'defaults to 12px (75%)');
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
    assert.equal(SettingsStore.getTextSize(), 12, 'non-number falls back to default');
});

test('textSize persists in localStorage', () => {
    SettingsStore.setTextSize(14);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.textSize, 14);
});

test('tileWidth defaults to 120 and can be set and retrieved', () => {
    assert.equal(SettingsStore.getTileWidth(), 120, 'defaults to 120px');
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
    assert.equal(SettingsStore.getTileWidth(), 120, 'non-number falls back to default');
});

test('tileWidth persists in localStorage', () => {
    SettingsStore.setTileWidth(150);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.tileWidth, 150);
});

test('listWidth defaults to 120 and can be set and retrieved', () => {
    assert.equal(SettingsStore.getListWidth(), 120, 'defaults to 120px');
    SettingsStore.setListWidth(150);
    assert.equal(SettingsStore.getListWidth(), 150);
    SettingsStore.setListWidth(220);
    assert.equal(SettingsStore.getListWidth(), 220);
});

test('listWidth clamps to range', () => {
    SettingsStore.setListWidth(500);
    assert.equal(SettingsStore.getListWidth(), 300, 'above max clamps to 300');
    SettingsStore.setListWidth(40);
    assert.equal(SettingsStore.getListWidth(), 100, 'below min clamps to 100');
    SettingsStore.setListWidth('invalid');
    assert.equal(SettingsStore.getListWidth(), 120, 'non-number falls back to default');
});

test('listWidth persists in localStorage', () => {
    SettingsStore.setListWidth(200);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.listWidth, 200);
});

test('catalogLayout defaults to tiles and toggles', () => {
    assert.equal(SettingsStore.getCatalogLayout(), 'tiles');
    SettingsStore.setCatalogLayout('list');
    assert.equal(SettingsStore.getCatalogLayout(), 'list');
    SettingsStore.setCatalogLayout('bogus');
    assert.equal(SettingsStore.getCatalogLayout(), 'tiles', 'invalid falls back to tiles');
});

test('activeTileStyle defaults to wave', () => {
    assert.equal(SettingsStore.getActiveTileStyle(), 'wave');
});

test('visitedStyle defaults to accent-2; nonVisited to undistinguished', () => {
    assert.equal(SettingsStore.getVisitedStyle(), 'accent-2');
    assert.equal(SettingsStore.getNonVisitedStyle(), 'undistinguished');
});

test('view transitions default to random', () => {
    assert.equal(SettingsStore.getSwapTransition(), 'random');
    assert.equal(SettingsStore.getCatalogTransition(), 'random');
});

test('chanSwitchMode defaults to classic', () => {
    assert.equal(SettingsStore.getChanSwitchMode(), 'classic');
});

test('chanSwitchMode round-trip and invalid fallback', () => {
    SettingsStore.setChanSwitchMode('safeLoading');
    assert.equal(SettingsStore.getChanSwitchMode(), 'safeLoading');
    let raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.chanSwitchMode, 'safeLoading');

    SettingsStore.setChanSwitchMode('bogus');
    assert.equal(SettingsStore.getChanSwitchMode(), 'classic');

    SettingsStore.setChanSwitchMode('classic');
    assert.equal(SettingsStore.getChanSwitchMode(), 'classic');
});

test('remoteModuleOpacity migrates from channelPickerOpacity', () => {
    store.set('matrix_tv_state', JSON.stringify({ channelPickerOpacity: 55 }));
    assert.equal(SettingsStore.getRemoteModuleOpacity(), 55);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.remoteModuleOpacity, 55);
    assert.equal(raw.channelPickerOpacity, undefined);
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
        getElementById: () => ({
            style: {},
            dataset: {},
            classList: { toggle() {}, remove() {}, contains() { return false; } },
            setAttribute() {},
            querySelector: () => null,
            querySelectorAll: () => []
        }),
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
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'screenLeft'), false);
    assert.equal(state.mosaicSlots.topLeft, undefined);
    globalThis.document = undefined;
});



