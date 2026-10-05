/** Bind scope picker for chan up/down — per TV slot; remote, catalog, tile rockers. */
import { el, escapeHtml, countryFlagEmoji } from '../tvUtils.js';
import { TvPlayer } from '../tvPlayer.js';
import { MultiView } from '../multiView.js';
import { ChannelGrid } from './channelGrid.js';
import { CHAN_BIND_SVG } from './tileHoverControls.js';
import { SLOT_SCREEN_LABELS } from '../mosaic/constants.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { buildCountryChannelIndex } from '../channelNav.js';

const BIND_ICON = CHAN_BIND_SVG;

/** @type {Map<string, { menu: HTMLElement, btn: HTMLElement }>} */
const openMenus = new Map();

/** @type {Array<{ iso_3166_1: string, name: string, stationcount?: number }>|null} */
let countriesCache = null;
/** @type {Promise<Array>|null} */
let countriesLoadPromise = null;
/** @type {Map<string, string>} */
const countryNameByCode = new Map();

async function loadCountries() {
    if (countriesCache) return countriesCache;
    if (countriesLoadPromise) return countriesLoadPromise;
    countriesLoadPromise = TvProviderRegistry.getCountries()
        .then((list) => {
            countriesCache = Array.isArray(list) ? list : [];
            countryNameByCode.clear();
            for (const c of countriesCache) {
                const code = String(c?.iso_3166_1 || '').toUpperCase();
                if (code) countryNameByCode.set(code, c.name || code);
            }
            return countriesCache;
        })
        .catch(() => {
            countriesCache = [];
            return countriesCache;
        })
        .finally(() => {
            countriesLoadPromise = null;
        });
    return countriesLoadPromise;
}

function isTileBindMenu(menuEl) {
    return Boolean(menuEl?.classList?.contains('tv-player-tile__chan-bind-menu'));
}

function scopeLabel(scope) {
    if (scope.mode === 'folder') {
        const folder = TvPlayer.getFavoriteFolder(scope.folderId);
        return folder?.name || 'Folder';
    }
    if (scope.mode === 'country') {
        const code = String(scope.countryCode || '').toUpperCase();
        return countryNameByCode.get(code) || code || 'Country';
    }
    return 'All favorites';
}

function isScopeActive(scope, current) {
    if (scope.mode !== current.mode) return false;
    if (scope.mode === 'folder') return scope.folderId === current.folderId;
    if (scope.mode === 'country') return scope.countryCode === current.countryCode;
    return true;
}

function menuKey(menuEl) {
    if (!menuEl) return '';
    if (menuEl.id) return menuEl.id;
    const tile = menuEl.closest('.tv-player-tile');
    const slot = tile?.getAttribute('data-slot') || 'tile';
    return `tile-bind:${slot}`;
}

function resolveSlotForMenu(menuEl) {
    const tile = menuEl?.closest('.tv-player-tile');
    if (tile) return tile.getAttribute('data-slot') || 'center';
    return MultiView.statusSlotId || 'center';
}

function syncBindButton(btn, slotId) {
    if (!btn) return;
    const scope = TvPlayer.getChanBindScope(slotId);
    const label = scopeLabel(scope);
    const title = `Bind channels (TV ${slotLabel(slotId)}): ${label}`;
    const folderBound = scope.mode === 'folder';
    const countryBound = scope.mode === 'country';

    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(folderBound || countryBound));
    btn.classList.toggle('is-bound-folder', folderBound);
    btn.classList.toggle('is-bound-country', countryBound);
}

function slotLabel(slotId) {
    return SLOT_SCREEN_LABELS[slotId] || '1';
}

function renderFavoritesOptions(current) {
    const folders = TvPlayer.getFavoriteFolders();
    const options = [{ mode: 'favorites', label: 'All favorites' }];
    folders.forEach((folder) => {
        options.push({ mode: 'folder', folderId: folder.id, label: folder.name || 'Folder' });
    });

    return options.map((opt) => {
        const active = isScopeActive(opt, current);
        const dataAttr = opt.mode === 'folder'
            ? `data-chan-bind-folder="${escapeHtml(opt.folderId)}"`
            : 'data-chan-bind-favorites="1"';
        return `<button type="button" class="chan-bind-menu__item${active ? ' is-active' : ''}" role="menuitem"${active ? ' aria-current="true"' : ''} ${dataAttr}>${escapeHtml(opt.label)}</button>`;
    }).join('');
}

function renderCountryNavItem(current) {
    const countryBound = current.mode === 'country';
    const code = countryBound ? String(current.countryCode || '').toUpperCase() : '';
    const detail = countryBound
        ? (countryNameByCode.get(code) || code)
        : '';
    const label = detail
        ? `Countries · ${escapeHtml(detail)}`
        : 'Countries';
    return `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--nav${countryBound ? ' is-active' : ''}" role="menuitem"${countryBound ? ' aria-current="true"' : ''} data-chan-bind-countries-nav="1"><span class="chan-bind-menu__nav-label">${label}</span><span class="chan-bind-menu__chevron" aria-hidden="true">›</span></button>`;
}

