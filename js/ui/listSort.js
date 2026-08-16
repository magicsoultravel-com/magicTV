import { el, escapeHtml } from '../tvUtils.js';
import {
    savePlayerState,
    DEFAULT_SORT_BY,
    DEFAULT_SORT_DIR,
    DEFAULT_CATEGORY_FILTER
} from '../storage/playerState.js';

export const SORT_OPTIONS = {
    countries: [
        { value: 'stations', label: 'Stations' },
        { value: 'name', label: 'Name' }
    ],
    channels: [
        { value: 'name', label: 'Name' },
        { value: 'category', label: 'Category' }
    ],
    favorites: [
        { value: 'custom', label: 'Custom' },
        { value: 'name', label: 'Name' },
        { value: 'country', label: 'Country' },
        { value: 'category', label: 'Category' }
    ],
    recents: [
        { value: 'recent', label: 'Recent' },
        { value: 'name', label: 'Name' },
        { value: 'country', label: 'Country' },
        { value: 'category', label: 'Category' }
    ]
};

/** Contexts that show the category filter dropdown. */
const CATEGORY_FILTER_CONTEXTS = new Set(['channels', 'favorites', 'recents']);

let deps = {
    appState: null,
    onSortChanged: () => {},
    onCategoryFilterChanged: () => {}
};

let categoryNameMap = new Map();

function dirMul(dir) {
    return dir === 'desc' ? -1 : 1;
}

function primaryCategory(ch) {
    const cats = ch?.categories;
    if (Array.isArray(cats) && cats.length) return String(cats[0] || '');
    if (typeof ch?.tags === 'string' && ch.tags) return ch.tags.split(',')[0].trim();
    return '';
}

function categorySortKey(ch) {
    const id = primaryCategory(ch);
    if (!id) return '';
    return (categoryNameMap.get(id) || id).toLowerCase();
}

export function setCategoryNameMap(map) {
    categoryNameMap = map instanceof Map ? map : new Map(Object.entries(map || {}));
}

export function getCategoryNameMap() {
    return categoryNameMap;
}

/** True when filter query matches a channel's category id or display name. */
export function matchesCategoryFilter(ch, q) {
    if (!q) return true;
    const cats = Array.isArray(ch?.categories) ? ch.categories : [];
    if (!cats.length && typeof ch?.tags === 'string' && ch.tags) {
        return ch.tags.toLowerCase().includes(q);
    }
    for (const id of cats) {
        const sid = String(id || '').toLowerCase();
        if (sid.includes(q)) return true;
        const name = (categoryNameMap.get(id) || '').toLowerCase();
        if (name && name.includes(q)) return true;
    }
    return false;
}

/** Exact category-id membership for the category dropdown filter. */
export function channelHasCategory(ch, categoryId) {
    if (!categoryId) return true;
    const cats = Array.isArray(ch?.categories) ? ch.categories : [];
    return cats.some((c) => String(c) === categoryId);
}

export function currentSortContext(appState = deps.appState) {
    if (!appState) return null;
    const tab = appState.activeTab;
    if (tab === 'settings') return null;
    if (tab === 'favorites') return 'favorites';
    if (tab === 'recents') return 'recents';
    if (tab === 'browse') {
        return appState.browseCountry == null ? 'countries' : 'channels';
    }
    return null;
}

export function getSortPrefs(appState = deps.appState) {
    const ctx = currentSortContext(appState);
    if (!ctx || !appState) {
        return { context: null, sortBy: null, sortDir: null };
    }
    const sortBy = appState.sortBy?.[ctx] || DEFAULT_SORT_BY[ctx];
    const sortDir = appState.sortDir?.[ctx] || DEFAULT_SORT_DIR[ctx];
    return { context: ctx, sortBy, sortDir };
}

export function getCategoryFilterValue(appState = deps.appState) {
    const ctx = currentSortContext(appState);
    if (!ctx || !CATEGORY_FILTER_CONTEXTS.has(ctx) || !appState) return '';
    return appState.categoryFilter?.[ctx] || '';
}

export function compareCountries(a, b, sortBy, sortDir) {
    const m = dirMul(sortDir);
    if (sortBy === 'stations') {
        const diff = (a.stationcount || 0) - (b.stationcount || 0);
        if (diff) return diff * m;
        return (a.name || '').localeCompare(b.name || '') * m;
    }
    const nameCmp = (a.name || '').localeCompare(b.name || '');
    if (nameCmp) return nameCmp * m;
    return ((a.stationcount || 0) - (b.stationcount || 0)) * m;
}

export function compareChannels(a, b, sortBy, sortDir) {
    const m = dirMul(sortDir);
    if (sortBy === 'country') {
        const c = (a.countrycode || a.country || '').localeCompare(b.countrycode || b.country || '');
        if (c) return c * m;
        return (a.name || '').localeCompare(b.name || '') * m;
    }
    if (sortBy === 'category') {
        const ca = categorySortKey(a);
        const cb = categorySortKey(b);
        if (!ca && cb) return 1;
        if (ca && !cb) return -1;
        const c = ca.localeCompare(cb);
        if (c) return c * m;
        return (a.name || '').localeCompare(b.name || '') * m;
    }
    if (sortBy === 'recent') {
        const diff = (a.at || 0) - (b.at || 0);
        if (diff) return diff * m;
        return (a.name || '').localeCompare(b.name || '') * m;
    }
    // name (and unknown keys)
    return (a.name || '').localeCompare(b.name || '') * m;
}

export function sortChannelList(list, sortBy, sortDir) {
    if (!Array.isArray(list) || !list.length) return list || [];
    if (sortBy === 'custom') return list;
    const copy = list.slice();
    copy.sort((a, b) => compareChannels(a, b, sortBy, sortDir));
    return copy;
}

