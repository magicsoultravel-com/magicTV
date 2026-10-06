/**
 * Unit tests for radio station bind index + up/down navigation.
 * Do not require a browser DOM.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildStationIndex,
    buildCountryStationIndex,
    clearCountryStationIndexCache,
    stationIndexForScope,
    peekCountryStationIndex,
    resolveAdjacentStation,
    navigateStation,
    bindScopeCacheKey,
    STATION_COUNTRY_BIND_LIMIT
} from '../js/radio/stationNav.js';
import {
    RADIO_STATE_KEY,
    normalizeStationBindScope,
    getStationBindScope,
    setStationBindScope,
    patchRadioState,
    loadRadioState
} from '../js/radio/radioState.js';
import { RadioProviderRegistry } from '../js/radio/radioProviders/registry.js';
import { RadioPlayer } from '../js/radio/radioPlayer.js';

function stubMethod(obj, key, impl) {
    const prev = obj[key];
    obj[key] = impl;
    return () => {
        obj[key] = prev;
    };
}

/** @type {Array<() => void>} */
let restores = [];

beforeEach(() => {
    clearCountryStationIndexCache();
    restores = [];
    globalThis.localStorage = {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; }
    };
});

afterEach(() => {
    while (restores.length) restores.pop()();
});

test('normalizeStationBindScope accepts country and uppercases code', () => {
    assert.deepEqual(
        normalizeStationBindScope({ mode: 'country', countryCode: 'gb' }, []),
        { mode: 'country', countryCode: 'GB' }
    );
    assert.deepEqual(
        normalizeStationBindScope({ mode: 'country', countryCode: '' }, []),
        { mode: 'favorites' }
    );
    assert.deepEqual(
        normalizeStationBindScope({ mode: 'folder', folderId: 'missing' }, []),
        { mode: 'favorites' }
    );
    assert.deepEqual(
        normalizeStationBindScope({ mode: 'folder', folderId: 'f1' }, [{ id: 'f1', items: ['a'] }]),
        { mode: 'folder', folderId: 'f1' }
    );
});

test('bindScopeCacheKey distinguishes country / folder / favorites', () => {
    assert.equal(bindScopeCacheKey({ mode: 'favorites' }), 'favorites');
    assert.equal(bindScopeCacheKey({ mode: 'folder', folderId: 'f1' }), 'folder:f1');
    assert.equal(bindScopeCacheKey({ mode: 'country', countryCode: 'PL' }), 'country:PL');
});

test('get/setStationBindScope persist favorites and country', () => {
    assert.deepEqual(getStationBindScope(), { mode: 'favorites' });
    setStationBindScope({ mode: 'country', countryCode: 'de' });
    assert.deepEqual(getStationBindScope(), { mode: 'country', countryCode: 'DE' });
    assert.deepEqual(loadRadioState().stationBindScope, { mode: 'country', countryCode: 'DE' });
    setStationBindScope({ mode: 'favorites' });
    assert.deepEqual(getStationBindScope(), { mode: 'favorites' });
});

test('buildStationIndex assigns 1-based numbers from favorites order', () => {
    patchRadioState({
        favorites: ['radio-browser:A', 'radio-browser:B', 'radio-browser:C']
    });
    const { keys, numberByKey } = buildStationIndex({ mode: 'favorites' });
    assert.deepEqual(keys, ['radio-browser:A', 'radio-browser:B', 'radio-browser:C']);
    assert.equal(numberByKey.get('radio-browser:A'), 1);
    assert.equal(numberByKey.get('radio-browser:B'), 2);
    assert.equal(numberByKey.get('radio-browser:C'), 3);
});

test('buildStationIndex folder mode walks folder items when present', () => {
    globalThis.localStorage.setItem(RADIO_STATE_KEY, JSON.stringify({
        favorites: ['radio-browser:root'],
        favoriteFolders: [{ id: 'f1', name: 'Jazz', items: ['radio-browser:J1', 'radio-browser:J2'] }],
        stationBindScope: { mode: 'folder', folderId: 'f1' }
    }));
    const { keys } = buildStationIndex({ mode: 'folder', folderId: 'f1' });
    assert.deepEqual(keys, ['radio-browser:J1', 'radio-browser:J2']);
});

