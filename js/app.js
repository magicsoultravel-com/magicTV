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
    activeTab: 'browse',
    countryFilter: '',
    browseQuery: '',
    favFilter: '',
    recentsFilter: '',
    favoritesList: [],
    recentsList: [],
    lastKey: null,
    lastName: '',
    lastCountry: ''
};

function el(id) { return document.getElementById(id); }
function els(query) { return Array.from(document.querySelectorAll(query)); }

// ===== BOOT =====
const DEFAULT_FIRST_CHANNEL_URL = 'https://channels.trace.plus/Traceprod/CARIBBEAN_hd/index.m3u8';
const DEFAULT_FIRST_CHANNEL_NAME = 'CARIBBEAN';

async function init() {
    console.log('🎬 magicTV initializing...');

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
    console.log('✨ magicTV ready!');
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
// for the favorites/recents tabs) and reload from the network. Without this
// the app boots straight from history — no auto-refetch on site reload.
async function handleManualRefresh() {
    const btn = el('refresh-btn');
    const spin = () => btn && btn.classList.add('is-loading');
    const unspin = () => btn && btn.classList.remove('is-loading');
    spin();
    showAppToast('Refreshing…');
    try {
        const tab = appState.activeTab;
        if (tab === 'browse') {
            if (appState.browseCountry === null) {
                appState.countries = await TvProviderRegistry.refreshCatalog();
                renderCountries();
            } else {
                await refreshBrowseCountry();
            }
        } else if (tab === 'favorites') {
            await refreshFavoritesTab(true);
        } else if (tab === 'recents') {
            await refreshRecentsTab(true);
        } else {
            updateStorageStats();
        }
        showAppToast('✅ Refreshed');
    } catch {
        showAppToast('Refresh failed — try again');
    } finally {
        unspin();
        updateRefreshAge();
    }
}

// The age label beside the ↻ arrow shows when the catalog was last reloaded
// from the network (e.g. "3h ago"); empty until the first load.
function updateRefreshAge() {
    const label = el('refresh-age');
    if (!label) return;
    label.textContent = formatRelativeTime(TvProviderRegistry.getLastRefreshed());
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
            <div class="country-tile__flag">${countryFlagEmoji(c.iso_3166_1)}</div>
            <h3 class="country-tile__name">${escapeHtml(c.name)}</h3>
            <div class="country-tile__count">${c.stationcount || 0} channels</div>
        </div>
    `).join('') || '<div class="empty-state"><p class="empty-state__text">No countries found</p></div>';

    container.querySelectorAll('.country-tile').forEach(tile => {
        const open = () => browseCountry(tile.dataset.country);
        tile.addEventListener('click', open);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    });
}

async function browseCountry(countryCode) {
    appState.browseCountry = countryCode;
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

    await loadMoreChannels();
    setupScrollLoading();
}

async function loadMoreChannels(forceRefresh = false) {
    if (appState.browseLoading || !appState.browseHasMore) return;
    appState.browseLoading = true;
    try {
        const hideOffline = TvProviderRegistry.getHideOffline();
        const results = await TvProviderRegistry.searchChannels({
            countrycode: appState.browseCountry,
            query: appState.browseQuery,
            offset: appState.browseOffset,
            limit: PAGE_SIZE,
            order: 'name',
            hideOffline,
            refresh: forceRefresh
        });
        if (results.length < PAGE_SIZE) {
            appState.browseHasMore = false;
        }
        appState.browseChannels = appState.browseChannels.concat(results);
        appState.browseOffset += PAGE_SIZE;
        // Append-only: the new chunk is painted without tearing down the
        // already-captured tiles (keeps DOM stable + preserves scroll perf).
        renderChannelGrid(el('channels-container'), results, { append: true });
    } catch (err) {
        console.error('Failed to load channels:', err);
        showAppToast('Failed to load channels');
    } finally {
        appState.browseLoading = false;
    }
}

// Restart the whole channel search for a country (e.g. when the filter text
// changes): pagination then scrolls through the *filtered* result set.
function startChannelSearch(query) {
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
            const scrollTop = panel.scrollTop;
            const scrollHeight = panel.scrollHeight;
            const clientHeight = panel.clientHeight;
            // When user has scrolled near bottom (20px threshold)
            if (scrollTop + clientHeight >= scrollHeight - 20) {
                loadMoreChannels();
            }
            ticking = false;
        });
    }

    panel.addEventListener('scroll', handleScroll, { passive: true });
}


// ===== CHANNEL GRID =====
function tileHtml(ch, { forceFav = false } = {}) {
    const isFav = forceFav || TvPlayer.isFavorite(channelKey(ch));
    const starIcon = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
    const initial = (ch.name || '?')[0].toUpperCase();
    const offline = ch.lastcheckok === 0;
    return `
        <div class="channel-tile" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}" data-logo="${escapeHtml(ch.logo || '')}">
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame="${escapeHtml(channelKey(ch))}">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img is-hidden" alt="" loading="lazy" decoding="async">
                    <span class="channel-tile__frame-loader">⏳</span>
                    <span class="channel-tile__offline-badge ${offline ? '' : 'is-hidden'}">🚫</span>
                </div>
            </div>
            <div class="channel-tile__body">
                <h3 class="channel-tile__name">${escapeHtml(ch.name || 'Unknown')}</h3>
                <span class="channel-tile__flag">${countryFlagEmoji(ch.countrycode)}</span>
            </div>
            <button class="channel-tile__star ${isFav ? 'is-active' : ''}" data-star="${escapeHtml(channelKey(ch))}" title="Favorite">${starIcon}</button>
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
    primeFramesFromCache(container);
}

