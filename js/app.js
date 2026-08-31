/** magicTV - Neon-styled TV streaming browser (composition root) */
import { TvPlayer } from './tvPlayer.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { el, els } from './tvUtils.js';
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
import { SLOT_IDS, slotIsOccupied } from './mosaic/constants.js';
import { parseDeepLink, resolveDeepLinkChannel, chooseSharedPlayTarget } from './share/shareChannel.js';
import { TvClock } from './ui/tvClock.js';
import { RemoteModule } from './ui/remoteModule.js';
import { RemotePanel, syncRemoteNav, syncRemoteChannelBar } from './ui/remotePanel.js';
import { RemoteExternalPopout } from './ui/remoteExternalPopout.js';
import { HiddenChannelsSettings } from './ui/hiddenChannelsSettings.js';
import { VisitedChannelsSettings } from './ui/visitedChannelsSettings.js';
import { GuidePanel } from './ui/guidePanel.js';
import { WingPanel } from './ui/wingPanel.js';
import { isSplit } from './ui/moduleLayout.js';
import { warmGuideIndex } from './epg/epgService.js';

import { ACTION_ICONS, CARD_ICONS } from './ui/icons.js';
import { ListSort } from './ui/listSort.js';
import { ChanBindPicker } from './ui/chanBindPicker.js';
import { loadPlayerState, DEFAULT_SORT_BY, DEFAULT_SORT_DIR, DEFAULT_CATEGORY_FILTER } from './storage/playerState.js';
import {
    fillViewTransitionSelect,
    resolveViewTransition,
    runCatalogPanelTransition
} from './ui/viewTransitions.js';
import { primeBootScreen, revealBootScreen, fadeOutBootCover, revealAppBehind } from './ui/bootScreen.js';
import { ResumeSessionModal, collectSessionTiles } from './ui/resumeSessionModal.js';
import { initHeaderCollapse } from './ui/headerCollapse.js';
import { UserDataSettings } from './ui/userDataSettings.js';

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
    lastBrowserTab: 'browse',
    scrollBrowseCountries: 0,
    scrollBrowseChannels: 0,
    scrollFavorites: 0,
    scrollRecents: 0,
    lastKey: null,
    lastName: '',
    lastCountry: '',
    sortBy: { ...DEFAULT_SORT_BY },
    sortDir: { ...DEFAULT_SORT_DIR },
    categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
    // Per-navigation refresh stamps used by live tile refresh.
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

/**
 * Handle a shared magicTV deep link (/?ch=<channelKey>&name=…&country=…).
 * Resolves the channel via the active provider, then plays it on a TV screen:
 *   - first free slot in fill order (→ 'center' = a single, clean TV for
 *     recipients with nothing running), or
 *   - the last (most-recently focused) screen when every slot is occupied.
 * Routes through playOnSlot so recents/persistence behave like a normal play.
 * @returns {Promise<boolean>} true if a shared channel was requested (played or failed).
 */
async function playSharedDeepLink() {
    const shared = parseDeepLink();
    if (!shared) return false;
    const channel = await resolveDeepLinkChannel(shared);
    if (!channel) {
        showAppToast('Shared channel not found');
        return true;
    }
    const occupied = SLOT_IDS.filter((id) => slotIsOccupied(
        MultiView.slots?.[id]?.player?.channel,
        MultiView.rememberedSlotKeys?.[id]
    ));
    const target = chooseSharedPlayTarget(occupied, {
        max: MAX_MOSAIC_SLOTS,
        fallback: MultiView.statusSlotId || 'center'
    });
    TileFrames.setPlaybackBusy(true);
    await MultiView.playOnSlot(target, channel).catch(() => {});
    TileFrames.setPlaybackBusy(false);
    return true;
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
        if (e.target.closest('.tv-tab-popup')) return;
        if (e.target.closest('.tv-tab--filter-input')) return;
        if (e.target.closest('.tv-tab--category')) return;
        if (e.target.closest('.tv-tab--sort')) return;
        if (e.target.closest('#sort-dir-btn')) return;
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
    els('#remote-catalog-tools [data-tab], .tv-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            // Controls with no data-tab are not tab switches.
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
            switchTabAnimated(tabName);
        });
    });
}

