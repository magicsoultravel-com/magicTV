/** magicTV - Neon-styled TV streaming browser (composition root) */
import { TvPlayer } from './tvPlayer.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { formatRelativeTime, el, els } from './tvUtils.js';
import { showAppToast } from './ui/toast.js';
import { TvPip } from './tvPip.js';
import { TileFrames } from './tileFrames.js';
import { SettingsStore } from './storage/settingsStore.js';
import { ChannelGrid } from './ui/channelGrid.js';
import { FavoritesFolders } from './ui/favoritesFolders.js';
import { BrowseView } from './browse/browseView.js';
import { Appearance } from './ui/appearance.js';
import { PlayerChrome } from './ui/playerChrome.js';
import { MultiView, MAX_MOSAIC_SLOTS } from './multiView.js';
import { TvClock } from './ui/tvClock.js';
import { RemoteModule } from './ui/remoteModule.js';
import { RemotePanel, syncRemoteNav, syncRemoteChannelBar } from './ui/remotePanel.js';
import { RemoteExternalPopout } from './ui/remoteExternalPopout.js';
import { HiddenChannelsSettings } from './ui/hiddenChannelsSettings.js';
import { VisitedChannelsSettings } from './ui/visitedChannelsSettings.js';
import { GuidePanel } from './ui/guidePanel.js';
import { warmGuideIndex } from './epg/epgService.js';

import { ACTION_ICONS, CARD_ICONS } from './ui/icons.js';
import { ListSort } from './ui/listSort.js';
import { loadPlayerState, DEFAULT_SORT_BY, DEFAULT_SORT_DIR, DEFAULT_CATEGORY_FILTER } from './storage/playerState.js';
import {
    VIEW_MOTION,
    fillViewTransitionSelect,
    resolveViewTransition,
    runWipeTransition
} from './ui/viewTransitions.js';
import { primeBootScreen, revealBootScreen } from './ui/bootScreen.js';

const DEFAULT_FIRST_CHANNEL_URL = 'https://channels.trace.plus/Traceprod/CARIBBEAN_hd/index.m3u8';
const DEFAULT_FIRST_CHANNEL_NAME = 'CARIBBEAN';

let appState = {
    countries: [],
    browseCountry: null,
    browseChannels: [],
    browseOffset: 0,
    browseHasMore: false,
    browseLoading: false,
    browseGeneration: 0,
    browseSortDirty: false,
    activeTab: 'remote',
    countryFilter: '',
    browseQuery: '',
    favFilter: '',
    recentsFilter: '',
    favoritesList: [],
    recentsList: [],
    favoritesFolderId: null,
    lastKey: null,
    lastName: '',
    lastCountry: '',
    sortBy: { ...DEFAULT_SORT_BY },
    sortDir: { ...DEFAULT_SORT_DIR },
    categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
    // Per-navigation refresh clocks for the bottom-right age label.
    // Keys: browseCountries | browse:<iso> | favorites | recents | settings
    lastRefreshedByView: Object.create(null)
};

function currentFilter() {
    const search = el('search-countries');
    return search ? (search.value || '').toLowerCase() : '';
}

function currentRefreshKey() {
    const tab = appState.activeTab;
    if (tab === 'browse') {
        return appState.browseCountry == null
            ? 'browseCountries'
            : `browse:${appState.browseCountry}`;
    }
    return tab;
}

function stampRefreshView(key, ts = Date.now()) {
    if (!key || !ts) return;
    appState.lastRefreshedByView[key] = ts;
}

