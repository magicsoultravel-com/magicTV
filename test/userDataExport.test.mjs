/**
 * Unit tests for user data export / import.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i] ?? null
    };
});

let UserDataExport;
let loadPlayerState;

before(async () => {
    ({ loadPlayerState } = await import('../js/storage/playerState.js'));
    UserDataExport = await import('../js/storage/userDataExport.js');
});

beforeEach(() => {
    store.clear();
});

function seedLocalState() {
    const state = {
        favorites: ['iptv-org:A.us'],
        favoritesMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US' }],
        favoriteFolders: [{ id: 'f_local', name: 'Local', items: ['iptv-org:A.us'] }],
        favoritesRootOrder: ['f_local'],
        recentsMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US', at: 100 }],
        hiddenChannels: [],
        hiddenChannelsMeta: [],
        visitedChannels: ['iptv-org:A.us'],
        visitedChannelsMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US' }],
        watchStatsMeta: [{ key: 'iptv-org:A.us', name: 'A', logo: '', countrycode: 'US', seconds: 30 }],
        themeId: 'neon',
        textSize: 14,
        volume: 0.5
    };
    store.set('matrix_tv_state', JSON.stringify(state));
    store.set('magic_tv_clock_style', 'digital');
    store.set('magic_tv_clock_hidden', 'false');
    store.set('magicTV:castHostAudio', 'true');
    store.set('magicTV:castHostVideo', 'false');
    return state;
}

function sampleImportPayload(overrides = {}) {
    return {
        format: UserDataExport.EXPORT_FORMAT,
        version: UserDataExport.EXPORT_VERSION,
        exportedAt: '2026-08-28T12:00:00.000Z',
        appVersion: '1.0.0',
        state: {
            favorites: ['iptv-org:B.us'],
            favoritesMeta: [{ key: 'iptv-org:B.us', name: 'B', logo: '', countrycode: 'GB' }],
            favoriteFolders: [{ id: 'f_imp', name: 'Imported', items: ['iptv-org:B.us'] }],
            favoritesRootOrder: ['f_imp'],
            recentsMeta: [{ key: 'iptv-org:B.us', name: 'B', logo: '', countrycode: 'GB', at: 200 }],
            hiddenChannels: ['iptv-org:C.us'],
            hiddenChannelsMeta: [{ key: 'iptv-org:C.us', name: 'C', logo: '', countrycode: 'DE' }],
            visitedChannels: ['iptv-org:B.us'],
            visitedChannelsMeta: [{ key: 'iptv-org:B.us', name: 'B', logo: '', countrycode: 'GB' }],
            watchStatsMeta: [{ key: 'iptv-org:B.us', name: 'B', logo: '', countrycode: 'GB', seconds: 40 }],
            themeId: 'classic',
            textSize: 16,
            volume: 0.2,
            ...overrides.state
        },
        extras: {
            clockStyle: 'analog',
            clockHidden: true,
            castHostAudio: false,
            castHostVideo: true,
            ...overrides.extras
        }
    };
}

test('buildUserDataExport includes state and extras', () => {
    seedLocalState();
    const payload = UserDataExport.buildUserDataExport();
    assert.equal(payload.format, UserDataExport.EXPORT_FORMAT);
    assert.equal(payload.version, UserDataExport.EXPORT_VERSION);
    assert.equal(payload.state.themeId, 'neon');
    assert.equal(payload.extras.clockStyle, 'digital');
    assert.equal(payload.extras.castHostAudio, true);
});

test('parseUserDataImport rejects invalid files', () => {
    assert.throws(() => UserDataExport.parseUserDataImport('{'), /Invalid JSON/);
    assert.throws(() => UserDataExport.parseUserDataImport('{}'), /Not a magicTV/);
    assert.throws(
        () => UserDataExport.parseUserDataImport(JSON.stringify({ format: UserDataExport.EXPORT_FORMAT, version: 99, state: {} })),
        /Unsupported backup version/
    );
});

test('parseUserDataImport accepts valid payload', () => {
    const payload = sampleImportPayload();
    const parsed = UserDataExport.parseUserDataImport(JSON.stringify(payload));
    assert.equal(parsed.state.favorites[0], 'iptv-org:B.us');
});

test('applyUserDataReplace overwrites local state and extras', () => {
    seedLocalState();
    const payload = sampleImportPayload();
    UserDataExport.applyUserDataReplace(payload);
    const player = loadPlayerState();
    assert.deepEqual(player.favorites, ['iptv-org:B.us']);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.textSize, 16);
    assert.equal(store.get('magic_tv_clock_style'), 'analog');
    assert.equal(store.get('magicTV:castHostAudio'), 'false');
});

test('applyUserDataMergeLibrary unions library data and keeps local settings', () => {
    seedLocalState();
    const payload = sampleImportPayload();
    UserDataExport.applyUserDataMergeLibrary(payload);
    const player = loadPlayerState();
    assert.deepEqual(player.favorites.sort(), ['iptv-org:A.us', 'iptv-org:B.us']);
    assert.equal(player.favoriteFolders.length, 2);
    assert.ok(player.favoriteFolders.some((f) => f.id === 'f_local'));
    assert.ok(player.favoriteFolders.some((f) => f.name === 'Imported'));
    assert.deepEqual(player.hiddenChannels, ['iptv-org:C.us']);
    assert.equal(player.watchStatsMeta.find((e) => e.key === 'iptv-org:A.us')?.seconds, 30);
    assert.equal(player.watchStatsMeta.find((e) => e.key === 'iptv-org:B.us')?.seconds, 40);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.themeId, 'neon');
    assert.equal(raw.textSize, 14);
    assert.equal(raw.volume, 0.5);
    assert.equal(store.get('magic_tv_clock_style'), 'digital');
});

test('merge remaps conflicting favorite folder ids', () => {
    seedLocalState();
    const payload = sampleImportPayload({
        state: {
            favoriteFolders: [{ id: 'f_local', name: 'Collision', items: ['iptv-org:B.us'] }]
        }
    });
    UserDataExport.applyUserDataMergeLibrary(payload);
    const player = loadPlayerState();
    const names = player.favoriteFolders.map((f) => f.name);
    assert.ok(names.includes('Local'));
    assert.ok(names.includes('Collision'));
    const ids = player.favoriteFolders.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('summarizeUserData reports counts', () => {
    const summary = UserDataExport.summarizeUserData(sampleImportPayload());
    assert.equal(summary.favorites, 1);
    assert.equal(summary.recents, 1);
    assert.equal(summary.hidden, 1);
    assert.equal(summary.visited, 1);
    assert.equal(summary.watchStats, 1);
});
