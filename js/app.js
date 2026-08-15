/** magicTV - Neon-styled TV streaming browser */
import { TvPlayer } from './tvPlayer.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, debounce, formatRelativeTime } from './tvUtils.js';
import { showAppToast } from './ui/toast.js';
import { CARD_ICONS } from './ui/icons.js';
import { TvPip } from './tvPip.js';
import { FrameCache } from './storage/frameCache.js';

const STATE_KEY = 'matrix_tv_state';
const PAGE_SIZE = 60;

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
    lastRefreshedByView: Object.create(null),
    // While true, skip priming tiles from FrameCache so a manual ↻ can
    // force fresh live-stream grabs instead of painting stale thumbs.
    refreshFramesPending: false,
    // After ↻ on a channel folder, keep forcing live frame grabs for that
    // view as lazy pages appear. Cleared when leaving the folder.
    // Keys match currentRefreshKey() for browse:<iso> | favorites | recents.
    folderFrameRefreshKey: null
};

function el(id) { return document.getElementById(id); }
function els(query) { return Array.from(document.querySelectorAll(query)); }

// ===== BOOT =====
const DEFAULT_FIRST_CHANNEL_URL = 'https://channels.trace.plus/Traceprod/CARIBBEAN_hd/index.m3u8';
const DEFAULT_FIRST_CHANNEL_NAME = 'CARIBBEAN';

async function init() {
    // Let TvPlayer create & wire its own <video> (listeners, recents, buffer).
    TvPlayer.init();
    TvPip.init();
    TvPlayer.mountVideo(el('tv-playback-surface'));

    // Sync now-playing header from saved localStorage (fast, before async fetch).
    loadLocalState();
    updateNowPlayingHeader();

    bindTabs();
    bindPlayerControls();
    bindSettings();
    bindBrowse();
    bindBackButton();

    syncSettingsFromState();

    window.addEventListener('tv:state_changed', onPlayerStateChanged);

    await refreshCountries();
    updateRefreshAge();
    // unref() lets the timer keep the label fresh in the browser without
    // holding the process open in Node (boot-smoke runs real init()).
    const refreshAgeTimer = setInterval(updateRefreshAge, 60 * 1000);
    if (refreshAgeTimer?.unref) refreshAgeTimer.unref();

    // Full metadata restore + auto-resume.
    await restoreLastChannelMeta();
    
    // Auto-play CARIBBEAN for first-time visitors (no saved state).
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

function loadLocalState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        if (raw.lastChannelKey) {
            appState.lastKey = raw.lastChannelKey;
            appState.lastName = raw.lastChannelName || 'Last channel';
            appState.lastCountry = '';
        }
    } catch { /* ignore */ }
}

function bindBackButton() {
    const back = el('back-btn');
    if (back) {
        back.addEventListener('click', showCountriesView);
    }
}

function showCountriesView() {
    appState.browseCountry = null;
    clearFolderFrameRefresh();
    appState.countryFilter = currentFilter();
    const countries = el('countries-container');
    const channels = el('channels-container');
    const backBtn = el('back-btn');
    if (countries) countries.classList.remove('is-hidden');
    if (channels) channels.classList.add('is-hidden');
    if (backBtn) {
        backBtn.classList.add('is-hidden');
        backBtn.classList.remove('is-active', 'is-pink-active');
    }
    // Ensure browse tab is active when in countries view
    els('.tv-tab[data-tab="browse"]').forEach(tab => tab.classList.add('is-active'));
    renderCountries();
    updateRefreshAge();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

export { TvPlayer, TvProviderRegistry };

// ===== TABS =====
function bindTabs() {
    els('.tv-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            // The refresh arrow isn't a panel — pull fresh data for the
            // currently active tab instead of switching views.
            if (tabName === 'refresh') {
                handleManualRefresh();
                return;
            }
            if (tabName === 'back-to-countries') {
                showCountriesView();
            } else {
                switchTab(tabName);
            }
        });
    });
}

// Manual cache refresh: bust the IndexedDB catalog (and channel metadata
// for the favorites/recents tabs), reload from the network, and re-capture
// live preview frames for the open channel folder. The channel *list* stays
// lazy-paginated; folder frame refresh sticks so pages that load later still
// get fresh live grabs instead of stale cache/logo thumbs.
async function handleManualRefresh() {
    const btn = el('refresh-btn');
    const spin = () => btn && btn.classList.add('is-loading');
    const unspin = () => btn && btn.classList.remove('is-loading');
    spin();
    showAppToast('Refreshing…');
    appState.refreshFramesPending = true;
    try {
        const tab = appState.activeTab;
        const viewKey = currentRefreshKey();
        if (tab === 'browse') {
            if (appState.browseCountry === null) {
                clearFolderFrameRefresh();
                appState.countries = await TvProviderRegistry.refreshCatalog();
                renderCountries();
                stampRefreshView('browseCountries', TvProviderRegistry.getLastRefreshed());
            } else {
                await refreshBrowseCountry();
                stampRefreshView(viewKey);
                beginFolderFrameRefresh(viewKey);
            }
        } else if (tab === 'favorites') {
            await refreshFavoritesTab(true);
            stampRefreshView('favorites');
            beginFolderFrameRefresh('favorites');
        } else if (tab === 'recents') {
            await refreshRecentsTab(true);
            stampRefreshView('recents');
            beginFolderFrameRefresh('recents');
        } else {
            clearFolderFrameRefresh();
            updateStorageStats();
            stampRefreshView('settings');
        }
        const grid = activeChannelGrid();
        if (grid) {
            // Wait a frame so layout/tile metrics are ready for hot-budget sizing.
            await new Promise((resolve) => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                } else {
                    setTimeout(resolve, 0);
                }
            });
            refreshTileFrames(grid);
        }
        showAppToast('✅ Refreshed');
    } catch {
        showAppToast('Refresh failed — try again');
    } finally {
        appState.refreshFramesPending = false;
        const grid = activeChannelGrid();
        // Tiles skipped by content-visibility / fill-check may have missed the
        // first queue pass — re-arm observer and promote anything still on-screen.
        reobserveUncapturedFrames(grid);
        promoteUncapturedFolderFrames(grid);
        unspin();
        updateRefreshAge();
    }
}

// Channel grid for the current navigation (null on countries list / settings).
function activeChannelGrid() {
    const tab = appState.activeTab;
    if (tab === 'browse' && appState.browseCountry != null) return el('channels-container');
    if (tab === 'favorites') return el('favorites-grid');
    if (tab === 'recents') return el('recents-grid');
    return null;
}

function beginFolderFrameRefresh(key) {
    if (!key || key === 'browseCountries' || key === 'settings') {
        appState.folderFrameRefreshKey = null;
        return;
    }
    appState.folderFrameRefreshKey = key;
}

function clearFolderFrameRefresh() {
    appState.folderFrameRefreshKey = null;
}

// True while this view is still under a post-↻ "refresh the whole folder"
// pass — list pagination stays lazy, but new tiles skip cache/logo and grab live.
function isFolderFrameRefreshActive() {
    return !!appState.folderFrameRefreshKey
        && appState.folderFrameRefreshKey === currentRefreshKey();
}

function syncFolderFrameRefreshToView() {
    if (!isFolderFrameRefreshActive()) clearFolderFrameRefresh();
}

// Navigation key for the bottom-right refresh age (countries vs a country
// channel list vs favorites / recents / settings).
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

