import { channelKey, migrateFavoriteRef, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import {
    loadPlayerState,
    savePlayerState,
    getRecentsCap
} from './playerState.js';
import { readPersistedState } from './persistedState.js';

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
            savePlayerState({
                favorites,
                favoritesMeta: loadPlayerState().favoritesMeta.filter((e) => e.key !== key)
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
        savePlayerState({ favorites, favoritesMeta });
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
    }
};
