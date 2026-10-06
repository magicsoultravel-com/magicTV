/**
 * Radio catalog inside magic browser — paints into the same grids as TV browse.
 */
import { el, countryFlagEmoji, escapeHtml } from '../tvUtils.js';
import { RadioPlayer } from '../radio/radioPlayer.js';
import { RadioProviderRegistry } from '../radio/radioProviders/registry.js';
import { stationKey } from '../radio/stationShape.js';
import { getHideOfflineStations } from '../radio/radioState.js';
import { showAppToast } from '../ui/toast.js';
import { CARD_ICONS } from '../ui/icons.js';
import { Appearance } from '../ui/appearance.js';
import { marqueeInnerHtml } from '../ui/marquee.js';
import {
    compareCountries,
    channelHasCategory,
    getCategoryFilterValue,
    getSortPrefs,
    ListSort,
    setCategoryNameMap
} from '../ui/listSort.js';
import { FavoritesFolders } from '../ui/favoritesFolders.js';

const PAGE_SIZE = 60;

/** @type {'tv'|'radio'} */
let catalogMode = 'tv';
/** @type {'countries'|'stations'} */
let browseLevel = 'countries';
/** @type {string|null} */
let activeCountry = null;
/** @type {any[]} */
let countriesCache = [];
/** @type {Promise<any[]>|null} */
let countriesLoadPromise = null;
/** @type {any[]} */
let stationsCache = [];
/** Favorites rows last painted (may include url_resolved). */
let favoritesRows = [];
/** Stations with url_resolved seen from browse/favorites/play. */
const knownStationsByKey = new Map();
let stationOffset = 0;
let stationsLoading = false;
let stationsDone = false;
let bound = false;
let filterText = '';
let scrollBound = false;

function rememberStations(list) {
    if (!Array.isArray(list)) return;
    for (const s of list) {
        const key = stationKey(s);
        if (key && s?.url_resolved) knownStationsByKey.set(key, s);
    }
}

function favoritesSet() {
    return new Set(RadioPlayer.getFavorites());
}

function resolvePlayTarget(key) {
    if (!key) return key;
    const known = knownStationsByKey.get(key);
    if (known?.url_resolved) return known;
    const fromBrowse = stationsCache.find((s) => stationKey(s) === key);
    if (fromBrowse?.url_resolved) return fromBrowse;
    const fromFav = favoritesRows.find((s) => stationKey(s) === key);
    if (fromFav?.url_resolved) return fromFav;
    return key;
}

function playStationFromCatalog(key) {
    const target = resolvePlayTarget(key);
    if (target && typeof target !== 'string' && target.url_resolved) {
        rememberStations([target]);
    }
    return RadioPlayer.playStation(target).catch((err) => {
        showAppToast(err?.message || 'Playback failed');
    });
}

/** Toggle playing classes only — never rebuild HTML or call applyToTiles. */
function syncPlayingTiles() {
    if (catalogMode !== 'radio') return;
    if (RadioPlayer.station?.url_resolved) rememberStations([RadioPlayer.station]);
    const playingKey = stationKey(RadioPlayer.station);
    document.querySelectorAll('[data-radio-station]').forEach((node) => {
        const key = node.getAttribute('data-radio-station');
        const on = Boolean(key && key === playingKey);
        node.classList.toggle('is-playing', on);
        node.classList.toggle('is-playing-radio', on);
    });
}

/** Class toggles only — safe under frequent radio:state_changed. */
function syncVisitedTiles() {
    if (catalogMode !== 'radio') return;
    const visited = new Set(RadioPlayer.getVisitedKeys());
    document.querySelectorAll('[data-radio-station]').forEach((node) => {
        const key = node.getAttribute('data-radio-station');
        if (key) node.classList.toggle('is-visited', visited.has(key));
    });
}

function matchesFolderFilter(folder, filter) {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return true;
    return String(folder?.name || '').toLowerCase().includes(q);
}

function stationMatchesFilter(station, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    return String(station.name || '').toLowerCase().includes(needle)
        || String(station.countrycode || '').toLowerCase().includes(needle)
        || String(stationKey(station) || '').toLowerCase().includes(needle);
}

