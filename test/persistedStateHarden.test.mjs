/**
 * Persistence hardening: patch-only player writes, catalogLayout survival,
 * and corrupt-blob write refusal.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() {
            return store.size;
        },
        key: (i) => [...store.keys()][i] ?? null
    };
});

let savePlayerState;
let loadPlayerState;
let FavoritesRecents;
let SettingsStore;
let parsePersistedStateRaw;
let patchPersistedState;
let STATE_KEY;

before(async () => {
    ({
        savePlayerState,
        loadPlayerState
    } = await import('../js/storage/playerState.js'));
    ({ FavoritesRecents } = await import('../js/storage/favoritesRecents.js'));
    ({ SettingsStore } = await import('../js/storage/settingsStore.js'));
    ({
        parsePersistedStateRaw,
        patchPersistedState,
        STATE_KEY
    } = await import('../js/storage/persistedState.js'));
});

beforeEach(() => {
    store.clear();
});

test('volume save does not rewrite favoriteFolders (stale full-snapshot race)', () => {
    savePlayerState({
        favorites: ['iptv-org:A.us'],
        favoritesMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US' }],
        volume: 0.4
    });
    const folder = FavoritesRecents.createFavoriteFolder('Keep Me');
    assert.ok(folder?.id);

    // Unrelated player write that used to re-emit the entire library snapshot.
    savePlayerState({ volume: 0.9 });

    const state = loadPlayerState();
    assert.equal(state.volume, 0.9);
    assert.equal(state.favoriteFolders.length, 1);
    assert.equal(state.favoriteFolders[0].id, folder.id);
    assert.equal(state.favoriteFolders[0].name, 'Keep Me');

    const raw = JSON.parse(store.get(STATE_KEY));
    assert.equal(raw.favoriteFolders.length, 1);
    assert.equal(raw.favoriteFolders[0].name, 'Keep Me');
});

test('catalogLayout list survives unrelated savePlayerState volume write', () => {
    SettingsStore.setCatalogLayout('list');
    assert.equal(SettingsStore.getCatalogLayout(), 'list');

    savePlayerState({ volume: 0.55 });

    assert.equal(SettingsStore.getCatalogLayout(), 'list');
    const raw = JSON.parse(store.get(STATE_KEY));
    assert.equal(raw.catalogLayout, 'list');
    assert.equal(raw.volume, 0.55);
});

test('corrupt matrix_tv_state refuses patch write and keeps raw string', () => {
    const corrupt = '{not-valid-json';
    store.set(STATE_KEY, corrupt);

    const parsed = parsePersistedStateRaw();
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.value, {});

    const warned = [];
    const prevWarn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
        const result = patchPersistedState({ volume: 0.1, catalogLayout: 'list' });
        assert.deepEqual(result, {});
    } finally {
        console.warn = prevWarn;
    }

    assert.equal(store.get(STATE_KEY), corrupt, 'corrupt blob must not be replaced');
    assert.ok(warned.some((m) => /corrupt/i.test(m)));
});

test('savePlayerState volume against corrupt blob does not wipe folders string', () => {
    const corrupt = '{"favorites":["iptv-org:A.us"],"favoriteFolders":[{"id":"f1","name":"X","items":[]}],';
    store.set(STATE_KEY, corrupt);

    savePlayerState({ volume: 0.2 });

    assert.equal(store.get(STATE_KEY), corrupt);
});
