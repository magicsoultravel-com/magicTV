import { channelKey, migrateFavoriteRef, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { loadPlayerState, savePlayerState, RECENTS_CAP } from './playerState.js';

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
        const meta = loadPlayerState().recentsMeta.filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || '',
            at: Date.now()
        });
        savePlayerState({ recentsMeta: meta.slice(0, RECENTS_CAP) });
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
