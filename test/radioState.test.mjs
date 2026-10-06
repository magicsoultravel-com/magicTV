/**
 * Radio state schema: visited / hidden / folders / hideOffline default.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    RADIO_STATE_KEY,
    loadRadioState,
    patchRadioState,
    getHideOfflineStations,
    setHideOfflineStations,
    normalizeFavoriteFolders,
    normalizeFavoritesRootOrder
} from '../js/radio/radioState.js';
import { RadioLibrary } from '../js/radio/radioLibrary.js';

beforeEach(() => {
    globalThis.localStorage = {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; }
    };
});

test('hideOfflineStations defaults to false', () => {
    assert.equal(loadRadioState().hideOfflineStations, false);
    assert.equal(getHideOfflineStations(), false);
    setHideOfflineStations(true);
    assert.equal(getHideOfflineStations(), true);
    assert.equal(loadRadioState().hideOfflineStations, true);
});

test('legacy missing hideOffline key stays false (not true)', () => {
    localStorage.setItem(RADIO_STATE_KEY, JSON.stringify({ favorites: [] }));
    assert.equal(loadRadioState().hideOfflineStations, false);
});

test('normalizeFavoriteFolders drops items not in favorites', () => {
    const folders = normalizeFavoriteFolders(
        ['radio-browser:a', 'radio-browser:b'],
        [{ id: 'f1', name: 'X', items: ['radio-browser:a', 'radio-browser:missing'] }]
    );
    assert.deepEqual(folders[0].items, ['radio-browser:a']);
});

test('normalizeFavoritesRootOrder excludes folder members', () => {
    const folders = [{ id: 'f1', name: 'X', items: ['radio-browser:b'] }];
    const root = normalizeFavoritesRootOrder(
        ['radio-browser:a', 'radio-browser:b', 'radio-browser:c'],
        folders,
        ['radio-browser:c', 'radio-browser:a', 'radio-browser:b']
    );
    assert.deepEqual(root, ['radio-browser:c', 'radio-browser:a']);
});

test('markVisited is idempotent for same key', () => {
    assert.equal(RadioLibrary.markVisited('radio-browser:s1', { name: 'One', favicon: 'f', countrycode: 'US' }), true);
    assert.equal(RadioLibrary.markVisited('radio-browser:s1', { name: 'One', favicon: 'f', countrycode: 'US' }), true);
    assert.deepEqual(RadioLibrary.getVisitedKeys(), ['radio-browser:s1']);
    assert.equal(RadioLibrary.getVisitedMeta()[0].name, 'One');
});

test('hideStation filters visible list', () => {
    const stations = [
        { providerId: 'radio-browser', stationId: 'a', stationuuid: 'a', name: 'A', favicon: '', countrycode: 'US' },
        { providerId: 'radio-browser', stationId: 'b', stationuuid: 'b', name: 'B', favicon: '', countrycode: 'US' }
    ];
    RadioLibrary.hideStation(stations[0]);
    const visible = RadioLibrary.filterVisible(stations);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].stationId, 'b');
    RadioLibrary.unhideStation('radio-browser:a');
    assert.equal(RadioLibrary.filterVisible(stations).length, 2);
});

test('folder CRUD and toggleFavorite keep root order', () => {
    patchRadioState({ favorites: [] });
    assert.equal(RadioLibrary.toggleFavorite('radio-browser:x'), true);
    assert.equal(RadioLibrary.toggleFavorite('radio-browser:y'), true);
    const folder = RadioLibrary.createFavoriteFolder('Jazz');
    assert.ok(folder.id);
    assert.equal(RadioLibrary.moveFavoriteToFolder('radio-browser:x', folder.id), true);
    assert.ok(!RadioLibrary.getFavoritesRootOrder().includes('radio-browser:x'));
    assert.deepEqual(RadioLibrary.getFavoriteFolder(folder.id).items, ['radio-browser:x']);
    assert.equal(RadioLibrary.moveFavoriteToRoot('radio-browser:x'), true);
    assert.ok(RadioLibrary.getFavoritesRootOrder().includes('radio-browser:x'));
});
