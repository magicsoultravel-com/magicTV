/**
 * Category filter sync: keep saved value while map is empty; clear only when known unknown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ListSort,
    setCategoryNameMap,
    currentSortContext
} from '../js/ui/listSort.js';
import { DEFAULT_CATEGORY_FILTER } from '../js/storage/playerState.js';

function makeSelect(options = [{ value: '', label: 'All categories' }]) {
    const opts = options.map((o) => ({ value: o.value, label: o.label || o.value }));
    return {
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            contains(c) { return this._set.has(c); }
        },
        options: opts,
        innerHTML: '',
        value: '',
        closest: () => null
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
        setAttribute() {},
        closest: () => null
    };
}

function withDom({ catSelect, catBtn }, fn) {
    const prevDoc = globalThis.document;
    globalThis.document = {
        getElementById(id) {
            if (id === 'category-filter') return catSelect;
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

test('empty category map does not clear a saved favorites filter', () => {
    const catSelect = makeSelect();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'favorites',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER, favorites: 'news' },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catSelect, catBtn }, () => {
        setCategoryNameMap(new Map());
        ListSort.init({ appState });
        ListSort.syncCategoryFilterControls();
        assert.equal(appState.categoryFilter.favorites, 'news');
        assert.equal(catSelect.value, '');
    });
});

test('populated map clears unknown saved category', () => {
    const catSelect = makeSelect([
        { value: '', label: 'All categories' },
        { value: 'sports', label: 'Sports' }
    ]);
    // After sync rebuilds innerHTML, options come from the map — stub options via
    // a proxy that re-reads from a mutable list after ListSort rewrites innerHTML.
    let optionList = [...catSelect.options];
    Object.defineProperty(catSelect, 'options', {
        get() { return optionList; },
        configurable: true
    });
    Object.defineProperty(catSelect, 'innerHTML', {
        get() { return this._html || ''; },
        set(html) {
            this._html = html;
            const values = [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
            optionList = values.map((value) => ({ value }));
        },
        configurable: true
    });

    const catBtn = makeBtn();
    const appState = {
        activeTab: 'favorites',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER, favorites: 'gone' },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catSelect, catBtn }, () => {
        setCategoryNameMap(new Map([['sports', 'Sports']]));
        ListSort.init({ appState });
        ListSort.syncCategoryFilterControls();
        assert.equal(appState.categoryFilter.favorites, '');
        assert.equal(catSelect.value, '');
    });
});

test('category control hidden on countries browse context', () => {
    const catSelect = makeSelect();
    const catBtn = makeBtn();
    const appState = {
        activeTab: 'browse',
        browseCountry: null,
        categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
        sortBy: {},
        sortDir: {}
    };

    withDom({ catSelect, catBtn }, () => {
        setCategoryNameMap(new Map([['news', 'News']]));
        ListSort.init({ appState });
        assert.equal(currentSortContext(appState), 'countries');
        ListSort.syncCategoryFilterControls();
        assert.ok(catBtn.classList.contains('is-hidden'));
        assert.ok(catSelect.classList.contains('is-hidden'));
    });
});