async function hydrateRadioTags() {
    try {
        const provider = RadioProviderRegistry.getActive();
        if (typeof provider.getTags !== 'function') return;
        const tags = await provider.getTags();
        const map = new Map();
        for (const t of tags || []) {
            const name = String(t?.name || '').trim();
            if (name) map.set(name, name);
        }
        setCategoryNameMap(map);
        ListSort.syncCategoryFilterControls();
    } catch {
        /* tags optional */
    }
}

/** @type {{ appState?: any } | null} */
let deps = null;

const ART_CASSETTE = `<span class="radio-module__art-cassette"><svg viewBox="0 0 24 24" focusable="false"><rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="8" width="14" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="16" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>`;

function setVisible(node, show) {
    if (!node) return;
    node.hidden = !show;
    node.classList.toggle('is-hidden', !show);
    node.setAttribute('aria-hidden', String(!show));
}

function syncModeClasses() {
    document.body.classList.toggle('catalog-mode-radio', catalogMode === 'radio');
    document.body.classList.toggle('catalog-mode-tv', catalogMode !== 'radio');
    const brand = document.querySelector('#browser-shell .remote-module__brand');
    if (brand) brand.textContent = catalogMode === 'radio' ? 'magic radio browser' : 'magic browser';
}

function syncBackButton() {
    const backBtn = el('back-btn');
    if (!backBtn || catalogMode !== 'radio') return;
    if (browseLevel === 'stations' && activeCountry) {
        backBtn.classList.remove('is-hidden');
        backBtn.classList.add('is-active', 'is-pink-active');
        backBtn.dataset.tab = 'back-to-countries';
    } else {
        backBtn.classList.add('is-hidden');
        backBtn.classList.remove('is-active', 'is-pink-active');
        backBtn.dataset.tab = 'back-to-countries';
    }
}

function countryTileHtml(c) {
    const code = (c.iso_3166_1 || '').toUpperCase();
    return `
        <div class="country-tile" data-radio-country="${escapeHtml(code)}" role="button" tabindex="0">
            <div class="country-tile__icon">${countryFlagEmoji(code)}</div>
            <div class="country-tile__body">
                <h3 class="country-tile__name">${marqueeInnerHtml(c.name || code)}</h3>
                <div class="country-tile__count">${c.stationcount || 0} stations</div>
            </div>
        </div>
    `;
}

function stationTileHtml(station, favKeys = null) {
    const key = stationKey(station);
    const initial = (station.name || '?')[0].toUpperCase();
    const favs = favKeys || favoritesSet();
    const isFav = key ? favs.has(key) : false;
    const playingKey = stationKey(RadioPlayer.station);
    const isPlaying = key && key === playingKey;
    const isVisited = key ? RadioPlayer.isVisited(key) : false;
    const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
    const hideLabel = 'Hide station';
    const logo = station.favicon || station.logo || '';
    const visitedClass = isVisited ? ' is-visited' : '';
    const playingClass = isPlaying ? ' is-playing is-playing-radio' : '';
    return `
        <div class="channel-tile${playingClass}${visitedClass}" data-radio-station="${escapeHtml(key)}" data-channel="${escapeHtml(key)}" role="button" tabindex="0" data-logo="${escapeHtml(logo)}">
            <button type="button" class="channel-tile__fav-btn${isFav ? ' is-active' : ''}" data-radio-star="${escapeHtml(key)}" title="${favLabel}" aria-label="${favLabel}" aria-pressed="${isFav}">${isFav ? CARD_ICONS.tileStarFilled : CARD_ICONS.tileStar}</button>
            <button type="button" class="channel-tile__hide-btn" data-radio-hide="${escapeHtml(key)}" title="${hideLabel}" aria-label="${hideLabel}">${CARD_ICONS.tileEye}</button>
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame-state="waiting">
                    <div class="channel-tile__letter-avatar">${escapeHtml(initial)}</div>
                    ${logo ? `<img class="channel-tile__logo-img" src="${escapeHtml(logo)}" alt="" decoding="async" loading="lazy" onerror="this.classList.add('is-hidden')">` : '<img class="channel-tile__logo-img is-hidden" alt="" decoding="async">'}
                </div>
            </div>
            <div class="channel-tile__body">
                <h3 class="channel-tile__name">${marqueeInnerHtml(station.name || 'Unknown')}</h3>
                <span class="channel-tile__flag">${countryFlagEmoji(station.countrycode)}</span>
            </div>
        </div>
    `;
}

