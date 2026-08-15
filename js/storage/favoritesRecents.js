import { channelKey, migrateFavoriteRef, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { loadPlayerState, savePlayerState, RECENTS_CAP } from './playerState.js';

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
    }
};
