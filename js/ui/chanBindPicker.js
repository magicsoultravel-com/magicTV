/** Bind scope picker for chan up/down — remote keypad + favorites toolbar. */
import { el, escapeHtml } from '../tvUtils.js';
import { TvPlayer } from '../tvPlayer.js';
import { ChannelGrid } from './channelGrid.js';

const BIND_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M2 3.5h8M2 6h8M2 8.5h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="9.2" cy="8.5" r="1.3" fill="currentColor"/></svg>`;

/** @type {Set<string>} */
const openMenus = new Set();

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

function renderMenu(menuEl) {
    if (!menuEl) return;
    const current = TvPlayer.getChanBindScope();
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

function closeMenu(menuId) {
    openMenus.delete(menuId);
    const menu = el(menuId);
    const btn = menuId === 'remote-chan-bind-menu' ? el('remote-chan-bind-btn') : el('catalog-chan-bind-btn');
    if (menu) menu.hidden = true;
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-active');
    }
}

function closeAllMenus() {
    [...openMenus].forEach(closeMenu);
}

function toggleMenu(menuId, btnId) {
    const menu = el(menuId);
    const btn = el(btnId);
    if (!menu || !btn) return;

    if (openMenus.has(menuId)) {
        closeMenu(menuId);
        return;
    }
    closeAllMenus();
    renderMenu(menu);
    menu.hidden = false;
    openMenus.add(menuId);
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('is-active');
}

function selectScope(scope) {
    TvPlayer.setChanBindScope(scope);
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
        if (item.hasAttribute('data-chan-bind-favorites')) {
            selectScope({ mode: 'favorites' });
            return;
        }
        const folderId = item.getAttribute('data-chan-bind-folder');
        if (folderId) selectScope({ mode: 'folder', folderId });
    });
}

export function syncBindButtons() {
    const scope = TvPlayer.getChanBindScope();
    const label = scopeLabel(scope);
    const title = `Bind channels: ${label}`;

    const remoteBtn = el('remote-chan-bind-btn');
    if (remoteBtn) {
        remoteBtn.title = title;
        remoteBtn.setAttribute('aria-label', title);
        remoteBtn.classList.toggle('is-bound-folder', scope.mode === 'folder');
    }

    const catalogBtn = el('catalog-chan-bind-btn');
    const catalogPopup = el('catalog-chan-bind-popup');
    if (catalogBtn) {
        catalogBtn.innerHTML = BIND_ICON;
        catalogBtn.title = title;
        catalogBtn.setAttribute('aria-label', title);
        catalogBtn.classList.toggle('is-bound-folder', scope.mode === 'folder');
    }
    if (catalogPopup) {
        catalogPopup.classList.toggle('is-hidden', false);
    }
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

        if (!window.__chanBindDocBound) {
            window.__chanBindDocBound = true;
            document.addEventListener('click', () => closeAllMenus());
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeAllMenus();
            });
        }

        syncBindButtons();
    },

    closeAllMenus,
    syncBindButtons,
    syncCatalogBindVisibility
};
