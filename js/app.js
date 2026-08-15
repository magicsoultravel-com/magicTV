/** magicTV - Neon-styled TV streaming browser */
import { TvPlayer } from './tvPlayer.js';
import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, debounce } from './tvUtils.js';
import { showAppToast } from './ui/toast.js';
import { CARD_ICONS } from './ui/icons.js';
import { TvPip } from './tvPip.js';

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
    lastKey: null,
    lastName: '',
    lastCountry: ''
};

function el(id) { return document.getElementById(id); }
function els(query) { return Array.from(document.querySelectorAll(query)); }

// ===== BOOT =====
async function init() {
    console.log('🎬 magicTV initializing...');

    // Let TvPlayer create & wire its own <video> (listeners, recents, buffer).
    TvPlayer.init();
    TvPip.init();
    TvPlayer.mountVideo(el('tv-playback-surface'));

    // Sync now-playing card from saved localStorage (fast, before async fetch).
    loadLocalState();
    updateNowPlayingCard();

    bindTabs();
    bindPlayerControls();
    bindSettings();
    bindBrowse();
    bindBackButton();

    syncSettingsFromState();

    window.addEventListener('tv:state_changed', onPlayerStateChanged);

    await refreshCountries();

    // Full metadata restore + auto-resume.
    await restoreLastChannelMeta();
    if (TvPlayer.channel) {
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
    const countries = el('countries-container');
    const channels = el('channels-container');
    const loadMore = el('load-more-container');
    const back = el('back-btn');
    if (countries) countries.classList.remove('is-hidden');
    if (channels) channels.classList.add('is-hidden');
    if (loadMore) loadMore.classList.add('is-hidden');
    if (back) back.classList.add('is-hidden');
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
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
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
    appState.activeTab = tabName;
    if (tabName === 'favorites') refreshFavoritesTab();
    else if (tabName === 'recents') refreshRecentsTab();
    else if (tabName === 'settings') updateStorageStats();
}

// ===== BROWSE =====
function bindBrowse() {
    const search = el('search-countries');
    if (search) {
        search.addEventListener('input', debounce((e) => {
            appState.countryFilter = e.target.value.toLowerCase();
            renderCountries();
        }, 250));
    }
    const loadMoreBtn = el('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreChannels);
}

async function refreshCountries() {
    try {
        appState.countries = await TvProviderRegistry.getCountries();
    } catch (err) {
        console.error('Failed to load countries:', err);
        showAppToast('Countries unavailable — check your connection');
    }
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

    const countries = el('countries-container');
    const channels = el('channels-container');
    const loadMore = el('load-more-container');
    const back = el('back-btn');
    if (countries) countries.classList.add('is-hidden');
    if (channels) channels.classList.remove('is-hidden');
    if (loadMore) loadMore.classList.remove('is-hidden');
    if (back) back.classList.remove('is-hidden');
    if (channels) channels.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading channels…</p></div>';

    await loadMoreChannels();
}

async function loadMoreChannels() {
    if (appState.browseLoading || !appState.browseHasMore) return;
    appState.browseLoading = true;
    const btn = el('load-more-btn');
    if (btn) btn.disabled = true;
    try {
        const hideOffline = TvProviderRegistry.getHideOffline();
        const results = await TvProviderRegistry.searchChannels({
            countrycode: appState.browseCountry,
            offset: appState.browseOffset,
            limit: PAGE_SIZE,
            order: 'name',
            hideOffline
        });
        if (results.length < PAGE_SIZE) {
            appState.browseHasMore = false;
            const loadMore = el('load-more-container');
            if (loadMore) loadMore.classList.add('is-hidden');
        }
        appState.browseChannels = appState.browseChannels.concat(results);
        appState.browseOffset += PAGE_SIZE;
        renderChannelGrid(el('channels-container'), appState.browseChannels);
    } catch (err) {
        console.error('Failed to load channels:', err);
        showAppToast('Failed to load channels');
    } finally {
        appState.browseLoading = false;
        if (btn) btn.disabled = false;
    }
}


// ===== CHANNEL GRID =====
function tileHtml(ch, { forceFav = false } = {}) {
    const isFav = forceFav || TvPlayer.isFavorite(channelKey(ch));
    const starIcon = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
    const initial = (ch.name || '?')[0].toUpperCase();
    const offline = ch.lastcheckok === 0;
    return `
        <div class="channel-tile" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}">
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame="${escapeHtml(channelKey(ch))}">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img is-hidden" alt="" loading="lazy">
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

function renderChannelGrid(container, channels) {
    if (!container) return;
    container.innerHTML = channels.map(ch => tileHtml(ch)).join('');
    wireTiles(container, channels);
    initFrameCapture(container);
}

function wireTiles(container, channels) {
    if (!container) return;
    container.querySelectorAll('.channel-tile').forEach(tile => {
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
    });
    container.querySelectorAll('[data-star]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.star;
            const ch = channels.find(c => channelKey(c) === key);
            if (!ch) return;
            const isFav = TvPlayer.toggleFavorite(ch);
            btn.classList.toggle('is-active', isFav);
            btn.innerHTML = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
            showAppToast(isFav ? '❤️ Added to favorites' : '💔 Removed from favorites');
            if (appState.activeTab === 'favorites') refreshFavoritesTab();
            else if (appState.activeTab === 'recents') refreshRecentsTab();
        });
    });
}
// ===== LAZY FRAME / LOGO CAPTURE =====
const frameCapture = { queue: [], running: 0, MAX: 3, observer: null };

function initFrameCapture(container) {
    if (!container || frameCapture.observer) return;
    frameCapture.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const f = entry.target;
            if (f.dataset.captured || frameCapture.queue.includes(f)) continue;
            frameCapture.queue.push(f);
        }
        drainFrameCapture();
    }, { rootMargin: '200px' });
    container.querySelectorAll('.channel-tile__capture-frame').forEach(el => frameCapture.observer.observe(el));
}

function drainFrameCapture() {
    while (frameCapture.queue.length && frameCapture.running < frameCapture.MAX) {
        const el = frameCapture.queue.shift();
        if (!el || el.dataset.captured) continue;
        frameCapture.running++;
        captureFrame(el).finally(() => {
            frameCapture.running--;
            drainFrameCapture();
        });
    }
}

async function captureFrame(el) {
    const url = el.closest('.channel-tile')?.dataset?.url;
    if (!url) { el.dataset.captured = '1'; return; }
    const loader = el.querySelector('.channel-tile__frame-loader');
    const letter = el.querySelector('.channel-tile__letter-avatar');
    const img = el.querySelector('.channel-tile__logo-img');

    // Try the channel logo URL first (fast path)
    try {
        const loaded = await new Promise((resolve) => {
            const i = new Image();
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 3000);
            i.onload = () => { if (!done) { done = true; clearTimeout(t); resolve(true); } };
            i.onerror = () => { if (!done) { done = true; clearTimeout(t); resolve(false); } };
            i.src = url;
        });
        if (loaded) {
            if (img) { img.src = url; img.classList.remove('is-hidden'); }
            if (loader) loader.classList.add('is-hidden');
            if (letter) letter.classList.add('is-hidden');
            el.dataset.captured = '1';
            return;
        }
    } catch { /* fall through */ }

    // Logo failed — try grabbing a frame from the stream via hidden <video>
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
            const t = setTimeout(() => reject(new Error('timeout')), 8000);
            video.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
            video.addEventListener('error', () => { clearTimeout(t); reject(new Error('err')); }, { once: true });
            video.load();
        });

        const canvas = document.createElement('canvas');
        canvas.width = 56; canvas.height = 56;
        canvas.getContext('2d').drawImage(video, 0, 0, 56, 56);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        if (img) { img.src = dataUrl; img.classList.remove('is-hidden'); }
        if (loader) loader.classList.add('is-hidden');
        if (letter) letter.classList.add('is-hidden');
        el.dataset.captured = '1';
    } catch {
        if (loader) loader.classList.add('is-hidden');
        el.dataset.captured = '1';
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

async function refreshFavoritesTab() {
    const grid = el('favorites-grid');
    const empty = el('favorites-empty');
    if (!grid || !empty) return;
    const favorites = TvPlayer.getFavorites();
    if (!favorites || favorites.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');
    grid.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading favorites…</p></div>';
    try {
        const channels = await TvProviderRegistry.getChannelsByRefs(favorites);
        renderChannelGrid(grid, channels);
    } catch (err) {
        console.error('Failed to load favorites:', err);
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
    }
}

async function refreshRecentsTab() {
    const grid = el('recents-grid');
    const empty = el('recents-empty');
    if (!grid || !empty) return;
    const recents = TvPlayer.getRecentsMeta();
    if (!recents || recents.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');
    grid.innerHTML = '<div class="empty-state"><p class="empty-state__text">Loading recents…</p></div>';
    try {
        const channels = await TvProviderRegistry.getChannelsByRefs(recents.map(r => r.key));
        renderChannelGrid(grid, channels);
    } catch (err) {
        console.error('Failed to load recents:', err);
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
    }
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

// ===== NOW PLAYING =====
function updateNowPlayingCard() {
    let channel = TvPlayer.channel;
    let name = channel?.name || appState.lastName;
    let country = channel?.countrycode || appState.lastCountry;

    const slot = el('now-playing-slot');
    const title = el('now-playing-title');

    if (!name && !channel) {
        if (slot) slot.classList.add('is-hidden');
        return;
    }
    if (slot) slot.classList.remove('is-hidden');
    const flag = country ? countryFlagEmoji(country) + ' ' : '';
    if (title) title.textContent = flag + (name || 'Unknown');
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

    updateNowPlayingCard();

    // Don't refresh favorites/recents here — it causes flickering on every buffer tick.
    // They are refreshed when the tab is switched or when a star is toggled.
}
