/**
 * Lightweight radio catalog inside the magic browser (countries → stations, favs, recents).
 */
import { el, countryFlagEmoji } from '../tvUtils.js';
import { RadioPlayer } from '../radio/radioPlayer.js';
import { RadioProviderRegistry } from '../radio/radioProviders/registry.js';
import { stationKey } from '../radio/stationShape.js';
import { loadRadioState } from '../radio/radioState.js';
import { showAppToast } from '../ui/toast.js';

const PAGE_SIZE = 60;

/** @type {'tv'|'radio'} */
let catalogMode = 'tv';
/** @type {'countries'|'stations'} */
let browseLevel = 'countries';
/** @type {string|null} */
let activeCountry = null;
/** @type {any[]} */
let countriesCache = [];
/** @type {any[]} */
let stationsCache = [];
let stationOffset = 0;
let stationsLoading = false;
let stationsDone = false;
let bound = false;
let filterText = '';
/** @type {IntersectionObserver | null} */
let sentinelObserver = null;

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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

function countryRowHtml(c) {
    const code = (c.iso_3166_1 || c.name || '').toUpperCase();
    const flag = countryFlagEmoji(code) || '';
    const count = Number(c.stationcount) || 0;
    return `<button type="button" class="radio-browse__row" data-radio-country="${escapeHtml(code)}" role="listitem">
        <span class="radio-browse__logo" aria-hidden="true">${flag}</span>
        <span class="radio-browse__name">${escapeHtml(c.name || code)}</span>
        <span class="radio-browse__meta">${count}</span>
        <span></span>
    </button>`;
}

function stationRowHtml(station) {
    const key = stationKey(station);
    const playing = stationKey(RadioPlayer.station) === key && (RadioPlayer.playing || RadioPlayer.hasActiveStation());
    const fav = RadioPlayer.isFavorite(key);
    const flag = countryFlagEmoji(station.countrycode || '') || '';
    const logo = station.favicon
        ? `<img class="radio-browse__logo" src="${escapeHtml(station.favicon)}" alt="" loading="lazy">`
        : `<span class="radio-browse__logo" aria-hidden="true"></span>`;
    return `<div class="radio-browse__row${playing ? ' is-playing' : ''}" data-radio-station="${escapeHtml(key)}" role="listitem" tabindex="0">
        ${logo}
        <span class="radio-browse__name">${escapeHtml(station.name || 'Unknown')}</span>
        <span class="radio-browse__meta">${flag}</span>
        <button type="button" class="radio-browse__star${fav ? ' is-active' : ''}" data-radio-star="${escapeHtml(key)}" title="Favorite" aria-label="Favorite" aria-pressed="${fav}">
            <svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M6 9.6S2.4 7.2 2.4 4.7A1.95 1.95 0 0 1 6 3.6a1.95 1.95 0 0 1 3.6 1.1C9.6 7.2 6 9.6 6 9.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        </button>
    </div>`;
}

function setStatus(text) {
    const status = el('radio-browse-status');
    if (!status) return;
    if (!text) {
        status.hidden = true;
        status.textContent = '';
        return;
    }
    status.hidden = false;
    status.textContent = text;
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
    const sort = RadioPlayer.getCountrySort();
    list.sort((a, b) => {
        if (sort === 'name') {
            return String(a.name || '').localeCompare(String(b.name || ''));
        }
        return (Number(b.stationcount) || 0) - (Number(a.stationcount) || 0);
    });
    return list;
}

function renderCountries() {
    const list = el('radio-browse-list');
    const back = el('radio-browse-back');
    if (back) back.hidden = true;
    if (!list) return;
    const rows = filteredCountries();
    list.innerHTML = rows.map(countryRowHtml).join('') || '<p class="radio-browse__status">No countries</p>';
    setStatus(rows.length ? `${rows.length} countries` : '');
}

async function loadCountries({ refresh = false } = {}) {
    setStatus('Loading countries…');
    try {
        const provider = RadioProviderRegistry.getActive();
        countriesCache = await provider.getCountries({ refresh });
        renderCountries();
    } catch (e) {
        setStatus(e?.message || 'Failed to load countries');
    }
}