function persistListPrefs() {
    const appState = deps.appState;
    if (!appState) return;
    savePlayerState({
        sortBy: { ...appState.sortBy },
        sortDir: { ...appState.sortDir },
        categoryFilter: { ...appState.categoryFilter }
    });
}

function buildCategoryOptionsHtml() {
    const entries = [...categoryNameMap.entries()]
        .filter(([id]) => id && id !== 'radio')
        .map(([id, name]) => ({ id, label: name || id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    const opts = [`<option value="">All categories</option>`];
    for (const e of entries) {
        opts.push(`<option value="${escapeHtml(e.id)}">${escapeHtml(e.label)}</option>`);
    }
    return opts.join('');
}

export const ListSort = {
    init({ appState, onSortChanged, onCategoryFilterChanged } = {}) {
        deps = {
            appState: appState || null,
            onSortChanged: onSortChanged || (() => {}),
            onCategoryFilterChanged: onCategoryFilterChanged || (() => {})
        };
        if (appState) {
            appState.sortBy = { ...DEFAULT_SORT_BY, ...(appState.sortBy || {}) };
            appState.sortDir = { ...DEFAULT_SORT_DIR, ...(appState.sortDir || {}) };
            appState.categoryFilter = {
                ...DEFAULT_CATEGORY_FILTER,
                ...(appState.categoryFilter || {})
            };
        }
    },

    bind() {
        const select = el('sort-select');
        const dirBtn = el('sort-dir-btn');
        const catSelect = el('category-filter');
        if (select) {
            select.addEventListener('change', () => {
                const { context } = getSortPrefs();
                if (!context || !deps.appState) return;
                deps.appState.sortBy[context] = select.value;
                persistListPrefs();
                this.syncSortControls();
                deps.onSortChanged(context, { dirOnly: false });
            });
        }
        if (dirBtn) {
            dirBtn.addEventListener('click', () => {
                const { context, sortDir } = getSortPrefs();
                if (!context || !deps.appState) return;
                deps.appState.sortDir[context] = sortDir === 'asc' ? 'desc' : 'asc';
                persistListPrefs();
                this.syncSortControls();
                deps.onSortChanged(context, { dirOnly: true });
            });
        }
        if (catSelect) {
            catSelect.addEventListener('change', () => {
                const ctx = currentSortContext();
                if (!ctx || !CATEGORY_FILTER_CONTEXTS.has(ctx) || !deps.appState) return;
                deps.appState.categoryFilter[ctx] = catSelect.value || '';
                persistListPrefs();
                this.syncCategoryFilterControls();
                deps.onCategoryFilterChanged(ctx);
            });
        }
    },

    syncSortControls() {
        const select = el('sort-select');
        const dirBtn = el('sort-dir-btn');
        const sortBtn = el('sort-btn');
        const sortPopup = sortBtn?.closest('.tv-tab-popup') || select?.closest('.tv-tab-popup');
        const { context, sortBy, sortDir } = getSortPrefs();
        if (!select || !dirBtn) return;

        if (!context) {
            select.classList.add('is-hidden');
            select.classList.remove('is-visible');
            dirBtn.classList.add('is-hidden');
            if (sortBtn) sortBtn.classList.add('is-hidden');
            if (sortPopup) sortPopup.classList.add('is-hidden');
            this.syncCategoryFilterControls();
            return;
        }

        select.classList.remove('is-hidden');
        dirBtn.classList.remove('is-hidden');
        if (sortBtn) sortBtn.classList.remove('is-hidden');
        if (sortPopup) sortPopup.classList.remove('is-hidden');

        const options = SORT_OPTIONS[context] || [];
        const html = options.map((o) =>
            `<option value="${o.value}">${o.label}</option>`
        ).join('');
        if (select.innerHTML !== html) select.innerHTML = html;
        if (options.some((o) => o.value === sortBy)) select.value = sortBy;
        else if (options[0]) select.value = options[0].value;

        const desc = sortDir === 'desc';
        dirBtn.textContent = desc ? '↓' : '↑';
        dirBtn.title = desc ? 'Descending — click for ascending' : 'Ascending — click for descending';
        dirBtn.setAttribute('aria-label', desc ? 'Sort descending' : 'Sort ascending');

        this.syncCategoryFilterControls();
    },

    syncCategoryFilterControls() {
        const catSelect = el('category-filter');
        const catBtn = el('category-btn');
        const catPopup = catBtn?.closest('.tv-tab-popup') || catSelect?.closest('.tv-tab-popup');
        if (!catSelect) return;
        const ctx = currentSortContext();
        if (!ctx || !CATEGORY_FILTER_CONTEXTS.has(ctx)) {
            catSelect.classList.add('is-hidden');
            catSelect.classList.remove('is-visible');
            if (catBtn) catBtn.classList.add('is-hidden');
            if (catPopup) catPopup.classList.add('is-hidden');
            return;
        }

        catSelect.classList.remove('is-hidden');
        if (catBtn) catBtn.classList.remove('is-hidden');
        if (catPopup) catPopup.classList.remove('is-hidden');
        const html = buildCategoryOptionsHtml();
        if (catSelect.innerHTML !== html) catSelect.innerHTML = html;

        const value = deps.appState?.categoryFilter?.[ctx] || '';
        if (value && [...catSelect.options].some((o) => o.value === value)) {
            catSelect.value = value;
        } else {
            catSelect.value = '';
            if (value && deps.appState) deps.appState.categoryFilter[ctx] = '';
        }
    }
};