// Age beside ↻ is per active view (e.g. "3h ago"); empty until that view
// has been loaded/refreshed at least once.
function updateRefreshAge() {
    const label = el('refresh-age');
    if (!label) return;
    const ts = appState.lastRefreshedByView[currentRefreshKey()] || 0;
    label.textContent = formatRelativeTime(ts);
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
    syncFolderFrameRefreshToView();
    if (tabName === 'favorites') {
        appState.favFilter = currentFilter();
        refreshFavoritesTab();
    } else if (tabName === 'recents') {
        appState.recentsFilter = currentFilter();
        refreshRecentsTab();
    } else if (tabName === 'browse' && appState.browseCountry !== null) {
        // Keep the *filtered* channel view in sync when returning to it.
        const q = currentFilter();
        if (q !== appState.browseQuery) startChannelSearch(q);
    } else if (tabName === 'settings') {
        updateStorageStats();
    }
    updateRefreshAge();
}

// ===== BROWSE / FILTER =====
function bindBrowse() {
    const search = el('search-countries');
    if (search) {
        // The shared Filter input applies to whatever list is active.
        search.setAttribute('placeholder', 'Filter');
        search.addEventListener('input', debounce((e) => {
            applyFilter(e.target.value.toLowerCase());
        }, 200));
    }
}

function currentFilter() {
    const search = el('search-countries');
    return search ? (search.value || '').toLowerCase() : '';
}

// Route the shared filter to the active list. Channels in a country are
// filtered over the FULL catalog (see provider `query`), so long lists that
// aren't fully scrolled-yet still match correctly.
function applyFilter(q) {
    if (appState.activeTab === 'browse') {
        if (appState.browseCountry === null) {
            appState.countryFilter = q;
            renderCountries();
        } else {
            startChannelSearch(q);
        }
    } else if (appState.activeTab === 'favorites') {
        appState.favFilter = q;
        renderFavoritesGrid();
    } else if (appState.activeTab === 'recents') {
        appState.recentsFilter = q;
        renderRecentsGrid();
    }
}

async function refreshCountries() {
    try {
        appState.countries = await TvProviderRegistry.getCountries();
        stampRefreshView('browseCountries', TvProviderRegistry.getLastRefreshed());
    } catch (err) {
        console.error('Failed to load countries:', err);
        showAppToast('Countries unavailable — check your connection');
    }
    updateRefreshAge();
    renderCountries();
}

function renderCountries() {
    const container = el('countries-container');
    if (!container) return;
    const list = (appState.countries || []).filter(c =>
        c && c.name && c.name.toLowerCase().includes(appState.countryFilter)
    );
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
        const open = () => browseCountry(tile.dataset.country);
        tile.addEventListener('click', open);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    });
    // Apply appearance settings (text size, tile width, narrow clipping) to new tiles
    applyAppearanceToTiles(container);
}

async function browseCountry(countryCode) {
    appState.browseGeneration += 1;
    appState.browseLoading = false;
    appState.browseCountry = countryCode;
    // Entering a country is a new folder — don't inherit another view's ↻.
    clearFolderFrameRefresh();
    appState.browseChannels = [];
    appState.browseOffset = 0;
    appState.browseHasMore = true;
    appState.browseQuery = currentFilter();

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
    updateRefreshAge();

    await loadMoreChannels();
    setupScrollLoading();
}

async function loadMoreChannels(forceRefresh = false) {
    if (appState.browseLoading || !appState.browseHasMore) return;
    const generation = appState.browseGeneration;
    appState.browseLoading = true;
    try {
        const results = await TvProviderRegistry.searchChannels({
            countrycode: appState.browseCountry,
            query: appState.browseQuery,
            offset: appState.browseOffset,
            limit: PAGE_SIZE,
            order: 'name',
            refresh: forceRefresh
        });
        // A newer search/refresh superseded this request — drop stale results.
        if (generation !== appState.browseGeneration) return;
        if (results.length < PAGE_SIZE) {
            appState.browseHasMore = false;
        }
        appState.browseChannels = appState.browseChannels.concat(results);
        appState.browseOffset += PAGE_SIZE;
        // Append-only: the new chunk is painted without tearing down the
        // already-captured tiles (keeps DOM stable + preserves scroll perf).
        renderChannelGrid(el('channels-container'), results, { append: true });
    } catch (err) {
        if (generation !== appState.browseGeneration) return;
        console.error('Failed to load channels:', err);
        showAppToast('Failed to load channels');
    } finally {
        if (generation === appState.browseGeneration) {
            appState.browseLoading = false;
            // Dense tile grids can fit a full page in the panel with no overflow.
            // Scroll never fires then, so keep loading until the panel can scroll
            // or the catalog is exhausted.
            scheduleBrowseFillCheck();
        }
    }
}

function browsePanelNeedsMore() {
    const panel = el('browse-panel');
    if (!panel || !appState.browseHasMore || appState.browseLoading) return false;
    // Near bottom (or not yet scrollable): same threshold as the scroll handler.
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 20;
}

function scheduleBrowseFillCheck() {
    if (typeof requestAnimationFrame !== 'function') {
        if (browsePanelNeedsMore()) loadMoreChannels();
        return;
    }
    requestAnimationFrame(() => {
        if (browsePanelNeedsMore()) loadMoreChannels();
    });
}

// Restart the whole channel search for a country (e.g. when the filter text
// changes): pagination then scrolls through the *filtered* result set.
function startChannelSearch(query) {
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
    loadMoreChannels(false);
}

// Manual refresh for the open-country view: drop what's on screen, bust the
// cached catalog and reload the first page from the network.
async function refreshBrowseCountry() {
    appState.browseGeneration += 1;
    appState.browseLoading = false;
    appState.browseChannels = [];
    appState.browseOffset = 0;
    appState.browseHasMore = true;
    const container = el('channels-container');
    if (container) {
        container.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading channels…</p></div>';
    }
    await loadMoreChannels(true);
}

// ===== SCROLL LOADING =====
let scrollLoadingBound = false;

function setupScrollLoading() {
    // The channel grid lives inside a .tv-panel, and that panel is the element
    // that actually scrolls (channels-container itself never scrolls). Attach
    // the infinite-scroll listener there instead.
    if (scrollLoadingBound) return;
    const panel = el('browse-panel');
    if (!panel) return;
    scrollLoadingBound = true;

    let ticking = false;
    function handleScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            if (browsePanelNeedsMore()) loadMoreChannels();
            // Small-tile layouts keep many rows "lazy" via content-visibility;
            // keep folder ↻ moving as the user scrolls.
            if (isFolderFrameRefreshActive()) promoteUncapturedFolderFrames(el('channels-container'));
            ticking = false;
        });
    }

    panel.addEventListener('scroll', handleScroll, { passive: true });
}


// ===== CHANNEL GRID =====
function tileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const isFav = TvPlayer.isFavorite(ch);
    const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
    return `
        <div class="channel-tile" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}" data-logo="${escapeHtml(ch.logo || '')}">
            <button type="button" class="channel-tile__fav-btn${isFav ? ' is-active' : ''}" title="${favLabel}" aria-label="${favLabel}" aria-pressed="${isFav}">${isFav ? '★' : '☆'}</button>
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame="${escapeHtml(channelKey(ch))}">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img is-hidden" alt="" loading="lazy" decoding="async">
                    <span class="channel-tile__frame-loader">⏳</span>
                    <span class="channel-tile__offline-badge is-hidden" aria-hidden="true">${CARD_ICONS.prohibited}</span>
                </div>
            </div>
            <div class="channel-tile__body">
                <h3 class="channel-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(ch.name || 'Unknown')}</span></span></h3>
                <span class="channel-tile__flag">${countryFlagEmoji(ch.countrycode)}</span>
            </div>
        </div>
    `;
}