function wireTiles(container, channels) {
    if (!container) return;
    container.querySelectorAll('.channel-tile').forEach(tile => {
        if (wiredTiles.has(tile)) return; // already wired by a previous append pass
        wiredTiles.add(tile);
        const key = tile.dataset.channel;
        const ch = channels.find(c => channelKey(c) === key);
        const play = (e) => {
            if (e.target.closest('[data-star]')) return;
            if (ch) startPlayback(ch);
        };
        tile.addEventListener('click', play);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(e); }
        });
        const star = tile.querySelector('[data-star]');
        if (star) {
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!ch) return;
                const isFav = TvPlayer.toggleFavorite(ch);
                star.classList.toggle('is-active', isFav);
                star.innerHTML = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
                showAppToast(isFav ? '❤️ Added to favorites' : '💔 Removed from favorites');
                if (appState.activeTab === 'favorites') refreshFavoritesTab();
                else if (appState.activeTab === 'recents') refreshRecentsTab();
            });
        }
    });
}
// ===== LAZY FRAME / LOGO CAPTURE =====
// Two-tier scheduler:
//  - cheap tier = cached thumbnail + natively-displayed channel logo (several at once)
//  - heavy tier = live-stream frame grab via a hidden <video> (serialized, max 2)
// Tiles inside the viewport ("hot") are drained before tiles in the 200px
// prefetch margin ("warm"), so what the user is looking at paints first.
const frameCapture = {
    observer: null,
    hot: [],
    warm: [],
    pending: new Set(),
    running: 0,
    heavyRunning: 0,
    MAX_TOTAL: 6,
    MAX_CHEAP: 4,
    MAX_HEAVY: 2,
    LOGO_TIMEOUT: 3500,
    VIDEO_TIMEOUT: 5500
};

