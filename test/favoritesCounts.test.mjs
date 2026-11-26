/**
 * Regression tests for favorites folder counts vs. rendered tiles.
 *
 * Bug 1 (hydration): channels the provider cannot resolve were dropped from
 * `appState.favoritesList`, so a folder holding 3 refs rendered 1 tile while
 * the tile label said "3". Reorder then failed its length guard.
 * Bug 2 (count): the folder tile label used the raw stored item count while
 * the folder view applied text / category / hidden filters.
 */
import test, { before } from 'node:test';
import assert from 'node:assert';

let ChannelGrid;
let getFavoritesMosaicQueue;
let mergeFavoriteChannels;
let TvPlayer;
let TvProviderRegistry;
let TileFrames;
let Appearance;
let FavoritesFolders;
let channelKey;

const store = new Map();

before(async () => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    globalThis.window = { addEventListener: () => {} };
    globalThis.document = {
        getElementById: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
    };
    ({ ChannelGrid, getFavoritesMosaicQueue, mergeFavoriteChannels } = await import('../js/ui/channelGrid.js'));
    ({ TvPlayer } = await import('../js/tvPlayer.js'));
    ({ TvProviderRegistry } = await import('../js/tvProviders/registry.js'));
    ({ TileFrames } = await import('../js/tileFrames.js'));
    ({ Appearance } = await import('../js/ui/appearance.js'));
    ({ FavoritesFolders } = await import('../js/ui/favoritesFolders.js'));
    ({ channelKey } = await import('../js/tvProviders/channelShape.js'));
    // Keep the render path pure markup — no capture loop, no appearance CSS.
    TileFrames.observe = () => {};
    Appearance.applyToTiles = () => {};
});

function ch(name, extra = {}) {
    return {
        providerId: 'iptv-org',
        channelId: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        logo: '',
        countrycode: '',
        url_resolved: `https://example.test/${name}.m3u8`,
        categories: [],
        ...extra
    };
}

function fakeNode(id) {
    return {
        id,
        innerHTML: '',
        dataset: {},
        textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {},
        appendChild() {},
        removeChild() {},
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    };
}

let nodes = {};

function installDom() {
    nodes = {
        'favorites-grid': fakeNode('favorites-grid'),
        'favorites-empty': fakeNode('favorites-empty'),
        'recents-grid': fakeNode('recents-grid'),
        'recents-empty': fakeNode('recents-empty')
    };
    globalThis.document = {
        getElementById: (id) => nodes[id] || null,
        querySelectorAll: () => [],
        createElement: () => fakeNode(''),
        addEventListener: () => {}
    };
}

function baseState(overrides = {}) {
    return {
        activeTab: 'favorites',
        catalogMode: 'tv',
        favFilter: '',
        recentsFilter: '',
        favoritesFolderId: null,
        favoritesList: [],
        recentsList: [],
        sortBy: { favorites: 'custom', recents: 'custom' },
        sortDir: { favorites: 'asc', recents: 'asc' },
        categoryFilter: { favorites: '', recents: '' },
        ...overrides
    };
}

function countTiles(node) {
    return (node.innerHTML.match(/class="channel-tile[ "]/g) || []).length;
}

function resetLibrary() {
    store.clear();
}

test('mergeFavoriteChannels keeps unresolvable refs as placeholders', () => {
    const keys = ['iptv-org:a', 'iptv-org:b', 'iptv-org:missing'];
    const meta = [
        { key: 'iptv-org:a', name: 'Alpha', logo: 'a.png', countrycode: 'GB' },
        { key: 'iptv-org:missing', name: 'Gone', at: 1234 }
    ];
    const hydrated = [ch('Bravo', { channelId: 'b', channeluuid: 'iptv-org:b' })];

    const list = mergeFavoriteChannels(keys, meta, hydrated);

    assert.deepEqual(list.map((c) => channelKey(c)), keys, 'order and length follow stored refs');
    assert.equal(list[0].name, 'Alpha', 'hydrated miss falls back to stored meta');
    assert.equal(list[1].name, 'Bravo', 'hydrated channel wins');
    assert.equal(list[1].url_resolved, 'https://example.test/Bravo.m3u8');
    assert.equal(list[2].name, 'Gone');
    assert.equal(list[2].url_resolved, '', 'placeholder is not playable');
    assert.equal(list[2].at, 1234, 'recents timestamp survives');
});