const wiredTiles = new WeakSet();

function renderChannelGrid(container, channels, { append = false } = {}) {
    if (!container) return;
    const html = channels.map(ch => tileHtml(ch)).join('');
    if (append && container.querySelector('.channel-tile')) {
        // Incremental: keep already-captured tiles in the DOM (stable scroll,
        // no teardown of images that are already visible).
        container.insertAdjacentHTML('beforeend', html);
    } else {
        container.innerHTML = html;
    }
    wireTiles(container, channels);
    observeFrames(container);
    // Folder ↻ keeps the channel list paginated. Skip cached thumbs so pages
    // that appear later still get live grabs — but paint logos immediately so
    // the top of the list isn't empty while streams spin up.
    if (appState.refreshFramesPending) {
        queueMicrotask(() => enqueueFolderFramesForRefresh(container));
    } else if (isFolderFrameRefreshActive()) {
        paintProvisionalLogos(container);
        scheduleFolderFramePump();
    } else {
        primeFramesFromCache(container);
    }
    // Apply appearance settings (text size, tile width, narrow clipping) to new tiles
    applyAppearanceToTiles(container);
}

function syncTileFavBtn(btn, isFav) {
    if (!btn) return;
    btn.classList.toggle('is-active', isFav);
    btn.textContent = isFav ? '★' : '☆';
    const label = isFav ? 'Remove from favorites' : 'Add to favorites';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(isFav));
}

function syncChannelTileFavButtons() {
    document.querySelectorAll('.channel-tile__fav-btn').forEach((btn) => {
        const key = btn.closest('.channel-tile')?.dataset.channel;
        if (!key) return;
        syncTileFavBtn(btn, TvPlayer.isFavorite(key));
    });
}

function wireTiles(container, channels) {
    if (!container) return;
    container.querySelectorAll('.channel-tile').forEach(tile => {
        if (wiredTiles.has(tile)) return; // already wired by a previous append pass
        wiredTiles.add(tile);
        const key = tile.dataset.channel;
        const ch = channels.find(c => channelKey(c) === key);
        const play = (e) => {
            if (ch) startPlayback(ch);
        };
        tile.addEventListener('click', play);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(e); }
        });
        const favBtn = tile.querySelector('.channel-tile__fav-btn');
        if (favBtn && ch) {
            favBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isFav = TvPlayer.toggleFavorite(ch);
                syncTileFavBtn(favBtn, isFav);
                updateFavBtn();
                showAppToast(isFav ? '❤️ Added to favorites' : '💔 Removed from favorites');
                if (appState.activeTab === 'favorites') refreshFavoritesTab();
            });
            favBtn.addEventListener('keydown', (e) => e.stopPropagation());
        }
    });
}
// ===== LAZY FRAME / LOGO CAPTURE =====
// Two-tier scheduler:
//  - cheap tier = cached thumbnail + natively-displayed channel logo (several at once)
//  - heavy tier = live-stream frame grab via a hidden <video> (max 4; never under cheap budget)
// Tiles inside the viewport ("hot") are drained before tiles in the 200px
// prefetch margin ("warm"), so what the user is looking at paints first.
// Heavy work pauses while a channel is playing so click-to-play keeps bandwidth.
const frameCapture = {
    observer: null,
    hot: [],
    warm: [],
    pending: new Set(),
    forceHeavy: new WeakSet(),
    running: 0,
    heavyRunning: 0,
    paused: false,
    // Bumped by refreshTileFrames so in-flight captures can't paint stale thumbs.
    refreshEpoch: 0,
    MAX_TOTAL: 8,
    MAX_CHEAP: 6,
    MAX_HEAVY: 4,
    LOGO_TIMEOUT: 3500,
    VIDEO_TIMEOUT: 5500
};

function observeFrames(container) {
    if (!container || typeof IntersectionObserver === 'undefined') return;
    if (!frameCapture.observer) {
        frameCapture.observer = new IntersectionObserver((entries) => {
            // While the ↻ button pass owns queuing, don't start cache/logo
            // captures that would race the forced live grab.
            if (appState.refreshFramesPending) return;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const f = entry.target;
                if (f.dataset.captured || frameCapture.pending.has(f)) continue;
                // Post-↻ folder pass: live grab even for lazily loaded pages.
                if (isFolderFrameRefreshActive()) {
                    const logo = (f.closest('.channel-tile')?.dataset?.logo || '').trim();
                    if (logo) applyFrameProvisional(f, logo);
                    frameCapture.forceHeavy.add(f);
                }
                (isInViewport(f) ? frameCapture.hot : frameCapture.warm).push(f);
                frameCapture.pending.add(f);
            }
            drainFrameCapture();
        }, { rootMargin: '200px 0px 200px 0px' });
    }
    container.querySelectorAll('.channel-tile__capture-frame').forEach(frame => {
        if (frame.dataset.captured) return;
        frameCapture.observer.observe(frame);
    });
}

function isInViewport(frame) {
    return isNearViewport(frame, 0);
}

function isNearViewport(frame, margin = 200) {
    const r = frame.getBoundingClientRect();
    if (!r) return false;
    // Tiles scroll inside .tv-panel, not the window — use the panel's
    // visible box so "hot" matches what the user actually sees.
    const panel = frame.closest?.('.tv-panel');
    if (panel) {
        const pr = panel.getBoundingClientRect();
        return r.bottom > pr.top - margin
            && r.top < pr.bottom + margin
            && r.right > pr.left
            && r.left < pr.right;
    }
    const h = globalThis.innerHeight || 0;
    return r.bottom > -margin && r.top < h + margin;
}

function applyFrameSuccess(frame, src) {
    const img = frame.querySelector('.channel-tile__logo-img');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const loader = frame.querySelector('.channel-tile__frame-loader');
    const badge = frame.querySelector('.channel-tile__offline-badge');
    if (img) { img.src = src; img.classList.remove('is-hidden'); }
    if (letter) letter.classList.add('is-hidden');
    if (loader) loader.classList.add('is-hidden');
    if (badge) badge.classList.add('is-hidden');
    frame.dataset.captured = '1';
    delete frame.dataset.provisional;
}

// Fast placeholder (usually the channel logo) while a live grab is still running.
// Does NOT set captured — the heavy pass can still replace it.
function applyFrameProvisional(frame, src) {
    if (!frame || !src || frame.dataset.captured) return;
    const img = frame.querySelector('.channel-tile__logo-img');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const loader = frame.querySelector('.channel-tile__frame-loader');
    const badge = frame.querySelector('.channel-tile__offline-badge');
    if (img) { img.src = src; img.classList.remove('is-hidden'); }
    if (letter) letter.classList.add('is-hidden');
    if (loader) loader.classList.add('is-hidden');
    if (badge) badge.classList.add('is-hidden');
    frame.dataset.provisional = '1';
}

