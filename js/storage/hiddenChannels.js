import { channelKey, migrateFavoriteRef } from '../tvProviders/channelShape.js';
import { loadPlayerState, savePlayerState } from './playerState.js';

/**
 * Hidden channels library. Does not emit UI events — callers (TvPlayer)
 * own emitState after mutations.
 */
export const HiddenChannels = {
    getHidden() {
        return [...loadPlayerState().hiddenChannels];
    },

    getHiddenMeta() {
        return loadPlayerState().hiddenChannelsMeta.map((e) => ({ ...e }));
    },

    isHidden(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        return loadPlayerState().hiddenChannels.includes(key);
    },

    /**
     * @returns {boolean} true if now hidden, false if already hidden / invalid
     */
    hideChannel(channel) {
        const key = channelKey(channel);
        if (!key) return false;
        const hiddenChannels = loadPlayerState().hiddenChannels;
        if (hiddenChannels.includes(key)) return false;
        hiddenChannels.unshift(key);
        const hiddenChannelsMeta = loadPlayerState().hiddenChannelsMeta.filter((e) => e.key !== key);
        hiddenChannelsMeta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || ''
        });
        savePlayerState({ hiddenChannels, hiddenChannelsMeta });
        return true;
    },

    /**
     * @returns {boolean} true if was hidden and is now visible
     */
    unhideChannel(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        if (!key) return false;
        const hiddenChannels = loadPlayerState().hiddenChannels;
        const idx = hiddenChannels.indexOf(key);
        if (idx < 0) return false;
        hiddenChannels.splice(idx, 1);
        savePlayerState({
            hiddenChannels,
            hiddenChannelsMeta: loadPlayerState().hiddenChannelsMeta.filter((e) => e.key !== key)
        });
        return true;
    },

    filterVisible(channels) {
        const hidden = new Set(loadPlayerState().hiddenChannels);
        return (channels || []).filter((ch) => !hidden.has(channelKey(ch)));
    }
};
