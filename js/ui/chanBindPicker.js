/** Bind scope picker for chan up/down — per TV slot; remote, catalog, tile rockers. */
import { el, escapeHtml } from '../tvUtils.js';
import { TvPlayer } from '../tvPlayer.js';
import { MultiView } from '../multiView.js';
import { ChannelGrid } from './channelGrid.js';
import { CHAN_BIND_SVG } from './tileHoverControls.js';

const BIND_ICON = CHAN_BIND_SVG;

/** @type {Map<string, { menu: HTMLElement, btn: HTMLElement }>} */
const openMenus = new Map();

function scopeLabel(scope) {
    if (scope.mode === 'folder') {
        const folder = TvPlayer.getFavoriteFolder(scope.folderId);
        return folder?.name || 'Folder';
    }
    return 'All favorites';
}

function isScopeActive(scope, current) {
    if (scope.mode !== current.mode) return false;
    if (scope.mode === 'folder') return scope.folderId === current.folderId;
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

    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(folderBound));
    btn.classList.toggle('is-bound-folder', folderBound);
}

function slotLabel(slotId) {
    const labels = { center: '1', topLeft: '2', topRight: '3', bottomLeft: '4', bottomRight: '5' };
    return labels[slotId] || '1';
}

function renderMenu(menuEl, slotId) {
    if (!menuEl) return;
    menuEl.dataset.chanBindSlot = slotId;
    const current = TvPlayer.getChanBindScope(slotId);
    const folders = TvPlayer.getFavoriteFolders();
    const options = [{ mode: 'favorites', label: 'All favorites' }];
    folders.forEach((folder) => {
        options.push({ mode: 'folder', folderId: folder.id, label: folder.name || 'Folder' });
    });

    menuEl.innerHTML = options.map((opt) => {
        const active = isScopeActive(opt, current);
        const dataAttr = opt.mode === 'folder'
            ? `data-chan-bind-folder="${escapeHtml(opt.folderId)}"`
            : 'data-chan-bind-favorites="1"';
        return `<button type="button" class="chan-bind-menu__item${active ? ' is-active' : ''}" role="menuitem"${active ? ' aria-current="true"' : ''} ${dataAttr}>${escapeHtml(opt.label)}</button>`;
    }).join('');
}

function closeMenuEntry(menuEl, btnEl) {
    if (menuEl) {
        openMenus.delete(menuKey(menuEl));
        menuEl.hidden = true;
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

function selectScope(scope, slotId) {
    TvPlayer.setChanBindScope(slotId, scope);
    closeAllMenus();
    syncBindButtons();
    ChannelGrid.refreshFavorites();
}

function wireMenu(menuEl) {
    if (!menuEl || menuEl.dataset.bound === '1') return;
    menuEl.dataset.bound = '1';
    menuEl.addEventListener('click', (e) => {
        const item = e.target.closest('[data-chan-bind-favorites], [data-chan-bind-folder]');
        if (!item) return;
        e.stopPropagation();
        const slotId = menuEl.dataset.chanBindSlot || resolveSlotForMenu(menuEl);
        if (item.hasAttribute('data-chan-bind-favorites')) {
            selectScope({ mode: 'favorites' }, slotId);
            return;
        }
        const folderId = item.getAttribute('data-chan-bind-folder');
        if (folderId) selectScope({ mode: 'folder', folderId }, slotId);
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
                if (e.key === 'Escape') closeAllMenus();
            });
        }

        syncBindButtons();
    },

    wireTileBindMenus,
    toggleTileBindMenu,
    closeAllMenus,
    syncBindButtons,
    syncCatalogBindVisibility
};