function applyFrameFailure(frame) {
    // Keep a provisional logo rather than flashing the prohibition badge —
    // dead streams fail fast, which made the top of the list look "broken"
    // long before live frames arrived.
    if (frame.dataset.provisional && frame.querySelector('.channel-tile__logo-img')?.src) {
        frame.dataset.captured = '1';
        delete frame.dataset.provisional;
        const loader = frame.querySelector('.channel-tile__frame-loader');
        const badge = frame.querySelector('.channel-tile__offline-badge');
        if (loader) loader.classList.add('is-hidden');
        if (badge) badge.classList.add('is-hidden');
        return;
    }
    const img = frame.querySelector('.channel-tile__logo-img');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const loader = frame.querySelector('.channel-tile__frame-loader');
    const badge = frame.querySelector('.channel-tile__offline-badge');
    if (img) img.classList.add('is-hidden');
    if (letter) letter.classList.add('is-hidden');
    if (loader) loader.classList.add('is-hidden');
    if (badge) badge.classList.remove('is-hidden');
    frame.dataset.captured = '1';
    delete frame.dataset.provisional;
}

function resetFrameUi(frame) {
    const img = frame.querySelector('.channel-tile__logo-img');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const loader = frame.querySelector('.channel-tile__frame-loader');
    const badge = frame.querySelector('.channel-tile__offline-badge');
    if (img) {
        img.removeAttribute('src');
        img.classList.add('is-hidden');
    }
    if (letter) letter.classList.remove('is-hidden');
    if (loader) loader.classList.remove('is-hidden');
    if (badge) badge.classList.add('is-hidden');
    delete frame.dataset.captured;
    delete frame.dataset.provisional;
}

function paintProvisionalLogos(container) {
    if (!container) return;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || frame.dataset.provisional) return;
        const logo = (frame.closest('.channel-tile')?.dataset?.logo || '').trim();
        if (logo) applyFrameProvisional(frame, logo);
    });
}

// How many tiles fit on ~one screen (+1 row). Used to keep the top of a dense
// small-tile grid on the hot queue without relying on getBoundingClientRect
// (unreliable with content-visibility: auto on skipped rows).
function hotFrameBudget(container) {
    const panel = container?.closest?.('.tv-panel') || container;
    const panelH = panel?.clientHeight || 700;
    const panelW = panel?.clientWidth || 900;
    const tileW = Number(TvProviderRegistry.getTileWidth?.()) || 180;
    const tileH = 72;
    const cols = Math.max(1, Math.floor(panelW / Math.max(60, tileW)));
    const rows = Math.max(3, Math.ceil(panelH / tileH) + 1);
    return cols * rows;
}

function queueFrameForFolderRefresh(frame, { hot, warm, hotBudget, keys }) {
    const tile = frame.closest('.channel-tile');
    const url = (tile?.dataset?.url || '').trim();
    const logo = (tile?.dataset?.logo || '').trim();
    if (url) keys.push(url);
    if (logo) keys.push(logo);
    if (logo && !frame.dataset.provisional && !frame.dataset.captured) {
        applyFrameProvisional(frame, logo);
    }
    if (!url) return false;
    if (frame.dataset.captured || frameCapture.pending.has(frame)) return false;
    frameCapture.forceHeavy.add(frame);
    frameCapture.pending.add(frame);
    if (hot.length < hotBudget) hot.push(frame);
    else warm.push(frame);
    return true;
}

// Refresh frames for the open folder:
//  1) logos immediately on every loaded tile
//  2) live-grab the whole loaded page in DOM order (top first = hot)
//  3) not-yet-paginated channels join later via sticky folder refresh
function refreshTileFrames(container) {
    if (!container) return;
    const frames = Array.from(container.querySelectorAll('.channel-tile__capture-frame'));
    if (!frames.length) return;

    frameCapture.refreshEpoch++;

    const frameSet = new Set(frames);
    for (const queue of [frameCapture.hot, frameCapture.warm]) {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (frameSet.has(queue[i])) queue.splice(i, 1);
        }
    }

    const keys = [];
    const hot = [];
    const warm = [];
    const hotBudget = hotFrameBudget(container);

    for (const frame of frames) {
        const tile = frame.closest('.channel-tile');
        const url = (tile?.dataset?.url || '').trim();
        const logo = (tile?.dataset?.logo || '').trim();

        frameCapture.pending.delete(frame);
        resetFrameUi(frame);
        if (logo) applyFrameProvisional(frame, logo);

        if (!url) {
            if (!logo) applyFrameFailure(frame);
            else {
                frame.dataset.captured = '1';
                delete frame.dataset.provisional;
            }
            continue;
        }

        // Queue every loaded tile. Dense/small-tile grids fit many rows in the
        // first page; a getBoundingClientRect "near viewport" cut-off often only
        // caught the first row once content-visibility skipped the rest.
        if (url) keys.push(url);
        if (logo) keys.push(logo);
        frameCapture.forceHeavy.add(frame);
        frameCapture.pending.add(frame);
        if (hot.length < hotBudget) hot.push(frame);
        else warm.push(frame);
    }

    frameCapture.hot.push(...hot);
    frameCapture.warm.push(...warm);

    FrameCache.removeFrames(keys).catch(() => {});
    drainFrameCapture();
}

// During the ↻ button pass, fold newly filled pages into the queue (top of
// the new chunk stays hot while budget remains).
function enqueueFolderFramesForRefresh(container) {
    if (!container || !appState.refreshFramesPending) return;
    paintProvisionalLogos(container);
    const keys = [];
    const hot = [];
    const warm = [];
    const hotBudget = Math.max(0, hotFrameBudget(container) - frameCapture.hot.length);
    let added = false;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (queueFrameForFolderRefresh(frame, { hot, warm, hotBudget, keys })) added = true;
    });
    frameCapture.hot.push(...hot);
    frameCapture.warm.push(...warm);
    if (keys.length) FrameCache.removeFrames(keys).catch(() => {});
    if (added) drainFrameCapture();
}

// Pick up on-screen tiles that never entered the queue (content-visibility /
// observer gaps) while a folder ↻ is active.
function promoteUncapturedFolderFrames(container) {
    if (!container) return;
    if (!appState.refreshFramesPending && !isFolderFrameRefreshActive()) return;
    paintProvisionalLogos(container);
    const keys = [];
    const hot = [];
    const warm = [];
    const hotBudget = hotFrameBudget(container);
    let added = false;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || frameCapture.pending.has(frame)) return;
        const url = (frame.closest('.channel-tile')?.dataset?.url || '').trim();
        if (!url) return;
        // Prefer tiles that are actually on-screen; DOM-order backlog is already
        // on warm from refreshTileFrames.
        if (!isNearViewport(frame)) return;
        const logo = (frame.closest('.channel-tile')?.dataset?.logo || '').trim();
        if (logo) applyFrameProvisional(frame, logo);
        if (url) keys.push(url);
        if (logo) keys.push(logo);
        frameCapture.forceHeavy.add(frame);
        frameCapture.pending.add(frame);
        if (hot.length < hotBudget) hot.push(frame);
        else warm.push(frame);
        added = true;
    });
    if (!added) return;
    frameCapture.hot.unshift(...hot);
    frameCapture.warm.push(...warm);
    FrameCache.removeFrames(keys).catch(() => {});
    drainFrameCapture();
}

