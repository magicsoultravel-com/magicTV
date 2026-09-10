import { el, escapeHtml } from '../tvUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
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
const CATEGORY_FILTER_KEYS = ['channels', 'favorites', 'recents'];

let deps = {
    appState: null,
    onSortChanged: () => {},
    onCategoryFilterChanged: () => {}
};

let categoryNameMap = new Map();

/** Shared category id across browse channels / favorites / recents. */
export function getSharedCategoryFilter(appState = deps.appState) {
    if (!appState?.categoryFilter) return '';
    for (const key of CATEGORY_FILTER_KEYS) {
        const value = appState.categoryFilter[key];
        if (typeof value === 'string' && value) return value;
    }
    return '';
}

/** Write the same category id into every catalog context and return it. */
export function setSharedCategoryFilter(appState, categoryId) {
    if (!appState) return '';
    const value = typeof categoryId === 'string' ? categoryId : '';
    if (!appState.categoryFilter || typeof appState.categoryFilter !== 'object') {
        appState.categoryFilter = { channels: value, favorites: value, recents: value };
    } else {
        for (const key of CATEGORY_FILTER_KEYS) {
            appState.categoryFilter[key] = value;
        }
    }
    return value;
}

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
    return getSharedCategoryFilter(appState);
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

function buildCategoryMenuHtml(selectedId) {
    const entries = [...categoryNameMap.entries()]
        .filter(([id]) => id && id !== 'radio')
        .map(([id, name]) => ({ id, label: name || id }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const rows = [{ id: '', label: 'All categories' }, ...entries];
    return rows.map((e) => {
        const selected = e.id === selectedId;
        const clear = selected && e.id
            ? `<button type="button" class="category-menu__clear" data-category-clear="1" title="Clear category filter" aria-label="Clear category filter">${CARD_ICONS.close}</button>`
            : '';
        return `
            <div class="category-menu__option${selected ? ' is-selected' : ''}"
                 role="option"
                 tabindex="0"
                 data-category-id="${escapeHtml(e.id)}"
                 aria-selected="${selected ? 'true' : 'false'}">
                <span class="category-menu__label">${escapeHtml(e.label)}</span>
                ${clear}
            </div>
        `;
    }).join('');
}

function applyCategorySelection(categoryId, { closePopout = true } = {}) {
    const ctx = currentSortContext();
    if (!deps.appState) return;
    setSharedCategoryFilter(deps.appState, categoryId || '');
    persistListPrefs();
    ListSort.syncCategoryFilterControls();
    if (ctx && CATEGORY_FILTER_CONTEXTS.has(ctx)) {
        deps.onCategoryFilterChanged(ctx);
    }
    if (closePopout) {
        const panel = el('category-filter');
        if (panel) {
            panel.classList.remove('is-visible');
            // Defer to catalogToolPopouts when available via class cleanup in app click-away;
            // local hide keeps UX snappy after pick/clear.
            panel.dispatchEvent(new CustomEvent('category-menu:close', { bubbles: true }));
        }
    }
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
            // Coalesce any legacy per-tab values into one shared filter.
            const shared = getSharedCategoryFilter({
                categoryFilter: { ...DEFAULT_CATEGORY_FILTER, ...(appState.categoryFilter || {}) }
            });
            appState.categoryFilter = {
                channels: shared,
                favorites: shared,
                recents: shared
            };
        }
    },

    bind() {
        const select = el('sort-select');
        const dirBtn = el('sort-dir-btn');
        const catMenu = el('category-filter');
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
        if (catMenu && catMenu.dataset.bound !== '1') {
            catMenu.dataset.bound = '1';
            catMenu.addEventListener('click', (e) => {
                const clearBtn = e.target.closest?.('[data-category-clear]');
                if (clearBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyCategorySelection('', { closePopout: true });
                    return;
                }
                const option = e.target.closest?.('.category-menu__option');
                if (!option || !catMenu.contains(option)) return;
                e.preventDefault();
                e.stopPropagation();
                applyCategorySelection(option.getAttribute('data-category-id') || '', { closePopout: true });
            });
            catMenu.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const option = e.target.closest?.('.category-menu__option');
                if (!option || !catMenu.contains(option)) return;
                e.preventDefault();
                applyCategorySelection(option.getAttribute('data-category-id') || '', { closePopout: true });
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
        dirBtn.innerHTML = desc ? ACTION_ICONS.sortDown : ACTION_ICONS.sortUp;
        dirBtn.title = desc ? 'Descending — click for ascending' : 'Ascending — click for descending';
        dirBtn.setAttribute('aria-label', desc ? 'Sort descending' : 'Sort ascending');

        this.syncCategoryFilterControls();
    },

    syncCategoryFilterControls() {
        const catMenu = el('category-filter');
        const catBtn = el('category-btn');
        const catPopup = catBtn?.closest('.tv-tab-popup') || catMenu?.closest('.tv-tab-popup');
        if (!catMenu) return;
        const ctx = currentSortContext();
        if (!ctx || !CATEGORY_FILTER_CONTEXTS.has(ctx)) {
            catMenu.classList.add('is-hidden');
            catMenu.classList.remove('is-visible');
            if (catBtn) {
                catBtn.classList.add('is-hidden');
                catBtn.classList.remove('is-active');
                catBtn.setAttribute('aria-pressed', 'false');
                catBtn.setAttribute('aria-expanded', 'false');
                catBtn.title = 'Filter by category';
                catBtn.setAttribute('aria-label', 'Filter by category');
            }
            if (catPopup) catPopup.classList.add('is-hidden');
            return;
        }

        catMenu.classList.remove('is-hidden');
        if (catBtn) catBtn.classList.remove('is-hidden');
        if (catPopup) catPopup.classList.remove('is-hidden');

        let value = getSharedCategoryFilter(deps.appState);
        const known = !value || categoryNameMap.has(value);
        // Don't wipe a saved filter while the category map hasn't hydrated yet.
        if (value && !known && categoryNameMap.size > 0) {
            setSharedCategoryFilter(deps.appState, '');
            value = '';
        }

        const html = buildCategoryMenuHtml(known ? value : '');
        if (catMenu.innerHTML !== html) catMenu.innerHTML = html;

        const pressed = Boolean(value && known);
        const selectedLabel = pressed
            ? (categoryNameMap.get(value) || value)
            : 'All categories';
        if (catBtn) {
            catBtn.classList.toggle('is-active', pressed);
            catBtn.setAttribute('aria-pressed', String(pressed));
            catBtn.setAttribute('aria-expanded', String(catMenu.classList.contains('is-visible')));
            const label = pressed ? `Category: ${selectedLabel}` : 'Filter by category';
            catBtn.title = label;
            catBtn.setAttribute('aria-label', label);
        }
    }
};