function activeTabId() {
    return document.querySelector('.tv-panel.is-active')?.id || '';
}

function filteredCountries() {
    const q = filterText.trim().toLowerCase();
    let list = [...countriesCache];
    if (q) {
        list = list.filter((c) => {
            const name = String(c.name || '').toLowerCase();
            const code = String(c.iso_3166_1 || '').toLowerCase();
            return name.includes(q) || code.includes(q);
        });
    }
    const appState = deps?.appState;
    const { sortBy, sortDir } = getSortPrefs(appState || undefined);
    const by = sortBy || 'stations';
    const dir = sortDir || 'desc';
    list.sort((a, b) => compareCountries(a, b, by, dir));
    return list;
}

function showCountriesLevel() {
    setVisible(el('countries-container'), true);
    setVisible(el('channels-container'), false);
    browseLevel = 'countries';
    syncBackButton();
    ListSort.syncSortControls();
}

function showStationsLevel() {
    setVisible(el('countries-container'), false);
    setVisible(el('channels-container'), true);
    browseLevel = 'stations';
    syncBackButton();
    ListSort.syncSortControls();
}

function renderCountries() {
    const container = el('countries-container');
    if (!container || catalogMode !== 'radio') return;
    showCountriesLevel();
    const rows = filteredCountries();
    container.innerHTML = rows.map(countryTileHtml).join('')
        || '<div class="empty-state"><p class="empty-state__text">No countries found</p></div>';
    Appearance.applyToTiles?.(container);
}

async function loadCountries({ refresh = false } = {}) {
    if (!refresh && countriesCache.length) {
        renderCountries();
        return countriesCache;
    }
    if (!refresh && countriesLoadPromise) {
        try {
            await countriesLoadPromise;
            renderCountries();
        } catch {
            /* status via empty grid */
        }
        return countriesCache;
    }

    countriesLoadPromise = (async () => {
        const provider = RadioProviderRegistry.getActive();
        return provider.getCountries({ refresh });
    })();

    try {
        countriesCache = await countriesLoadPromise;
        if (catalogMode === 'radio') renderCountries();
        return countriesCache;
    } catch (e) {
        const container = el('countries-container');
        if (container && catalogMode === 'radio') {
            container.innerHTML = `<div class="empty-state"><p class="empty-state__text">${escapeHtml(e?.message || 'Failed to load countries')}</p></div>`;
        }
        return countriesCache;
    } finally {
        countriesLoadPromise = null;
    }
}

function prefetchCountries() {
    if (countriesCache.length || countriesLoadPromise) {
        return countriesLoadPromise || Promise.resolve(countriesCache);
    }
    countriesLoadPromise = (async () => {
        const provider = RadioProviderRegistry.getActive();
        countriesCache = await provider.getCountries({ refresh: false });
        return countriesCache;
    })().finally(() => {
        countriesLoadPromise = null;
    });
    return countriesLoadPromise;
}

function stationApiOrder() {
    const { sortBy } = getSortPrefs(deps?.appState || undefined);
    // Shared chrome only exposes name for radio stations; keep API aligned.
    if (sortBy === 'name') return { order: 'name', reverse: false };
    return { order: 'name', reverse: false };
}