function renderCountryOptionsHtml(countries, current) {
    if (!countries.length) {
        return '<div class="chan-bind-menu__empty">No countries</div>';
    }
    return countries.map((c) => {
        const code = String(c.iso_3166_1 || '').toUpperCase();
        if (!code) return '';
        const opt = { mode: 'country', countryCode: code };
        const active = isScopeActive(opt, current);
        const flag = countryFlagEmoji(code);
        const count = Number(c.stationcount) || 0;
        const name = c.name || code;
        return `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--country${active ? ' is-active' : ''}" role="menuitem"${active ? ' aria-current="true"' : ''} data-chan-bind-country="${escapeHtml(code)}"><span class="chan-bind-menu__flag" aria-hidden="true">${flag}</span><span class="chan-bind-menu__country-label"><span class="chan-bind-menu__country-name">${escapeHtml(name)}</span><span class="chan-bind-menu__country-count">${count}</span></span></button>`;
    }).join('');
}

function renderRootPanel(menuEl, slotId) {
    const current = TvPlayer.getChanBindScope(slotId);
    menuEl.dataset.chanBindPanel = 'root';
    const favHtml = renderFavoritesOptions(current);
    if (!isTileBindMenu(menuEl)) {
        menuEl.innerHTML = favHtml;
        return;
    }
    menuEl.innerHTML = `${favHtml}${renderCountryNavItem(current)}`;
}

function renderCountriesPanel(menuEl, slotId) {
    const current = TvPlayer.getChanBindScope(slotId);
    menuEl.dataset.chanBindPanel = 'countries';
    const back = `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--back" role="menuitem" data-chan-bind-back="1"><span class="chan-bind-menu__chevron" aria-hidden="true">‹</span><span class="chan-bind-menu__nav-label">Countries</span></button>`;
    if (!countriesCache) {
        menuEl.innerHTML = `${back}<div class="chan-bind-menu__empty">Loading countries…</div>`;
        const gen = String(Date.now());
        menuEl.dataset.countriesGen = gen;
        loadCountries().then(() => {
            if (menuEl.dataset.countriesGen !== gen || menuEl.hidden) return;
            if (menuEl.dataset.chanBindPanel !== 'countries') return;
            renderCountriesPanel(menuEl, slotId);
            syncBindButtons();
        });
        return;
    }
    menuEl.innerHTML = `${back}${renderCountryOptionsHtml(countriesCache, current)}`;
}

function renderMenu(menuEl, slotId) {
    if (!menuEl) return;
    menuEl.dataset.chanBindSlot = slotId;
    renderRootPanel(menuEl, slotId);
}

function closeMenuEntry(menuEl, btnEl) {
    if (menuEl) {
        openMenus.delete(menuKey(menuEl));
        menuEl.hidden = true;
        menuEl.dataset.chanBindPanel = 'root';
    }
    if (btnEl) {
        btnEl.setAttribute('aria-expanded', 'false');
        if (btnEl.getAttribute('aria-pressed') !== 'true') {
            btnEl.classList.remove('is-active');
        }
    }
}

function closeAllMenus() {
    for (const { menu, btn } of openMenus.values()) {
        if (menu) menu.hidden = true;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('is-active');
        }
    }
    openMenus.clear();
}

function toggleMenuEl(menuEl, btnEl) {
    if (!menuEl || !btnEl) return;
    const key = menuKey(menuEl);

    if (openMenus.has(key)) {
        closeMenuEntry(menuEl, btnEl);
        return;
    }
    closeAllMenus();
    const slotId = resolveSlotForMenu(menuEl);
    renderMenu(menuEl, slotId);
    menuEl.hidden = false;
    openMenus.set(key, { menu: menuEl, btn: btnEl });
    btnEl.setAttribute('aria-expanded', 'true');
    btnEl.classList.add('is-active');
}

function toggleMenu(menuId, btnId) {
    toggleMenuEl(el(menuId), el(btnId));
}

async function selectScope(scope, slotId) {
    TvPlayer.setChanBindScope(slotId, scope);
    if (scope?.mode === 'country' && scope.countryCode) {
        void buildCountryChannelIndex(scope.countryCode).then(() => {
            MultiView.scheduleRefreshTiles?.();
        });
    }
    closeAllMenus();
    syncBindButtons();
    ChannelGrid.refreshFavorites();
}

