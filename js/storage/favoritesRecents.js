import { channelKey, migrateFavoriteRef, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import {
    loadPlayerState,
    savePlayerState,
    getRecentsCap,
    normalizeChanBindScope
} from './playerState.js';
import { readPersistedState } from './persistedState.js';

function cloneFolders(folders) {
    return (folders || []).map((f) => ({ ...f, items: [...(f.items || [])] }));
}

function folderById(folders, id) {
    return folders.find((f) => f.id === id) || null;
}

function removeKeyFromLayout(state, key) {
    const folders = cloneFolders(state.favoriteFolders);
    const rootOrder = [...(state.favoritesRootOrder || [])];
    const idx = rootOrder.indexOf(key);
    if (idx >= 0) rootOrder.splice(idx, 1);
    folders.forEach((f) => {
        f.items = f.items.filter((k) => k !== key);
    });
    return { favoriteFolders: folders, favoritesRootOrder: rootOrder };
}

export function nextFolderName(folders) {
    const used = new Set((folders || []).map((f) => (f.name || '').trim()));
    let n = 1;
    while (used.has(`Folder ${n}`)) n += 1;
    return `Folder ${n}`;
}

function folderIdsSet(folders) {
    return new Set((folders || []).map((f) => f.id));
}

function newFolderId() {
    return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Splice a reordered visible subset back into the full favorites list.
 * Non-visible keys keep their slots; visible keys take the new order in those slots.
 * Example: full [A,B,C,D,E], visible [E,B,D] → [A,E,B,D,C]
 */
export function mergeVisibleFavoriteOrder(fullKeys, visibleOrderedKeys) {
    const visibleSet = new Set(visibleOrderedKeys);
    let i = 0;
    return fullKeys.map((k) => (visibleSet.has(k) ? visibleOrderedKeys[i++] : k));
}

/**
 * Merge visible root refs (folder ids + channel keys) into full root order.
 */
export function mergeVisibleRootOrder(fullRootOrder, visibleOrderedRefs) {
    const visibleSet = new Set(visibleOrderedRefs);
    let i = 0;
    return fullRootOrder.map((ref) => (visibleSet.has(ref) ? visibleOrderedRefs[i++] : ref));
}

/**
 * Merge visible folder item keys into full folder item list.
 */
export function mergeVisibleFolderItems(fullItems, visibleOrderedKeys) {
    return mergeVisibleFavoriteOrder(fullItems, visibleOrderedKeys);
}

/**
 * Favorites / recents library. Does not emit UI events — callers (TvPlayer)
 * own emitState after mutations.
 */
export const FavoritesRecents = {
    getFavorites() {
        return [...loadPlayerState().favorites];
    },

    getFavoritesMeta() {
        return loadPlayerState().favoritesMeta.map((e) => ({ ...e }));
    },

    getFavoriteFolders() {
        return cloneFolders(loadPlayerState().favoriteFolders);
    },

    getFavoritesRootOrder() {
        return [...loadPlayerState().favoritesRootOrder];
    },

    getFavoriteFolder(id) {
        const folder = folderById(loadPlayerState().favoriteFolders, id);
        return folder ? { ...folder, items: [...(folder.items || [])] } : null;
    },

    suggestFolderName() {
        return nextFolderName(loadPlayerState().favoriteFolders);
    },

    createFavoriteFolder(name) {
        const state = loadPlayerState();
        const folders = cloneFolders(state.favoriteFolders);
        const folder = {
            id: newFolderId(),
            name: (name || '').trim() || nextFolderName(folders),
            items: []
        };
        folders.unshift(folder);
        savePlayerState({ favoriteFolders: folders });
        return folder;
    },

    renameFavoriteFolder(id, name) {
        const trimmed = (name || '').trim();
        if (!id || !trimmed) return false;
        const folders = cloneFolders(loadPlayerState().favoriteFolders);
        const folder = folderById(folders, id);
        if (!folder || folder.name === trimmed) return false;
        folder.name = trimmed;
        savePlayerState({ favoriteFolders: folders });
        return true;
    },

    deleteFavoriteFolder(id) {
        if (!id) return false;
        const state = loadPlayerState();
        const folder = folderById(state.favoriteFolders, id);
        if (!folder || folder.items.length > 0) return false;
        const favoriteFolders = state.favoriteFolders.filter((f) => f.id !== id);
        const patch = { favoriteFolders };
        if (state.chanBindScope?.mode === 'folder' && state.chanBindScope.folderId === id) {
            patch.chanBindScope = { mode: 'favorites' };
        }
        savePlayerState(patch);
        return true;
    },

    reorderFavoritesRoot(orderedChannelKeys) {
        if (!Array.isArray(orderedChannelKeys)) return false;
        const state = loadPlayerState();
        const folderIds = folderIdsSet(state.favoriteFolders);
        const current = state.favoritesRootOrder.filter((ref) => !folderIds.has(ref));
        const next = orderedChannelKeys.map(migrateFavoriteRef).filter(Boolean);
        if (next.length !== current.length) return false;
        const currentSet = new Set(current);
        for (const ref of next) {
            if (!currentSet.has(ref)) return false;
        }
        if (next.every((ref, i) => ref === current[i])) return false;
        savePlayerState({ favoritesRootOrder: next });
        return true;
    },

    reorderFavoriteFolderItems(folderId, orderedKeys) {
        if (!folderId || !Array.isArray(orderedKeys)) return false;
        const state = loadPlayerState();
        const folders = cloneFolders(state.favoriteFolders);
        const folder = folderById(folders, folderId);
        if (!folder) return false;
        const current = folder.items;
        const next = orderedKeys.map(migrateFavoriteRef).filter(Boolean);
        if (next.length !== current.length) return false;
        const currentSet = new Set(current);
        for (const k of next) {
            if (!currentSet.has(k)) return false;
        }
        if (next.every((k, i) => k === current[i])) return false;
        folder.items = next;
        savePlayerState({ favoriteFolders: folders });
        return true;
    },

    moveFavoriteToFolder(channelKeyRef, folderId, { index = null } = {}) {
        const key = migrateFavoriteRef(channelKeyRef);
        if (!key || !folderId) return false;
        const state = loadPlayerState();
        if (!state.favorites.includes(key)) return false;
        const folders = cloneFolders(state.favoriteFolders);
        const folder = folderById(folders, folderId);
        if (!folder) return false;

        const favoritesRootOrder = state.favoritesRootOrder.filter((ref) => ref !== key);
        folders.forEach((f) => {
            f.items = f.items.filter((k) => k !== key);
        });
        const target = folderById(folders, folderId);
        if (!target) return false;
        if (Number.isInteger(index) && index >= 0 && index <= target.items.length) {
            target.items.splice(index, 0, key);
        } else {
            target.items.push(key);
        }
        savePlayerState({ favoriteFolders: folders, favoritesRootOrder });
        return true;
    },

    moveFavoriteToRoot(channelKeyRef, { index = null } = {}) {
        const key = migrateFavoriteRef(channelKeyRef);
        if (!key) return false;
        const state = loadPlayerState();
        if (!state.favorites.includes(key)) return false;
        const folders = cloneFolders(state.favoriteFolders);
        folders.forEach((f) => {
            f.items = f.items.filter((k) => k !== key);
        });
        const folderIds = folderIdsSet(folders);
        let favoritesRootOrder = state.favoritesRootOrder.filter((ref) => ref !== key && !folderIds.has(ref));
        if (Number.isInteger(index) && index >= 0 && index <= favoritesRootOrder.length) {
            favoritesRootOrder.splice(index, 0, key);
        } else {
            favoritesRootOrder.push(key);
        }
        savePlayerState({ favoriteFolders: folders, favoritesRootOrder });
        return true;
    },

    getRecents() {
        return [...loadPlayerState().recents];
    },

    getRecentsMeta() {
        return loadPlayerState().recentsMeta.map((e) => ({ ...e }));
    },

    clearRecents() {
        savePlayerState({ recentsMeta: [] });
    },

    pushRecent(key, channel = null) {
        if (!key) return;
        const cap = getRecentsCap();
        const meta = loadPlayerState().recentsMeta.filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || '',
            at: Date.now()
        });
        savePlayerState({ recentsMeta: meta.slice(0, cap) });
    },

    /**
     * Seed visitedChannels from legacy state (recents / favorites / last channel)
     * exactly once, so long-time users keep their history visibly "visited".
     */
    reconcileVisitedChannels() {
        const raw = readPersistedState();
        const state = loadPlayerState();

        // Full seed exactly once (first run after the feature shipped).
        if (raw.visitedChannelsReconciled !== true) {
            const visited = new Set(state.visitedChannels);
            const metaByKey = new Map(state.visitedChannelsMeta.map((e) => [e.key, e]));
            for (const e of state.recentsMeta) {
                if (e.key) visited.add(e.key);
                if (e.key && !metaByKey.has(e.key)) {
                    metaByKey.set(e.key, {
                        key: e.key,
                        name: e.name || '',
                        logo: e.logo || '',
                        countrycode: e.countrycode || ''
                    });
                }
            }
            for (const k of state.favorites) {
                visited.add(k);
                if (!metaByKey.has(k)) {
                    const fav = state.favoritesMeta.find((f) => f.key === k);
                    metaByKey.set(k, fav || { key: k, name: '', logo: '', countrycode: '' });
                }
            }
            if (state.lastChannelKey) {
                visited.add(migrateFavoriteRef(state.lastChannelKey));
            }
            savePlayerState({
                visitedChannels: [...visited],
                visitedChannelsMeta: [...metaByKey.values()].filter((m) => visited.has(m.key)),
                visitedChannelsReconciled: true
            });
            return;
        }

        // Meta backfill: if any visited keys are missing display metadata, pull
        // from recents / favorites. This catches the gap if the initial
        // reconciliation ran before meta storage was added.
        if (state.visitedChannels.length !== state.visitedChannelsMeta.length) {
            const keysWithMeta = new Set(state.visitedChannelsMeta.map((e) => e.key));
            const missing = state.visitedChannels.filter((k) => !keysWithMeta.has(k));
            if (missing.length > 0) {
                const metaByKey = new Map(state.visitedChannelsMeta.map((e) => [e.key, e]));
                for (const e of state.recentsMeta) {
                    if (missing.includes(e.key) && !metaByKey.has(e.key)) {
                        metaByKey.set(e.key, {
                            key: e.key,
                            name: e.name || '',
                            logo: e.logo || '',
                            countrycode: e.countrycode || ''
                        });
                    }
                }
                for (const fav of state.favoritesMeta) {
                    if (missing.includes(fav.key) && !metaByKey.has(fav.key)) {
                        metaByKey.set(fav.key, { ...fav });
                    }
                }
                const newMeta = [...metaByKey.values()].filter((m) => state.visitedChannels.includes(m.key));
                if (newMeta.length > state.visitedChannelsMeta.length) {
                    savePlayerState({ visitedChannelsMeta: newMeta });
                }
            }
        }
    },

    markVisited(channelOrKey, channel = null) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        if (!key) return false;
        this.reconcileVisitedChannels();
        const state = loadPlayerState();
        const visitedChannels = [...state.visitedChannels];
        const visitedChannelsMeta = state.visitedChannelsMeta.map((e) => ({ ...e }));
        let changed = false;
        if (!visitedChannels.includes(key)) {
            visitedChannels.push(key);
            changed = true;
        }
        // Refresh display metadata whenever a channel object is available, so
        // the settings browser shows the freshest name / logo / country.
        const metaIdx = visitedChannelsMeta.findIndex((e) => e.key === key);
        const entry = {
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || ''
        };
        if (metaIdx >= 0) {
            if (entry.name || entry.logo || entry.countrycode) {
                visitedChannelsMeta[metaIdx] = {
                    ...visitedChannelsMeta[metaIdx],
                    ...Object.fromEntries(
                        Object.entries(entry).filter(([k, v]) => v !== '' && v != null)
                    )
                };
                changed = true;
            }
        } else {
            visitedChannelsMeta.push(entry);
            changed = true;
        }
        if (changed) savePlayerState({ visitedChannels, visitedChannelsMeta });
        return changed;
    },

    unvisitChannel(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        if (!key) return false;
        const state = loadPlayerState();
        if (!state.visitedChannels.includes(key)) return false;
        savePlayerState({
            visitedChannels: state.visitedChannels.filter((k) => k !== key),
            visitedChannelsMeta: state.visitedChannelsMeta.filter((e) => e.key !== key)
        });
        return true;
    },

    isVisited(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        if (!key) return false;
        return loadPlayerState().visitedChannels.includes(key);
    },

    getVisitedMeta() {
        return loadPlayerState().visitedChannelsMeta.map((e) => ({ ...e }));
    },

    getVisitedKeys() {
        return [...loadPlayerState().visitedChannels];
    },

    isFavorite(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        return loadPlayerState().favorites.includes(key);
    },

    /**
     * @returns {boolean} true if now a favorite, false if removed / invalid
     */
    toggleFavorite(channel) {
        const key = channelKey(channel);
        if (!key) return false;
        const favorites = loadPlayerState().favorites;
        const idx = favorites.indexOf(key);
        if (idx >= 0) {
            favorites.splice(idx, 1);
            const state = loadPlayerState();
            const layout = removeKeyFromLayout(state, key);
            savePlayerState({
                favorites,
                favoritesMeta: state.favoritesMeta.filter((e) => e.key !== key),
                ...layout
            });
            return false;
        }
        favorites.unshift(key);
        const favoritesMeta = loadPlayerState().favoritesMeta.filter((e) => e.key !== key);
        favoritesMeta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || ''
        });
        const state = loadPlayerState();
        const keysInFolders = new Set(state.favoriteFolders.flatMap((f) => f.items));
        let favoritesRootOrder = [...state.favoritesRootOrder];
        if (!keysInFolders.has(key)) {
            favoritesRootOrder = [key, ...favoritesRootOrder.filter((ref) => ref !== key)];
        }
        savePlayerState({ favorites, favoritesMeta, favoritesRootOrder });
        const parsed = parseChannelKey(key);
        TvProviderRegistry.getChannel(parsed).catch(() => {});
        return true;
    },

    /**
     * Replace favorites order with `orderedKeys` (same set of keys).
     * @returns {boolean} true if order changed and was saved
     */
    reorderFavorites(orderedKeys) {
        if (!Array.isArray(orderedKeys)) return false;
        const current = loadPlayerState().favorites;
        const next = orderedKeys.map(migrateFavoriteRef).filter(Boolean);
        if (next.length !== current.length) return false;
        if (new Set(next).size !== next.length) return false;
        const currentSet = new Set(current);
        for (const k of next) {
            if (!currentSet.has(k)) return false;
        }
        if (next.every((k, i) => k === current[i])) return false;

        const metaByKey = new Map(loadPlayerState().favoritesMeta.map((e) => [e.key, e]));
        const favoritesMeta = next.map((k) => metaByKey.get(k) || {
            key: k,
            name: '',
            logo: '',
            countrycode: ''
        });
        savePlayerState({ favorites: next, favoritesMeta });
        return true;
    },

    getChanBindScope() {
        const scope = loadPlayerState().chanBindScope;
        if (scope?.mode === 'folder' && scope.folderId) {
            return { mode: 'folder', folderId: scope.folderId };
        }
        return { mode: 'favorites' };
    },

    setChanBindScope(scope) {
        const folders = loadPlayerState().favoriteFolders;
        const normalized = normalizeChanBindScope(scope, folders);
        const current = loadPlayerState().chanBindScope;
        if (current.mode === normalized.mode
            && (normalized.mode !== 'folder' || current.folderId === normalized.folderId)) {
            return false;
        }
        savePlayerState({ chanBindScope: normalized });
        return true;
    }
};
