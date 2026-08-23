import { MultiView } from './multiView.js';
import { FavoritesRecents } from './storage/favoritesRecents.js';
import { HiddenChannels } from './storage/hiddenChannels.js';
import { parseChannelKey } from './tvProviders/channelShape.js';
import { loadPlayerState } from './storage/playerState.js';

/**
 * Facade over MultiView's primary (center) player.
 * Favorites / recents stay shared here for existing UI call sites.
 */
export const TvPlayer = {
    init() {
        MultiView.init();
        FavoritesRecents.reconcileVisitedChannels();
        const primary = MultiView.getPrimary();
        const saved = loadPlayerState();
        if (primary && saved.lastChannelKey && !primary.channel) {
            const parsed = parseChannelKey(saved.lastChannelKey);
            primary.channel = {
                providerId: parsed.providerId,
                channelId: parsed.channelId,
                channeluuid: saved.lastChannelKey,
                name: saved.lastChannelName || 'Last channel'
            };
            primary.emitState();
        }
    },

    get video() { return MultiView.getPrimary()?.video ?? null; },
    get hls() { return MultiView.getPrimary()?.hls ?? null; },
    get playing() { return MultiView.getPrimary()?.playing === true; },
    get loading() { return MultiView.getPrimary()?.loading === true; },
    get loadPhase() { return MultiView.getPrimary()?.loadPhase || 'idle'; },
    get pausePhase() { return MultiView.getPrimary()?.pausePhase || 'idle'; },
    get error() { return MultiView.getPrimary()?.error ?? null; },
    get resumeBlocked() { return MultiView.getPrimary()?.resumeBlocked === true; },
    get qualityLabel() { return MultiView.getPrimary()?.qualityLabel || '—'; },
    get qualityLevel() {
        const level = MultiView.getPrimary()?.qualityLevel;
        return Number.isFinite(level) ? level : -1;
    },
    get qualityMode() {
        return MultiView.getPrimary()?.qualityMode ?? 'auto';
    },
    getQualityLevels() {
        return MultiView.getPrimary()?.getQualityLevels?.() || [];
    },
    setQualityMode(mode) {
        return MultiView.getPrimary()?.setQualityMode?.(mode);
    },
    get connection() { return MultiView.getPrimary()?.connection || 'idle'; },
    get muted() {
        const p = MultiView.getPrimary();
        return p ? p.muted : true;
    },
    get volume() { return MultiView.getSharedVolume(); },
    get lastVolume() { return MultiView.getLastVolume(); },
    get bufferSize() {
        return MultiView.getPrimary()?.bufferSize ?? MultiView.getBufferSize();
    },

    get channel() { return MultiView.getPrimary()?.channel ?? null; },
    set channel(value) {
        const primary = MultiView.getPrimary();
        if (primary) primary.channel = value;
    },

    mountVideo(_targetEl) {
        MultiView.mountAll();
    },

    emitState() {
        MultiView.getPrimary()?.emitState();
    },

    getFavorites() { return FavoritesRecents.getFavorites(); },
    getFavoritesMeta() { return FavoritesRecents.getFavoritesMeta(); },
    getFavoriteFolders() { return FavoritesRecents.getFavoriteFolders(); },
    getFavoritesRootOrder() { return FavoritesRecents.getFavoritesRootOrder(); },
    getFavoriteFolder(id) { return FavoritesRecents.getFavoriteFolder(id); },
    suggestFolderName() {
        return FavoritesRecents.suggestFolderName();
    },
    createFavoriteFolder(name) {
        const folder = FavoritesRecents.createFavoriteFolder(name);
        this.emitState();
        return folder;
    },
    renameFavoriteFolder(id, name) {
        const changed = FavoritesRecents.renameFavoriteFolder(id, name);
        if (changed) this.emitState();
        return changed;
    },
    deleteFavoriteFolder(id) {
        const removed = FavoritesRecents.deleteFavoriteFolder(id);
        if (removed) this.emitState();
        return removed;
    },
    reorderFavoritesRoot(orderedRefs) {
        const changed = FavoritesRecents.reorderFavoritesRoot(orderedRefs);
        if (changed) this.emitState();
        return changed;
    },
    reorderFavoriteFolderItems(folderId, orderedKeys) {
        const changed = FavoritesRecents.reorderFavoriteFolderItems(folderId, orderedKeys);
        if (changed) this.emitState();
        return changed;
    },
    moveFavoriteToFolder(channelKeyRef, folderId, options) {
        const moved = FavoritesRecents.moveFavoriteToFolder(channelKeyRef, folderId, options);
        if (moved) this.emitState();
        return moved;
    },
    moveFavoriteToRoot(channelKeyRef, options) {
        const moved = FavoritesRecents.moveFavoriteToRoot(channelKeyRef, options);
        if (moved) this.emitState();
        return moved;
    },
    getRecents() { return FavoritesRecents.getRecents(); },
    getRecentsMeta() { return FavoritesRecents.getRecentsMeta(); },

    clearRecents() {
        FavoritesRecents.clearRecents();
        this.emitState();
    },

    pushRecent(key, channel = null) {
        FavoritesRecents.pushRecent(key, channel);
    },

    isFavorite(channelOrKey) {
        return FavoritesRecents.isFavorite(channelOrKey);
    },

    markVisited(channelOrKey, channel = null) {
        const changed = FavoritesRecents.markVisited(channelOrKey, channel || (typeof channelOrKey === 'object' ? channelOrKey : null));
        if (changed) this.emitState();
        return changed;
    },

    isVisited(channelOrKey) {
        return FavoritesRecents.isVisited(channelOrKey);
    },

    unvisitChannel(channelOrKey) {
        const removed = FavoritesRecents.unvisitChannel(channelOrKey);
        // emitState dispatches tv:state_changed → ChannelGrid.syncVisitedTiles()
        if (removed) this.emitState();
        return removed;
    },

    getVisitedKeys() {
        return FavoritesRecents.getVisitedKeys();
    },

    getVisitedMeta() {
        return FavoritesRecents.getVisitedMeta();
    },

    toggleFavorite(channel) {
        const isFav = FavoritesRecents.toggleFavorite(channel);
        this.emitState();
        return isFav;
    },

    reorderFavorites(orderedKeys) {
        const changed = FavoritesRecents.reorderFavorites(orderedKeys);
        if (changed) this.emitState();
        return changed;
    },

    isHidden(channelOrKey) {
        return HiddenChannels.isHidden(channelOrKey);
    },

    hideChannel(channel) {
        const hidden = HiddenChannels.hideChannel(channel);
        if (hidden) this.emitState();
        return hidden;
    },

    unhideChannel(channelOrKey) {
        const visible = HiddenChannels.unhideChannel(channelOrKey);
        if (visible) this.emitState();
        return visible;
    },

    getHiddenMeta() {
        return HiddenChannels.getHiddenMeta();
    },

    setVolume(value) {
        return MultiView.setSharedVolume(value);
    },

    mute() {
        MultiView.getPrimary()?.mute();
        MultiView.persistSlots();
    },

    unmute() {
        MultiView.getPrimary()?.unmute();
        MultiView.persistSlots();
    },

    toggleMute() {
        MultiView.getPrimary()?.toggleMute();
        MultiView.persistSlots();
    },

    setBufferSize(size) {
        return MultiView.setBufferSize(size);
    },

    getBufferSize() {
        return MultiView.getBufferSize();
    },

    getBufferInfo() {
        return MultiView.getPrimary()?.getBufferInfo() || { buffered: 0, duration: 0 };
    },

    getBandwidthKbps() {
        return MultiView.getPrimary()?.getBandwidthKbps() ?? null;
    },

    getSeekInfo() {
        return MultiView.getPrimary()?.getSeekInfo() || {
            current: 0,
            bufferedStart: 0,
            bufferedEnd: 0,
            isLive: true,
            progress: 0,
            behindLive: null
        };
    },

    toggle() {
        return MultiView.getPrimary()?.toggle();
    },

    resume() {
        return MultiView.getPrimary()?.resume();
    },

    pause() {
        return MultiView.getPrimary()?.pause();
    },

    async resumeIfWasPlaying() {
        return MultiView.getPrimary()?.resumeIfWasPlaying();
    },

    async playChannel(channelOrKey) {
        return MultiView.playOnPrimary(channelOrKey);
    },

    async stop() {
        await MultiView.getPrimary()?.stop();
        MultiView.persistSlots();
    }
};
