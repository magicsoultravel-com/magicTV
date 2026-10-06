/**
 * Radio favorites folders / visited / hidden — parallel to TV FavoritesRecents + HiddenChannels.
 * Does not emit UI events; RadioPlayer owns emitState after mutations.
 */
import { stationKey, migrateFavoriteRef } from './stationShape.js';
import { loadRadioState, patchRadioState } from './radioState.js';
import { nextFolderName } from '../storage/favoritesRecents.js';

function cloneFolders(folders) {
    return (folders || []).map((f) => ({ ...f, items: [...(f.items || [])] }));
}

function folderById(folders, id) {
    return (folders || []).find((f) => f.id === id) || null;
}

function folderIdsSet(folders) {
    return new Set((folders || []).map((f) => f.id));
}

function newFolderId() {
    return `rf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function resolveKey(keyOrStation) {
    if (!keyOrStation) return '';
    if (typeof keyOrStation === 'string') return migrateFavoriteRef(keyOrStation);
    return stationKey(keyOrStation);
}

function stationLogo(station) {
    return station?.favicon || station?.logo || '';
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

function leanMeta(entry, key) {
    return {
        key,
        name: entry?.name || '',
        logo: stationLogo(entry) || entry?.logo || '',
        countrycode: entry?.countrycode || ''
    };
}

export const RadioLibrary = {
    /* ---- folders ---- */

    getFavoriteFolders() {
        return cloneFolders(loadRadioState().favoriteFolders);
    },

    getFavoritesRootOrder() {
        return [...(loadRadioState().favoritesRootOrder || [])];
    },

    getFavoriteFolder(id) {
        const folder = folderById(loadRadioState().favoriteFolders, id);
        return folder ? { ...folder, items: [...(folder.items || [])] } : null;
    },

    suggestFolderName() {
        return nextFolderName(loadRadioState().favoriteFolders);
    },

    createFavoriteFolder(name) {
        const state = loadRadioState();
        const folders = cloneFolders(state.favoriteFolders);
        const folder = {
            id: newFolderId(),
            name: (name || '').trim() || nextFolderName(folders),
            items: []
        };
        folders.unshift(folder);
        patchRadioState({ favoriteFolders: folders });
        return folder;
    },

    renameFavoriteFolder(id, name) {
        const trimmed = (name || '').trim();
        if (!id || !trimmed) return false;
        const folders = cloneFolders(loadRadioState().favoriteFolders);
        const folder = folderById(folders, id);
        if (!folder || folder.name === trimmed) return false;
        folder.name = trimmed;
        patchRadioState({ favoriteFolders: folders });
        return true;
    },

    deleteFavoriteFolder(id) {
        if (!id) return false;
        const state = loadRadioState();
        const folder = folderById(state.favoriteFolders, id);
        if (!folder || folder.items.length > 0) return false;
        const favoriteFolders = state.favoriteFolders.filter((f) => f.id !== id);
        const patch = { favoriteFolders };
        if (state.stationBindScope?.mode === 'folder' && state.stationBindScope.folderId === id) {
            patch.stationBindScope = { mode: 'favorites' };
        }
        patchRadioState(patch);
        return true;
    },

    reorderFavoritesRoot(orderedChannelKeys) {
        if (!Array.isArray(orderedChannelKeys)) return false;
        const state = loadRadioState();
        const folderIds = folderIdsSet(state.favoriteFolders);
        const current = (state.favoritesRootOrder || []).filter((ref) => !folderIds.has(ref));
        const next = orderedChannelKeys.map(migrateFavoriteRef).filter(Boolean);
        if (next.length !== current.length) return false;
        const currentSet = new Set(current);
        for (const ref of next) {
            if (!currentSet.has(ref)) return false;
        }
        if (next.every((ref, i) => ref === current[i])) return false;
        patchRadioState({ favoritesRootOrder: next });
        return true;
    },

    reorderFavoriteFolderItems(folderId, orderedKeys) {
        if (!folderId || !Array.isArray(orderedKeys)) return false;
        const state = loadRadioState();
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
        patchRadioState({ favoriteFolders: folders });
        return true;
    },

    moveFavoriteToFolder(stationKeyRef, folderId, { index = null } = {}) {
        const key = migrateFavoriteRef(stationKeyRef);
        if (!key || !folderId) return false;
        const state = loadRadioState();
        if (!state.favorites.includes(key)) return false;
        const folders = cloneFolders(state.favoriteFolders);
        const folder = folderById(folders, folderId);
        if (!folder) return false;

        const favoritesRootOrder = (state.favoritesRootOrder || []).filter((ref) => ref !== key);
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
        patchRadioState({ favoriteFolders: folders, favoritesRootOrder });
        return true;
    },

    moveFavoriteToRoot(stationKeyRef, { index = null } = {}) {
        const key = migrateFavoriteRef(stationKeyRef);
        if (!key) return false;
        const state = loadRadioState();
        if (!state.favorites.includes(key)) return false;
        const folders = cloneFolders(state.favoriteFolders);
        folders.forEach((f) => {
            f.items = f.items.filter((k) => k !== key);
        });
        const folderIds = folderIdsSet(folders);
        let favoritesRootOrder = (state.favoritesRootOrder || []).filter((ref) => ref !== key && !folderIds.has(ref));
        if (Number.isInteger(index) && index >= 0 && index <= favoritesRootOrder.length) {
            favoritesRootOrder.splice(index, 0, key);
        } else {
            favoritesRootOrder.push(key);
        }
        patchRadioState({ favoriteFolders: folders, favoritesRootOrder });
        return true;
    },

    /**
     * Toggle favorite and keep folder/root order consistent.
     * @returns {boolean} true if now favorite
     */
    toggleFavorite(keyOrStation) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        const state = loadRadioState();
        const favorites = [...state.favorites];
        const idx = favorites.indexOf(key);
        if (idx >= 0) {
            favorites.splice(idx, 1);
            const layout = removeKeyFromLayout(state, key);
            patchRadioState({ favorites, ...layout });
            return false;
        }
        favorites.unshift(key);
        const keysInFolders = new Set((state.favoriteFolders || []).flatMap((f) => f.items || []));
        let favoritesRootOrder = [...(state.favoritesRootOrder || [])];
        if (!keysInFolders.has(key)) {
            favoritesRootOrder = [key, ...favoritesRootOrder.filter((ref) => ref !== key)];
        }
        patchRadioState({ favorites, favoritesRootOrder });
        return true;
    },

    /* ---- visited ---- */

    reconcileVisitedStations() {
        const state = loadRadioState();
        if (state.visitedStationsReconciled === true) {
            if (state.visitedStations.length !== state.visitedStationsMeta.length) {
                const keysWithMeta = new Set(state.visitedStationsMeta.map((e) => e.key));
                const missing = state.visitedStations.filter((k) => !keysWithMeta.has(k));
                if (missing.length > 0) {
                    const metaByKey = new Map(state.visitedStationsMeta.map((e) => [e.key, e]));
                    for (const e of state.recentsMeta || []) {
                        if (missing.includes(e.key) && !metaByKey.has(e.key)) {
                            metaByKey.set(e.key, leanMeta(e, e.key));
                        }
                    }
                    const newMeta = [...metaByKey.values()].filter((m) => state.visitedStations.includes(m.key));
                    if (newMeta.length > state.visitedStationsMeta.length) {
                        patchRadioState({ visitedStationsMeta: newMeta });
                    }
                }
            }
            return;
        }

        const visited = new Set(state.visitedStations);
        const metaByKey = new Map(state.visitedStationsMeta.map((e) => [e.key, e]));
        for (const e of state.recentsMeta || []) {
            if (e.key) visited.add(e.key);
            if (e.key && !metaByKey.has(e.key)) metaByKey.set(e.key, leanMeta(e, e.key));
        }
        for (const k of state.favorites || []) {
            visited.add(k);
            if (!metaByKey.has(k)) metaByKey.set(k, { key: k, name: '', logo: '', countrycode: '' });
        }
        if (state.lastStationKey) visited.add(migrateFavoriteRef(state.lastStationKey));
        patchRadioState({
            visitedStations: [...visited],
            visitedStationsMeta: [...metaByKey.values()].filter((m) => visited.has(m.key)),
            visitedStationsReconciled: true
        });
    },

    markVisited(keyOrStation, station = null) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        this.reconcileVisitedStations();
        const state = loadRadioState();
        const visitedStations = [...state.visitedStations];
        const visitedStationsMeta = state.visitedStationsMeta.map((e) => ({ ...e }));
        let changed = false;
        if (!visitedStations.includes(key)) {
            visitedStations.push(key);
            changed = true;
        }
        const src = station || (typeof keyOrStation === 'object' ? keyOrStation : null);
        const metaIdx = visitedStationsMeta.findIndex((e) => e.key === key);
        const entry = leanMeta(src, key);
        if (metaIdx >= 0) {
            if (entry.name || entry.logo || entry.countrycode) {
                visitedStationsMeta[metaIdx] = {
                    ...visitedStationsMeta[metaIdx],
                    ...Object.fromEntries(
                        Object.entries(entry).filter(([_, v]) => v !== '' && v != null)
                    )
                };
                changed = true;
            }
        } else {
            visitedStationsMeta.push(entry);
            changed = true;
        }
        if (changed) patchRadioState({ visitedStations, visitedStationsMeta });
        return changed;
    },

    unvisitStation(keyOrStation) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        const state = loadRadioState();
        if (!state.visitedStations.includes(key)) return false;
        patchRadioState({
            visitedStations: state.visitedStations.filter((k) => k !== key),
            visitedStationsMeta: state.visitedStationsMeta.filter((e) => e.key !== key)
        });
        return true;
    },

    isVisited(keyOrStation) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        return loadRadioState().visitedStations.includes(key);
    },

    getVisitedMeta() {
        return loadRadioState().visitedStationsMeta.map((e) => ({ ...e }));
    },

    getVisitedKeys() {
        return [...loadRadioState().visitedStations];
    },

    /* ---- hidden ---- */

    getHidden() {
        return [...loadRadioState().hiddenStations];
    },

    getHiddenMeta() {
        return loadRadioState().hiddenStationsMeta.map((e) => ({ ...e }));
    },

    isHidden(keyOrStation) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        return loadRadioState().hiddenStations.includes(key);
    },

    hideStation(stationOrKey) {
        const key = resolveKey(stationOrKey);
        if (!key) return false;
        const state = loadRadioState();
        if (state.hiddenStations.includes(key)) return false;
        const hiddenStations = [key, ...state.hiddenStations];
        const hiddenStationsMeta = state.hiddenStationsMeta.filter((e) => e.key !== key);
        const src = typeof stationOrKey === 'object' ? stationOrKey : null;
        hiddenStationsMeta.unshift(leanMeta(src, key));
        patchRadioState({ hiddenStations, hiddenStationsMeta });
        return true;
    },

    unhideStation(keyOrStation) {
        const key = resolveKey(keyOrStation);
        if (!key) return false;
        const state = loadRadioState();
        if (!state.hiddenStations.includes(key)) return false;
        patchRadioState({
            hiddenStations: state.hiddenStations.filter((k) => k !== key),
            hiddenStationsMeta: state.hiddenStationsMeta.filter((e) => e.key !== key)
        });
        return true;
    },

    filterVisible(stations) {
        const hidden = new Set(loadRadioState().hiddenStations);
        return (stations || []).filter((s) => !hidden.has(stationKey(s) || resolveKey(s)));
    }
};
