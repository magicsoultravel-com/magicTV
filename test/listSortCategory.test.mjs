/**
 * Category filter: shared menu list with clear × on the selected row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ListSort,
    setCategoryNameMap,
    currentSortContext,
    getSharedCategoryFilter,
    setSharedCategoryFilter
} from '../js/ui/listSort.js';
import { DEFAULT_CATEGORY_FILTER } from '../js/storage/playerState.js';

function makeMenu() {
    return {
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            contains(c) { return this._set.has(c); },
            toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); }
        },
        dataset: {},
        innerHTML: '',
        closest: () => null,
        contains() { return true; },
        addEventListener() {},
        dispatchEvent() { return true; }
    };
}

function makeBtn() {
    return {
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
            contains(c) { return this._set.has(c); }
        },
        title: '',
        setAttribute() {},
        closest: () => null
    };
}

function withDom({ catMenu, catBtn }, fn) {
    const prevDoc = globalThis.document;
    globalThis.document = {
        getElementById(id) {
            if (id === 'category-filter') return catMenu;
            if (id === 'category-btn') return catBtn;
            if (id === 'sort-select') return null;
            if (id === 'sort-dir-btn') return null;
            return null;
        }
    };
    try {
        return fn();
    } finally {
        if (prevDoc) globalThis.document = prevDoc;
        else delete globalThis.document;
    }
}

test('empty category map does not clear a saved shared filter', () => {
    const catMenu = makeMenu();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'favorites',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER, favorites: 'news', channels: 'news', recents: 'news' },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catMenu, catBtn }, () => {
        setCategoryNameMap(new Map());
        ListSort.init({ appState });
        ListSort.syncCategoryFilterControls();
        assert.equal(getSharedCategoryFilter(appState), 'news');
        // Map empty → options are only "All categories"; saved value kept in state.
        assert.ok(!catMenu.innerHTML.includes('data-category-clear'));
    });
});

test('populated map clears unknown saved category across all tabs', () => {
    const catMenu = makeMenu();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'favorites',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER, favorites: 'gone' },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catMenu, catBtn }, () => {
        setCategoryNameMap(new Map([['sports', 'Sports']]));
        ListSort.init({ appState });
        ListSort.syncCategoryFilterControls();
        assert.equal(getSharedCategoryFilter(appState), '');
        assert.equal(appState.categoryFilter.channels, '');
        assert.equal(appState.categoryFilter.favorites, '');
        assert.equal(appState.categoryFilter.recents, '');
        assert.ok(!catMenu.innerHTML.includes('data-category-clear'));
    });
});

test('category control hidden on countries browse context', () => {
    const catMenu = makeMenu();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'browse',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catMenu, catBtn }, () => {
        setCategoryNameMap(new Map([['news', 'News']]));
        ListSort.init({ appState });
        assert.equal(currentSortContext(appState), 'countries');
        ListSort.syncCategoryFilterControls();
        assert.ok(catBtn.classList.contains('is-hidden'));
        assert.ok(catMenu.classList.contains('is-hidden'));
    });
});

test('setSharedCategoryFilter aligns channels favorites and recents', () => {
    const appState = {
        categoryFilter: { channels: 'a', favorites: 'b', recents: 'c' }
    };
    setSharedCategoryFilter(appState, 'news');
    assert.equal(appState.categoryFilter.channels, 'news');
    assert.equal(appState.categoryFilter.favorites, 'news');
    assert.equal(appState.categoryFilter.recents, 'news');
    assert.equal(getSharedCategoryFilter(appState), 'news');

    setSharedCategoryFilter(appState, '');
    assert.equal(getSharedCategoryFilter(appState), '');
});

test('selected category row renders an inline clear ×', () => {
    const catMenu = makeMenu();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'recents',
        browseCountry: null,
        categoryFilter: { channels: 'news', favorites: 'news', recents: 'news' },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catMenu, catBtn }, () => {
        setCategoryNameMap(new Map([['news', 'News'], ['sports', 'Sports']]));
        ListSort.init({ appState });
        ListSort.syncCategoryFilterControls();
        assert.match(catMenu.innerHTML, /data-category-id="news"[^>]*aria-selected="true"/);
        assert.match(catMenu.innerHTML, /data-category-clear="1"/);
        // Clear only on the selected row — Sports has no clear control.
        const sportsChunk = catMenu.innerHTML.split('data-category-id="sports"')[1] || '';
        const sportsBeforeNext = sportsChunk.split('data-category-id="')[0];
        assert.ok(!sportsBeforeNext.includes('data-category-clear'));
        assert.ok(catBtn.classList.contains('is-active'));
    });
});