let screenWipeBusy = false;

function prefersReducedCatalogMotion() {
    return typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Apply the selected view transition around a browser-catalog panel swap.
 * Targets #browser-shell so remote keypad chrome is not faded.
 */
async function withCatalogViewTransition(mutate, surfaceOverride = null) {
    if (screenWipeBusy) return false;
    const mode = resolveViewTransition(SettingsStore.getCatalogTransition(), 'catalog');
    if (prefersReducedCatalogMotion() || mode === 'instant') {
        mutate();
        return true;
    }

    const surface = surfaceOverride || el('browser-shell') || el('tv-catalog-body');
    screenWipeBusy = true;
    try {
        await runCatalogPanelTransition(surface, mode, mutate);
    } finally {
        screenWipeBusy = false;
    }
    return true;
}

/** View transition scoped to the browse list panel (countries ↔ channels). */
function withBrowseDrillTransition(mutate) {
    return withCatalogViewTransition(mutate, el('browse-panel'));
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
    ChanBindPicker.syncCatalogBindVisibility(appState.activeTab === 'favorites');
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
    WingPanel.syncForTab(tab);
}

const BROWSER_TABS = ['browse', 'favorites', 'recents', 'settings'];

function saveActiveTabScroll() {
    const tab = appState.activeTab;
    const panel = el(`${tab}-panel`);
    if (!panel) return;
    if (tab === 'browse') {
        BrowseView.saveScroll();
    } else if (tab === 'favorites') {
        appState.scrollFavorites = panel.scrollTop;
    } else if (tab === 'recents') {
        appState.scrollRecents = panel.scrollTop;
    }
}

function restoreActiveTabScroll(tabName) {
    const panel = el(`${tabName}-panel`);
    if (!panel) return;
    if (tabName === 'browse') {
        BrowseView.restoreScroll();
    } else if (tabName === 'favorites' && appState.scrollFavorites > 0) {
        panel.scrollTop = appState.scrollFavorites;
    } else if (tabName === 'recents' && appState.scrollRecents > 0) {
        panel.scrollTop = appState.scrollRecents;
    }
}

/** When split, Browser window must show a catalog tab — never leave panels blank. */
function ensureBrowserCatalogVisible() {
    if (!isSplit()) return;
    let tab = appState.activeTab;
    if (tab === 'remote' || !BROWSER_TABS.includes(tab)) {
        tab = appState.lastBrowserTab || 'browse';
    }
    if (tab !== appState.activeTab) {
        switchTab(tab);
        return;
    }
    activateTabPanels(tab);
    if (tab === 'browse') BrowseView.restoreView();
    else if (tab === 'favorites') ChannelGrid.refreshFavorites();
    else if (tab === 'recents') ChannelGrid.refreshRecents();
}

function activateTabPanels(tabName) {
    els('.tv-panel').forEach((panel) => panel.classList.remove('is-active'));
    el(`${tabName}-panel`)?.classList.add('is-active');
}

function switchTab(tabName) {
    if (BROWSER_TABS.includes(appState.activeTab) && tabName !== appState.activeTab) {
        saveActiveTabScroll();
    }
    appState.activeTab = tabName;
    if (BROWSER_TABS.includes(tabName)) {
        appState.lastBrowserTab = tabName;
    }

    // Remote is the door: when split, browser tabs focus the Browser window.
    if (BROWSER_TABS.includes(tabName) && RemoteModule.isOpen?.() && isSplit()) {
        RemoteModule.focusBrowserWindow?.();
    }

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

    syncRemoteTabChrome();
    TileFrames.syncLiveRefresh(currentRefreshKey());
    ListSort.syncSortControls();
    if (tabName === 'favorites') {
        appState.favFilter = currentFilter();
        ChannelGrid.refreshFavorites();
        restoreActiveTabScroll('favorites');
    } else if (tabName === 'recents') {
        appState.recentsFilter = currentFilter();
        ChannelGrid.refreshRecents();
        restoreActiveTabScroll('recents');
    } else if (tabName === 'browse') {
        BrowseView.restoreView();
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
    RemoteModule.syncSplitChromeButtons?.();
    RemotePanel.syncRemotePanel();
}

/**
 * User-facing nav among browser catalog tabs — runs View transition when applicable.
 * Navigating to/from remote (or same tab) stays instant.
 */
function switchTabAnimated(tabName) {
    if (!tabName || tabName === appState.activeTab) return;
    const fromBrowser = BROWSER_TABS.includes(appState.activeTab);
    const toBrowser = BROWSER_TABS.includes(tabName);
    if (fromBrowser && toBrowser) {
        withCatalogViewTransition(() => switchTab(tabName));
        return;
    }
    switchTab(tabName);
}

export { switchTab, ensureBrowserCatalogVisible };

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
    const hasSession = collectSessionTiles().length > 0;
    const reveal = async () => {
        if (revealed) return;
        revealed = true;
        try {
            if (hasSession) {
                await fadeOutBootCover();
            } else {
                await revealBootScreen();
            }
        } catch {
            document.documentElement.classList.remove('is-booting');
            document.documentElement.classList.remove('is-app-pending');
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
            switchTab,
            switchTabNav: switchTabAnimated,
            ensureBrowserCatalog: ensureBrowserCatalogVisible
        });
        RemotePanel.bind();
        GuidePanel.init();
        BrowseView.init({
            appState,
            stampRefreshView,
            currentFilter,
            runBrowseTransition: withBrowseDrillTransition
        });
        PlayerChrome.init({ appState });
        HiddenChannelsSettings.init({ appState, onPlay: startPlayback });
        VisitedChannelsSettings.init({ appState, onPlay: startPlayback });

        MultiView._deferFullRestore = true;
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
        ChanBindPicker.bind();
        syncPlayFavoritesMosaicBtn();
        syncCreateFavoriteFolderBtn();
        syncCatalogLayoutBtn();
        syncRemoteTabChrome();
        switchTab('remote');
        if (GuidePanel.isVisible()) {
            GuidePanel.refresh().catch(() => {});
        }
        TvClock.init();
        initHeaderCollapse();

        PlayerChrome.bindControls();
        PlayerChrome.bindSettings();
        HiddenChannelsSettings.bind();
        VisitedChannelsSettings.bind();
        UserDataSettings.bind();
        BrowseView.bind();
        ListSort.bind();
        ListSort.syncSortControls();
        bindBackButton();
        bindTabBarPopups();

        PlayerChrome.syncSettingsFromState();

        window.addEventListener('tv:state_changed', (e) => PlayerChrome.onPlayerStateChanged(e));

        await restoreLastChannelMeta();
        PlayerChrome.updateNowPlayingHeader();

        await MultiView.hydrateMosaicFromSaved();

        // Mosaic stubs already painted in MultiView.init; streams attach on user play.
        const countriesPromise = BrowseView.refreshCountries().catch(() => {});

        bindRemoteExternalPopoutBtn();
        RemoteExternalPopout.syncBtn();

        window.addEventListener('remote:external_popout_changed', () => {
            activateTabPanels(appState.activeTab);
            syncRemoteTabChrome();
            RemoteExternalPopout.syncBtn();
            RemoteModule.syncSplitChromeButtons?.();
        });

        window.addEventListener('remote:layout_changed', () => {
            activateTabPanels(appState.activeTab);
            syncRemoteTabChrome();
            RemoteModule.syncSplitChromeButtons?.();
            if (isSplit()) ensureBrowserCatalogVisible();
        });

        await reveal();

        if (hasSession) {
            const modalDone = ResumeSessionModal.maybeShow();
            await revealAppBehind();
            await modalDone;
        }

        RemoteModule.restoreOpenIfNeeded();

        await playSharedDeepLink();

        await countriesPromise;
        warmGuideIndex().catch(() => {});
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
