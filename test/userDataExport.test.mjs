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
    assert.equal(raw.stateSchemaVersion, 2);
    assert.equal(store.get('magic_tv_clock_style'), 'analog');
    assert.equal(store.get('magic_tv_clock_hidden'), '1');
    assert.equal(store.get('magicTV:castHostAudio'), 'false');
});

test('applyUserDataReplace canonicalizes sparse backup and strips orphans', async () => {
    seedLocalState();
    const localBefore = store.get('matrix_tv_state');
    const payload = {
        format: UserDataExport.EXPORT_FORMAT,
        version: UserDataExport.EXPORT_VERSION,
        exportedAt: '2026-09-23T00:00:00.000Z',
        appVersion: '1.0.0',
        state: {
            favorites: ['iptv-org:Sparse.us'],
            volume: 0.1,
            browserW: 908,
            browserH: 711,
            liveOffset: 3,
            hideOfflineChannels: true,
            browseSort: 'name'
        },
        extras: {
            clockStyle: 'segment',
            clockHidden: false,
            castHostAudio: false,
            castHostVideo: false
        }
    };
    const { canonicalizePersistedState } = await import('../js/storage/stateMigration.js');
    const preview = canonicalizePersistedState(payload.state);
    assert.equal(store.get('matrix_tv_state'), localBefore);
    assert.equal(preview.browserW, undefined);
    assert.equal(preview.stateSchemaVersion, 2);

    UserDataExport.applyUserDataReplace(payload);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.deepEqual(raw.favorites, ['iptv-org:Sparse.us']);
    assert.equal(raw.stateSchemaVersion, 2);
    assert.equal(raw.browserW, undefined);
    assert.equal(raw.liveOffset, undefined);
    assert.equal(raw.hideOfflineChannels, undefined);
    assert.equal(raw.themeId, undefined);
    assert.deepEqual(raw.favoriteFolders, []);
});

test('buildUserDataExport emits canonical state without mutating storage', () => {
    store.set('matrix_tv_state', JSON.stringify({
        favorites: ['iptv-org:A.us'],
        volume: 0.4,
        browserW: 908,
        liveOffset: 3,
        hideOfflineChannels: true
    }));
    store.set('magic_tv_clock_hidden', '1');
    const before = store.get('matrix_tv_state');
    const payload = UserDataExport.buildUserDataExport();
    assert.equal(store.get('matrix_tv_state'), before);
    assert.equal(payload.state.stateSchemaVersion, 2);
    assert.equal(payload.state.browserW, undefined);
    assert.equal(payload.state.liveOffset, undefined);
    assert.equal(payload.extras.clockHidden, true);
});

test('clockHidden round-trips with tvClock 1/0 storage', () => {
    seedLocalState();
    store.set('magic_tv_clock_hidden', '1');
    const exported = UserDataExport.buildUserDataExport();
    assert.equal(exported.extras.clockHidden, true);

    store.clear();
    seedLocalState();
    store.set('magic_tv_clock_hidden', '0');
    UserDataExport.applyUserDataReplace({
        ...exported,
        extras: { ...exported.extras, clockHidden: true }
    });
    assert.equal(store.get('magic_tv_clock_hidden'), '1');
});

test('summarizeUserData flags sparse backups', () => {
    const summary = UserDataExport.summarizeUserData({
        format: UserDataExport.EXPORT_FORMAT,
        version: 1,
        state: {
            favorites: ['iptv-org:A.us', 'iptv-org:B.us'],
            recentsMeta: []
        }
    });
    assert.equal(summary.favorites, 2);
    assert.equal(summary.folders, 0);
    assert.equal(summary.sparse, true);
    assert.ok(summary.warnings.some((w) => /folders/i.test(w)));
    assert.ok(summary.warnings.some((w) => /stateSchemaVersion/i.test(w)));
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

test('clearAllUserData removes exportable localStorage keys only', () => {
    seedLocalState();
    store.set('matrix_tv_state_corrupt_backup', '{"broken":true}');
    store.set('magicTV:castState', '{"connected":true}');
    store.set('matrix_tv_iptv_cache', '{"legacy":true}');
    UserDataExport.clearAllUserData();
    assert.equal(store.has('matrix_tv_state'), false);
    assert.equal(store.has('matrix_tv_state_corrupt_backup'), false);
    assert.equal(store.has('magic_tv_clock_style'), false);
    assert.equal(store.has('magic_tv_clock_hidden'), false);
    assert.equal(store.has('magicTV:castHostAudio'), false);
    assert.equal(store.has('magicTV:castHostVideo'), false);
    assert.equal(store.has('magicTV:castState'), false);
    // Legacy/cache-ish key left alone by flush
    assert.equal(store.get('matrix_tv_iptv_cache'), '{"legacy":true}');
});

test('factoryResetUserData clears user data and prefixed localStorage keys', async () => {
    seedLocalState();
    store.set('matrix_tv_state_corrupt_backup', '{"broken":true}');
    store.set('magicTV:castState', '{"connected":true}');
    store.set('matrix_tv_iptv_cache', '{"legacy":true}');
    store.set('matrix_tv_epg_guides', '[]');
    await UserDataExport.factoryResetUserData();
    assert.equal(store.has('matrix_tv_state'), false);
    assert.equal(store.has('magic_tv_clock_style'), false);
    assert.equal(store.has('magicTV:castState'), false);
    assert.equal(store.has('matrix_tv_iptv_cache'), false);
    assert.equal(store.has('matrix_tv_epg_guides'), false);
});
