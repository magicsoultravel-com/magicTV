import { TvPlayer } from '../tvPlayer.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';
import { TileFrames } from '../tileFrames.js';
import { Appearance } from './appearance.js';
import { FavoritesReorder } from './favoritesReorder.js';
import { ListSort, getSortPrefs, matchesCategoryFilter, channelHasCategory, sortChannelList, setCategoryNameMap } from './listSort.js';

const wiredTiles = new WeakSet();

let deps = {
    appState: null,
    getRefreshKey: () => '',
    onPlay: () => {}
};

function tileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const isFav = TvPlayer.isFavorite(ch);
    const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
    return `
        <div class="channel-tile" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}" data-logo="${escapeHtml(ch.logo || '')}">
            <button type="button" class="channel-tile__fav-btn${isFav ? ' is-active' : ''}" title="${favLabel}" aria-label="${favLabel}" aria-pressed="${isFav}">${isFav ? CARD_ICONS.tileStarFilled : CARD_ICONS.tileStar}</button>
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame="${escapeHtml(channelKey(ch))}" data-frame-state="waiting">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img is-hidden" alt="" decoding="async">
                    <span class="channel-tile__frame-waiting" aria-hidden="true">${CARD_ICONS.waiting}</span>
                    <span class="channel-tile__frame-loading is-hidden" aria-hidden="true">${CARD_ICONS.loading}</span>
                    <span class="channel-tile__offline-badge is-hidden" aria-hidden="true">${CARD_ICONS.disconnect}</span>
                </div>
            </div>
            <div class="channel-tile__body">
                <h3 class="channel-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(ch.name || 'Unknown')}</span></span></h3>
                <span class="channel-tile__flag">${countryFlagEmoji(ch.countrycode)}</span>
            </div>
        </div>
    `;
}

function syncTileFavBtn(btn, isFav) {
    if (!btn) return;
    btn.classList.toggle('is-active', isFav);
    btn.innerHTML = isFav ? CARD_ICONS.tileStarFilled : CARD_ICONS.tileStar;
    const label = isFav ? 'Remove from favorites' : 'Add to favorites';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(isFav));
}

function syncControlFavBtn() {
    const favBtn = el('fav-btn');
    if (!favBtn) return;
    const ch = TvPlayer.channel;
    const isFav = ch ? TvPlayer.isFavorite(ch) : false;
    favBtn.classList.toggle('is-active', isFav);
    favBtn.textContent = isFav ? '★' : '☆';
    favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
}

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
            url_resolved: '',
            categories: [],
            at: Number.isFinite(e.at) ? e.at : 0
        };
    });
}

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
            url_resolved: '',
            categories: [],
            at: 0
        };
    });
}

function matchesFilter(ch, q) {
    if (!q) return true;
    const name = (ch?.name || '').toLowerCase();
    const id = (ch?.channelId || '').toLowerCase();
    if (name.includes(q) || id.includes(q)) return true;
    return matchesCategoryFilter(ch, q);
}

function mergeRecentAt(channels, metaEntries) {
    const atByKey = new Map((metaEntries || []).map((e) => [e.key, e.at || 0]));
    return (channels || []).map((ch) => {
        const key = channelKey(ch);
        const at = atByKey.get(key);
        return at != null ? { ...ch, at } : ch;
    });
}

function syncFavoritesReorder(enabled) {
    const grid = el('favorites-grid');
    if (!grid) return;
    grid.classList.toggle('is-sort-locked', !enabled);
}

function wireTiles(container, channels) {
    if (!container) return;
    container.querySelectorAll('.channel-tile').forEach(tile => {
        if (wiredTiles.has(tile)) return;
        wiredTiles.add(tile);
        const key = tile.dataset.channel;
        const ch = channels.find(c => channelKey(c) === key);
        const play = () => {
            if (ch) deps.onPlay(ch);
        };
        tile.addEventListener('click', play);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
        });
        const favBtn = tile.querySelector('.channel-tile__fav-btn');
        if (favBtn && ch) {
            favBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ChannelGrid.toggleFavorite(ch);
            });
            favBtn.addEventListener('keydown', (e) => e.stopPropagation());
        }
    });
}

