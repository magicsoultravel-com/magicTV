import { TvProviderRegistry } from '../tvProviders/registry.js';
import { countryFlagEmoji, escapeHtml, debounce, el, els } from '../tvUtils.js';
import { showAppToast } from '../ui/toast.js';
import { Appearance } from '../ui/appearance.js';
import { ChannelGrid } from '../ui/channelGrid.js';
import { TileFrames } from '../tileFrames.js';
import { ListSort, compareCountries, getSortPrefs, getCategoryFilterValue, setCategoryNameMap } from '../ui/listSort.js';

const PAGE_SIZE = 60;

let deps = {
    appState: null,
    stampRefreshView: () => {},
    updateRefreshAge: () => {},
    currentFilter: () => ''
};

let scrollLoadingBound = false;

function browsePanelNeedsMore() {
    const appState = deps.appState;
    const panel = el('browse-panel');
    if (!panel || !appState.browseHasMore || appState.browseLoading) return false;
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 20;
}

function scheduleBrowseFillCheck() {
    if (typeof requestAnimationFrame !== 'function') {
        if (browsePanelNeedsMore()) BrowseView.loadMoreChannels();
        return;
    }
    requestAnimationFrame(() => {
        if (browsePanelNeedsMore()) BrowseView.loadMoreChannels();
    });
}

function setupScrollLoading() {
    if (scrollLoadingBound) return;
    const panel = el('browse-panel');
    if (!panel) return;
    scrollLoadingBound = true;

    let ticking = false;
    function handleScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            if (browsePanelNeedsMore()) BrowseView.loadMoreChannels();
            ticking = false;
        });
    }

    panel.addEventListener('scroll', handleScroll, { passive: true });
}

