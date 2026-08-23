import { TvPlayer } from '../tvPlayer.js';
import { escapeHtml, el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';

let deps = {
    getAppState: () => null,
    onChanged: () => {}
};

function promptFolderName(defaultName = '', title = 'Folder name') {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
        return (defaultName || '').trim() || null;
    }
    const value = window.prompt(title, defaultName);
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed || null;
}

export function folderTileHtml(folder) {
    const count = folder.items?.length || 0;
    const label = count === 1 ? '1 channel' : `${count} channels`;
    return `
        <div class="favorite-folder-tile" data-folder-id="${escapeHtml(folder.id)}" role="button" tabindex="0">
            <button type="button" class="favorite-folder-tile__edit-btn" title="Rename folder" aria-label="Rename folder">${CARD_ICONS.tileEdit}</button>
            <button type="button" class="favorite-folder-tile__delete-btn" title="Delete folder" aria-label="Delete folder">${CARD_ICONS.folderDelete}</button>
            <div class="favorite-folder-tile__icon" aria-hidden="true">${CARD_ICONS.folder}</div>
            <div class="favorite-folder-tile__body">
                <h3 class="favorite-folder-tile__name">${escapeHtml(folder.name || 'Folder')}</h3>
                <div class="favorite-folder-tile__count">${label}</div>
            </div>
        </div>
    `;
}

export function folderParentTileHtml() {
    return `
        <div class="favorite-folder-parent-tile" data-folder-parent="1" role="button" tabindex="0" title="Back to favorites" aria-label="Back to favorites">
            <span class="favorite-folder-parent-tile__label" aria-hidden="true">..</span>
        </div>
    `;
}

/** @deprecated Use folderParentTileHtml */
export const folderEscapeTileHtml = folderParentTileHtml;

function syncCreateFolderBtn() {
    const appState = deps.getAppState();
    const btn = el('create-favorite-folder-btn');
    if (!btn || !appState) return;
    const visible = appState.activeTab === 'favorites' && !appState.favoritesFolderId;
    btn.classList.toggle('is-hidden', !visible);
}

export function syncFavoritesBackButton() {
    const appState = deps.getAppState();
    const backBtn = el('back-btn');
    if (!backBtn || !appState) return;
    const inFolder = appState.activeTab === 'favorites' && appState.favoritesFolderId;
    if (inFolder) {
        backBtn.classList.add('is-hidden');
        backBtn.classList.remove('is-active', 'is-pink-active');
        backBtn.dataset.tab = 'back-to-favorites-root';
    } else if (appState.activeTab !== 'browse' || appState.browseCountry === null) {
        if (appState.activeTab !== 'browse') {
            backBtn.classList.add('is-hidden');
            backBtn.classList.remove('is-active', 'is-pink-active');
        }
        backBtn.dataset.tab = 'back-to-countries';
    }
    syncCreateFolderBtn();
}

export function openFavoriteFolder(folderId) {
    const appState = deps.getAppState();
    if (!appState || !folderId) return false;
    const folder = TvPlayer.getFavoriteFolder(folderId);
    if (!folder) return false;
    appState.favoritesFolderId = folderId;
    syncFavoritesBackButton();
    deps.onChanged();
    return true;
}

export function closeFavoriteFolder() {
    const appState = deps.getAppState();
    if (!appState?.favoritesFolderId) return false;
    appState.favoritesFolderId = null;
    syncFavoritesBackButton();
    deps.onChanged();
    return true;
}

export function createFavoriteFolder() {
    const defaultName = TvPlayer.suggestFolderName();
    const name = promptFolderName(defaultName, 'New folder name');
    if (name == null) return null;
    const folder = TvPlayer.createFavoriteFolder(name);
    showAppToast(`Created ${folder.name}`);
    deps.onChanged();
    return folder;
}

export function renameFavoriteFolder(folderId) {
    const folder = TvPlayer.getFavoriteFolder(folderId);
    if (!folder) return false;
    const name = promptFolderName(folder.name, 'Rename folder');
    if (name == null || name === folder.name) return false;
    const changed = TvPlayer.renameFavoriteFolder(folderId, name);
    if (changed) {
        showAppToast(`Renamed to ${name}`);
        deps.onChanged();
    }
    return changed;
}

export function deleteFavoriteFolder(folderId) {
    const folder = TvPlayer.getFavoriteFolder(folderId);
    if (!folder) return false;
    if (folder.items.length > 0) {
        showAppToast('Move channels out before deleting folder');
        return false;
    }
    const appState = deps.getAppState();
    if (appState?.favoritesFolderId === folderId) {
        appState.favoritesFolderId = null;
        syncFavoritesBackButton();
    }
    const removed = TvPlayer.deleteFavoriteFolder(folderId);
    if (removed) {
        showAppToast('Folder deleted');
        deps.onChanged();
    }
    return removed;
}

function wireFolderTiles(container) {
    if (!container) return;
    container.querySelectorAll('.favorite-folder-tile').forEach((tile) => {
        const folderId = tile.dataset.folderId;
        if (!folderId) return;

        tile.addEventListener('click', (e) => {
            if (e.target.closest?.('.favorite-folder-tile__edit-btn, .favorite-folder-tile__delete-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            openFavoriteFolder(folderId);
        });
        tile.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest?.('.favorite-folder-tile__edit-btn, .favorite-folder-tile__delete-btn')) return;
            e.preventDefault();
            openFavoriteFolder(folderId);
        });

        const editBtn = tile.querySelector('.favorite-folder-tile__edit-btn');
        editBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            renameFavoriteFolder(folderId);
        });

        const deleteBtn = tile.querySelector('.favorite-folder-tile__delete-btn');
        deleteBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteFavoriteFolder(folderId);
        });
    });
}

function wireFolderViewTiles(container) {
    if (!container) return;
    const parent = container.querySelector('.favorite-folder-parent-tile');
    if (!parent) return;

    const goBack = (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeFavoriteFolder();
    };

    parent.addEventListener('click', goBack);
    parent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            closeFavoriteFolder();
        }
    });
}

export const FavoritesFolders = {
    init({ getAppState, onChanged } = {}) {
        deps = {
            getAppState: getAppState || (() => null),
            onChanged: onChanged || (() => {})
        };
    },

    wireFolderTiles(container) {
        wireFolderTiles(container);
    },

    wireFolderViewTiles(container) {
        wireFolderViewTiles(container);
    },

    syncBackButton: syncFavoritesBackButton,
    openFavoriteFolder,
    closeFavoriteFolder,
    createFavoriteFolder,
    renameFavoriteFolder,
    deleteFavoriteFolder,
    folderTileHtml,
    folderParentTileHtml,
    folderEscapeTileHtml
};
