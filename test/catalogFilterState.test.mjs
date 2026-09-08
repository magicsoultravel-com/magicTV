/**
 * Per-tab catalog filter restore for the shared search input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    catalogFilterValueForTab,
    applyCatalogFilterInput
} from '../js/ui/catalogFilterState.js';

test('favorites and recents restore their own stored filters', () => {
    const appState = {
        favFilter: 'bbc',
        recentsFilter: 'cnn',
        countryFilter: 'poland',
        browseQuery: 'news',
        browseCountry: null
    };
    assert.equal(catalogFilterValueForTab('favorites', appState), 'bbc');
    assert.equal(catalogFilterValueForTab('recents', appState), 'cnn');
    assert.equal(catalogFilterValueForTab('browse', appState), 'poland');
});

test('browse channel drill-down uses browseQuery', () => {
    const appState = {
        countryFilter: 'poland',
        browseQuery: 'sport',
        browseCountry: 'PL'
    };
    assert.equal(catalogFilterValueForTab('browse', appState), 'sport');
});

test('applyCatalogFilterInput writes stored value without clobbering state', () => {
    const appState = {
        favFilter: 'bbc',
        recentsFilter: 'cnn',
        countryFilter: 'stale-browse'
    };
    const search = { value: 'stale-browse' };
    applyCatalogFilterInput(search, 'favorites', appState);
    assert.equal(search.value, 'bbc');
    assert.equal(appState.favFilter, 'bbc');
    assert.equal(appState.recentsFilter, 'cnn');

    applyCatalogFilterInput(search, 'recents', appState);
    assert.equal(search.value, 'cnn');
    assert.equal(appState.favFilter, 'bbc');
});

test('applyCatalogFilterInput no-ops on missing element', () => {
    assert.doesNotThrow(() => applyCatalogFilterInput(null, 'favorites', { favFilter: 'x' }));
});