let folderFramePumpQueued = false;
function scheduleFolderFramePump() {
    if (folderFramePumpQueued) return;
    folderFramePumpQueued = true;
    const run = () => {
        folderFramePumpQueued = false;
        if (frameCapture.running > 0) return;
        promoteUncapturedFolderFrames(activeChannelGrid());
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

function reobserveUncapturedFrames(container) {
    if (!container || !frameCapture.observer) return;
    container.querySelectorAll('.channel-tile__capture-frame').forEach((frame) => {
        if (frame.dataset.captured || frameCapture.pending.has(frame)) return;
        frameCapture.observer.unobserve(frame);
        frameCapture.observer.observe(frame);
    });
}

// Sync-apply already-cached thumbnails as soon as a grid is (re)rendered —
// favorites/recents tabs switch far faster than an IntersectionObserver
// round-trip. Un-cached tiles are left to the normal lazy pipeline.
function primeFramesFromCache(container) {
    if (!container) return;
    const frames = [];
    const allKeys = [];
    container.querySelectorAll('.channel-tile__capture-frame').forEach(frame => {
        if (frame.dataset.captured) return;
        const tile = frame.closest('.channel-tile');
        const keys = [(tile?.dataset?.url || '').trim(), (tile?.dataset?.logo || '').trim()].filter(Boolean);
        frames.push({ frame, keys });
        allKeys.push(...keys);
    });
    if (!frames.length) return;

    (async () => {
        const cached = await FrameCache.getFrames([...new Set(allKeys)]).catch(() => new Map());
        for (const { frame, keys } of frames) {
            if (frame.dataset.captured || !frame.isConnected) continue;
            for (const key of keys) {
                const dataUrl = cached.get(key);
                if (!dataUrl) continue;
                applyFrameSuccess(frame, dataUrl);
                break;
            }
        }
    })();
}

// Drop frames whose tiles were torn down (e.g. country switch) so stale
// references never consume capture slots.
function pruneUnconnectedFrames() {
    for (const queue of [frameCapture.hot, frameCapture.warm]) {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (!queue[i].isConnected) {
                frameCapture.pending.delete(queue[i]);
                queue.splice(i, 1);
            }
        }
    }
}

function captureTier(frame) {
    if (frameCapture.forceHeavy.has(frame)) return 'heavy';
    const tile = frame.closest('.channel-tile');
    const logo = (tile?.dataset?.logo || '').trim();
    return logo ? 'cheap' : 'heavy';
}

function canStartTier(tier) {
    if (frameCapture.running >= frameCapture.MAX_TOTAL) return false;
    if (tier === 'heavy') {
        if (frameCapture.paused) return false;
        return frameCapture.heavyRunning < frameCapture.MAX_HEAVY;
    }
    return (frameCapture.running - frameCapture.heavyRunning) < frameCapture.MAX_CHEAP;
}

function pickNextCapture() {
    for (const queue of [frameCapture.hot, frameCapture.warm]) {
        for (let i = 0; i < queue.length; i++) {
            const frame = queue[i];
            if (!frame.isConnected) {
                frameCapture.pending.delete(frame);
                queue.splice(i, 1);
                i--;
                continue;
            }
            const tier = captureTier(frame);
            if (canStartTier(tier)) {
                queue.splice(i, 1);
                return { frame, tier };
            }
        }
    }
    return null;
}

function setFrameCapturePaused(paused) {
    const next = !!paused;
    if (frameCapture.paused === next) return;
    frameCapture.paused = next;
    if (!next) drainFrameCapture();
}

function drainFrameCapture() {
    pruneUnconnectedFrames();
    let next;
    while ((next = pickNextCapture())) {
        const { frame, tier } = next;
        const epoch = frameCapture.refreshEpoch;
        frameCapture.running++;
        if (tier === 'heavy') frameCapture.heavyRunning++;
        let requeued = false;
        captureFrame(frame, tier, epoch)
            .then((result) => {
                if (result !== 'requeue-heavy') return;
                requeued = true;
                frameCapture.forceHeavy.add(frame);
                frameCapture.pending.add(frame);
                (isInViewport(frame) ? frameCapture.hot : frameCapture.warm).unshift(frame);
            })
            .finally(() => {
                frameCapture.running--;
                if (tier === 'heavy') frameCapture.heavyRunning--;
                // A newer ↻ may have re-queued this frame — don't clear its slots.
                if (!requeued && epoch === frameCapture.refreshEpoch) {
                    frameCapture.pending.delete(frame);
                    frameCapture.forceHeavy.delete(frame);
                }
                drainFrameCapture();
                if (frameCapture.running === 0
                    && frameCapture.hot.length === 0
                    && frameCapture.warm.length === 0) {
                    scheduleFolderFramePump();
                }
            });
    }
}

async function captureFrame(frame, tier, epoch = frameCapture.refreshEpoch) {
    const stale = () => epoch !== frameCapture.refreshEpoch || !frame.isConnected;
    const tile = frame.closest('.channel-tile');
    const url = (tile?.dataset?.url || '').trim();
    const logo = (tile?.dataset?.logo || '').trim();
    const alreadyHeavy = frameCapture.forceHeavy.has(frame);

    // Tier 0 — persistent thumbnail cache (IndexedDB), keyed by stream or logo URL.
    // Skip when forcing a live re-grab (manual ↻) so we don't paint a stale thumb.
    if (!alreadyHeavy) {
        for (const key of [url, logo]) {
            if (!key) continue;
            const cached = await FrameCache.getFrame(key).catch(() => null);
            if (stale()) return;
            if (cached) { applyFrameSuccess(frame, cached); return; }
        }
    }

    // Tier 1 — channel logo (skip when re-entering as heavy after a logo miss).
    if (logo && !alreadyHeavy) {
        if (await imageLoad(logo, frameCapture.LOGO_TIMEOUT)) {
            if (stale()) return;
            applyFrameSuccess(frame, logo);
            persistFrameBestEffort(logo); // background cache write, if CORS allows
            return;
        }
        if (stale()) return;
    }

    // Tier 2 — grab a frame from the live stream via a hidden <video>.
    // Stream grabs always use the heavy budget (never under a cheap slot).
    if (!url) {
        if (!stale()) applyFrameFailure(frame);
        return;
    }
    if (tier === 'cheap') return 'requeue-heavy';

    const dataUrl = await captureStreamFrame(url);
    if (stale()) return;
    if (dataUrl) {
        applyFrameSuccess(frame, dataUrl);
        FrameCache.setFrame(url, dataUrl).catch(() => {});
        return;
    }

    // Live grab failed or was still black — keep/show the channel logo so the
    // top of the list isn't littered with prohibition badges (failures are fast;
    // real frames are slow).
    if (logo && await imageLoad(logo, frameCapture.LOGO_TIMEOUT)) {
        if (stale()) return;
        applyFrameSuccess(frame, logo);
        persistFrameBestEffort(logo);
        return;
    }
    if (!stale()) applyFrameFailure(frame);
}

function imageLoad(src, timeout) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            img.onload = img.onerror = null;
            resolve(ok);
        };
        const t = setTimeout(() => finish(false), timeout);
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = src;
    });
}

// Downscale a logo into a small JPEG thumb and cache it. Requires the origin
// to send CORS headers; otherwise it fails silently (the browser HTTP cache
// already covers repeat visits).
async function persistFrameBestEffort(url) {
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            let done = false;
            const t = setTimeout(() => {
                if (!done) { done = true; reject(new Error('timeout')); }
            }, frameCapture.LOGO_TIMEOUT);
            img.onload = () => {
                if (done) return;
                done = true;
                clearTimeout(t);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 56; canvas.height = 56;
                    canvas.getContext('2d').drawImage(img, 0, 0, 56, 56);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                } catch { reject(new Error('tainted')); }
            };
            img.onerror = () => {
                if (!done) { done = true; clearTimeout(t); reject(new Error('load')); }
            };
            img.src = url;
        });
        await FrameCache.setFrame(url, dataUrl);
    } catch { /* CORS/network — fine, display path already worked */ }
}