async function loadMoreStations() {
    if (stationsLoading || stationsDone || !activeCountry) return;
    stationsLoading = true;
    setStatus('Loading stations…');
    try {
        const provider = RadioProviderRegistry.getActive();
        const order = RadioPlayer.getBrowseSort() || 'name';
        const dir = RadioPlayer.getBrowseSortDir() || 'asc';
        const hideOffline = loadRadioState().hideOfflineStations !== false;
        const batch = await provider.searchStations({
            countrycode: activeCountry,
            limit: PAGE_SIZE,
            offset: stationOffset,
            order: order === 'count' ? 'name' : order,
            reverse: dir === 'desc',
            hideOffline
        });
        const q = filterText.trim().toLowerCase();
        const filtered = q
            ? batch.filter((s) => String(s.name || '').toLowerCase().includes(q))
            : batch;
        stationsCache = stationsCache.concat(filtered);
        stationOffset += batch.length;
        if (batch.length < PAGE_SIZE) stationsDone = true;
        const list = el('radio-browse-list');
        if (list) {
            list.innerHTML = stationsCache.map(stationRowHtml).join('')
                || '<p class="radio-browse__status">No stations</p>';
        }
        setStatus(stationsDone
            ? `${stationsCache.length} stations`
            : `${stationsCache.length}+ stations`);
    } catch (e) {
        setStatus(e?.message || 'Failed to load stations');
    } finally {
        stationsLoading = false;
    }
}

async function openCountry(code) {
    activeCountry = code;
    browseLevel = 'stations';
    stationsCache = [];
    stationOffset = 0;
    stationsDone = false;
    const back = el('radio-browse-back');
    if (back) back.hidden = false;
    const list = el('radio-browse-list');
    if (list) list.innerHTML = '';
    syncSortControlsForLevel();
    await loadMoreStations();
}

function syncSortControlsForLevel() {
    const sort = el('radio-browse-sort');
    const dir = el('radio-browse-sort-dir');
    if (!sort || !dir) return;
    if (browseLevel === 'countries') {
        sort.value = RadioPlayer.getCountrySort() === 'name' ? 'name' : 'count';
        [...sort.options].forEach((opt) => {
            opt.hidden = !(opt.value === 'count' || opt.value === 'name');
        });
        dir.hidden = true;
    } else {
        [...sort.options].forEach((opt) => {
            opt.hidden = opt.value === 'count';
        });
        const cur = RadioPlayer.getBrowseSort();
        sort.value = cur === 'count' ? 'name' : cur;
        dir.hidden = false;
        dir.value = RadioPlayer.getBrowseSortDir();
    }
}

async function renderFavorites() {
    const list = el('radio-favorites-list');
    if (!list) return;
    const keys = RadioPlayer.getFavorites();
    if (!keys.length) {
        list.innerHTML = '<p class="radio-browse__status">No radio favorites</p>';
        return;
    }
    list.innerHTML = '<p class="radio-browse__status">Loading…</p>';
    try {
        const provider = RadioProviderRegistry.getActive();
        const ids = keys.map((k) => {
            const idx = k.indexOf(':');
            return idx >= 0 ? k.slice(idx + 1) : k;
        });
        const stations = await provider.getStationsByIds(ids);
        const byKey = new Map(stations.map((s) => [stationKey(s), s]));
        list.innerHTML = keys.map((k) => {
            const s = byKey.get(k) || { stationuuid: k, name: k, favicon: '', countrycode: '' };
            return stationRowHtml(s);
        }).join('');
    } catch (e) {
        list.innerHTML = `<p class="radio-browse__status">${escapeHtml(e?.message || 'Failed')}</p>`;
    }
}

async function renderRecents() {
    const list = el('radio-recents-list');
    if (!list) return;
    const meta = RadioPlayer.getRecentsMeta();
    if (!meta.length) {
        list.innerHTML = '<p class="radio-browse__status">No radio recents</p>';
        return;
    }
    list.innerHTML = meta.map((m) => stationRowHtml({
        stationuuid: m.key,
        name: m.name || m.key,
        favicon: m.favicon || '',
        countrycode: m.countrycode || ''
    })).join('');
}

