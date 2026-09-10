import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let ChannelGrid;
let PLAY_FAVORITES_MOSAIC_LIMIT;
let getFavoritesMosaicQueue;

before(async () => {
    globalThis.document = { getElementById: () => null, addEventListener: () => {} };
    globalThis.window = { addEventListener: () => {} };
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
    ({ ChannelGrid, PLAY_FAVORITES_MOSAIC_LIMIT, getFavoritesMosaicQueue } = await import('../js/ui/channelGrid.js'));
});

function ch(name, extra = {}) {
    return {
        providerId: 'iptv-org',
        channelId: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        logo: '',
        countrycode: '',
        categories: [],
        ...extra
    };
}

function keyOf(c) {
    return `${c.providerId}:${c.channelId}`;
}

function baseState(overrides = {}) {
    return {
        activeTab: 'favorites',
        browseCountry: null,
        favFilter: '',
        favoritesFolderId: null,
        favoritesList: [],
        sortBy: { favorites: 'custom' },
        sortDir: { favorites: 'asc' },
        categoryFilter: { favorites: '' },
        ...overrides
    };
}

test('root queue uses loose root channels only, caps at 5, skips folders', () => {
    ChannelGrid.init({ appState: baseState(), getRefreshKey: () => '', onPlay: () => {} });
    const channels = Array.from({ length: 7 }, (_, i) => ch(`Channel ${i + 1}`));
    const rootKeys = channels.map(keyOf);
    const folder = { id: 'f_1', name: 'Sports', items: [keyOf(channels[6])] };
    const state = baseState({ favoritesList: channels });
    const { list, folderId, folderName } = getFavoritesMosaicQueue({}, {
        appState: state,
        getFavoriteFolder: () => folder,
        getFavoritesRootOrder: () => rootKeys,
        filterVisible: (arr) => arr
    });
    assert.equal(PLAY_FAVORITES_MOSAIC_LIMIT, 5);
    assert.equal(folderId, null);
    assert.equal(folderName, '');
    assert.equal(list.length, 5);
    assert.deepEqual(list.map((c) => c.name), ['Channel 1', 'Channel 2', 'Channel 3', 'Channel 4', 'Channel 5']);
});

test('folder queue plays first 5 of open folder in display order', () => {
    ChannelGrid.init({ appState: baseState(), getRefreshKey: () => '', onPlay: () => {} });
    const channels = Array.from({ length: 8 }, (_, i) => ch(`Club ${i + 1}`));
    const folder = { id: 'f_9', name: 'Clubs', items: channels.map(keyOf) };
    const state = baseState({ favoritesList: channels, favoritesFolderId: 'f_9' });
    const { list, folderId, folderName } = getFavoritesMosaicQueue({}, {
        appState: state,
        getFavoriteFolder: (id) => (id === 'f_9' ? folder : null),
        getFavoritesRootOrder: () => [keyOf(channels[0])],
        filterVisible: (arr) => arr
    });
    assert.equal(folderId, 'f_9');
    assert.equal(folderName, 'Clubs');
    assert.equal(list.length, 5);
    assert.deepEqual(list.map((c) => c.name), ['Club 1', 'Club 2', 'Club 3', 'Club 4', 'Club 5']);
});

test('folder queue respects text filter, category filter, and hidden', () => {
    ChannelGrid.init({ appState: baseState(), getRefreshKey: () => '', onPlay: () => {} });
    const news = ch('Daily News', { categories: ['news'] });
    const sport = ch('Match Night', { categories: ['sports'] });
    const hidden = ch('Secret Stream', { categories: ['news'] });
    const folder = { id: 'f_2', name: 'Mixed', items: [news, sport, hidden].map(keyOf) };
    const state = baseState({
        favoritesList: [news, sport, hidden],
        favoritesFolderId: 'f_2',
        favFilter: '',
        categoryFilter: { favorites: 'news' }
    });
    const { list } = getFavoritesMosaicQueue({}, {
        appState: state,
        getFavoriteFolder: () => folder,
        getFavoritesRootOrder: () => [],
        filterVisible: (arr) => arr.filter((c) => c.name !== 'Secret Stream')
    });
    assert.deepEqual(list.map((c) => c.name), ['Daily News']);
});

test('stale folder id falls back to root view', () => {
    ChannelGrid.init({ appState: baseState(), getRefreshKey: () => '', onPlay: () => {} });
    const a = ch('Alpha');
    const b = ch('Beta');
    const state = baseState({ favoritesList: [a, b], favoritesFolderId: 'missing' });
    const { list, folderId } = getFavoritesMosaicQueue({}, {
        appState: state,
        getFavoriteFolder: () => null,
        getFavoritesRootOrder: () => [keyOf(a), keyOf(b)],
        filterVisible: (arr) => arr
    });
    assert.equal(folderId, null);
    assert.deepEqual(list.map((c) => c.name), ['Alpha', 'Beta']);
});

test('empty view returns empty queue', () => {
    ChannelGrid.init({ appState: baseState(), getRefreshKey: () => '', onPlay: () => {} });
    const state = baseState({ favoritesList: [] });
    const { list } = getFavoritesMosaicQueue({}, {
        appState: state,
        getFavoriteFolder: () => null,
        getFavoritesRootOrder: () => [],
        filterVisible: (arr) => arr
    });
    assert.deepEqual(list, []);
});
