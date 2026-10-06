/** Bind scope picker for radio station up/down — cassette rocker. */
import { el, escapeHtml, countryFlagEmoji } from '../tvUtils.js';
import { CHAN_BIND_SVG } from './tileHoverControls.js';
import {
    getStationBindScope,
    setStationBindScope,
    loadRadioState
} from '../radio/radioState.js';
import { RadioProviderRegistry } from '../radio/radioProviders/registry.js';
import { buildCountryStationIndex } from '../radio/stationNav.js';

const BIND_ICON = CHAN_BIND_SVG;

/** @type {{ menu: HTMLElement, btn: HTMLElement } | null} */
let openMenu = null;

/** @type {Array<{ iso_3166_1: string, name: string, stationcount?: number }>|null} */
let countriesCache = null;
/** @type {Promise<Array>|null} */
let countriesLoadPromise = null;
/** @type {Map<string, string>} */
const countryNameByCode = new Map();

async function loadCountries() {
    if (countriesCache) return countriesCache;
    if (countriesLoadPromise) return countriesLoadPromise;
    countriesLoadPromise = RadioProviderRegistry.getActive().getCountries()
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

function scopeLabel(scope) {
    if (scope.mode === 'folder') {
        const folder = (loadRadioState().favoriteFolders || []).find((f) => f && f.id === scope.folderId);
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

function syncBindButton(btn) {
    if (!btn) return;
    const scope = getStationBindScope();
    const label = scopeLabel(scope);
    const title = `Bind stations: ${label}`;
    const folderBound = scope.mode === 'folder';
    const countryBound = scope.mode === 'country';

    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(folderBound || countryBound));
    btn.classList.toggle('is-bound-folder', folderBound);
    btn.classList.toggle('is-bound-country', countryBound);
    if (!btn.innerHTML.trim()) btn.innerHTML = BIND_ICON;
}

function renderFavoritesOptions(current) {
    const opt = { mode: 'favorites', label: 'All favorites' };
    const active = isScopeActive(opt, current);
    return `<button type="button" class="chan-bind-menu__item${active ? ' is-active' : ''}" role="menuitem"${active ? ' aria-current="true"' : ''} data-station-bind-favorites="1">${escapeHtml(opt.label)}</button>`;
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
    return `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--nav${countryBound ? ' is-active' : ''}" role="menuitem"${countryBound ? ' aria-current="true"' : ''} data-station-bind-countries-nav="1"><span class="chan-bind-menu__nav-label">${label}</span><span class="chan-bind-menu__chevron" aria-hidden="true">›</span></button>`;
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
        return `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--country${active ? ' is-active' : ''}" role="menuitem"${active ? ' aria-current="true"' : ''} data-station-bind-country="${escapeHtml(code)}"><span class="chan-bind-menu__flag" aria-hidden="true">${flag}</span><span class="chan-bind-menu__country-label"><span class="chan-bind-menu__country-name">${escapeHtml(name)}</span><span class="chan-bind-menu__country-count">${count}</span></span></button>`;
    }).join('');
}

function renderRootPanel(menuEl) {
    const current = getStationBindScope();
    menuEl.dataset.stationBindPanel = 'root';
    menuEl.innerHTML = `${renderFavoritesOptions(current)}${renderCountryNavItem(current)}`;
}

function renderCountriesPanel(menuEl) {
    const current = getStationBindScope();
    menuEl.dataset.stationBindPanel = 'countries';
    const back = `<button type="button" class="chan-bind-menu__item chan-bind-menu__item--back" role="menuitem" data-station-bind-back="1"><span class="chan-bind-menu__chevron" aria-hidden="true">‹</span><span class="chan-bind-menu__nav-label">Countries</span></button>`;
    if (!countriesCache) {
        menuEl.innerHTML = `${back}<div class="chan-bind-menu__empty">Loading countries…</div>`;
        const gen = String(Date.now());
        menuEl.dataset.countriesGen = gen;
        loadCountries().then(() => {
            if (menuEl.dataset.countriesGen !== gen || menuEl.hidden) return;
            if (menuEl.dataset.stationBindPanel !== 'countries') return;
            renderCountriesPanel(menuEl);
            syncBindButtons();
        });
        return;
    }
    menuEl.innerHTML = `${back}${renderCountryOptionsHtml(countriesCache, current)}`;
}

function closeMenu() {
    if (!openMenu) return;
    const { menu, btn } = openMenu;
    if (menu) {
        menu.hidden = true;
        menu.dataset.stationBindPanel = 'root';
    }
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        if (btn.getAttribute('aria-pressed') !== 'true') {
            btn.classList.remove('is-active');
        }
    }
    openMenu = null;
}

function toggleMenuEl(menuEl, btnEl) {
    if (!menuEl || !btnEl) return;
    if (openMenu?.menu === menuEl) {
        closeMenu();
        return;
    }
    closeMenu();
    renderRootPanel(menuEl);
    menuEl.hidden = false;
    openMenu = { menu: menuEl, btn: btnEl };
    btnEl.setAttribute('aria-expanded', 'true');
    btnEl.classList.add('is-active');
}

async function selectScope(scope) {
    setStationBindScope(scope);
    if (scope?.mode === 'country' && scope.countryCode) {
        void buildCountryStationIndex(scope.countryCode);
    }
    closeMenu();
    syncBindButtons();
}

function wireMenu(menuEl) {
    if (!menuEl || menuEl.dataset.bound === '1') return;
    menuEl.dataset.bound = '1';
    menuEl.addEventListener('click', (e) => {
        const item = e.target.closest(
            '[data-station-bind-favorites], [data-station-bind-country], [data-station-bind-countries-nav], [data-station-bind-back]'
        );
        if (!item) return;
        e.stopPropagation();
        if (item.hasAttribute('data-station-bind-back')) {
            renderRootPanel(menuEl);
            return;
        }
        if (item.hasAttribute('data-station-bind-countries-nav')) {
            renderCountriesPanel(menuEl);
            return;
        }
        if (item.hasAttribute('data-station-bind-favorites')) {
            void selectScope({ mode: 'favorites' });
            return;
        }
        const countryCode = item.getAttribute('data-station-bind-country');
        if (countryCode) {
            void selectScope({ mode: 'country', countryCode });
        }
    });
}

export function syncBindButtons() {
    syncBindButton(el('radio-station-bind-btn'));
}

export const StationBindPicker = {
    bind() {
        if (typeof document === 'undefined') return;

        const menu = el('radio-station-bind-menu');
        const btn = el('radio-station-bind-btn');
        wireMenu(menu);

        if (btn && btn.dataset.bound !== '1') {
            btn.dataset.bound = '1';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleMenuEl(menu, btn);
            });
        }

        if (!window.__stationBindDocBound) {
            window.__stationBindDocBound = true;
            document.addEventListener('click', () => closeMenu());
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !openMenu) return;
                const { menu: openEl, btn: openBtn } = openMenu;
                if (openEl?.dataset?.stationBindPanel === 'countries') {
                    renderRootPanel(openEl);
                    e.stopPropagation();
                    return;
                }
                closeMenu();
                openBtn?.focus?.();
            });
        }

        void loadCountries().then(() => syncBindButtons());
        syncBindButtons();
    },

    toggle() {
        toggleMenuEl(el('radio-station-bind-menu'), el('radio-station-bind-btn'));
    },

    closeAllMenus: closeMenu,
    syncBindButtons
};