const CAPTURE_HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: true,
    maxBufferLength: 2,
    maxMaxBufferLength: 4,
    maxBufferSize: 2 * 1024 * 1024,
    maxBufferHole: 0.5,
    startLevel: 0,
    abrEwmaDefaultEstimate: 500000,
    manifestLoadingTimeOut: 3000,
    levelLoadingTimeOut: 3000,
    fragLoadingTimeOut: 3000
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reject blank/black snapshots (common when drawing before the first decoded frame).
function isMostlyBlackImageData(data) {
    if (!data?.length) return true;
    let dark = 0;
    let n = 0;
    // Sample every 8th pixel (RGBA stride 32).
    for (let i = 0; i < data.length; i += 32) {
        n++;
        if (data[i] < 18 && data[i + 1] < 18 && data[i + 2] < 18) dark++;
    }
    return n > 0 && dark / n >= 0.92;
}

function snapshotVideoFrame(video) {
    if (!video?.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 56;
    canvas.height = 56;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
        ctx.drawImage(video, 0, 0, 56, 56);
        const pixels = ctx.getImageData(0, 0, 56, 56).data;
        if (isMostlyBlackImageData(pixels)) return null;
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch {
        return null;
    }
}

async function waitForVideoFrame(video, budgetMs) {
    const deadline = Date.now() + Math.max(0, budgetMs);
    while (Date.now() < deadline) {
        if (video.videoWidth > 0 && video.readyState >= 2) {
            const snap = snapshotVideoFrame(video);
            if (snap) return snap;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        if (typeof video.requestVideoFrameCallback === 'function') {
            await new Promise((resolve) => {
                const id = video.requestVideoFrameCallback(() => resolve());
                setTimeout(() => {
                    try { video.cancelVideoFrameCallback?.(id); } catch { /* ignore */ }
                    resolve();
                }, Math.min(200, remaining));
            });
        } else {
            await sleep(Math.min(120, remaining));
        }
    }
    return null;
}

async function captureStreamFrame(url) {
    let video, hls;
    const started = Date.now();
    try {
        video = document.createElement('video');
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'auto';
        // Real dimensions matter — a 1×1 offscreen video often never paints
        // a decoded frame, which produced black tile thumbs after ↻.
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:90px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);

        if (url.includes('.m3u8')) {
            const { default: Hls } = await loadHlsForCapture();
            if (Hls) {
                hls = new Hls(CAPTURE_HLS_CONFIG);
                hls.attachMedia(video);
                hls.loadSource(url);
            } else {
                video.src = url;
            }
        } else {
            video.src = url;
        }

        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (err, isError) => {
                if (settled) return;
                settled = true;
                clearTimeout(t);
                if (isError) reject(err);
                else resolve();
            };
            const t = setTimeout(() => finish(new Error('timeout'), true), frameCapture.VIDEO_TIMEOUT);
            video.addEventListener('loadeddata', () => finish(null, false), { once: true });
            video.addEventListener('error', () => finish(new Error('media error'), true), { once: true });
            if (hls && window.Hls?.Events) {
                hls.on(window.Hls.Events.FRAG_BUFFERED, () => finish(null, false));
                hls.on(window.Hls.Events.ERROR, (_e, data) => {
                    if (data?.fatal) finish(new Error('hls error'), true);
                });
            }
            video.load();
        });

        try { await video.play(); } catch { /* autoplay policies — muted should allow */ }

        const remaining = frameCapture.VIDEO_TIMEOUT - (Date.now() - started) + 1500;
        return await waitForVideoFrame(video, remaining);
    } catch {
        return null;
    } finally {
        if (hls) try { hls.destroy(); } catch {}
        if (video) try { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); } catch {}
    }
}

async function loadHlsForCapture() {
    try {
        await import('./tvHls.js').then(m => m.loadHlsLibrary());
        return { default: window.Hls };
    } catch { return null; }
}

// Reveal the player immediately (before the stream loads) and start playback.
function startPlayback(channel) {
    setFrameCapturePaused(true);
    try { TvPlayer.mountVideo(el('tv-playback-surface')); } catch { /* ignore */ }
    TvPlayer.playChannel(channel).catch((e) => {
        const blocked = e?.name === 'NotAllowedError'
            || String(e?.message || '').toLowerCase().includes('not allowed');
        if (!blocked) showAppToast('Stream unavailable');
        if (!TvPlayer.playing) setFrameCapturePaused(false);
    });
}

