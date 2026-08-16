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
import { MultiView, MAX_MOSAIC_SLOTS } from './multiView.js';
import { TvClock } from './ui/tvClock.js';
import { ChannelPickerModal } from './ui/channelPickerModal.js';

import { ACTION_ICONS } from './ui/icons.js';
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
    try { TvPlayer.mountVideo(); } catch { /* ignore */ }
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
        back.addEventListener('click', () => BrowseView.showCountriesView());
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
            closePopups();
            filterInput?.classList.toggle('is-visible');
        });
    }

    if (categoryBtn) {
        categoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePopups();
            categorySelect?.classList.toggle('is-visible');
        });
    }

    if (sortBtn) {
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePopups();
            sortSelect?.classList.toggle('is-visible');
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
            if (tabName === 'refresh') {
                handleManualRefresh();
                return;
            }
            if (tabName === 'back-to-countries') {
                BrowseView.showCountriesView();
                return;
            }
            if (tabName === appState.activeTab) return;
            withCatalogViewTransition(() => switchTab(tabName));
        });
    });
}

/** Shared API so the content splitter can expand/collapse via drag. */
const CatalogCollapse = {
    busy: false,
    setCollapsed: async () => {}
};

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
    if (screenWipeBusy || CatalogCollapse.busy) return false;
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

function catalogCollapsedMinHeight(catalog) {
    const toggle = catalog.querySelector('.tv-catalog__toggle');
    const gap = 8;
    if (toggle) return Math.ceil(toggle.getBoundingClientRect().height + gap * 2);
    return 44;
}