function updateRefreshAge() {
    const btn = el('refresh-btn');
    if (!btn) return;
    const ts = appState.lastRefreshedByView[currentRefreshKey()] || 0;
    const age = formatRelativeTime(ts);
    const label = age ? `Refresh this tab · ${age}` : 'Refresh this tab · Never refreshed';
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function activeChannelGrid() {
    const tab = appState.activeTab;
    if (tab === 'browse' && appState.browseCountry != null) return el('channels-container');
    if (tab === 'favorites') return el('favorites-grid');
    if (tab === 'recents') return el('recents-grid');
    return null;
}

function startPlayback(channel) {
    TileFrames.setPlaybackBusy(true);
    const slotId = MultiView.statusSlotId || 'center';
    MultiView.playOnSlot(slotId, channel).catch((e) => {
        const blocked = e?.name === 'NotAllowedError'
            || String(e?.message || '').toLowerCase().includes('not allowed');
        if (!blocked) showAppToast('Stream unavailable');
        const player = MultiView.getStatusPlayer?.() || MultiView.getPrimary?.();
        if (!player?.playing) TileFrames.setPlaybackBusy(false);
    });
}

function loadLocalState() {
    const meta = SettingsStore.loadLastChannelMeta();
    appState.lastKey = meta.lastKey;
    appState.lastName = meta.lastName;
    appState.lastCountry = meta.lastCountry;
    try {
        const player = loadPlayerState();
        appState.sortBy = { ...DEFAULT_SORT_BY, ...(player.sortBy || {}) };
        appState.sortDir = { ...DEFAULT_SORT_DIR, ...(player.sortDir || {}) };
        appState.categoryFilter = {
            ...DEFAULT_CATEGORY_FILTER,
            ...(player.categoryFilter || {})
        };
    } catch {
        appState.sortBy = { ...DEFAULT_SORT_BY };
        appState.sortDir = { ...DEFAULT_SORT_DIR };
        appState.categoryFilter = { ...DEFAULT_CATEGORY_FILTER };
    }
}

function handleSortChanged(context, opts = {}) {
    if (context === 'countries') {
        BrowseView.renderCountries();
    } else if (context === 'channels') {
        BrowseView.renderBrowseChannels(opts);
    } else if (context === 'favorites') {
        ChannelGrid.renderFavorites();
    } else if (context === 'recents') {
        ChannelGrid.renderRecents();
    }
}

function handleCategoryFilterChanged(context) {
    if (context === 'channels') {
        BrowseView.restartChannelList();
    } else if (context === 'favorites') {
        ChannelGrid.renderFavorites();
    } else if (context === 'recents') {
        ChannelGrid.renderRecents();
    }
}

async function restoreLastChannelMeta() {
    try {
        const meta = SettingsStore.loadLastChannelMeta();
        if (!meta.lastKey) return;
        appState.lastKey = meta.lastKey;
        appState.lastName = meta.lastName;
        appState.lastCountry = meta.lastCountry;
        const ch = await TvProviderRegistry.getChannel(parseChannelKey(meta.lastKey)).catch(() => null);
        if (!ch) return;
        TvPlayer.channel = ch;
        appState.lastKey = channelKey(ch);
        appState.lastName = ch.name;
        appState.lastCountry = ch.countrycode || '';
        TvPlayer.emitState();
    } catch { /* ignore */ }
}

function bindBackButton() {
    const back = el('back-btn');
    if (back) {
        back.addEventListener('click', () => {
            if (back.dataset.tab === 'back-to-favorites-root') {
                FavoritesFolders.closeFavoriteFolder();
                ChannelGrid.renderFavorites();
                syncCreateFavoriteFolderBtn();
                return;
            }
            BrowseView.showCountriesView();
        });
    }
}

function bindTabBarPopups() {
    const filterBtn = el('filter-btn');
    const filterInput = el('search-countries');
    const categoryBtn = el('category-btn');
    const categorySelect = el('category-filter');
    const sortBtn = el('sort-btn');
    const sortSelect = el('sort-select');

    const closePopups = () => {
        if (filterInput) filterInput.classList.remove('is-visible');
        if (categorySelect) categorySelect.classList.remove('is-visible');
        if (sortSelect) sortSelect.classList.remove('is-visible');
    };

    const togglePopup = (target) => {
        const wasOpen = target?.classList.contains('is-visible');
        closePopups();
        if (!wasOpen) target?.classList.add('is-visible');
    };

    // Click outside closes all popups
    document.addEventListener('click', (e) => {
        if (e.target.closest('.tv-tab')) return;
        if (e.target.closest('.tv-tab--filter-input')) return;
        if (e.target.closest('.tv-tab--category')) return;
        if (e.target.closest('.tv-tab--sort')) return;
        closePopups();
    });

    if (filterBtn) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopup(filterInput);
            if (filterInput?.classList.contains('is-visible')) filterInput.focus();
        });
    }

    if (categoryBtn) {
        categoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopup(categorySelect);
        });
    }

    if (sortBtn) {
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopup(sortSelect);
        });
    }
}