async function loadMoreStations() {
    if (stationsLoading || stationsDone || !activeCountry || catalogMode !== 'radio') return;
    stationsLoading = true;
    const list = el('channels-container');
    const isFirstPage = !stationsCache.length;
    if (list && isFirstPage) {
        list.innerHTML = '<div class="catalog-status" role="status"><p class="catalog-status__text">Loading stations…</p></div>';
    }
    try {
        const provider = RadioProviderRegistry.getActive();
        const { order, reverse } = stationApiOrder();
        const { sortDir } = getSortPrefs(deps?.appState || undefined);
        const hideOffline = getHideOfflineStations();
        const tag = getCategoryFilterValue(deps?.appState || undefined) || undefined;
        const batch = await provider.searchStations({
            countrycode: activeCountry,
            limit: PAGE_SIZE,
            offset: stationOffset,
            order,
            reverse: sortDir === 'desc' ? !reverse : reverse,
            hideOffline,
            tag: tag || undefined
        });
        const q = filterText.trim().toLowerCase();
        let filtered = q
            ? batch.filter((s) => String(s.name || '').toLowerCase().includes(q))
            : batch;
        filtered = RadioPlayer.filterVisibleStations(filtered);
        stationOffset += batch.length;
        if (batch.length < PAGE_SIZE) stationsDone = true;

        if (!list) {
            stationsCache = stationsCache.concat(filtered);
            rememberStations(filtered);
            return;
        }

        // Later page with nothing new — leave existing tiles; never leave Loading….
        if (!isFirstPage && !filtered.length) {
            return;
        }

        const favs = favoritesSet();
        const html = filtered.map((s) => stationTileHtml(s, favs)).join('');

        if (isFirstPage) {
            stationsCache = filtered;
            rememberStations(filtered);
            list.innerHTML = html
                || '<div class="empty-state"><p class="empty-state__text">No stations</p></div>';
            if (html) Appearance.applyToTiles?.(list);
            syncVisitedTiles();
            return;
        }

        stationsCache = stationsCache.concat(filtered);
        rememberStations(filtered);
        if (!html) return;

        // Append only — preserves scrollTop; marquee only new tiles.
        const batchRoot = document.createElement('div');
        batchRoot.className = 'radio-station-batch';
        batchRoot.style.display = 'contents';
        batchRoot.innerHTML = html;
        list.appendChild(batchRoot);
        Appearance.applyToTiles?.(batchRoot);
        syncVisitedTiles();
    } catch (e) {
        if (list && isFirstPage) {
            list.innerHTML = `<div class="empty-state"><p class="empty-state__text">${escapeHtml(e?.message || 'Failed to load stations')}</p></div>`;
        }
    } finally {
        stationsLoading = false;
    }
}

async function openCountry(code) {
    activeCountry = code;
    stationsCache = [];
    stationOffset = 0;
    stationsDone = false;
    showStationsLevel();
    const list = el('channels-container');
    if (list) list.innerHTML = '';
    const panel = el('browse-panel');
    if (panel) panel.scrollTop = 0;
    await loadMoreStations();
}

function backToCountries() {
    if (catalogMode !== 'radio') return;
    activeCountry = null;
    stationsCache = [];
    stationOffset = 0;
    stationsDone = false;
    renderCountries();
}

function filterStationsClient(list) {
    const q = filterText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => stationMatchesFilter(s, q));
}

function sortStationRows(rows, sortBy, sortDir) {
    if (!sortBy || sortBy === 'custom') return rows;
    const m = sortDir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
        if (sortBy === 'recent') {
            const d = (a.at || 0) - (b.at || 0);
            if (d) return d * m;
        } else if (sortBy === 'country') {
            const c = String(a.countrycode || '').localeCompare(String(b.countrycode || ''));
            if (c) return c * m;
        } else if (sortBy === 'category') {
            const ta = String(a.tags || a.categories?.[0] || '');
            const tb = String(b.tags || b.categories?.[0] || '');
            const c = ta.localeCompare(tb);
            if (c) return c * m;
        }
        return String(a.name || '').localeCompare(String(b.name || '')) * m;
    });
}

function stubFromKey(key) {
    return { stationuuid: key, name: key, favicon: '', countrycode: '', tags: '' };
}

async function resolveFavoriteStations(keys) {
    if (!keys.length) return new Map();
    const provider = RadioProviderRegistry.getActive();
    const ids = keys.map((k) => {
        const idx = k.indexOf(':');
        return idx >= 0 ? k.slice(idx + 1) : k;
    });
    const stations = await provider.getStationsByIds(ids);
    rememberStations(stations);
    return new Map(stations.map((s) => [stationKey(s), s]));
}

function syncRadioFavoritesReorder(enabled) {
    const grid = el('favorites-grid');
    if (!grid) return;
    grid.classList.toggle('is-reorder-enabled', Boolean(enabled));
}

