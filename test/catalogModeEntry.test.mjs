/**
 * Catalog mode is owned by entry point (not sticky across TV surfaces).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BROWSER_TABS,
    catalogModeForEntry,
    isBrowserCatalogTab
} from '../js/ui/catalogModeEntry.js';

describe('catalogModeEntry', () => {
    it('lists browser catalog tabs', () => {
        assert.deepEqual([...BROWSER_TABS], ['browse', 'favorites', 'recents', 'settings']);
        assert.equal(isBrowserCatalogTab('browse'), true);
        assert.equal(isBrowserCatalogTab('remote'), false);
    });

    it('remote shell, chrome tile, and welcome always force TV', () => {
        assert.equal(catalogModeForEntry('remote-shell'), 'tv');
        assert.equal(catalogModeForEntry('chrome-tile'), 'tv');
        assert.equal(catalogModeForEntry('welcome'), 'tv');
    });

    it('radio module forces radio catalog', () => {
        assert.equal(catalogModeForEntry('radio-module'), 'radio');
    });

    it('browser-shell nav keeps current mode (sticky within radio session)', () => {
        assert.equal(catalogModeForEntry('browser-shell'), 'keep');
    });

    it('after radio, TV entry points still resolve to tv (not sticky)', () => {
        // Simulate: user opened radio, then returned via remote or chrome.
        const afterRadio = 'radio';
        for (const source of ['remote-shell', 'chrome-tile', 'welcome']) {
            const next = catalogModeForEntry(source);
            assert.equal(next, 'tv', `${source} must reset from ${afterRadio}`);
            assert.notEqual(next, 'keep');
        }
    });
});
