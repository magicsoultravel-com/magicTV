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

before(async () => {
    TvPlayer = (await import('../js/tvPlayer.js')).TvPlayer;
    HiddenChannels = (await import('../js/storage/hiddenChannels.js')).HiddenChannels;
    ChannelGrid = (await import('../js/ui/channelGrid.js')).ChannelGrid;
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