async function renderFavoritesRoot(list, empty, byKey, filter, sortBy, sortDir, categoryId) {
    const folders = RadioPlayer.getFavoriteFolders().filter((folder) => matchesFolderFilter(folder, filter));
    let rootKeys = RadioPlayer.getFavoritesRootOrder();
    if (sortBy && sortBy !== 'custom') {
        const sortable = rootKeys.map((k) => byKey.get(k) || stubFromKey(k));
        rootKeys = sortStationRows(sortable, sortBy, sortDir).map((s) => stationKey(s) || s.stationuuid);
    }

    const parts = folders.map((folder) => ({ type: 'folder', folder }));
    const stationRows = [];
    for (const ref of rootKeys) {
        const s = byKey.get(ref) || stubFromKey(ref);
        if (!stationMatchesFilter(s, filter) || !channelHasCategory(s, categoryId)) continue;
        if (RadioPlayer.isHidden(ref)) continue;
        parts.push({ type: 'station', station: s });
        stationRows.push(s);
    }

    if (!parts.length) {
        favoritesRows = [];
        list.innerHTML = '<div class="empty-state"><p class="empty-state__text">No favorites found</p></div>';
        setVisible(empty, false);
        setVisible(list, true);
        syncRadioFavoritesReorder(false);
        return;
    }

    favoritesRows = stationRows;
    const favs = favoritesSet();
    list.innerHTML = parts.map((part) => (
        part.type === 'folder'
            ? FavoritesFolders.folderTileHtml(part.folder)
            : stationTileHtml(part.station, favs)
    )).join('');
    setVisible(empty, false);
    setVisible(list, true);
    FavoritesFolders.wireFolderTiles(list);
    Appearance.applyToTiles?.(list);
    syncVisitedTiles();
    syncRadioFavoritesReorder(sortBy === 'custom');
}

async function renderFavoritesFolder(list, empty, folderId, byKey, filter, sortBy, sortDir, categoryId) {
    const folder = RadioPlayer.getFavoriteFolder(folderId);
    const appState = deps?.appState;
    if (!folder) {
        if (appState) appState.favoritesFolderId = null;
        FavoritesFolders.syncBackButton();
        return renderFavoritesRoot(list, empty, byKey, filter, sortBy, sortDir, categoryId);
    }

    let rows = (folder.items || [])
        .map((k) => byKey.get(k) || stubFromKey(k))
        .filter((s) => stationMatchesFilter(s, filter) && channelHasCategory(s, categoryId))
        .filter((s) => !RadioPlayer.isHidden(stationKey(s) || s.stationuuid));
    rows = sortStationRows(rows, sortBy === 'custom' ? 'custom' : sortBy, sortDir);

    favoritesRows = rows;
    const favs = favoritesSet();
    const stationHtml = rows.map((s) => stationTileHtml(s, favs)).join('');
    list.innerHTML = FavoritesFolders.folderParentTileHtml() + (stationHtml
        || '<div class="empty-state"><p class="empty-state__text">No stations in folder</p></div>');
    setVisible(empty, false);
    setVisible(list, true);
    FavoritesFolders.wireFolderViewTiles(list);
    Appearance.applyToTiles?.(list);
    syncVisitedTiles();
    syncRadioFavoritesReorder(sortBy === 'custom');
}

async function renderFavorites() {
    const list = el('favorites-grid');
    const empty = el('favorites-empty');
    if (!list || catalogMode !== 'radio') return;
    const keys = RadioPlayer.getFavorites();
    const folders = RadioPlayer.getFavoriteFolders();
    const filter = filterText.trim();
    const appState = deps?.appState;
    const { sortBy, sortDir } = getSortPrefs(appState || undefined);
    const categoryId = getCategoryFilterValue(appState || undefined) || '';

    if (!keys.length && !folders.length) {
        favoritesRows = [];
        list.innerHTML = '';
        setVisible(empty, true);
        setVisible(list, false);
        if (appState) appState.favoritesFolderId = null;
        FavoritesFolders.syncBackButton();
        syncRadioFavoritesReorder(false);
        return;
    }

    setVisible(empty, false);
    setVisible(list, true);
    list.innerHTML = '<div class="catalog-status" role="status"><p class="catalog-status__text">Loading…</p></div>';
    try {
        const byKey = await resolveFavoriteStations(keys);
        FavoritesFolders.syncBackButton();
        if (appState?.favoritesFolderId) {
            await renderFavoritesFolder(
                list, empty, appState.favoritesFolderId, byKey, filter, sortBy, sortDir, categoryId
            );
        } else {
            await renderFavoritesRoot(list, empty, byKey, filter, sortBy, sortDir, categoryId);
        }
    } catch (e) {
        favoritesRows = [];
        list.innerHTML = `<div class="empty-state"><p class="empty-state__text">${escapeHtml(e?.message || 'Failed')}</p></div>`;
    }
}

