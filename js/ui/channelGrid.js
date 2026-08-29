import { TvPlayer } from '../tvPlayer.js';
import { MultiView } from '../multiView.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';
import { TileFrames } from '../tileFrames.js';
import { Appearance } from './appearance.js';
import { FavoritesReorder } from './favoritesReorder.js';
import { FavoritesFolders } from './favoritesFolders.js';
import { HiddenChannels } from '../storage/hiddenChannels.js';
import { ListSort, getSortPrefs, matchesCategoryFilter, channelHasCategory, sortChannelList, setCategoryNameMap } from './listSort.js';
import { buildChannelIndex } from '../channelNav.js';

const wiredTiles = new WeakSet();

let deps = {
    appState: null,
    getRefreshKey: () => '',
    onPlay: () => {}
};

function tileHtml(ch, opts = {}) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const isFav = TvPlayer.isFavorite(ch);
    const isVisited = TvPlayer.isVisited(ch);
    const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
    const hideLabel = 'Hide channel';
    const refreshLabel = 'Refresh preview';
    const chanNum = Number.isFinite(opts.chanNumber) ? opts.chanNumber : null;
    const chanNumHtml = chanNum != null
        ? `<span class="channel-tile__chan-num" aria-hidden="true">${chanNum}</span>`
        : '';
    return `
        <div class="channel-tile${isVisited ? ' is-visited' : ''}" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}" data-logo="${escapeHtml(ch.logo || '')}">
            ${chanNumHtml}
            <button type="button" class="channel-tile__refresh-btn" title="${refreshLabel}" aria-label="${refreshLabel}">${CARD_ICONS.tileRefresh}</button>
            <button type="button" class="channel-tile__hide-btn" title="${hideLabel}" aria-label="${hideLabel}">${CARD_ICONS.tileEye}</button>
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
    const favBtn = document.querySelector?.('#player-tile-center [data-tile-action="fav"]');
    if (!favBtn) return;
    const ch = TvPlayer.channel;
    const isFav = ch ? TvPlayer.isFavorite(ch) : false;
    favBtn.classList.toggle('is-active', isFav);
    favBtn.innerHTML = isFav ? CARD_ICONS.starFilled : '☆';
    favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
    favBtn.setAttribute('aria-pressed', String(isFav));
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

function filterVisibleChannels(channels) {
    return HiddenChannels.filterVisible(channels);
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
        const hideBtn = tile.querySelector('.channel-tile__hide-btn');
        if (hideBtn && ch) {
            hideBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ChannelGrid.hideChannel(ch);
            });
            hideBtn.addEventListener('keydown', (e) => e.stopPropagation());
        }
        const refreshBtn = tile.querySelector('.channel-tile__refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const frame = tile.querySelector('.channel-tile__capture-frame');
                if (frame) TileFrames.refreshFrame(frame);
            });
            refreshBtn.addEventListener('keydown', (e) => e.stopPropagation());
        }
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

function matchesFolderFilter(folder, q) {
    if (!q) return true;
    return (folder?.name || '').toLowerCase().includes(q);
}

function channelByKey(list, key) {
    return (list || []).find((ch) => channelKey(ch) === key) || null;
}

function sortRootChannelRefs(rootChannelKeys, channels, sortBy, sortDir) {
    if (sortBy === 'custom') return rootChannelKeys;
    const channelsByKey = new Map((channels || []).map((ch) => [channelKey(ch), ch]));
    const sortable = rootChannelKeys
        .map((ref) => channelsByKey.get(ref))
        .filter(Boolean);
    return sortChannelList(sortable, sortBy, sortDir).map((ch) => channelKey(ch));
}

function renderFavoritesRootGrid(appState, grid, empty, filter, sortBy, sortDir, categoryId) {
    const folders = TvPlayer.getFavoriteFolders().filter((folder) => matchesFolderFilter(folder, filter));
    let rootChannelKeys = TvPlayer.getFavoritesRootOrder();
    rootChannelKeys = sortRootChannelRefs(rootChannelKeys, appState.favoritesList, sortBy, sortDir);
    const { numberByKey } = buildChannelIndex(TvPlayer.getChanBindScope(MultiView.statusSlotId || 'center'));

    const parts = folders.map((folder) => ({ type: 'folder', folder }));
    for (const ref of rootChannelKeys) {
        const ch = channelByKey(appState.favoritesList, ref);
        if (ch && matchesFilter(ch, filter) && channelHasCategory(ch, categoryId)) {
            const visible = filterVisibleChannels([ch]);
            if (visible.length) parts.push({ type: 'channel', channel: visible[0] });
        }
    }

    if (!parts.length) {
        grid.innerHTML = '<div class="empty-state"><p class="empty-state__text">No channels match</p></div>';
        syncFavoritesReorder(sortBy === 'custom');
        return;
    }

    const html = parts.map((part) => (
        part.type === 'folder'
            ? FavoritesFolders.folderTileHtml(part.folder)
            : tileHtml(part.channel, { chanNumber: numberByKey.get(channelKey(part.channel)) })
    )).join('');
    grid.innerHTML = html;
    const channels = parts.filter((p) => p.type === 'channel').map((p) => p.channel);
    wireTiles(grid, channels);
    FavoritesFolders.wireFolderTiles(grid);
    TileFrames.observe(grid, { viewKey: deps.getRefreshKey?.() || null });
    Appearance.applyToTiles(grid);
    ChannelGrid.syncPlayingTiles();
    ChannelGrid.syncVisitedTiles();
    syncFavoritesReorder(sortBy === 'custom');
}

function renderFavoritesFolderGrid(appState, grid, empty, folderId, filter, sortBy, sortDir, categoryId) {
    const folder = TvPlayer.getFavoriteFolder(folderId);
    if (!folder) {
        appState.favoritesFolderId = null;
        FavoritesFolders.syncBackButton();
        renderFavoritesRootGrid(appState, grid, empty, filter, sortBy, sortDir, categoryId);
        return;
    }

    let list = folder.items
        .map((key) => channelByKey(appState.favoritesList, key))
        .filter(Boolean)
        .filter((ch) => matchesFilter(ch, filter) && channelHasCategory(ch, categoryId));
    list = filterVisibleChannels(list);
    list = sortChannelList(list, sortBy, sortDir);
    const { numberByKey } = buildChannelIndex(TvPlayer.getChanBindScope(MultiView.statusSlotId || 'center'));

    const parentHtml = FavoritesFolders.folderParentTileHtml();
    if (!list.length) {
        grid.innerHTML = `${parentHtml}<div class="empty-state"><p class="empty-state__text">Folder is empty</p></div>`;
        FavoritesFolders.wireFolderViewTiles(grid);
        syncFavoritesReorder(sortBy === 'custom');
        return;
    }

    grid.innerHTML = parentHtml + list.map((ch) => tileHtml(ch, { chanNumber: numberByKey.get(channelKey(ch)) })).join('');
    wireTiles(grid, list);
    FavoritesFolders.wireFolderViewTiles(grid);
    TileFrames.observe(grid, { viewKey: deps.getRefreshKey?.() || null });
    Appearance.applyToTiles(grid);
    ChannelGrid.syncPlayingTiles();
    ChannelGrid.syncVisitedTiles();
    syncFavoritesReorder(sortBy === 'custom');
}

function renderFavoritesGrid(appState) {
    const grid = el('favorites-grid');
    const empty = el('favorites-empty');
    if (!grid || !empty) return;

    const favorites = TvPlayer.getFavorites();
    const folders = TvPlayer.getFavoriteFolders();
    if ((!favorites || favorites.length === 0) && folders.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        syncFavoritesReorder(false);
        return;
    }
    empty.classList.add('is-hidden');

    const filter = appState.favFilter;
    const { sortBy, sortDir } = getSortPrefs(appState);
    const categoryId = appState.categoryFilter?.favorites || '';

    if (appState.favoritesFolderId) {
        renderFavoritesFolderGrid(
            appState, grid, empty, appState.favoritesFolderId, filter, sortBy, sortDir, categoryId
        );
        return;
    }
    renderFavoritesRootGrid(appState, grid, empty, filter, sortBy, sortDir, categoryId);
}

function renderTabGrid(tab) {
    const appState = deps.appState;
    if (tab === 'favorites') {
        renderFavoritesGrid(appState);
        return;
    }
    const grid = el('recents-grid');
    const empty = el('recents-empty');
    if (!grid || !empty) return;
    const source = appState.recentsList;
    if (!source || source.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }
    empty.classList.add('is-hidden');
    const filter = appState.recentsFilter;
    const { sortBy, sortDir } = getSortPrefs(appState);
    const categoryId = appState.categoryFilter?.recents || '';
    let list = source.filter((ch) => matchesFilter(ch, filter) && channelHasCategory(ch, categoryId));
    list = filterVisibleChannels(list);
    list = sortChannelList(list, sortBy, sortDir);
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
        FavoritesFolders.init({
            getAppState: () => deps.appState,
            onChanged: () => ChannelGrid.renderFavorites()
        });
    },

    setOnPlay(onPlay) {
        deps.onPlay = typeof onPlay === 'function' ? onPlay : () => {};
    },

    render(container, channels, { append = false } = {}) {
        if (!container) return;
        const list = channels || [];
        if (!append && !list.length) {
            container.innerHTML = '<div class="empty-state" role="status"><p class="empty-state__text">No channels</p></div>';
            return;
        }
        const html = list.map(ch => tileHtml(ch)).join('');
        if (append && container.querySelector('.channel-tile')) {
            container.insertAdjacentHTML('beforeend', html);
        } else {
            container.innerHTML = html;
        }
        wireTiles(container, list);
        TileFrames.observe(container, { viewKey: deps.getRefreshKey?.() || null });
        Appearance.applyToTiles(container);
        this.syncPlayingTiles();
        this.syncVisitedTiles();
    },

    /**
     * Move existing tiles into `channels` order without destroying DOM nodes
     * (preserves frame captures). Falls back to render if any tile is missing.
     */
    reorder(container, channels) {
        if (!container) return;
        const list = channels || [];
        if (!list.length) {
            this.render(container, list);
            return;
        }
        const byKey = new Map();
        container.querySelectorAll('.channel-tile').forEach((tile) => {
            const key = tile.dataset.channel;
            if (key) byKey.set(key, tile);
        });
        for (const ch of list) {
            if (!byKey.has(channelKey(ch))) {
                this.render(container, list);
                return;
            }
        }
        const frag = document.createDocumentFragment();
        for (const ch of list) {
            frag.appendChild(byKey.get(channelKey(ch)));
        }
        container.appendChild(frag);
    },

    syncFavButtons() {
        document.querySelectorAll('.channel-tile__fav-btn').forEach((btn) => {
            const key = btn.closest('.channel-tile')?.dataset.channel;
            if (!key) return;
            syncTileFavBtn(btn, TvPlayer.isFavorite(key));
        });
        syncControlFavBtn();
    },

    /** Re-render the active catalog tab after hide/unhide. */
    refreshVisibleCatalog() {
        const appState = deps.appState;
        if (!appState) return;
        if (appState.activeTab === 'favorites') {
            this.renderFavorites();
        } else if (appState.activeTab === 'recents') {
            this.renderRecents();
        } else if (appState.activeTab === 'browse' && appState.browseCountry) {
            const grid = el('channels-container');
            if (grid) {
                const visible = filterVisibleChannels(appState.browseChannels);
                this.render(grid, visible);
            }
        }
    },

    hideChannel(ch) {
        if (!ch) return false;
        const hidden = TvPlayer.hideChannel(ch);
        if (!hidden) return false;
        showAppToast('Channel hidden');
        this.refreshVisibleCatalog();
        return true;
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
        const folders = TvPlayer.getFavoriteFolders();
        if ((!favorites || favorites.length === 0) && folders.length === 0) {
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
    renderRecents() { renderTabGrid('recents'); },

    /** Sync is-playing class on catalog tiles for all playing slots. */
    syncPlayingTiles() {
        if (typeof document === 'undefined') return;
        const playingKeys = new Set();
        const slots = MultiView.slots;
        for (const id of Object.keys(slots)) {
            const slot = slots[id];
            if (slot.enabled && slot.player?.playing === true && slot.player.channel) {
                playingKeys.add(channelKey(slot.player.channel));
            }
        }
        document.querySelectorAll('.channel-tile').forEach((tile) => {
            const key = tile.dataset.channel;
            if (key) tile.classList.toggle('is-playing', playingKeys.has(key));
        });
    },

    /** Sync is-visited class on catalog tiles (single read of the visited set). */
    syncVisitedTiles() {
        if (typeof document === 'undefined') return;
        const visitedKeys = new Set(TvPlayer.getVisitedKeys());
        document.querySelectorAll('.channel-tile').forEach((tile) => {
            const key = tile.dataset.channel;
            if (key) tile.classList.toggle('is-visited', visitedKeys.has(key));
        });
    }
};