function observeFrames(container) {
    if (!container || typeof IntersectionObserver === 'undefined') return;
    if (!frameCapture.observer) {
        frameCapture.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const f = entry.target;
                if (f.dataset.captured || frameCapture.pending.has(f)) continue;
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
    const r = frame.getBoundingClientRect();
    const h = globalThis.innerHeight || 0;
    return !!r && r.top < h && r.bottom > 0;
}

// Sync-apply already-cached thumbnails as soon as a grid is (re)rendered —
// favorites/recents tabs switch far faster than an IntersectionObserver
// round-trip. Un-cached tiles are left to the normal lazy pipeline.
function primeFramesFromCache(container) {
    if (!container) return;
    container.querySelectorAll('.channel-tile__capture-frame').forEach(frame => {
        if (frame.dataset.captured) return;
        (async () => {
            const tile = frame.closest('.channel-tile');
            const keys = [(tile?.dataset?.url || '').trim(), (tile?.dataset?.logo || '').trim()];
            for (const key of keys) {
                if (!key) continue;
                const cached = await FrameCache.getFrame(key).catch(() => null);
                if (!cached || frame.dataset.captured) continue;
                const img = frame.querySelector('.channel-tile__logo-img');
                const letter = frame.querySelector('.channel-tile__letter-avatar');
                const loader = frame.querySelector('.channel-tile__frame-loader');
                if (img) { img.src = cached; img.classList.remove('is-hidden'); }
                if (letter) letter.classList.add('is-hidden');
                if (loader) loader.classList.add('is-hidden');
                frame.dataset.captured = '1';
                return;
            }
        })();
    });
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
    const tile = frame.closest('.channel-tile');
    const logo = (tile?.dataset?.logo || '').trim();
    return logo ? 'cheap' : 'heavy';
}

function canStartTier(tier) {
    if (frameCapture.running >= frameCapture.MAX_TOTAL) return false;
    if (tier === 'heavy') return frameCapture.heavyRunning < frameCapture.MAX_HEAVY;
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

function drainFrameCapture() {
    pruneUnconnectedFrames();
    let next;
    while ((next = pickNextCapture())) {
        const { frame, tier } = next;
        frameCapture.running++;
        if (tier === 'heavy') frameCapture.heavyRunning++;
        captureFrame(frame).finally(() => {
            frameCapture.running--;
            if (tier === 'heavy') frameCapture.heavyRunning--;
            frameCapture.pending.delete(frame);
            drainFrameCapture();
        });
    }
}

async function captureFrame(frame) {
    const tile = frame.closest('.channel-tile');
    const url = (tile?.dataset?.url || '').trim();
    const logo = (tile?.dataset?.logo || '').trim();

    const loader = frame.querySelector('.channel-tile__frame-loader');
    const letter = frame.querySelector('.channel-tile__letter-avatar');
    const img = frame.querySelector('.channel-tile__logo-img');

    const show = (src) => {
        if (img) { img.src = src; img.classList.remove('is-hidden'); }
        if (letter) letter.classList.add('is-hidden');
        if (loader) loader.classList.add('is-hidden');
        frame.dataset.captured = '1';
    };

    // Tier 0 — persistent thumbnail cache (IndexedDB), keyed by stream or logo URL.
    for (const key of [url, logo]) {
        if (!key) continue;
        const cached = await FrameCache.getFrame(key).catch(() => null);
        if (cached) { show(cached); return; }
    }

    // Tier 1 — channel logo, displayed natively (no canvas/CORS needed).
    // Falls back to a stream frame grab only when the logo is absent.
    if (logo) {
        if (await imageLoad(logo, frameCapture.LOGO_TIMEOUT)) {
            show(logo);
            persistFrameBestEffort(logo); // background cache write, if CORS allows
            return;
        }
    }

    // Tier 2 — grab a frame from the live stream via a hidden <video>.
    if (!url) { frame.dataset.captured = '1'; return; }
    const dataUrl = await captureStreamFrame(url);
    if (dataUrl) {
        show(dataUrl);
        FrameCache.setFrame(url, dataUrl).catch(() => {});
    } else {
        frame.dataset.captured = '1'; // give up this session — letter avatar stays
    }
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

async function captureStreamFrame(url) {
    let video, hls;
    try {
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';
        document.body.appendChild(video);

        if (url.includes('.m3u8')) {
            const { default: Hls } = await loadHlsForCapture();
            if (Hls) { hls = new Hls(); hls.attachMedia(video); hls.loadSource(url); }
            else { video.src = url; }
        } else {
            video.src = url;
        }

        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), frameCapture.VIDEO_TIMEOUT);
            const done = () => clearTimeout(t);
            video.addEventListener('loadeddata', () => { done(); resolve(); }, { once: true });
            video.addEventListener('error', () => { done(); reject(new Error('media error')); }, { once: true });
            video.load();
        });

        const canvas = document.createElement('canvas');
        canvas.width = 56; canvas.height = 56;
        canvas.getContext('2d').drawImage(video, 0, 0, 56, 56);
        return canvas.toDataURL('image/jpeg', 0.6);
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
    try { TvPlayer.mountVideo(el('tv-playback-surface')); } catch { /* ignore */ }
    TvPlayer.playChannel(channel).catch(() => {});
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
    const hideOffline = el('hide-offline-toggle');
    if (hideOffline) {
        hideOffline.addEventListener('click', () => {
            const active = hideOffline.classList.contains('is-active');
            TvProviderRegistry.setHideOffline(!active);
            hideOffline.classList.toggle('is-active', !active);
            hideOffline.setAttribute('aria-pressed', String(!active));
            showAppToast(!active ? 'Hiding offline channels' : 'Showing all channels');
        });
    }
}

function syncSettingsFromState() {
    const buffer = el('buffer-size-select');
    if (buffer) buffer.value = String(TvPlayer.getBufferSize());
    const hideOffline = el('hide-offline-toggle');
    if (hideOffline) {
        const active = TvProviderRegistry.getHideOffline();
        hideOffline.classList.toggle('is-active', active);
        hideOffline.setAttribute('aria-pressed', String(active));
    }
    const volume = el('volume-slider');
    if (volume) volume.value = String(Math.round((TvPlayer.volume || 0.85) * 100));
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
// ===== STATE CHANGES =====
function onPlayerStateChanged(e) {
    const state = e.detail || {};

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
        showAppToast(state.error === 'Channel offline' ? 'Channel offline' : 'Stream unavailable');
    }

    updateNowPlayingHeader();

    // Don't refresh favorites/recents here — it causes flickering on every buffer tick.
    // They are refreshed when the tab is switched or when a star is toggled.
}