function renderRecents() {
    const list = el('recents-grid');
    const empty = el('recents-empty');
    if (!list || catalogMode !== 'radio') return;
    const meta = RadioPlayer.getRecentsMeta();
    if (!meta.length) {
        list.innerHTML = '';
        setVisible(empty, true);
        setVisible(list, false);
        return;
    }
    setVisible(empty, false);
    setVisible(list, true);
    const categoryId = getCategoryFilterValue(deps?.appState || undefined) || '';
    let rows = meta.map((m) => ({
        stationuuid: m.key,
        name: m.name || m.key,
        favicon: m.favicon || '',
        countrycode: m.countrycode || '',
        at: m.at || 0,
        tags: ''
    }));
    rows = filterStationsClient(rows)
        .filter((s) => !RadioPlayer.isHidden(stationKey(s) || s.stationuuid))
        .filter((s) => {
            const key = stationKey(s) || s.stationuuid;
            const enriched = (key && knownStationsByKey.get(key)) || s;
            return channelHasCategory(enriched, categoryId);
        });
    const { sortBy, sortDir } = getSortPrefs(deps?.appState || undefined);
    rows = sortStationRows(rows, sortBy, sortDir);
    const favs = favoritesSet();
    list.innerHTML = rows.map((s) => {
        const key = stationKey(s) || s.stationuuid;
        const enriched = (key && knownStationsByKey.get(key)) || s;
        return stationTileHtml(enriched, favs);
    }).join('')
        || '<div class="empty-state"><p class="empty-state__text">No recents found</p></div>';
    Appearance.applyToTiles?.(list);
    syncVisitedTiles();
}

function ensureScrollBind() {
    if (scrollBound) return;
    const panel = el('browse-panel');
    if (!panel) return;
    scrollBound = true;
    panel.addEventListener('scroll', () => {
        if (catalogMode !== 'radio' || browseLevel !== 'stations') return;
        if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 80) {
            loadMoreStations();
        }
    }, { passive: true });
}

function syncFilterFromSearchInput() {
    const search = el('search-countries');
    if (search) filterText = search.value || '';
}

function applyFilter(q) {
    filterText = q || '';
    const tab = activeTabId();
    if (tab === 'favorites-panel') {
        renderFavorites();
        return;
    }
    if (tab === 'recents-panel') {
        renderRecents();
        return;
    }
    if (browseLevel === 'countries') {
        renderCountries();
        return;
    }
    stationsCache = [];
    stationOffset = 0;
    stationsDone = false;
    loadMoreStations();
}

function onSortChanged() {
    if (catalogMode !== 'radio') return;
    const tab = activeTabId();
    if (tab === 'favorites-panel') {
        renderFavorites();
        return;
    }
    if (tab === 'recents-panel') {
        renderRecents();
        return;
    }
    if (browseLevel === 'countries') {
        renderCountries();
        return;
    }
    stationsCache = [];
    stationOffset = 0;
    stationsDone = false;
    loadMoreStations();
}