export const BrowseView = {
    init({ appState, stampRefreshView, updateRefreshAge, currentFilter }) {
        deps = { appState, stampRefreshView, updateRefreshAge, currentFilter };
    },

    bind() {
        const search = el('search-countries');
        if (search) {
            search.setAttribute('placeholder', 'Filter');
            search.addEventListener('input', debounce((e) => {
                this.applyFilter(e.target.value.toLowerCase());
            }, 200));
        }
    },

    applyFilter(q) {
        const appState = deps.appState;
        if (appState.activeTab === 'browse') {
            if (appState.browseCountry === null) {
                appState.countryFilter = q;
                this.renderCountries();
            } else {
                this.startChannelSearch(q);
            }
        } else if (appState.activeTab === 'favorites') {
            appState.favFilter = q;
            ChannelGrid.renderFavorites();
        } else if (appState.activeTab === 'recents') {
            appState.recentsFilter = q;
            ChannelGrid.renderRecents();
        }
    },

    async refreshCountries() {
        const appState = deps.appState;
        try {
            appState.countries = await TvProviderRegistry.getCountries();
            setCategoryNameMap(TvProviderRegistry.getCategoryNameMap());
            deps.stampRefreshView('browseCountries', TvProviderRegistry.getLastRefreshed());
        } catch (err) {
            console.error('Failed to load countries:', err);
            showAppToast('Countries unavailable — check your connection');
        }
        deps.updateRefreshAge();
        ListSort.syncCategoryFilterControls();
        this.renderCountries();
    },

    renderCountries() {
        const appState = deps.appState;
        const container = el('countries-container');
        if (!container) return;
        const { sortBy, sortDir } = getSortPrefs(appState);
        const list = (appState.countries || [])
            .filter(c => c && c.name && c.name.toLowerCase().includes(appState.countryFilter))
            .slice()
            .sort((a, b) => compareCountries(a, b, sortBy || 'stations', sortDir || 'desc'));
        container.innerHTML = list.map(c => `
        <div class="country-tile" data-country="${escapeHtml(c.iso_3166_1 || '')}" role="button" tabindex="0">
            <div class="country-tile__icon">${countryFlagEmoji(c.iso_3166_1)}</div>
            <div class="country-tile__body">
                <h3 class="country-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(c.name)}</span></span></h3>
                <div class="country-tile__count">${c.stationcount || 0} channels</div>
            </div>
        </div>
    `).join('') || '<div class="empty-state"><p class="empty-state__text">No countries found</p></div>';

        container.querySelectorAll('.country-tile').forEach(tile => {
            const open = () => this.browseCountry(tile.dataset.country);
            tile.addEventListener('click', open);
            tile.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });
        Appearance.applyToTiles(container);
    },

    async browseCountry(countryCode) {
        const appState = deps.appState;
        appState.browseGeneration += 1;
        appState.browseLoading = false;
        appState.browseCountry = countryCode;
        TileFrames.clearLiveRefresh();
        appState.browseChannels = [];
        appState.browseOffset = 0;
        appState.browseHasMore = true;
        appState.browseQuery = deps.currentFilter();

        const countries = el('countries-container');
        const channels = el('channels-container');
        const browsePanel = el('browse-panel');
        const backBtn = el('back-btn');
        if (browsePanel) browsePanel.scrollTop = 0;
        if (countries) countries.classList.add('is-hidden');
        if (channels) channels.classList.remove('is-hidden');
        if (backBtn) {
            backBtn.classList.remove('is-hidden');
            backBtn.classList.add('is-active', 'is-pink-active');
            els('.tv-tab[data-tab="browse"]').forEach(tab => tab.classList.remove('is-active', 'is-pink-active'));
        }
        if (channels) channels.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading channels…</p></div>';
        deps.updateRefreshAge();
        ListSort.syncSortControls();

        await this.loadMoreChannels();
        setupScrollLoading();
    },

    async loadMoreChannels(forceRefresh = false) {
        const appState = deps.appState;
        if (appState.browseLoading || !appState.browseHasMore) return;
        const generation = appState.browseGeneration;
        appState.browseLoading = true;
        const { sortBy, sortDir } = getSortPrefs(appState);
        try {
            const results = await TvProviderRegistry.searchChannels({
                countrycode: appState.browseCountry,
                query: appState.browseQuery,
                category: getCategoryFilterValue(appState),
                offset: appState.browseOffset,
                limit: PAGE_SIZE,
                order: sortBy === 'category' ? 'category' : 'name',
                reverse: sortDir === 'desc',
                refresh: forceRefresh
            });
            if (generation !== appState.browseGeneration) return;
            if (results.length < PAGE_SIZE) {
                appState.browseHasMore = false;
            }
            appState.browseChannels = appState.browseChannels.concat(results);
            appState.browseOffset += PAGE_SIZE;
            const grid = el('channels-container');
            ChannelGrid.render(grid, results, { append: true });
            if (grid && TileFrames.isLiveRefreshActive(`browse:${appState.browseCountry}`)) {
                TileFrames.enqueueFolderFramesForRefresh(grid);
            }
            setCategoryNameMap(TvProviderRegistry.getCategoryNameMap());
            ListSort.syncCategoryFilterControls();
        } catch (err) {
            if (generation !== appState.browseGeneration) return;
            console.error('Failed to load channels:', err);
            showAppToast('Failed to load channels');
        } finally {
            if (generation === appState.browseGeneration) {
                appState.browseLoading = false;
                scheduleBrowseFillCheck();
            }
        }
    },

    /** Restart channel list when filter or sort changes. */
    restartChannelList(query = deps.currentFilter()) {
        this.startChannelSearch(query);
    },

    startChannelSearch(query) {
        const appState = deps.appState;
        appState.browseGeneration += 1;
        appState.browseLoading = false;
        appState.browseQuery = query || '';
        appState.browseChannels = [];
        appState.browseOffset = 0;
        appState.browseHasMore = true;
        const container = el('channels-container');
        if (container) {
            container.innerHTML = query
                ? '<div class="empty-state"><p class="empty-state__text">Filtering…</p></div>'
                : '<div class="empty-state"><p class="empty-state__text">Loading channels…</p></div>';
        }
        this.loadMoreChannels(false);
    },

    async refreshBrowseCountry() {
        const appState = deps.appState;
        appState.browseGeneration += 1;
        appState.browseLoading = false;
        appState.browseChannels = [];
        appState.browseOffset = 0;
        appState.browseHasMore = true;
        const container = el('channels-container');
        if (container) {
            container.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading channels…</p></div>';
        }
        await this.loadMoreChannels(true);
    },

    showCountriesView() {
        const appState = deps.appState;
        appState.browseCountry = null;
        TileFrames.clearLiveRefresh();
        appState.countryFilter = deps.currentFilter();
        const countries = el('countries-container');
        const channels = el('channels-container');
        const backBtn = el('back-btn');
        if (countries) countries.classList.remove('is-hidden');
        if (channels) channels.classList.add('is-hidden');
        if (backBtn) {
            backBtn.classList.add('is-hidden');
            backBtn.classList.remove('is-active', 'is-pink-active');
        }
        els('.tv-tab[data-tab="browse"]').forEach(tab => tab.classList.add('is-active'));
        ListSort.syncSortControls();
        this.renderCountries();
        deps.updateRefreshAge();
    }
};
