/**
 * Boot migration + quota-safe persisted state writes.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let throwOnSetItem = false;
let setItemCalls = 0;

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => {
            setItemCalls += 1;
            if (throwOnSetItem) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            store.set(k, String(v));
        },
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() {
            return store.size;
        },
        key: (i) => [...store.keys()][i] ?? null
    };
});

let STATE_KEY;
let CORRUPT_BACKUP_KEY;
let STATE_SCHEMA_VERSION;
let parsePersistedStateRaw;
let patchPersistedState;
let writePersistedState;
let compactNonEssentialPersistedState;
let migratePersistedState;
let loadPlayerState;

before(async () => {
    ({
        STATE_KEY,
        parsePersistedStateRaw,
        patchPersistedState,
        writePersistedState,
        compactNonEssentialPersistedState
    } = await import('../js/storage/persistedState.js'));
    ({
        migratePersistedState,
        STATE_SCHEMA_VERSION,
        CORRUPT_BACKUP_KEY
    } = await import('../js/storage/stateMigration.js'));
    ({ loadPlayerState } = await import('../js/storage/playerState.js'));
});

beforeEach(() => {
    store.clear();
    throwOnSetItem = false;
    setItemCalls = 0;
});

test('migrate writes stateSchemaVersion and keeps favorites/folders', () => {
    store.set(STATE_KEY, JSON.stringify({
        favorites: ['BBC.uk', 'iptv-org:CNN.us'],
        favoritesMeta: [
            { key: 'BBC.uk', name: 'BBC', logo: '', countrycode: 'UK' },
            { key: 'iptv-org:CNN.us', name: 'CNN', logo: '', countrycode: 'US' }
        ],
        favoriteFolders: [{ id: 'f1', name: 'News', items: ['iptv-org:CNN.us'] }],
        favoritesRootOrder: ['BBC.uk'],
        volume: 0.4
    }));

    const result = migratePersistedState();
    assert.equal(result.migrated, true);
    assert.equal(result.repaired, false);

    const raw = JSON.parse(store.get(STATE_KEY));
    assert.equal(raw.stateSchemaVersion, STATE_SCHEMA_VERSION);
    assert.deepEqual(raw.favorites, ['iptv-org:BBC.uk', 'iptv-org:CNN.us']);
    assert.equal(raw.favoriteFolders.length, 1);
    assert.equal(raw.favoriteFolders[0].id, 'f1');
    assert.deepEqual(raw.favoriteFolders[0].items, ['iptv-org:CNN.us']);
    assert.ok(raw.chanBindScopeBySlot);
    assert.equal(raw.chanBindScope, undefined);
});

test('migrate is idempotent once versioned', () => {
    store.set(STATE_KEY, JSON.stringify({
        favorites: ['iptv-org:A.us'],
        volume: 0.5
    }));
    assert.equal(migratePersistedState().migrated, true);
    const first = store.get(STATE_KEY);
    assert.equal(migratePersistedState().migrated, false);
    assert.equal(store.get(STATE_KEY), first);
});

test('migrate legacy chanBindScope, categoryFilter string, headerCollapsed, channelPicker', () => {
    store.set(STATE_KEY, JSON.stringify({
        favorites: ['iptv-org:A.us'],
        favoriteFolders: [{ id: 'folder1', name: 'F', items: ['iptv-org:A.us'] }],
        chanBindScope: { mode: 'folder', folderId: 'folder1' },
        categoryFilter: 'news',
        headerCollapsed: true,
        channelPickerOpacity: 80,
        screenLeft: true,
        screenRight: false,
        channelPicker: {
            left: 10,
            top: 20,
            width: 300,
            height: 400,
            open: true
        },
        lastChannelKey: 'BareId.us'
    }));

    const result = migratePersistedState();
    assert.equal(result.migrated, true);

    const raw = JSON.parse(store.get(STATE_KEY));
    assert.equal(raw.stateSchemaVersion, STATE_SCHEMA_VERSION);
    assert.equal(raw.chanBindScope, undefined);
    assert.equal(raw.chanBindScopeBySlot.center.mode, 'folder');
    assert.equal(raw.chanBindScopeBySlot.center.folderId, 'folder1');
    assert.equal(raw.categoryFilter.channels, 'news');
    assert.equal(raw.categoryFilter.favorites, 'news');
    assert.equal(raw.headerMode, 'colorMark');
    assert.equal(raw.remoteModuleOpacity, 80);
    assert.equal(raw.channelPickerOpacity, undefined);
    assert.equal(raw.screenTopLeft, true);
    assert.equal(raw.screenTopRight, false);
    assert.equal(raw.screenLeft, undefined);
    assert.equal(raw.channelPicker, undefined);
    assert.ok(raw.remoteModule);
    assert.equal(raw.lastChannelKey, 'iptv-org:BareId.us');
});

test('corrupt JSON backs up and force-resets to versioned empty blob', () => {
    const corrupt = '{not-valid-json';
    store.set(STATE_KEY, corrupt);

    const result = migratePersistedState();
    assert.equal(result.migrated, true);
    assert.equal(result.repaired, true);
    assert.equal(store.get(CORRUPT_BACKUP_KEY), corrupt);

    const parsed = parsePersistedStateRaw();
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.stateSchemaVersion, STATE_SCHEMA_VERSION);
});

test('null hole in recentsMeta does not wipe favorites on load', () => {
    store.set(STATE_KEY, JSON.stringify({
        favorites: ['iptv-org:A.us'],
        favoritesMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US' }],
        mosaicSlots: {
            center: { key: 'iptv-org:A.us', name: 'A', muted: true, volume: 1, url: '' }
        },
        recentsMeta: [null, { key: 'iptv-org:B.us', name: 'B', logo: '', countrycode: 'US', at: 1 }]
    }));

    const state = loadPlayerState();
    assert.deepEqual(state.favorites, ['iptv-org:A.us']);
    assert.equal(state.mosaicSlots.center.key, 'iptv-org:A.us');
    assert.equal(state.recentsMeta.length, 1);
    assert.equal(state.recentsMeta[0].key, 'iptv-org:B.us');
});

test('patchPersistedState does not throw on QuotaExceeded and retries after compact', () => {
    store.set(STATE_KEY, JSON.stringify({
        favorites: ['iptv-org:A.us'],
        mosaicPlacement: {
            center: { x: 0, y: 0, w: 0.5, h: 0.5, z: 1 }
        },
        mosaicSlots: {
            center: { key: 'iptv-org:A.us', name: 'A', muted: true, volume: 1, url: 'https://example.com/x.m3u8' }
        },
        remoteModule: {
            left: 10, top: 20, width: 300, height: 400,
            mode: 'undocked', open: true, pinned: false, targetSlotId: 'center'
        },
        volume: 0.5
    }));

    let attempts = 0;
    const realSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (k, v) => {
        attempts += 1;
        if (attempts === 1) {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
        }
        store.set(k, String(v));
    };

    const warned = [];
    const prevWarn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
        const result = patchPersistedState({ volume: 0.9 });
        assert.equal(result.volume, 0.9);
        assert.deepEqual(result.mosaicPlacement, {});
        assert.equal(result.mosaicSlots.center.url, '');
        assert.equal(result.remoteModule.open, false);
        assert.equal(result.remoteModule.mode, 'hidden');
        assert.ok(warned.some((m) => /nonessential|quota/i.test(m)));
    } finally {
        console.warn = prevWarn;
        globalThis.localStorage.setItem = realSet;
    }

    const raw = JSON.parse(store.get(STATE_KEY));
    assert.equal(raw.volume, 0.9);
    assert.deepEqual(raw.favorites, ['iptv-org:A.us']);
    assert.equal(raw.mosaicSlots.center.url, '');
});

test('writePersistedState force replaces corrupt blob', () => {
    store.set(STATE_KEY, '{broken');
    const out = writePersistedState({ volume: 0.33, stateSchemaVersion: 1 }, { force: true });
    assert.equal(out.volume, 0.33);
    assert.equal(parsePersistedStateRaw().ok, true);
    assert.equal(JSON.parse(store.get(STATE_KEY)).volume, 0.33);
});

test('compactNonEssentialPersistedState keeps library keys', () => {
    const compacted = compactNonEssentialPersistedState({
        favorites: ['iptv-org:A.us'],
        favoriteFolders: [{ id: 'f1', name: 'F', items: [] }],
        mosaicPlacement: { center: { x: 0, y: 0, w: 1, h: 1, z: 1 } },
        mosaicSlots: { center: { key: 'iptv-org:A.us', name: 'A', url: 'http://x' } },
        remoteModule: { left: 1, top: 2, width: 300, height: 400, open: true, mode: 'undocked' },
        channelPicker: { left: 1, top: 2, width: 300, height: 400 }
    });
    assert.deepEqual(compacted.favorites, ['iptv-org:A.us']);
    assert.equal(compacted.favoriteFolders[0].id, 'f1');
    assert.deepEqual(compacted.mosaicPlacement, {});
    assert.equal(compacted.mosaicSlots.center.url, '');
    assert.equal(compacted.remoteModule.open, false);
    assert.equal(compacted.channelPicker, undefined);
});