test('buildCountryStationIndex caches and caps results', async () => {
    const stations = Array.from({ length: 5 }, (_, i) => ({
        providerId: 'radio-browser',
        stationId: `s${i}`,
        stationuuid: `s${i}`,
        name: `S${i}`,
        url_resolved: `http://x/${i}`,
        favicon: '',
        countrycode: 'US'
    }));
    const provider = {
        searchStations: async () => stations
    };
    restores.push(stubMethod(RadioProviderRegistry, 'getActive', () => provider));

    const first = await buildCountryStationIndex('us');
    assert.equal(first.keys.length, 5);
    assert.equal(first.numberByKey.get('radio-browser:s0'), 1);
    assert.ok(peekCountryStationIndex('US'));
    assert.equal(STATION_COUNTRY_BIND_LIMIT, 200);

    let calls = 0;
    restores.push(stubMethod(RadioProviderRegistry, 'getActive', () => ({
        searchStations: async () => {
            calls += 1;
            return stations;
        }
    })));
    await buildCountryStationIndex('US');
    assert.equal(calls, 0, 'second build should use cache');
});

test('stationIndexForScope country returns empty until cached', () => {
    const empty = stationIndexForScope({ mode: 'country', countryCode: 'NO' });
    assert.deepEqual(empty.keys, []);
});

test('resolveAdjacentStation wraps favorites and skips dead streams', async () => {
    patchRadioState({
        favorites: ['radio-browser:A', 'radio-browser:B', 'radio-browser:C'],
        stationBindScope: { mode: 'favorites' }
    });
    RadioPlayer.station = {
        providerId: 'radio-browser',
        stationId: 'A',
        stationuuid: 'radio-browser:A',
        name: 'A',
        url_resolved: 'http://a'
    };

    const resolveMap = {
        'radio-browser:A': { url_resolved: 'http://a', name: 'A', providerId: 'radio-browser', stationId: 'A' },
        'radio-browser:B': { url_resolved: '', name: 'B', providerId: 'radio-browser', stationId: 'B' },
        'radio-browser:C': { url_resolved: 'http://c', name: 'C', providerId: 'radio-browser', stationId: 'C' }
    };
    restores.push(stubMethod(RadioPlayer, 'resolveStation', async (key) => resolveMap[key] || null));

    const up = await resolveAdjacentStation({ direction: 'up', bindScope: { mode: 'favorites' } });
    assert.equal(up.key, 'radio-browser:C');
    assert.equal(up.number, 3);

    RadioPlayer.station = resolveMap['radio-browser:C'];
    const down = await resolveAdjacentStation({ direction: 'down', bindScope: { mode: 'favorites' } });
    assert.equal(down.key, 'radio-browser:A');
});

test('navigateStation toasts when bind list empty', async () => {
    patchRadioState({ favorites: [], stationBindScope: { mode: 'favorites' } });
    const toasts = [];
    const ok = await navigateStation('up', { showToast: (m) => toasts.push(m) });
    assert.equal(ok, false);
    assert.deepEqual(toasts, ['No stations bound']);
});

test('navigateStation plays next station', async () => {
    patchRadioState({
        favorites: ['radio-browser:A', 'radio-browser:B'],
        stationBindScope: { mode: 'favorites' }
    });
    RadioPlayer.station = {
        providerId: 'radio-browser',
        stationId: 'A',
        name: 'A',
        url_resolved: 'http://a'
    };
    restores.push(stubMethod(RadioPlayer, 'resolveStation', async (key) => ({
        providerId: 'radio-browser',
        stationId: key.split(':')[1],
        name: key,
        url_resolved: `http://${key}`
    })));
    const played = [];
    restores.push(stubMethod(RadioPlayer, 'playStation', async (station) => {
        played.push(stationKeyish(station));
    }));

    const ok = await navigateStation('up', { showToast: () => {} });
    assert.equal(ok, true);
    assert.deepEqual(played, ['radio-browser:B']);
});

function stationKeyish(station) {
    if (typeof station === 'string') return station;
    return `radio-browser:${station.stationId || station.stationuuid}`;
}