function ensureSentinel() {
    const sentinel = el('radio-browse-sentinel');
    if (!sentinel || sentinelObserver) return;
    sentinelObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && browseLevel === 'stations') {
            loadMoreStations();
        }
    }, { root: el('radio-browse-root'), rootMargin: '80px' });
    sentinelObserver.observe(sentinel);
}

function bindOnce() {
    if (bound) return;
    bound = true;

    el('radio-browse-back')?.addEventListener('click', () => {
        browseLevel = 'countries';
        activeCountry = null;
        syncSortControlsForLevel();
        renderCountries();
    });

    el('radio-browse-filter')?.addEventListener('input', (e) => {
        filterText = e.target.value || '';
        if (browseLevel === 'countries') renderCountries();
        else {
            stationsCache = [];
            stationOffset = 0;
            stationsDone = false;
            loadMoreStations();
        }
    });

    el('radio-browse-sort')?.addEventListener('change', (e) => {
        const value = e.target.value;
        if (browseLevel === 'countries') {
            RadioPlayer.saveCountrySort(value === 'name' ? 'name' : 'count');
            renderCountries();
        } else {
            RadioPlayer.saveBrowseSort(value);
            stationsCache = [];
            stationOffset = 0;
            stationsDone = false;
            loadMoreStations();
        }
    });

    el('radio-browse-sort-dir')?.addEventListener('change', (e) => {
        RadioPlayer.saveBrowseSortDir(e.target.value);
        if (browseLevel === 'stations') {
            stationsCache = [];
            stationOffset = 0;
            stationsDone = false;
            loadMoreStations();
        }
    });

    el('radio-recents-clear')?.addEventListener('click', () => {
        if (!confirm('Clear radio recents?')) return;
        RadioPlayer.clearRecents();
        renderRecents();
    });

    document.addEventListener('click', (e) => {
        if (catalogMode !== 'radio') return;
        const star = e.target.closest?.('[data-radio-star]');
        if (star) {
            e.preventDefault();
            e.stopPropagation();
            RadioPlayer.toggleFavorite(star.getAttribute('data-radio-star'));
            refreshActiveLists();
            return;
        }
        const country = e.target.closest?.('[data-radio-country]');
        if (country) {
            openCountry(country.getAttribute('data-radio-country'));
            return;
        }
        const row = e.target.closest?.('[data-radio-station]');
        if (row) {
            const key = row.getAttribute('data-radio-station');
            RadioPlayer.playStation(key).catch((err) => {
                showAppToast(err?.message || 'Playback failed');
            });
        }
    });

    window.addEventListener('radio:state_changed', () => {
        if (catalogMode === 'radio') refreshActiveLists({ soft: true });
    });
}

function refreshActiveLists({ soft = false } = {}) {
    const tab = document.querySelector('.tv-panel.is-active')?.id;
    if (tab === 'favorites-panel' || soft) renderFavorites();
    if (tab === 'recents-panel' || soft) renderRecents();
    if (!soft && browseLevel === 'stations') {
        const list = el('radio-browse-list');
        if (list && stationsCache.length) {
            list.innerHTML = stationsCache.map(stationRowHtml).join('');
        }
    } else if (!soft && browseLevel === 'countries') {
        renderCountries();
    }
}

export const RadioBrowseView = {
    init() {
        bindOnce();
        syncModeClasses();
    },

    getMode() {
        return catalogMode;
    },

    setMode(mode) {
        catalogMode = mode === 'radio' ? 'radio' : 'tv';
        syncModeClasses();
        setVisible(el('radio-browse-root'), catalogMode === 'radio');
        setVisible(el('radio-favorites-root'), catalogMode === 'radio');
        setVisible(el('radio-recents-root'), catalogMode === 'radio');
        if (catalogMode === 'radio') {
            ensureSentinel();
            syncSortControlsForLevel();
            if (!countriesCache.length) loadCountries();
            else renderCountries();
            renderFavorites();
            renderRecents();
        }
        return catalogMode;
    },

    async openBrowse() {
        this.setMode('radio');
        browseLevel = 'countries';
        activeCountry = null;
        syncSortControlsForLevel();
        await loadCountries();
    },

    refresh() {
        if (catalogMode !== 'radio') return;
        refreshActiveLists();
    }
};