function wireMenu(menuEl) {
    if (!menuEl || menuEl.dataset.bound === '1') return;
    menuEl.dataset.bound = '1';
    menuEl.addEventListener('click', (e) => {
        const item = e.target.closest(
            '[data-chan-bind-favorites], [data-chan-bind-folder], [data-chan-bind-country], [data-chan-bind-countries-nav], [data-chan-bind-back]'
        );
        if (!item) return;
        e.stopPropagation();
        const slotId = menuEl.dataset.chanBindSlot || resolveSlotForMenu(menuEl);
        if (item.hasAttribute('data-chan-bind-back')) {
            renderRootPanel(menuEl, slotId);
            return;
        }
        if (item.hasAttribute('data-chan-bind-countries-nav')) {
            renderCountriesPanel(menuEl, slotId);
            return;
        }
        if (item.hasAttribute('data-chan-bind-favorites')) {
            void selectScope({ mode: 'favorites' }, slotId);
            return;
        }
        const folderId = item.getAttribute('data-chan-bind-folder');
        if (folderId) {
            void selectScope({ mode: 'folder', folderId }, slotId);
            return;
        }
        const countryCode = item.getAttribute('data-chan-bind-country');
        if (countryCode) {
            void selectScope({ mode: 'country', countryCode }, slotId);
        }
    });
}

function wireTileBindMenus() {
    document.querySelectorAll('.tv-player-tile__chan-bind-menu').forEach(wireMenu);
}

export function toggleTileBindMenu(btnEl) {
    const wrap = btnEl?.closest('.tv-player-tile__chan-bind-wrap');
    const menu = wrap?.querySelector('.tv-player-tile__chan-bind-menu');
    if (menu) toggleMenuEl(menu, btnEl);
}

export function syncBindButtons() {
    const focusedSlot = MultiView.statusSlotId || 'center';
    syncBindButton(el('remote-chan-bind-btn'), focusedSlot);

    const catalogBtn = el('catalog-chan-bind-btn');
    syncBindButton(catalogBtn, focusedSlot);
    if (catalogBtn) catalogBtn.innerHTML = BIND_ICON;

    document.querySelectorAll('[data-tile-chan-bind-btn]').forEach((btn) => {
        const slotId = btn.closest('.tv-player-tile')?.getAttribute('data-slot') || 'center';
        syncBindButton(btn, slotId);
    });
}

export function syncCatalogBindVisibility(isFavoritesTab) {
    const catalogBtn = el('catalog-chan-bind-btn');
    const catalogPopup = el('catalog-chan-bind-popup');
    if (catalogBtn) catalogBtn.classList.toggle('is-hidden', !isFavoritesTab);
    if (catalogPopup) catalogPopup.classList.toggle('is-hidden', !isFavoritesTab);
}

export const ChanBindPicker = {
    bind() {
        if (typeof document === 'undefined') return;

        const remoteBtn = el('remote-chan-bind-btn');
        const catalogBtn = el('catalog-chan-bind-btn');
        wireMenu(el('remote-chan-bind-menu'));
        wireMenu(el('catalog-chan-bind-menu'));
        wireTileBindMenus();

        if (remoteBtn && remoteBtn.dataset.bound !== '1') {
            remoteBtn.dataset.bound = '1';
            remoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu('remote-chan-bind-menu', 'remote-chan-bind-btn');
            });
        }

        if (catalogBtn && catalogBtn.dataset.bound !== '1') {
            catalogBtn.dataset.bound = '1';
            catalogBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu('catalog-chan-bind-menu', 'catalog-chan-bind-btn');
            });
        }

        const mosaic = document.getElementById('player-mosaic');
        if (mosaic && mosaic.dataset.chanBindBound !== '1') {
            mosaic.dataset.chanBindBound = '1';
            mosaic.addEventListener('click', (e) => {
                const btn = e.target.closest?.('[data-tile-chan-bind-btn]');
                if (!btn) return;
                e.stopPropagation();
                e.preventDefault();
                toggleTileBindMenu(btn);
            });
        }

        if (!window.__chanBindDocBound) {
            window.__chanBindDocBound = true;
            document.addEventListener('click', () => closeAllMenus());
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                // Countries submenu → back to root; otherwise close.
                for (const { menu, btn } of openMenus.values()) {
                    if (menu?.dataset?.chanBindPanel === 'countries') {
                        const slotId = menu.dataset.chanBindSlot || resolveSlotForMenu(menu);
                        renderRootPanel(menu, slotId);
                        e.stopPropagation();
                        return;
                    }
                    closeMenuEntry(menu, btn);
                }
                openMenus.clear();
            });
        }

        // Warm country names for bind-button titles when a country is already bound.
        void loadCountries().then(() => syncBindButtons());
        syncBindButtons();
    },

    wireTileBindMenus,
    toggleTileBindMenu,
    closeAllMenus,
    syncBindButtons,
    syncCatalogBindVisibility
};