function bindTabs() {
    els('.tv-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            // Controls styled with `.tv-tab` that are not actual tabs (e.g. the
            // ASC/DESC arrow) have no data-tab. Do not treat them as a tab switch.
            if (!tabName) return;
            if (tabName === 'back-to-countries') {
                BrowseView.showCountriesView();
                return;
            }
            if (tabName === 'back-to-favorites-root') {
                FavoritesFolders.closeFavoriteFolder();
                ChannelGrid.renderFavorites();
                syncCreateFavoriteFolderBtn();
                return;
            }
            if (tabName === appState.activeTab) return;
            withCatalogViewTransition(() => switchTab(tabName));
        });
    });
}

let screenWipeBusy = false;

function prefersReducedCatalogMotion() {
    return typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Apply the selected view transition around a catalog UI swap (tab change).
 * Scoped to the browse module so the player does not flash.
 */
async function withCatalogViewTransition(mutate) {
    if (screenWipeBusy) return false;
    const mode = resolveViewTransition(SettingsStore.getCatalogTransition(), 'catalog');
    if (prefersReducedCatalogMotion() || mode === 'instant') {
        mutate();
        return true;
    }
    if (mode === 'dissolve' || mode === 'grain') {
        screenWipeBusy = true;
        try {
            await runWipeTransition(mode, mutate, { scope: 'catalog' });
        } finally {
            screenWipeBusy = false;
        }
        return true;
    }

    const body = el('tv-catalog-body');
    if (!body || typeof body.animate !== 'function') {
        mutate();
        return true;
    }

    screenWipeBusy = true;
    const cfg = VIEW_MOTION[mode] || VIEW_MOTION.fade;
    const opts = { duration: Math.round(cfg.duration * 0.55), easing: cfg.easing, fill: 'forwards' };
    try {
        let outFrames = [{ opacity: 1 }, { opacity: 0 }];
        let inFrames = [{ opacity: 0 }, { opacity: 1 }];
        if (mode === 'slide') {
            outFrames = [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(16px)' }
            ];
            inFrames = [
                { opacity: 0, transform: 'translateY(-16px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ];
        } else if (mode === 'spring') {
            outFrames = [
                { opacity: 1, transform: 'scale(1)' },
                { opacity: 0, transform: 'scale(0.96)' }
            ];
            inFrames = [
                { opacity: 0, transform: 'scale(1.03)' },
                { opacity: 1, transform: 'scale(1)' }
            ];
        } else if (mode === 'flip') {
            outFrames = [
                { opacity: 1, transform: 'rotateY(0deg)' },
                { opacity: 0, transform: 'rotateY(90deg)' }
            ];
            inFrames = [
                { opacity: 0, transform: 'rotateY(-90deg)' },
                { opacity: 1, transform: 'rotateY(0deg)' }
            ];
        } else if (mode === 'smooth') {
            outFrames = [
                { opacity: 1, transform: 'scale(1)' },
                { opacity: 0, transform: 'scale(0.97)' }
            ];
            inFrames = [
                { opacity: 0, transform: 'scale(1.03)' },
                { opacity: 1, transform: 'scale(1)' }
            ];
        }
        // fade + crossfade share simple opacity
        const out = body.animate(outFrames, opts);
        await out.finished;
        mutate();
        const inn = body.animate(inFrames, opts);
        await inn.finished;
        try {
            out.cancel();
            inn.cancel();
        } catch { /* ignore */ }
        body.style.opacity = '';
        body.style.transform = '';
    } catch {
        mutate();
        body.style.opacity = '';
        body.style.transform = '';
    } finally {
        screenWipeBusy = false;
    }
    return true;
}


function matchesFavFilter(ch, q) {
    if (!q) return true;
    const name = (ch?.name || '').toLowerCase();
    const id = (ch?.channelId || '').toLowerCase();
    return name.includes(q) || id.includes(q);
}

function syncPlayFavoritesMosaicBtn() {
    const btn = el('play-favorites-mosaic-btn');
    if (!btn) return;
    btn.classList.toggle('is-hidden', appState.activeTab !== 'favorites');
}

function syncCreateFavoriteFolderBtn() {
    const btn = el('create-favorite-folder-btn');
    if (!btn) return;
    const visible = appState.activeTab === 'favorites' && !appState.favoritesFolderId;
    btn.classList.toggle('is-hidden', !visible);
}

function bindCreateFavoriteFolderBtn() {
    const btn = el('create-favorite-folder-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.innerHTML = CARD_ICONS.folderPlus;
    btn.title = 'New folder';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => {
        FavoritesFolders.createFavoriteFolder();
        syncCreateFavoriteFolderBtn();
    });
}

const CHANNEL_TABS = ['browse', 'favorites', 'recents'];

function bindRemoteExternalPopoutBtn() {
    const btn = el('remote-external-popout-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
        if (RemoteExternalPopout.isPoppedOut()) {
            RemoteExternalPopout.popIn();
            return;
        }
        if (RemoteExternalPopout.getPopoutWindow()) {
            RemoteExternalPopout.openOrFocus();
            return;
        }
        RemoteExternalPopout.popOut();
    });
}

function syncCatalogLayoutBtn() {
    const btn = el('catalog-layout-btn');
    if (!btn) return;
    const onChannelTabs = appState.activeTab === 'browse'
        || appState.activeTab === 'favorites'
        || appState.activeTab === 'recents';
    btn.classList.toggle('is-hidden', !onChannelTabs);
    const layout = SettingsStore.getCatalogLayout();
    const toList = layout !== 'list';
    btn.innerHTML = toList ? ACTION_ICONS.list : ACTION_ICONS.tiles;
    const label = toList ? 'List view' : 'Tiles view';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', layout === 'list' ? 'true' : 'false');
}

function bindCatalogLayout() {
    const btn = el('catalog-layout-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
        const next = SettingsStore.getCatalogLayout() === 'list' ? 'tiles' : 'list';
        SettingsStore.setCatalogLayout(next);
        Appearance.applyStyles();
        syncCatalogLayoutBtn();
    });
}

function bindRefreshBtn() {
    const btn = el('refresh-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.innerHTML = ACTION_ICONS.refresh;
    updateRefreshAge();
    btn.addEventListener('click', () => {
        handleManualRefresh();
    });
}

function bindPlayFavoritesMosaic() {
    const btn = el('play-favorites-mosaic-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.innerHTML = ACTION_ICONS.playMosaic;
    btn.title = 'Play favorites on multiple TVs';
    btn.setAttribute('aria-label', btn.title);

    btn.addEventListener('click', () => {
        const filter = appState.favFilter || currentFilter();
        const list = (appState.favoritesList || [])
            .filter((ch) => matchesFavFilter(ch, filter))
            .slice(0, MAX_MOSAIC_SLOTS);
        if (!list.length) {
            showAppToast('No favorites to play');
            return;
        }
        MultiView.playChannelsOnMosaic(list)
            .then(() => {
                showAppToast(`Playing ${list.length} favorite${list.length === 1 ? '' : 's'}`);
            })
            .catch((e) => {
                console.error('play favorites mosaic failed', e);
                showAppToast('Could not play favorites');
            });
    });
}


let refreshInFlight = false;

async function handleManualRefresh() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const btn = el('refresh-btn');
    const spin = () => btn && btn.classList.add('is-loading');
    const unspin = () => btn && btn.classList.remove('is-loading');
    spin();
    showAppToast('Refreshing…');
    try {
        const tab = appState.activeTab;
        const viewKey = currentRefreshKey();
        if (tab === 'browse') {
            if (appState.browseCountry === null) {
                TileFrames.clearLiveRefresh();
                appState.countries = await TvProviderRegistry.refreshCatalog();
                BrowseView.renderCountries();
                stampRefreshView('browseCountries', TvProviderRegistry.getLastRefreshed());
            } else {
                await BrowseView.refreshBrowseCountry();
                stampRefreshView(viewKey);
                const grid = activeChannelGrid();
                if (grid) await TileFrames.refresh(grid, { viewKey });
            }
        } else if (tab === 'favorites') {
            await ChannelGrid.refreshFavorites(true);
            stampRefreshView('favorites');
            const grid = activeChannelGrid();
            if (grid) await TileFrames.refresh(grid, { viewKey: 'favorites' });
        } else if (tab === 'recents') {
            await ChannelGrid.refreshRecents(true);
            stampRefreshView('recents');
            const grid = activeChannelGrid();
            if (grid) await TileFrames.refresh(grid, { viewKey: 'recents' });
        } else {
            TileFrames.clearLiveRefresh();
            Appearance.refreshWatchStats();
            Appearance.updateStorageStats();
            HiddenChannelsSettings.refresh();
            VisitedChannelsSettings.refresh();
            stampRefreshView('settings');
        }
        showAppToast('✅ Refreshed');
    } catch {
        showAppToast('Refresh failed — try again');
    } finally {
        refreshInFlight = false;
        unspin();
        updateRefreshAge();
    }
}

function syncRemoteTabChrome() {
    const tab = appState.activeTab;
    const isChannelTab = CHANNEL_TABS.includes(tab);
    const showFilters = isChannelTab;
    const catalogTools = el('remote-catalog-tools');
    const body = el('tv-catalog-body');

    if (catalogTools) {
        catalogTools.classList.toggle('is-visible', showFilters);
    }
    if (body) {
        body.classList.toggle('is-remote-view', tab === 'remote');
        body.classList.toggle('is-subview', showFilters);
    }
    syncRemoteNav(tab);
    syncRemoteChannelBar(tab);
}

function activateTabPanels(tabName) {
    if (RemoteExternalPopout.isPoppedOut()) {
        RemoteExternalPopout.syncActiveTab(tabName);
        return;
    }
    els('.tv-panel').forEach((panel) => panel.classList.remove('is-active'));
    el(`${tabName}-panel`)?.classList.add('is-active');
}

function switchTab(tabName) {
    appState.activeTab = tabName;
    activateTabPanels(tabName);

    const backBtn = el('back-btn');
    if (backBtn) {
        if (appState.browseCountry !== null && tabName === 'browse') {
            backBtn.classList.remove('is-hidden');
            backBtn.classList.add('is-active', 'is-pink-active');
            backBtn.dataset.tab = 'back-to-countries';
        } else if (tabName === 'favorites') {
            FavoritesFolders.syncBackButton();
        } else {
            backBtn.classList.add('is-hidden');
            backBtn.classList.remove('is-active', 'is-pink-active');
            backBtn.dataset.tab = 'back-to-countries';
        }
    }

    if (tabName !== 'favorites' && appState.favoritesFolderId) {
        appState.favoritesFolderId = null;
    }

    syncRemoteTabChrome();
    TileFrames.syncLiveRefresh(currentRefreshKey());
    ListSort.syncSortControls();
    if (tabName === 'favorites') {
        appState.favFilter = currentFilter();
        ChannelGrid.refreshFavorites();
    } else if (tabName === 'recents') {
        appState.recentsFilter = currentFilter();
        ChannelGrid.refreshRecents();
    } else if (tabName === 'browse' && appState.browseCountry !== null) {
        const q = currentFilter();
        if (q !== appState.browseQuery) BrowseView.startChannelSearch(q);
    } else if (tabName === 'settings') {
        Appearance.refreshWatchStats();
        Appearance.updateStorageStats();
        HiddenChannelsSettings.refresh();
        VisitedChannelsSettings.refresh();
    }
    syncPlayFavoritesMosaicBtn();
    syncCreateFavoriteFolderBtn();
    syncCatalogLayoutBtn();
    RemoteExternalPopout.syncBtn();
    updateRefreshAge();
    RemotePanel.syncRemotePanel();
}

export { switchTab };

function bindViewTransitionSelect() {
    const select = el('catalog-transition-select');
    if (!select || select.dataset.bound === '1') return;
    select.dataset.bound = '1';
    fillViewTransitionSelect(select, SettingsStore.getCatalogTransition());
    select.addEventListener('change', () => {
        const next = SettingsStore.setCatalogTransition(select.value);
        select.value = next;
        showAppToast(`View transition: ${next.charAt(0).toUpperCase()}${next.slice(1)}`);
    });
}

async function init() {
    let revealed = false;
    const reveal = async () => {
        if (revealed) return;
        revealed = true;
        try {
            await revealBootScreen();
        } catch {
            document.documentElement.classList.remove('is-booting');
            el('boot-screen')?.remove();
        }
    };

    try {
        primeBootScreen();
        Appearance.applyStyles();

        ChannelGrid.init({
            appState,
            getRefreshKey: currentRefreshKey,
            onPlay: startPlayback
        });
        RemoteModule.init({
            getDefaultOnPlay: () => startPlayback,
            switchTab
        });
        RemotePanel.bind();
        GuidePanel.bind();
        BrowseView.init({
            appState,
            stampRefreshView,
            updateRefreshAge,
            currentFilter
        });
        PlayerChrome.init({ appState });
        HiddenChannelsSettings.init({ appState, onPlay: startPlayback });
        VisitedChannelsSettings.init({ appState, onPlay: startPlayback });

        TvPlayer.init();
        TvPip.init();
        TvPlayer.mountVideo();
        TileFrames.warmup();
        MultiView.bindSettings();

        loadLocalState();
        ListSort.init({
            appState,
            onSortChanged: handleSortChanged,
            onCategoryFilterChanged: handleCategoryFilterChanged
        });
        PlayerChrome.updateNowPlayingHeader();

        bindViewTransitionSelect();
        bindTabs();
        bindPlayFavoritesMosaic();
        bindCreateFavoriteFolderBtn();
        bindCatalogLayout();
        bindRefreshBtn();
        syncPlayFavoritesMosaicBtn();
        syncCreateFavoriteFolderBtn();
        syncCatalogLayoutBtn();
        syncRemoteTabChrome();
        switchTab('remote');
        TvClock.init();

        PlayerChrome.bindControls();
        PlayerChrome.bindSettings();
        HiddenChannelsSettings.bind();
        VisitedChannelsSettings.bind();
        BrowseView.bind();
        ListSort.bind();
        ListSort.syncSortControls();
        bindBackButton();
        bindTabBarPopups();

        PlayerChrome.syncSettingsFromState();

        window.addEventListener('tv:state_changed', (e) => PlayerChrome.onPlayerStateChanged(e));

        await restoreLastChannelMeta();

        // Mosaic stubs already painted in MultiView.init; attach streams under cover.
        // Catalog/countries can be slow on cold cache — kick off but do not gate reveal.
        const restorePromise = MultiView.restoreSlots().catch(() => false);
        const countriesPromise = BrowseView.refreshCountries().catch(() => {});

        const restored = await restorePromise;
        if (restored) {
            if (TvPlayer.channel) {
                appState.lastKey = channelKey(TvPlayer.channel);
                appState.lastName = TvPlayer.channel.name || appState.lastName;
                appState.lastCountry = TvPlayer.channel.countrycode || '';
            }
            PlayerChrome.updateNowPlayingHeader();
        } else if (!TvPlayer.channel && !appState.lastKey) {
            const firstChannel = {
                name: DEFAULT_FIRST_CHANNEL_NAME,
                url_resolved: DEFAULT_FIRST_CHANNEL_URL,
                channelId: 'trace-CARIBBEAN_hd',
                providerId: 'trace',
                countrycode: '',
                lastcheckok: 1
            };
            TvPlayer.channel = firstChannel;
            startPlayback(firstChannel);
        } else if (TvPlayer.channel) {
            TvPlayer.resumeIfWasPlaying().catch(() => {});
        }

        // Docked → modal teleport finishes under the boot cover.
        RemoteModule.restoreOpenIfNeeded();
        bindRemoteExternalPopoutBtn();
        RemoteExternalPopout.syncBtn();

        window.addEventListener('remote:external_popout_changed', () => {
            if (RemoteExternalPopout.isPoppedOut()) {
                RemoteExternalPopout.syncActiveTab(appState.activeTab);
            } else {
                activateTabPanels(appState.activeTab);
            }
            syncRemoteTabChrome();
            RemoteExternalPopout.syncBtn();
        });

        await reveal();

        await countriesPromise;
        warmGuideIndex().catch(() => {});
        updateRefreshAge();
        const refreshAgeTimer = setInterval(updateRefreshAge, 60 * 1000);
        if (refreshAgeTimer?.unref) refreshAgeTimer.unref();
    } finally {
        await reveal();
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}