function bindOnce() {
    if (bound) return;
    bound = true;
    ensureScrollBind();

    document.addEventListener('click', (e) => {
        if (catalogMode !== 'radio') return;
        const hideBtn = e.target.closest?.('[data-radio-hide]');
        if (hideBtn) {
            e.preventDefault();
            e.stopPropagation();
            const key = hideBtn.getAttribute('data-radio-hide');
            const known = knownStationsByKey.get(key) || { stationuuid: key };
            if (RadioPlayer.hideChannel(known)) {
                showAppToast('Station hidden');
                document.querySelectorAll(`[data-radio-station="${CSS.escape(key)}"]`).forEach((n) => n.remove());
                refreshActiveLists({ soft: true });
            }
            return;
        }
        const star = e.target.closest?.('[data-radio-star]');
        if (star) {
            e.preventDefault();
            e.stopPropagation();
            RadioPlayer.toggleFavorite(star.getAttribute('data-radio-star'));
            refreshActiveLists({ soft: true });
            return;
        }
        const country = e.target.closest?.('[data-radio-country]');
        if (country) {
            openCountry(country.getAttribute('data-radio-country'));
            return;
        }
        const row = e.target.closest?.('[data-radio-station]');
        if (row) {
            if (e.target.closest?.('.channel-tile__fav-btn, .channel-tile__hide-btn')) return;
            playStationFromCatalog(row.getAttribute('data-radio-station'));
        }
    });

    document.addEventListener('keydown', (e) => {
        if (catalogMode !== 'radio') return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest?.('.channel-tile__fav-btn, .channel-tile__hide-btn')) return;
        const country = e.target.closest?.('[data-radio-country]');
        if (country) {
            e.preventDefault();
            openCountry(country.getAttribute('data-radio-country'));
            return;
        }
        const row = e.target.closest?.('[data-radio-station]');
        if (row) {
            e.preventDefault();
            playStationFromCatalog(row.getAttribute('data-radio-station'));
        }
    });

    window.addEventListener('radio:state_changed', () => {
        if (catalogMode === 'radio') {
            syncPlayingTiles();
            syncVisitedTiles();
        }
    });
}

function refreshActiveLists({ soft = false } = {}) {
    if (catalogMode !== 'radio') return;
    syncFilterFromSearchInput();
    const tab = activeTabId();
    if (tab === 'favorites-panel' || el('favorites-panel')?.classList.contains('is-active')) {
        renderFavorites();
    }
    if (tab === 'recents-panel' || el('recents-panel')?.classList.contains('is-active')) {
        renderRecents();
    }
    if (tab === 'browse-panel' || el('browse-panel')?.classList.contains('is-active')) {
        if (browseLevel === 'stations' && stationsCache.length) {
            const list = el('channels-container');
            if (list) {
                const favs = favoritesSet();
                list.innerHTML = stationsCache.map((s) => stationTileHtml(s, favs)).join('');
                // Soft refresh after fav toggle still needs marquee measure; play-state uses syncPlayingTiles.
                Appearance.applyToTiles?.(list);
            }
        } else if (!soft && browseLevel === 'countries') {
            renderCountries();
        } else if (soft && browseLevel === 'countries') {
            renderCountries();
        }
    }
    syncBackButton();
}

export const RadioBrowseView = {
    init(options = {}) {
        deps = { appState: options.appState || null };
        bindOnce();
        syncModeClasses();
    },

    getMode() {
        return catalogMode;
    },

    getBrowseLevel() {
        return browseLevel;
    },

    setMode(mode, { paint = true } = {}) {
        catalogMode = mode === 'radio' ? 'radio' : 'tv';
        syncModeClasses();
        if (catalogMode === 'radio') {
            ensureScrollBind();
            void hydrateRadioTags();
            ListSort.syncSortControls();
            syncBackButton();
            FavoritesFolders.syncBackButton();
            if (paint) {
                if (browseLevel === 'stations' && activeCountry) showStationsLevel();
                else if (countriesCache.length) renderCountries();
                else loadCountries();
            }
        }
        return catalogMode;
    },

    async openBrowse() {
        this.setMode('radio', { paint: false });
        activeCountry = null;
        stationsCache = [];
        stationOffset = 0;
        stationsDone = false;
        if (countriesCache.length) {
            renderCountries();
            return;
        }
        await loadCountries();
    },

    backToCountries,
    applyFilter,
    onSortChanged,
    onCategoryFilterChanged: onSortChanged,
    renderFavorites,
    renderRecents,
    syncVisitedTiles,
    reloadStations() {
        if (catalogMode !== 'radio' || browseLevel !== 'stations') return;
        stationsCache = [];
        stationOffset = 0;
        stationsDone = false;
        return loadMoreStations();
    },

    prefetch() {
        return prefetchCountries().catch(() => []);
    },

    refresh() {
        if (catalogMode !== 'radio') return;
        refreshActiveLists();
    },

    artCassetteHtml: ART_CASSETTE
};