function bindCatalogToggle() {
    const catalog = el('tv-catalog');
    const btn = el('catalog-toggle-btn');
    const clip = catalog?.querySelector('.tv-catalog__clip');
    const body = catalog?.querySelector('.tv-catalog__body');
    if (!catalog || !btn || !clip || !body) return;

    let animating = false;
    let activeAnims = [];

    const syncToggle = () => {
        const collapsed = catalog.classList.contains('is-collapsed');
        btn.innerHTML = collapsed ? ACTION_ICONS.expand : ACTION_ICONS.collapse;
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.title = collapsed ? 'Expand catalog' : 'Collapse catalog';
        btn.setAttribute('aria-label', btn.title);
    };

    const applyTransitionAttr = (mode) => {
        catalog.dataset.catalogTransition = mode;
    };

    const clearMotionStyles = () => {
        catalog.style.height = '';
        catalog.style.overflow = '';
        body.style.opacity = '';
        body.style.transform = '';
        catalog.classList.remove('is-animating');
    };

    const settle = (collapsed) => {
        activeAnims.forEach((a) => {
            try {
                if (typeof a.commitStyles === 'function') a.commitStyles();
                a.cancel();
            } catch { /* ignore */ }
        });
        activeAnims = [];
        clearMotionStyles();
        catalog.classList.toggle('is-collapsed', collapsed);
        SettingsStore.setCatalogCollapsed(collapsed);
        syncToggle();
        animating = false;
    };

    const bodyKeyframes = (mode, collapsing) => {
        if (mode === 'fade' || mode === 'crossfade') {
            return collapsing
                ? [{ opacity: 1 }, { opacity: 0 }]
                : [{ opacity: 0 }, { opacity: 1 }];
        }
        if (mode === 'slide') {
            return collapsing
                ? [
                    { opacity: 1, transform: 'translateY(0)' },
                    { opacity: 0, transform: 'translateY(-32px)' }
                ]
                : [
                    { opacity: 0, transform: 'translateY(-32px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ];
        }
        if (mode === 'spring' || mode === 'smooth') {
            return collapsing
                ? [
                    { opacity: 1, transform: 'translateY(0) scale(1)' },
                    { opacity: 0.4, transform: 'translateY(-12px) scale(0.97)', offset: 0.5 },
                    { opacity: 0, transform: 'translateY(-8px) scale(0.93)' }
                ]
                : [
                    { opacity: 0, transform: 'translateY(-8px) scale(0.93)' },
                    { opacity: 1, transform: 'translateY(0) scale(1.03)', offset: 0.72 },
                    { opacity: 1, transform: 'translateY(0) scale(1)' }
                ];
        }
        if (mode === 'flip') {
            return collapsing
                ? [
                    { opacity: 1, transform: 'rotateX(0deg)' },
                    { opacity: 0, transform: 'rotateX(75deg)' }
                ]
                : [
                    { opacity: 0, transform: 'rotateX(-75deg)' },
                    { opacity: 1, transform: 'rotateX(0deg)' }
                ];
        }
        return null;
    };

    const runHeightMotion = async (collapsed, { forceInstant = false } = {}) => {
        if (animating) return;
        const pref = SettingsStore.getCatalogTransition();
        const mode = forceInstant ? 'instant' : resolveViewTransition(pref, 'catalog');
        applyTransitionAttr(forceInstant ? 'instant' : mode);
        const cfg = forceInstant ? VIEW_MOTION.instant : (VIEW_MOTION[mode] || VIEW_MOTION.instant);
        const reduce = prefersReducedCatalogMotion();

        if (cfg.duration <= 0 || reduce || typeof catalog.animate !== 'function') {
            settle(collapsed);
            applyTransitionAttr(pref);
            return;
        }

        animating = true;

        // Full-screen fade out → swap layout → fade in.
        if (mode === 'dissolve' || mode === 'grain') {
            screenWipeBusy = true;
            try {
                await runWipeTransition(mode, () => {
                    clearMotionStyles();
                    catalog.classList.toggle('is-collapsed', collapsed);
                    SettingsStore.setCatalogCollapsed(collapsed);
                    syncToggle();
                }, { scope: 'full' });
            } finally {
                screenWipeBusy = false;
                activeAnims = [];
                animating = false;
                applyTransitionAttr(pref);
            }
            return;
        }

        const minH = catalogCollapsedMinHeight(catalog);
        const opts = { duration: cfg.duration, easing: cfg.easing, fill: 'forwards' };

        let fromH;
        let toH;

        if (collapsed) {
            fromH = catalog.getBoundingClientRect().height;
            toH = minH;
            catalog.classList.add('is-animating');
            catalog.style.height = `${fromH}px`;
            catalog.style.overflow = 'hidden';
        } else {
            // Measure expanded height in the same turn (before paint), then pin to minH.
            catalog.classList.remove('is-collapsed');
            fromH = minH;
            toH = catalog.getBoundingClientRect().height;
            catalog.classList.add('is-animating');
            catalog.style.height = `${fromH}px`;
            catalog.style.overflow = 'hidden';
        }
        void catalog.offsetHeight;

        const heightAnim = catalog.animate(
            [{ height: `${fromH}px` }, { height: `${toH}px` }],
            opts
        );
        activeAnims = [heightAnim];

        const bodyFrames = bodyKeyframes(mode, collapsed);
        if (bodyFrames) {
            activeAnims.push(body.animate(bodyFrames, opts));
        }

        try {
            await Promise.all(activeAnims.map((a) => a.finished));
        } catch {
            applyTransitionAttr(pref);
            return;
        }
        settle(collapsed);
        applyTransitionAttr(pref);
    };

    // Restore collapsed state without animating on first paint.
    applyTransitionAttr('instant');
    catalog.classList.toggle('is-collapsed', SettingsStore.getCatalogCollapsed());
    syncToggle();
    requestAnimationFrame(() => {
        applyTransitionAttr(SettingsStore.getCatalogTransition());
    });

    btn.addEventListener('click', () => {
        if (animating) return;
        runHeightMotion(!catalog.classList.contains('is-collapsed'));
    });

    CatalogCollapse.isCollapsed = () => catalog.classList.contains('is-collapsed');
    Object.defineProperty(CatalogCollapse, 'busy', {
        get: () => animating || screenWipeBusy,
        configurable: true
    });
    CatalogCollapse.setCollapsed = (collapsed, opts) => runHeightMotion(Boolean(collapsed), opts);

    const select = el('catalog-transition-select');
    if (select && select.dataset.bound !== '1') {
        select.dataset.bound = '1';
        fillViewTransitionSelect(select, SettingsStore.getCatalogTransition());
        select.addEventListener('change', () => {
            const next = SettingsStore.setCatalogTransition(select.value);
            select.value = next;
            applyTransitionAttr(next);
            showAppToast(`View transition: ${next.charAt(0).toUpperCase()}${next.slice(1)}`);
        });
    }
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

const CONTENT_SPLIT_MIN = 15;
const CONTENT_SPLIT_MAX = 85;
const CONTENT_SPLIT_STEP = 2;
/** Drag past this raw player-% to snap the catalog closed. */
const CONTENT_SPLIT_COLLAPSE_AT = 92;
/** Pointer movement (px) before a press counts as a drag instead of a click. */
const CONTENT_SPLIT_CLICK_SLOP = 5;

function bindContentSplitter() {
    const content = document.querySelector ? document.querySelector('.tv-content') : null;
    const splitter = el('content-splitter');
    if (!content || !splitter || splitter.dataset.bound === '1') return;
    splitter.dataset.bound = '1';

    const clampShare = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return 50;
        return Math.min(CONTENT_SPLIT_MAX, Math.max(CONTENT_SPLIT_MIN, Math.round(n)));
    };

    const rawShareFromClientY = (clientY) => {
        const rect = content.getBoundingClientRect();
        if (rect.height <= 0) return SettingsStore.getContentSplit();
        const y = clientY - rect.top;
        return (y / rect.height) * 100;
    };

    const applyShare = (value, { persist = false } = {}) => {
        const share = clampShare(value);
        content.style.setProperty('--tv-player-share', String(share));
        splitter.setAttribute('aria-valuenow', String(share));
        if (persist) SettingsStore.setContentSplit(share);
        if (MultiView.hasCustomPlacement?.()) {
            requestAnimationFrame(() => MultiView.applyFreeLayout());
        }
        return share;
    };

    const expandToSaved = ({ forceInstant = false } = {}) => {
        applyShare(SettingsStore.getContentSplit());
        return CatalogCollapse.setCollapsed?.(false, { forceInstant });
    };

    const collapseCatalog = ({ forceInstant = false } = {}) => {
        // Keep the last saved split so expand can restore it.
        return CatalogCollapse.setCollapsed?.(true, { forceInstant });
    };

    applyShare(SettingsStore.getContentSplit());

    let dragPointerId = null;
    let dragRaf = 0;
    let dragCollapsed = false;
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startedCollapsed = false;
    /** After opening from collapsed, require leaving the snap zone before re-collapse. */
    let collapseArmed = true;

    const endDrag = (e) => {
        if (dragPointerId == null || e.pointerId !== dragPointerId) return;
        const wasDrag = dragActive;
        dragPointerId = null;
        content.classList.remove('is-splitting');
        try {
            splitter.releasePointerCapture(e.pointerId);
        } catch {
            /* already released */
        }
        if (dragRaf) {
            cancelAnimationFrame(dragRaf);
            dragRaf = 0;
        }

        // Click (no meaningful move): toggle expand/collapse to last saved split.
        if (!wasDrag) {
            dragCollapsed = false;
            if (CatalogCollapse.isCollapsed?.()) {
                expandToSaved();
            } else {
                collapseCatalog();
            }
            return;
        }

        if (dragCollapsed || CatalogCollapse.isCollapsed?.()) {
            dragCollapsed = false;
            return;
        }
        const raw = rawShareFromClientY(e.clientY);
        if (collapseArmed && raw >= CONTENT_SPLIT_COLLAPSE_AT) {
            collapseCatalog();
            return;
        }
        applyShare(raw, { persist: true });
    };

    splitter.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (CatalogCollapse.busy) return;
        e.preventDefault();
        dragPointerId = e.pointerId;
        dragCollapsed = false;
        dragActive = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        startedCollapsed = Boolean(CatalogCollapse.isCollapsed?.());
        // Collapsed grabs start past the snap zone; arm only after the pointer leaves it.
        collapseArmed = !startedCollapsed;
        content.classList.add('is-splitting');
        splitter.setPointerCapture(e.pointerId);
    });

    splitter.addEventListener('pointermove', (e) => {
        if (dragPointerId == null || e.pointerId !== dragPointerId) return;
        if (dragCollapsed) return;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (!dragActive) {
            if ((dx * dx) + (dy * dy) < CONTENT_SPLIT_CLICK_SLOP * CONTENT_SPLIT_CLICK_SLOP) {
                return;
            }
            dragActive = true;

            if (startedCollapsed) {
                // Open under the pointer without bouncing back into collapse.
                CatalogCollapse.setCollapsed?.(false, { forceInstant: true });
                const raw = rawShareFromClientY(e.clientY);
                if (raw >= CONTENT_SPLIT_COLLAPSE_AT) {
                    applyShare(CONTENT_SPLIT_MAX);
                    collapseArmed = false;
                } else {
                    applyShare(raw);
                    collapseArmed = true;
                }
                return;
            }
        }

        if (CatalogCollapse.isCollapsed?.()) return;

        const y = e.clientY;
        if (dragRaf) cancelAnimationFrame(dragRaf);
        dragRaf = requestAnimationFrame(() => {
            dragRaf = 0;
            if (dragPointerId == null || dragCollapsed) return;
            const raw = rawShareFromClientY(y);
            if (raw < CONTENT_SPLIT_COLLAPSE_AT) collapseArmed = true;
            if (collapseArmed && raw >= CONTENT_SPLIT_COLLAPSE_AT) {
                dragCollapsed = true;
                collapseCatalog({ forceInstant: true });
                content.classList.remove('is-splitting');
                return;
            }
            applyShare(raw >= CONTENT_SPLIT_COLLAPSE_AT ? CONTENT_SPLIT_MAX : raw);
        });
    });

    splitter.addEventListener('pointerup', endDrag);
    splitter.addEventListener('pointercancel', endDrag);

    splitter.addEventListener('keydown', (e) => {
        if (CatalogCollapse.busy) return;

        if (CatalogCollapse.isCollapsed?.()) {
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (e.key === 'Home') {
                    CatalogCollapse.setCollapsed?.(false, { forceInstant: true });
                    applyShare(CONTENT_SPLIT_MIN, { persist: true });
                } else {
                    expandToSaved({ forceInstant: true });
                }
            }
            return;
        }

        let delta = 0;
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -CONTENT_SPLIT_STEP;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = CONTENT_SPLIT_STEP;
        else if (e.key === 'Home') {
            e.preventDefault();
            applyShare(CONTENT_SPLIT_MIN, { persist: true });
            return;
        } else if (e.key === 'End' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            collapseCatalog({ forceInstant: true });
            return;
        } else {
            return;
        }
        e.preventDefault();
        const current = Number(splitter.getAttribute('aria-valuenow')) || SettingsStore.getContentSplit();
        const next = current + delta;
        if (next > CONTENT_SPLIT_MAX) {
            collapseCatalog({ forceInstant: true });
            return;
        }
        applyShare(next, { persist: true });
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
        Appearance.updateStorageStats();
    }
    syncPlayFavoritesMosaicBtn();
    syncCatalogLayoutBtn();
    updateRefreshAge();
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
        showAppToast('Loading theme…');
        primeBootScreen();
        Appearance.applyStyles();

        showAppToast('Preparing screens…');
        ChannelGrid.init({
            appState,
            getRefreshKey: currentRefreshKey,
            onPlay: startPlayback
        });
        ChannelPickerModal.init({
            getDefaultOnPlay: () => startPlayback
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

        bindTabs();
        bindCatalogToggle();
        bindPlayFavoritesMosaic();
        bindCatalogLayout();
        syncPlayFavoritesMosaicBtn();
        syncCatalogLayoutBtn();
        bindContentSplitter();
        TvClock.init();

        PlayerChrome.bindControls();
        PlayerChrome.bindSettings();
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
        showAppToast('Restoring screens…');
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
        ChannelPickerModal.restoreOpenIfNeeded();

        showAppToast('Ready');
        await reveal();

        await countriesPromise;
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