async function refreshFavoritesTab(forceRefresh = false) {
    const grid = el('favorites-grid');
    const empty = el('favorites-empty');
    if (!grid || !empty) return;
    const favorites = TvPlayer.getFavorites();
    if (!favorites || favorites.length === 0) {
        appState.favoritesList = [];
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');

    // Instant pass — favorites metadata lives in localStorage, so real tiles
    // render immediately with zero catalog/network wait. The hydration pass
    // below upgrades them with stream URLs in the background.
    const favMeta = TvPlayer.getFavoritesMeta();
    appState.favoritesList = favMeta.length
        ? metaChannels(favMeta)
        : skeletonChannels(favorites); // pre-metadata favorites (migration)
    renderFavoritesGrid();

    try {
        const channels = await TvProviderRegistry.getChannelsByRefs(favorites, { refresh: forceRefresh });
        if (channels.length) {
            appState.favoritesList = channels;
            renderFavoritesGrid();
        }
    } catch (err) {
        console.error('Failed to hydrate favorites:', err);
    }
}

async function refreshRecentsTab(forceRefresh = false) {
    const grid = el('recents-grid');
    const empty = el('recents-empty');
    if (!grid || !empty) return;
    const recents = TvPlayer.getRecentsMeta();
    if (!recents || recents.length === 0) {
        appState.recentsList = [];
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');

    // Instant pass — recents metadata is already local, so tiles render
    // immediately and are only upgraded with live stream URLs afterwards.
    appState.recentsList = metaChannels(recents);
    renderRecentsGrid();

    try {
        const channels = await TvProviderRegistry.getChannelsByRefs(recents.map(r => r.key), { refresh: forceRefresh });
        if (channels.length) {
            appState.recentsList = channels;
            renderRecentsGrid();
        }
    } catch (err) {
        console.error('Failed to hydrate recents:', err);
    }
}

// Build lightweight channel-shaped objects from stored {key,name,logo,countrycode}.
function metaChannels(metaEntries) {
    return (metaEntries || []).map(e => {
        const parsed = parseChannelKey(e.key);
        return {
            providerId: parsed?.providerId,
            channelId: parsed?.channelId,
            channeluuid: e.key,
            name: e.name || '',
            logo: e.logo || '',
            countrycode: e.countrycode || '',
            url_resolved: ''
        };
    });
}

// Fallback tiles for favorites that predate the metadata field.
function skeletonChannels(keys) {
    return (keys || []).map(k => {
        const parsed = parseChannelKey(k);
        return {
            providerId: parsed?.providerId,
            channelId: parsed?.channelId,
            channeluuid: k,
            name: parsed?.channelId || k,
            logo: '',
            countrycode: '',
            url_resolved: ''
        };
    });
}

function matchesFilter(ch, q) {
    if (!q) return true;
    const name = (ch?.name || '').toLowerCase();
    const id = (ch?.channelId || '').toLowerCase();
    return name.includes(q) || id.includes(q);
}

function renderFavoritesGrid() { renderTabGrid('favorites'); }
function renderRecentsGrid() { renderTabGrid('recents'); }

// Render the current (already hydrated) list, applying the shared Filter.
function renderTabGrid(tab) {
    const isFav = tab === 'favorites';
    const grid = el(isFav ? 'favorites-grid' : 'recents-grid');
    const empty = el(isFav ? 'favorites-empty' : 'recents-empty');
    if (!grid || !empty) return;
    const source = isFav ? appState.favoritesList : appState.recentsList;
    if (!source || source.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');
    const filter = isFav ? appState.favFilter : appState.recentsFilter;
    const list = source.filter(ch => matchesFilter(ch, filter));
    if (!list.length) {
        grid.innerHTML = '<div class="empty-state"><p class="empty-state__text">No channels match</p></div>';
        return;
    }
    renderChannelGrid(grid, list);
}

// ===== PLAYER CONTROLS =====
function bindPlayerControls() {
    const playBtn = el('play-btn');
    const pauseBtn = el('pause-btn');
    const stopBtn = el('stop-btn');
    const volume = el('volume-slider');
    const muteBtn = el('mute-btn');
    const fullscreenBtn = el('fullscreen-btn');
    const pipBtn = el('pip-btn');

    if (playBtn) playBtn.addEventListener('click', () => TvPlayer.toggle());
    if (pauseBtn) pauseBtn.addEventListener('click', () => TvPlayer.pause());
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            TvPlayer.stop();
        });
    }
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const video = TvPlayer.video;
            if (!video?.requestFullscreen) {
                showAppToast('Fullscreen isn’t supported here');
                return;
            }
            video.requestFullscreen().catch(() => showAppToast('Fullscreen blocked'));
        });
    }
    if (pipBtn) TvPip.registerButton(pipBtn);
    if (volume) {
        volume.addEventListener('input', (e) => {
            TvPlayer.setVolume(parseFloat(e.target.value) / 100);
        });
    }
    if (muteBtn) {
        muteBtn.addEventListener('click', () => TvPlayer.toggleMute());
        // Update mute button icon on state changes
        const updateMuteIcon = () => {
            const isMuted = TvPlayer.muted || TvPlayer.volume === 0;
            const wave = muteBtn.querySelector('#mute-wave');
            if (wave) wave.style.opacity = isMuted ? '0' : '1';
            muteBtn.setAttribute('aria-pressed', String(isMuted));
            muteBtn.title = isMuted ? 'Unmute' : 'Mute';
        };
        window.addEventListener('tv:state_changed', updateMuteIcon);
        updateMuteIcon();
    }
    const favBtn = el('fav-btn');
    if (favBtn) {
        favBtn.addEventListener('click', () => {
            const ch = TvPlayer.channel;
            if (!ch) {
                showAppToast('No channel playing');
                return;
            }
            const isFav = TvPlayer.toggleFavorite(ch);
            favBtn.classList.toggle('is-active', isFav);
            favBtn.textContent = isFav ? '★' : '☆';
            favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
            showAppToast(isFav ? '❤️ Added to favorites' : '💔 Removed from favorites');
            if (appState.activeTab === 'favorites') refreshFavoritesTab();
        });
        // Keep fav button in sync when channel changes
        window.addEventListener('tv:state_changed', updateFavBtn);
    }
    const volPct = el('volume-pct');
    if (volPct) {
        const updateVolPct = () => {
            const shown = TvPlayer.muted ? 0 : TvPlayer.volume;
            volPct.textContent = `${Math.round((shown || 0) * 100)}%`;
        };
        window.addEventListener('tv:state_changed', updateVolPct);
        updateVolPct();
    }
}

function updateFavBtn() {
    const favBtn = el('fav-btn');
    if (favBtn) {
        const ch = TvPlayer.channel;
        const isFav = ch ? TvPlayer.isFavorite(ch) : false;
        favBtn.classList.toggle('is-active', isFav);
        favBtn.textContent = isFav ? '★' : '☆';
        favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
    }
    syncChannelTileFavButtons();
}

// ===== NOW PLAYING (header) =====
function updateNowPlayingHeader() {
    const channel = TvPlayer.channel;
    const name = channel?.name || appState.lastName;
    const country = channel?.countrycode || appState.lastCountry;

    const headerInfo = els('.tv-channel-info')[0];
    const headerName = el('header-channel-name');
    const headerFlag = el('header-channel-flag');

    if (!name && !channel) {
        if (headerInfo) headerInfo.classList.add('is-hidden');
        if (headerName) headerName.textContent = '';
        if (headerFlag) headerFlag.textContent = '';
        return;
    }

    if (headerInfo) headerInfo.classList.remove('is-hidden');
    if (headerName) headerName.textContent = name || 'Unknown';
    if (headerFlag) headerFlag.textContent = country ? countryFlagEmoji(country) : '';
}

// ===== STATE PERSISTENCE =====
async function restoreLastChannelMeta() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        if (!raw.lastChannelKey) return;
        appState.lastKey = raw.lastChannelKey;
        appState.lastName = raw.lastChannelName || 'Last channel';
        appState.lastCountry = '';
        const ch = await TvProviderRegistry.getChannel(parseChannelKey(raw.lastChannelKey)).catch(() => null);
        if (!ch) return;
        TvPlayer.channel = ch;
        appState.lastKey = channelKey(ch);
        appState.lastName = ch.name;
        appState.lastCountry = ch.countrycode || '';
        TvPlayer.emitState();
    } catch { /* ignore */ }
}

// ===== SETTINGS =====
function bindSettings() {
    const buffer = el('buffer-size-select');
    if (buffer) {
        buffer.addEventListener('change', () => {
            const size = parseInt(buffer.value, 10);
            const clamped = TvPlayer.setBufferSize(Number.isFinite(size) ? size : 15);
            buffer.value = String(clamped);
            showAppToast(`Buffer size: ${clamped}s`);
        });
    }
    bindAppearance();
}

// ===== APPEARANCE SETTINGS =====
function formatTextSizeLabel(size) {
    return `${Math.round((size / 16) * 100)}%`;
}

function bindAppearance() {
    const textSlider = el('text-size-slider');
    const textValue = el('text-size-value');
    const tileSlider = el('tile-width-slider');
    const tileValue = el('tile-width-value');

    const syncTextUi = (size) => {
        if (textSlider) textSlider.value = String(size);
        if (textValue) textValue.textContent = formatTextSizeLabel(size);
        if (textSlider) textSlider.setAttribute('aria-valuetext', formatTextSizeLabel(size));
    };

    const syncTileUi = (width) => {
        if (tileSlider) tileSlider.value = String(width);
        if (tileValue) tileValue.textContent = `${width}px`;
        if (tileSlider) tileSlider.setAttribute('aria-valuetext', `${width}px`);
    };

    if (textSlider) {
        textSlider.addEventListener('input', () => {
            const size = TvProviderRegistry.setTextSize(Number(textSlider.value));
            syncTextUi(size);
            applyAppearanceStyles();
        });
    }

    if (tileSlider) {
        tileSlider.addEventListener('input', () => {
            const width = TvProviderRegistry.setTileWidth(Number(tileSlider.value));
            syncTileUi(width);
            applyAppearanceStyles();
        });
    }

    const resetBtn = el('reset-appearance-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const size = TvProviderRegistry.setTextSize(16);
            const width = TvProviderRegistry.setTileWidth(180);
            syncTextUi(size);
            syncTileUi(width);
            applyAppearanceStyles();
            showAppToast('Appearance reset to defaults');
        });
    }
}