test('folder with an unresolvable favorite renders every tile and keeps storage intact', async () => {
    resetLibrary();
    installDom();
    const [a, b, c] = [ch('Alpha'), ch('Bravo'), ch('Charlie')];
    [a, b, c].forEach((channel) => TvPlayer.toggleFavorite(channel));
    const folder = TvPlayer.createFavoriteFolder('News');
    [a, b, c].forEach((channel) => TvPlayer.moveFavoriteToFolder(channelKey(channel), folder.id));

    const appState = baseState({ favoritesFolderId: folder.id });
    ChannelGrid.init({ appState, getRefreshKey: () => '', onPlay: () => {} });
    // Provider resolves one of the three refs (stale catalog / URL-less rows).
    TvProviderRegistry.getChannelsByRefs = async () => [b];

    await ChannelGrid.refreshFavorites();

    assert.equal(appState.favoritesList.length, 3, 'no refs are dropped from the render list');
    assert.equal(countTiles(nodes['favorites-grid']), 3, 'all folder members paint a tile');
    assert.equal(TvPlayer.getFavoriteFolder(folder.id).items.length, 3, 'storage is never pruned');

    // Drag-reorder sends the visible keys back; the length guard must accept them.
    const visibleKeys = appState.favoritesList.map((channel) => channelKey(channel));
    const reordered = [...visibleKeys];
    reordered.push(reordered.shift());
    assert.equal(TvPlayer.reorderFavoriteFolderItems(folder.id, reordered), true,
        'reorder accepts the full visible set (a hydrated subset would fail the length guard)');

    // Mosaic must never queue the unplayable placeholder.
    const queue = getFavoritesMosaicQueue({}, {
        appState,
        getMaxSlots: () => 5,
        getFavoriteFolder: () => TvPlayer.getFavoriteFolder(folder.id)
    });
    assert.deepEqual(queue.list.map((channel) => channelKey(channel)), ['iptv-org:bravo']);
    assert.equal(queue.folderName, 'News');
});

test('folder tile label reflects the filtered, visible contents', async () => {
    resetLibrary();
    installDom();
    const [a, b, c] = [ch('Alpha'), ch('Bravo'), ch('Charlie')];
    [a, b, c].forEach((channel) => TvPlayer.toggleFavorite(channel));
    const folder = TvPlayer.createFavoriteFolder('News');
    [a, b, c].forEach((channel) => TvPlayer.moveFavoriteToFolder(channelKey(channel), folder.id));

    const appState = baseState();
    ChannelGrid.init({ appState, getRefreshKey: () => '', onPlay: () => {} });
    TvProviderRegistry.getChannelsByRefs = async () => [a, b, c];
    await ChannelGrid.refreshFavorites();

    assert.match(nodes['favorites-grid'].innerHTML, /3 channels/, 'unfiltered folder keeps the plain count');
    assert.doesNotMatch(nodes['favorites-grid'].innerHTML, /of 3 channels/);

    TvPlayer.hideChannel(a);
    ChannelGrid.renderFavorites();
    assert.match(nodes['favorites-grid'].innerHTML, /2 of 3 channels/,
        'hidden channels shrink the label to what the folder view shows');

    appState.favoritesFolderId = folder.id;
    ChannelGrid.renderFavorites();
    assert.equal(countTiles(nodes['favorites-grid']), 2, 'folder view renders the same two tiles');
});

test('root favorites keep unresolved refs so reorder and mosaic stay aligned', async () => {
    resetLibrary();
    installDom();
    const [a, b] = [ch('Alpha'), ch('Bravo')];
    [a, b].forEach((channel) => TvPlayer.toggleFavorite(channel));

    const appState = baseState();
    ChannelGrid.init({ appState, getRefreshKey: () => '', onPlay: () => {} });
    TvProviderRegistry.getChannelsByRefs = async (refs) => (refs.includes(channelKey(a)) ? [a] : []);

    await ChannelGrid.refreshFavorites();

    assert.equal(appState.favoritesList.length, 2);
    assert.equal(countTiles(nodes['favorites-grid']), 2, 'placeholder root tile still renders');
    const visibleKeys = appState.favoritesList.map((channel) => channelKey(channel));
    assert.deepEqual(visibleKeys, TvPlayer.getFavoritesRootOrder());
    assert.equal(TvPlayer.reorderFavoritesRoot([...visibleKeys].reverse()), true,
        'reorder no longer fails on the hydrated subset length');
});

test('recents keep unresolved entries with their timestamps', async () => {
    resetLibrary();
    installDom();
    const [a, b] = [ch('Alpha'), ch('Bravo')];
    TvPlayer.pushRecent(channelKey(a), a);
    TvPlayer.pushRecent(channelKey(b), b);

    const appState = baseState({ activeTab: 'recents' });
    ChannelGrid.init({ appState, getRefreshKey: () => '', onPlay: () => {} });
    TvProviderRegistry.getChannelsByRefs = async () => [a];

    const storedAt = new Map(TvPlayer.getRecentsMeta().map((entry) => [entry.key, entry.at]));
    await ChannelGrid.refreshRecents();

    assert.equal(appState.recentsList.length, 2);
    assert.equal(countTiles(nodes['recents-grid']), 2);
    for (const channel of appState.recentsList) {
        assert.equal(channel.at, storedAt.get(channelKey(channel)),
            'at survives for hydrated and placeholder entries');
    }
});

test('folderTileHtml labels partial and empty folders honestly', () => {
    const folder = { id: 'f_1', name: 'News', items: ['a', 'b', 'c'] };
    assert.match(FavoritesFolders.folderTileHtml(folder), /3 channels/);
    assert.match(FavoritesFolders.folderTileHtml(folder, { visible: 2 }), /2 of 3 channels/);
    assert.match(FavoritesFolders.folderTileHtml(folder, { visible: 0 }), /0 of 3 channels/);
    assert.match(FavoritesFolders.folderTileHtml(folder, { visible: 9 }), /3 channels/, 'clamped to total');
    assert.match(FavoritesFolders.folderTileHtml({ id: 'f_2', items: ['a'] }), /1 channel/);
    assert.match(FavoritesFolders.folderTileHtml({ id: 'f_3', items: [] }), /0 channels/);
});