function renderTabGrid(tab) {
    const appState = deps.appState;
    const isFav = tab === 'favorites';
    const grid = el(isFav ? 'favorites-grid' : 'recents-grid');
    const empty = el(isFav ? 'favorites-empty' : 'recents-empty');
    if (!grid || !empty) return;
    const source = isFav ? appState.favoritesList : appState.recentsList;
    if (!source || source.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        syncFavoritesReorder(false);
        return;
    }
    empty.classList.add('is-hidden');
    const filter = isFav ? appState.favFilter : appState.recentsFilter;
    const { sortBy, sortDir } = getSortPrefs(appState);
    const categoryId = isFav
        ? (appState.categoryFilter?.favorites || '')
        : (appState.categoryFilter?.recents || '');
    let list = source.filter(ch => matchesFilter(ch, filter) && channelHasCategory(ch, categoryId));
    list = sortChannelList(list, sortBy, sortDir);
    if (isFav) syncFavoritesReorder(sortBy === 'custom');
    if (!list.length) {
        grid.innerHTML = '<div class="empty-state"><p class="empty-state__text">No channels match</p></div>';
        return;
    }
    ChannelGrid.render(grid, list);
}

export const ChannelGrid = {
    init({ appState, getRefreshKey, onPlay }) {
        deps = { appState, getRefreshKey, onPlay };
        FavoritesReorder.init({
            getAppState: () => deps.appState,
            isReorderEnabled: () => getSortPrefs(deps.appState).sortBy === 'custom',
            onReordered: () => ChannelGrid.renderFavorites()
        });
    },

    render(container, channels, { append = false } = {}) {
        if (!container) return;
        const html = channels.map(ch => tileHtml(ch)).join('');
        if (append && container.querySelector('.channel-tile')) {
            container.insertAdjacentHTML('beforeend', html);
        } else {
            container.innerHTML = html;
        }
        wireTiles(container, channels);
        TileFrames.observe(container, { viewKey: deps.getRefreshKey?.() || null });
        Appearance.applyToTiles(container);
    },

    syncFavButtons() {
        document.querySelectorAll('.channel-tile__fav-btn').forEach((btn) => {
            const key = btn.closest('.channel-tile')?.dataset.channel;
            if (!key) return;
            syncTileFavBtn(btn, TvPlayer.isFavorite(key));
        });
        syncControlFavBtn();
    },

    /** Shared fav toggle for tile stars and the control-bar ★. */
    toggleFavorite(ch) {
        if (!ch) {
            showAppToast('No channel playing');
            return false;
        }
        const isFav = TvPlayer.toggleFavorite(ch);
        this.syncFavButtons();
        showAppToast(isFav ? '❤️ Added to favorites' : '💔 Removed from favorites');
        if (deps.appState?.activeTab === 'favorites') this.refreshFavorites();
        return isFav;
    },

    async refreshFavorites(forceRefresh = false) {
        const appState = deps.appState;
        const grid = el('favorites-grid');
        const empty = el('favorites-empty');
        if (!grid || !empty) return;
        const favorites = TvPlayer.getFavorites();
        if (!favorites || favorites.length === 0) {
            appState.favoritesList = [];
            grid.innerHTML = '';
            empty.classList.remove('is-hidden');
            syncFavoritesReorder(false);
            return;
        }
        empty.classList.add('is-hidden');

        const favMeta = TvPlayer.getFavoritesMeta();
        appState.favoritesList = favMeta.length
            ? metaChannels(favMeta)
            : skeletonChannels(favorites);
        this.renderFavorites();

        try {
            const channels = await TvProviderRegistry.getChannelsByRefs(favorites, { refresh: forceRefresh });
            if (channels.length) {
                appState.favoritesList = channels;
                setCategoryNameMap(TvProviderRegistry.getCategoryNameMap());
                ListSort.syncCategoryFilterControls();
                this.renderFavorites();
            }
        } catch (err) {
            console.error('Failed to hydrate favorites:', err);
        }
    },

    async refreshRecents(forceRefresh = false) {
        const appState = deps.appState;
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

        appState.recentsList = metaChannels(recents);
        this.renderRecents();

        try {
            const channels = await TvProviderRegistry.getChannelsByRefs(recents.map(r => r.key), { refresh: forceRefresh });
            if (channels.length) {
                appState.recentsList = mergeRecentAt(channels, recents);
                setCategoryNameMap(TvProviderRegistry.getCategoryNameMap());
                ListSort.syncCategoryFilterControls();
                this.renderRecents();
            }
        } catch (err) {
            console.error('Failed to hydrate recents:', err);
        }
    },

    renderFavorites() { renderTabGrid('favorites'); },
    renderRecents() { renderTabGrid('recents'); }
};