function applyAppearanceStyles() {
    // Guard for test environments without full DOM
    if (!document.documentElement) return;
    
    const root = document.documentElement;
    const textSize = TvProviderRegistry.getTextSize();
    const tileWidth = TvProviderRegistry.getTileWidth();
    
    // Relative text scale via root font-size — rem-based UI scales everywhere
    root.style.fontSize = `${textSize}px`;
    root.style.setProperty('--tv-tile-width', `${tileWidth}px`);
    
    // Update the preview tile
    updatePreviewTile();
    
    // Measure marquee on all tiles — immediately and again after layout settles,
    // since the tile-width change reflows the auto-fill grid columns.
    document.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            document.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
        });
    }
}

// Also apply appearance styles after any new tiles are rendered
function applyAppearanceToTiles(container) {
    if (!container || !document.documentElement) return;
    
    // CSS variables auto-cascade, but we need to handle narrow class + shift for new tiles.
    // Measure immediately (best effort) and again after layout settles so the
    // scrollWidth/clientWidth reflect the final rendered widths.
    container.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            container.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
        });
    }
}

// Detect each tile's name overflow and toggle the "narrow" class.
// Clone a second .marquee-text only when the single copy overflows — same
// pattern as syncMarquee in tvUtils.js — so fitting names never show doubled.
function measureTileMarquee(tile) {
    if (!tile || typeof tile.classList?.toggle !== 'function') return;
    const name = tile.querySelector?.('.channel-tile__name, .country-tile__name');
    if (!name) return;

    const track = name.querySelector('.marquee-track');
    const firstText = track?.querySelector('.marquee-text');
    if (!track || !firstText) return;

    // Strip any prior clone before measuring a single copy.
    track.querySelectorAll('.marquee-text[aria-hidden="true"]').forEach((node) => node.remove());
    tile.classList.remove('narrow');

    // Only measure when the browser exposes real layout metrics.
    if (typeof firstText.scrollWidth !== 'number' || typeof name.clientWidth !== 'number') {
        return;
    }

    const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const overflows = firstText.scrollWidth > name.clientWidth + 2;

    if (overflows && !reducedMotion) {
        const clone = firstText.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
        tile.classList.add('narrow');
    }
}

// Update the settings preview tile with current channel or a default
function updatePreviewTile() {
    const preview = el('appearance-preview-tile');
    if (!preview) return;
    const name = el('preview-name');
    const flag = el('preview-flag');
    const avatar = el('preview-avatar');
    
    // Try to use the currently playing channel
    const channel = TvPlayer.channel;
    const nameText = channel?.name || 'Now Playing';
    const countryCode = channel?.countrycode || '';
    const initial = (nameText[0] || 'P').toUpperCase();
    const safeName = escapeHtml(nameText);
    
    if (name) name.innerHTML = `<span class="marquee-track"><span class="marquee-text">${safeName}</span></span>`;
    if (flag) flag.textContent = countryCode ? countryFlagEmoji(countryCode) : '';
    if (avatar) avatar.textContent = initial;
}

function syncSettingsFromState() {
    const buffer = el('buffer-size-select');
    if (buffer) buffer.value = String(TvPlayer.getBufferSize());
    const volume = el('volume-slider');
    if (volume) volume.value = String(Math.round((TvPlayer.volume || 0.85) * 100));
    
    // Sync appearance settings
    const textSize = TvProviderRegistry.getTextSize();
    const textSlider = el('text-size-slider');
    const textValue = el('text-size-value');
    if (textSlider) textSlider.value = String(textSize);
    if (textValue) textValue.textContent = formatTextSizeLabel(textSize);
    if (textSlider) textSlider.setAttribute('aria-valuetext', formatTextSizeLabel(textSize));

    const tileWidthPx = TvProviderRegistry.getTileWidth();
    const tileSlider = el('tile-width-slider');
    const tileWidth = el('tile-width-value');
    if (tileSlider) tileSlider.value = String(tileWidthPx);
    if (tileWidth) tileWidth.textContent = `${tileWidthPx}px`;
    if (tileSlider) tileSlider.setAttribute('aria-valuetext', `${tileWidthPx}px`);
    
    // Apply appearance styles on load
    applyAppearanceStyles();
}

function updateStorageStats() {
    const stats = el('storage-stats');
    if (!stats) return;
    const spans = stats.querySelectorAll('span');
    if (spans.length < 4) return;

    // Favorites / Recents count
    const favs = TvPlayer.getFavorites?.() || [];
    const recents = TvPlayer.getRecentsMeta?.() || [];
    spans[0].textContent = `Favorites: ${favs.length}`;
    spans[1].textContent = `Recents: ${recents.length}`;

    // localStorage usage
    let localBytes = 0;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key);
            localBytes += (key?.length || 0) + (val?.length || 0);
        }
    } catch { /* ignore */ }
    spans[2].textContent = `localStorage: ${localBytes < 1024 ? localBytes + ' B' : (localBytes / 1024).toFixed(1) + ' KB'}`;

    // IndexedDB cache estimate
    if (navigator?.storage?.estimate) {
        navigator.storage.estimate().then((est) => {
            const used = est.usage || 0;
            spans[3].textContent = `Cache: ${used < 1024 ? used + ' B' : used < 1048576 ? (used / 1024).toFixed(1) + ' KB' : (used / 1048576).toFixed(1) + ' MB'}`;
        }).catch(() => { spans[3].textContent = 'Cache: —'; });
    } else {
        spans[3].textContent = 'Cache: —';
    }
}

// ===== STATE CHANGES =====
function onPlayerStateChanged(e) {
    const state = e.detail || {};

    // Heavy tile grabs yield bandwidth while a channel is loading or playing.
    setFrameCapturePaused(state.playing === true || state.loading === true);

    // Keep the video element mounted in the player surface (always visible).
    try { TvPlayer.mountVideo(el('tv-playback-surface')); } catch { /* ignore */ }

    const playBtn = el('play-btn');
    const pauseBtn = el('pause-btn');
    if (playBtn) playBtn.classList.toggle('is-hidden', state.playing === true);
    if (pauseBtn) pauseBtn.classList.toggle('is-hidden', state.playing !== true);

    const volume = el('volume-slider');
    if (volume && typeof state.volume === 'number') {
        volume.value = String(Math.round(state.volume * 100));
    }

    const bufferInfo = el('buffer-info');
    if (bufferInfo) {
        if (state.channel && state.loadPhase !== 'idle') {
            const buf = TvPlayer.getBufferInfo();
            bufferInfo.textContent = `Buffer: ${buf.buffered.toFixed(1)}s`;
        } else {
            bufferInfo.textContent = 'Buffer: —';
        }
    }
    const qualityInfo = el('quality-info');
    if (qualityInfo) {
        qualityInfo.textContent = state.channel ? `Quality: ${TvPlayer.qualityLabel || 'Auto'}` : 'Quality: —';
    }

    if (state.resumeBlocked) {
        showAppToast('Tap ▶ to start playback');
    } else if (state.error && !state.resumeBlocked) {
        showAppToast('Stream unavailable');
    }

    updateNowPlayingHeader();

    // Don't refresh favorites/recents here — it causes flickering on every buffer tick.
    // They are refreshed when the tab is switched or when a star is toggled.

    // Update the settings preview tile when channel changes
    if (state.channel) {
        updatePreviewTile();
    }
}
