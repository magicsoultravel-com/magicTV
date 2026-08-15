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
import { BrowseView } from './browse/browseView.js';
import { Appearance } from './ui/appearance.js';
import { PlayerChrome } from './ui/playerChrome.js';

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
    activeTab: 'browse',
    countryFilter: '',
    browseQuery: '',
    favFilter: '',
    recentsFilter: '',
    favoritesList: [],
    recentsList: [],
    lastKey: null,
    lastName: '',
    lastCountry: '',
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
    const label = el('refresh-age');
    if (!label) return;
    const ts = appState.lastRefreshedByView[currentRefreshKey()] || 0;
    label.textContent = formatRelativeTime(ts);
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
    try { TvPlayer.mountVideo(el('tv-playback-surface')); } catch { /* ignore */ }
    TvPlayer.playChannel(channel).catch((e) => {
        const blocked = e?.name === 'NotAllowedError'
            || String(e?.message || '').toLowerCase().includes('not allowed');
        if (!blocked) showAppToast('Stream unavailable');
        if (!TvPlayer.playing) TileFrames.setPlaybackBusy(false);
    });
}

function loadLocalState() {
    const meta = SettingsStore.loadLastChannelMeta();
    appState.lastKey = meta.lastKey;
    appState.lastName = meta.lastName;
    appState.lastCountry = meta.lastCountry;
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
        back.addEventListener('click', () => BrowseView.showCountriesView());
    }
}

function bindTabs() {
    els('.tv-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === 'refresh') {
                handleManualRefresh();
                return;
            }
            if (tabName === 'back-to-countries') {
                BrowseView.showCountriesView();
            } else {
                switchTab(tabName);
            }
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
            Appearance.updateStorageStats();
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

function switchTab(tabName) {
    els('.tv-panel').forEach(panel => panel.classList.remove('is-active'));
    const panel = el(tabName + '-panel');
    if (panel) panel.classList.add('is-active');
    els('.tv-tab').forEach(tab => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
    });

    const backBtn = el('back-btn');
    if (backBtn) {
        if (appState.browseCountry !== null && tabName === 'browse') {
            backBtn.classList.remove('is-hidden');
            backBtn.classList.add('is-active', 'is-pink-active');
            els('.tv-tab[data-tab="browse"]').forEach(tab => tab.classList.remove('is-active', 'is-pink-active'));
        } else {
            backBtn.classList.add('is-hidden');
            backBtn.classList.remove('is-active', 'is-pink-active');
        }
    }

    appState.activeTab = tabName;
    TileFrames.syncLiveRefresh(currentRefreshKey());
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
        Appearance.updateStorageStats();
    }
    updateRefreshAge();
}

async function init() {
    ChannelGrid.init({
        appState,
        getRefreshKey: currentRefreshKey,
        onPlay: startPlayback
    });
    BrowseView.init({
        appState,
        stampRefreshView,
        updateRefreshAge,
        currentFilter
    });
    PlayerChrome.init({ appState });

    TvPlayer.init();
    TvPip.init();
    TvPlayer.mountVideo(el('tv-playback-surface'));
    TileFrames.warmup();

    loadLocalState();
    PlayerChrome.updateNowPlayingHeader();

    bindTabs();
    PlayerChrome.bindControls();
    PlayerChrome.bindSettings();
    BrowseView.bind();
    bindBackButton();

    PlayerChrome.syncSettingsFromState();

    window.addEventListener('tv:state_changed', (e) => PlayerChrome.onPlayerStateChanged(e));

    await BrowseView.refreshCountries();
    updateRefreshAge();
    const refreshAgeTimer = setInterval(updateRefreshAge, 60 * 1000);
    if (refreshAgeTimer?.unref) refreshAgeTimer.unref();

    await restoreLastChannelMeta();

    if (!TvPlayer.channel && !appState.lastKey) {
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
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}
