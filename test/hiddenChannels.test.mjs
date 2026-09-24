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
        matchMedia: () => ({ matches: true }),
        setTimeout: globalThis.setTimeout?.bind(globalThis),
        requestAnimationFrame: (cb) => setTimeout(cb, 0)
    };
});

let TvPlayer;
let HiddenChannels;
let ChannelGrid;
let BrowseView;
let TvProviderRegistry;

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    HiddenChannels = (await import('../js/storage/hiddenChannels.js')).HiddenChannels;
    ChannelGrid = (await import('../js/ui/channelGrid.js')).ChannelGrid;
    BrowseView = (await import('../js/browse/browseView.js')).BrowseView;
    TvProviderRegistry = (await import('../js/tvProviders/registry.js')).TvProviderRegistry;
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

test('hide and unhide do not emit player state', () => {
    let emitted = 0;
    const prev = TvPlayer.emitState;
    TvPlayer.emitState = () => { emitted += 1; };
    try {
        assert.equal(TvPlayer.hideChannel(CHANNEL), true);
        assert.equal(TvPlayer.unhideChannel(CHANNEL), true);
        assert.equal(emitted, 0);
    } finally {
        TvPlayer.emitState = prev;
    }
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

function makeBrowseGrid(keys) {
    const tiles = keys.map((key) => {
        const tile = {
            dataset: { channel: key },
            removed: false,
            remove() {
                tile.removed = true;
                const i = grid._tiles.indexOf(tile);
                if (i >= 0) grid._tiles.splice(i, 1);
            }
        };
        return tile;
    });
    const grid = {
        _tiles: tiles,
        _innerHTML: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        get innerHTML() { return grid._innerHTML; },
        set innerHTML(v) {
            grid._innerHTML = String(v);
            if (v === '' || String(v).includes('empty-state')) grid._tiles = [];
        },
        querySelectorAll(sel) {
            const m = String(sel).match(/\.channel-tile\[data-channel="([^"]+)"\]/);
            if (m) return grid._tiles.filter((t) => t.dataset.channel === m[1]);
            if (sel === '.channel-tile') return [...grid._tiles];
            return [];
        },
        querySelector(sel) {
            if (sel === '.empty-state') {
                return String(grid._innerHTML).includes('empty-state') ? {} : null;
            }
            return grid.querySelectorAll(sel)[0] || null;
        }
    };
    return grid;
}

test('removeChannelTiles drops only the matching browse tile', () => {
    const bbc = 'iptv-org:BBC.uk';
    const cnn = 'iptv-org:CNN.us';
    const grid = makeBrowseGrid([bbc, cnn]);
    const appState = {
        activeTab: 'browse',
        browseCountry: 'GB',
        browseChannels: [
            { ...CHANNEL, providerId: 'iptv-org', channelId: 'BBC.uk' },
            { ...OTHER, providerId: 'iptv-org', channelId: 'CNN.us' }
        ]
    };
    const prevDoc = globalThis.document;
    globalThis.document = {
        getElementById: (id) => (id === 'channels-container' ? grid : null)
    };
    try {
        ChannelGrid.init({ appState, getRefreshKey: () => 'browse:GB', onPlay: () => {} });
        assert.equal(ChannelGrid.removeChannelTiles(bbc), true);
        assert.equal(grid._tiles.length, 1);
        assert.equal(grid._tiles[0].dataset.channel, cnn);
        assert.equal(appState.browseChannels.length, 2, 'browseChannels kept for unhide restore');
    } finally {
        globalThis.document = prevDoc;
    }
});

function makeDomEl() {
    return {
        id: '', className: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, appendChild() {}, remove() {}, childElementCount: 0
    };
}

/**
 * Document stub for browse-path tests. ChannelGrid.hideChannel toasts, and
 * showAppToast needs document.createElement + document.body (a bare getElementById
 * stub throws "createElement is not a function"), plus requestAnimationFrame for the
 * show animation. Accepts sync or async fn and always restores.
 */
function withBrowseDom(grid, fn) {
    const prevDoc = globalThis.document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevTimeout = globalThis.window?.setTimeout;
    globalThis.document = {
        getElementById: (id) => (id === 'channels-container' ? grid : null),
        createElement: () => makeDomEl(),
        body: { appendChild() {} }
    };
    // scheduleBrowseFillCheck / showAppToast defer via requestAnimationFrame; run it
    // synchronously so no callback escapes past restore() with document torn down.
    globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
    // Toast auto-dismiss timers are irrelevant to these assertions and would
    // otherwise hold the process open for the 2200ms duration.
    if (globalThis.window) globalThis.window.setTimeout = () => 0;
    const restore = () => {
        globalThis.document = prevDoc;
        if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = prevRaf;
        if (globalThis.window && prevTimeout !== undefined) globalThis.window.setTimeout = prevTimeout;
    };
    try {
        const out = fn();
        if (out && typeof out.then === 'function') return out.finally(restore);
        restore();
        return out;
    } catch (err) {
        restore();
        throw err;
    }
}

/** Capture the list handed to a ChannelGrid method, restoring the method afterwards. */
function capturing(method, fn) {
    const prev = ChannelGrid[method];
    let captured = null;
    ChannelGrid[method] = (_container, list) => { captured = list; };
    try {
        fn();
    } finally {
        ChannelGrid[method] = prev;
    }
    return captured;
}

test('restoreView renders browseChannels with hidden ones filtered out', () => {
    TvPlayer.hideChannel(CHANNEL);
    const appState = {
        activeTab: 'browse',
        browseCountry: 'GB',
        browseChannels: [CHANNEL, OTHER],
        sortBy: {},
        sortDir: {}
    };
    BrowseView.init({ appState, stampRefreshView: () => {}, currentFilter: () => '' });
    const rendered = capturing('render', () => withBrowseDom(makeBrowseGrid([]), () => BrowseView.restoreView()));
    assert.ok(rendered, 'render was called');
    assert.equal(rendered.length, 1, 'hidden channel is not rendered');
    assert.equal(rendered[0].id, 'CNN.us');
});

test('loadMoreChannels keeps hidden rows in browseChannels but renders them filtered', async () => {
    TvPlayer.hideChannel(CHANNEL);
    const appState = {
        activeTab: 'browse',
        browseCountry: 'GB',
        browseChannels: [],
        browseOffset: 0,
        browseHasMore: true,
        browseLoading: false,
        browseGeneration: 0,
        browseSortDirty: false,
        browseQuery: '',
        sortBy: {},
        sortDir: {},
        categoryFilter: {}
    };
    const prevSearch = TvProviderRegistry.searchChannels;
    TvProviderRegistry.searchChannels = async () => [CHANNEL, OTHER];
    let rendered = null;
    const prevRender = ChannelGrid.render;
    ChannelGrid.render = (_container, list) => { rendered = list; };
    try {
        BrowseView.init({ appState, stampRefreshView: () => {}, currentFilter: () => '' });
        await withBrowseDom(makeBrowseGrid([]), () => BrowseView.loadMoreChannels());
        assert.equal(appState.browseChannels.length, 2, 'master set keeps hidden rows');
        assert.ok(rendered, 'render was called');
        assert.equal(rendered.length, 1, 'render receives visible rows only');
        assert.equal(rendered[0].id, 'CNN.us');
    } finally {
        TvProviderRegistry.searchChannels = prevSearch;
        ChannelGrid.render = prevRender;
    }
});

test('hide in browse, unhide in settings, back to browse keeps other channels hideable', () => {
    const grid = makeBrowseGrid(['iptv-org:BBC.uk', 'iptv-org:CNN.us']);
    const appState = {
        activeTab: 'browse',
        browseCountry: 'GB',
        browseChannels: [CHANNEL, OTHER],
        sortBy: {},
        sortDir: {}
    };
    withBrowseDom(grid, () => {
        ChannelGrid.init({ appState, getRefreshKey: () => 'browse:GB', onPlay: () => {} });
        BrowseView.init({ appState, stampRefreshView: () => {}, currentFilter: () => '' });

        // 1. hide in browse — tile leaves the grid, master set keeps the row
        assert.equal(ChannelGrid.hideChannel(CHANNEL), true);
        assert.equal(TvPlayer.isHidden(CHANNEL), true);
        assert.equal(grid._tiles.length, 1, 'BBC tile removed from browse grid');

        // 2. unhide from Settings while browse is not the active tab
        appState.activeTab = 'settings';
        assert.equal(TvPlayer.unhideChannel(CHANNEL), true);
        ChannelGrid.revealChannelTiles(CHANNEL);
        assert.equal(grid._tiles.length, 1, 'off-tab reveal leaves the browse DOM alone');
        assert.equal(appState.browseChannels.length, 2, 'master set intact for restore');

        // 3. returning to browse renders filtered — BBC comes back
        appState.activeTab = 'browse';
        const rendered = capturing('render', () => withBrowseDom(grid, () => BrowseView.restoreView()));
        assert.equal(rendered.length, 2, 'both channels render after unhide');

        // 4. the other channel is still hideable (the reported symptom)
        assert.equal(ChannelGrid.hideChannel(OTHER), true, 'other channel still hideable');
        assert.equal(TvPlayer.isHidden(OTHER), true);
    });
});

test('renderBrowseChannels reorders with the filtered list only', () => {
    TvPlayer.hideChannel(CHANNEL);
    const appState = {
        activeTab: 'browse',
        browseCountry: 'GB',
        browseChannels: [CHANNEL, OTHER],
        sortBy: { channels: 'name' },
        sortDir: { channels: 'asc' },
        browseSortDirty: false
    };
    BrowseView.init({ appState, stampRefreshView: () => {}, currentFilter: () => '' });
    const reordered = capturing('reorder', () => withBrowseDom(makeBrowseGrid([]), () => BrowseView.renderBrowseChannels({ dirOnly: true })));
    assert.ok(reordered, 'reorder was called');
    assert.equal(reordered.length, 1, 'hidden channel excluded from the reorder list');
    assert.equal(reordered[0].id, 'CNN.us');
});
