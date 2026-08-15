import { TvProviderRegistry } from './tvProviders/registry.js';
import {
    channelKey,
    parseChannelKey,
    normalizeChannel
} from './tvProviders/channelShape.js';
import {
    loadPlayerState,
    savePlayerState,
    DEFAULT_BUFFER_SIZE,
    MAX_BUFFER_SIZE,
    MIN_BUFFER_SIZE
} from './storage/playerState.js';
import { FavoritesRecents } from './storage/favoritesRecents.js';
import { attachStream, destroyHls, applyHlsBufferConfig } from './player/hlsAttach.js';

function dispatchState(detail) {
    window.dispatchEvent(new CustomEvent('tv:state_changed', { detail }));
}

export const TvPlayer = {
    video: null,
    videoHolder: null,
    hls: null,
    channel: null,
    playing: false,
    loading: false,
    loadPhase: 'idle',
    error: null,
    resumeBlocked: false,
    recentRecordedForKey: null,
    volume: loadPlayerState().volume,
    lastVolume: loadPlayerState().volume || 0.85,
    muted: true,
    videoMount: null,

    bufferSize: loadPlayerState().bufferSize || DEFAULT_BUFFER_SIZE,

    connection: 'idle',
    qualityLevel: 0,
    qualityLabel: 'Auto',
    errorCount: 0,
    retryCount: 0,
    maxRetries: 3,
    toggling: false,

    pausePhase: 'idle',
    playGeneration: 0,

    init() {
        if (this.video) return;

        this.videoHolder = document.createElement('div');
        this.videoHolder.id = 'tv-video-holder';
        this.videoHolder.className = 'tv-video-holder is-hidden';
        this.videoHolder.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.videoHolder);

        this.video = document.createElement('video');
        this.video.className = 'tv-video';
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', '');
        this.video.autoplay = true;
        this.video.preload = 'auto';
        this.video.muted = true;
        this.video.volume = this.volume;
        this.muted = true;
        this.lastVolume = this.volume > 0 ? this.volume : 0.85;
        this.videoHolder.appendChild(this.video);

        this.video.addEventListener('loadstart', () => {
            this.loadPhase = 'connecting';
            this.emitState();
        });
        this.video.addEventListener('canplay', () => {
            if (this.loadPhase !== 'idle') {
                this.loadPhase = 'idle';
                this.emitState();
            }
        });
        this.video.addEventListener('canplaythrough', () => {
            if (this.loading) {
                this.loading = false;
                this.emitState();
            }
        });
        this.video.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.pausePhase = 'idle';
            this.error = null;
            this.resumeBlocked = false;
            savePlayerState({ wasPlaying: true });
            const key = channelKey(this.channel);
            if (key && this.recentRecordedForKey !== key) {
                this.recentRecordedForKey = key;
                this.pushRecent(key, this.channel);
            }
            this.emitState();
        });
        this.video.addEventListener('timeupdate', () => {
            if (this.pausePhase !== 'idle') {
                this.updatePauseBuffer();
            }
        });
        this.video.addEventListener('progress', () => {
            if (this.pausePhase !== 'idle') {
                this.updatePauseBuffer();
                this.emitState();
            }
        });
        this.video.addEventListener('pause', () => {
            this.playing = false;
            if (this.pausePhase !== 'idle') {
                this.updatePauseBuffer();
            }
            this.emitState();
        });
        this.video.addEventListener('waiting', () => {
            this.loading = true;
            this.loadPhase = 'buffering';
            if (this.pausePhase !== 'idle') {
                this.pausePhase = 'buffering';
            }
            this.emitState();
        });
        this.video.addEventListener('stalled', () => {
            if (this.playing || this.loading) {
                this.loadPhase = 'buffering';
                if (this.pausePhase !== 'idle') {
                    this.pausePhase = 'buffering';
                }
                this.emitState();
            }
        });
        this.video.addEventListener('error', () => {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        this.video.addEventListener('ended', () => {
            this.playing = false;
            this.loadPhase = 'idle';
            this.emitState();
        });

        const saved = loadPlayerState();
        if (saved.lastChannelKey) {
            const parsed = parseChannelKey(saved.lastChannelKey);
            this.channel = {
                providerId: parsed.providerId,
                channelId: parsed.channelId,
                channeluuid: saved.lastChannelKey,
                name: saved.lastChannelName || 'Last channel'
            };
            this.emitState();
        }
    },

    mountVideo(targetEl) {
        if (!this.video) return;
        const mount = targetEl || this.videoHolder;
        if (this.video.parentElement !== mount) {
            mount.appendChild(this.video);
        }
        this.videoMount = mount;
        mount.classList?.remove('is-hidden');
        this.videoHolder.classList.toggle('is-hidden', mount !== this.videoHolder);
    },

    emitState() {
        dispatchState({
            channel: this.channel,
            playing: this.playing,
            loading: this.loading,
            loadPhase: this.loadPhase,
            pausePhase: this.pausePhase,
            error: this.error,
            resumeBlocked: this.resumeBlocked,
            volume: this.volume,
            favorites: this.getFavorites(),
            favoritesMeta: this.getFavoritesMeta(),
            recents: this.getRecents(),
            recentsMeta: this.getRecentsMeta(),
            seekInfo: this.getSeekInfo()
        });
    },

    getFavorites() { return FavoritesRecents.getFavorites(); },
    getFavoritesMeta() { return FavoritesRecents.getFavoritesMeta(); },
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

    toggleFavorite(channel) {
        const isFav = FavoritesRecents.toggleFavorite(channel);
        this.emitState();
        return isFav;
    },

    setVolume(value) {
        const clamped = Math.min(1, Math.max(0, value));
        this.volume = clamped;
        if (clamped > 0) {
            this.lastVolume = clamped;
            this.muted = false;
        } else if (clamped === 0) {
            this.muted = true;
        }
        if (this.video) {
            this.video.volume = clamped;
            this.video.muted = clamped === 0;
        }
        savePlayerState({ volume: this.volume });
        this.emitState();
    },

    mute() {
        this.muted = true;
        if (this.video) this.video.muted = true;
        this.emitState();
    },

    unmute() {
        this.muted = false;
        this.setVolume(this.lastVolume > 0 ? this.lastVolume : 0.85);
    },

    toggleMute() {
        if (this.muted) this.unmute();
        else this.mute();
    },

    setBufferSize(size) {
        const clamped = Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, size));
        savePlayerState({ bufferSize: clamped });
        this.bufferSize = clamped;
        applyHlsBufferConfig(this.hls, clamped);
        this.emitState();
        return clamped;
    },

    getBufferSize() {
        return loadPlayerState().bufferSize || DEFAULT_BUFFER_SIZE;
    },

    getBufferInfo() {
        const video = this.video;
        if (!video || !video.buffered || video.buffered.length === 0) {
            return { buffered: 0, duration: 0 };
        }
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration || 0;
        return {
            buffered: Math.max(0, bufferedEnd - (video.currentTime || 0)),
            duration
        };
    },

    getSeekInfo() {
        const video = this.video;
        if (!video || !video.buffered || video.buffered.length === 0) {
            return {
                current: 0,
                bufferedStart: 0,
                bufferedEnd: 0,
                isLive: !Number.isFinite(video?.duration),
                progress: 0,
                behindLive: null
            };
        }
        const duration = video.duration;
        const isLive = !Number.isFinite(duration);
        const current = video.currentTime || 0;
        const bufferedStart = video.buffered.start(0);
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const seekableDuration = Math.max(0, bufferedEnd - bufferedStart);
        const progress = seekableDuration > 0
            ? ((current - bufferedStart) / seekableDuration) * 100
            : 0;
        let behindLive = null;
        if (isLive && this.hls && typeof this.hls.latency === 'number') {
            behindLive = this.hls.latency;
        }
        return {
            current,
            bufferedStart,
            bufferedEnd,
            isLive,
            progress: Math.min(100, Math.max(0, progress)),
            behindLive
        };
    },

    updatePauseBuffer() {
        if (this.pausePhase === 'idle' || this.pausePhase === 'pausing') {
            const info = this.getBufferInfo();
            const target = this.bufferSize || DEFAULT_BUFFER_SIZE;
            if (info.buffered >= target * 0.9) {
                this.pausePhase = 'ready';
            } else {
                this.pausePhase = 'buffering';
                if (this.hls) this.hls.startLoad();
            }
            this.emitState();
        }
    },

    async destroyHls() {
        await destroyHls(this);
    },

    async attachStream(url, generation = this.playGeneration) {
        return attachStream(this, url, generation);
    },

    async toggle() {
        if (this.toggling) return;
        this.toggling = true;
        try {
            if (this.playing) {
                this.pause();
                return;
            }
            this.resumeBlocked = false;
            if (this.channel?.url_resolved && (this.video?.src || this.hls)) {
                try {
                    await this.video.play();
                } catch {
                    this.error = 'Playback blocked';
                    this.resumeBlocked = true;
                    savePlayerState({ wasPlaying: false });
                    this.emitState();
                }
                return;
            }
            if (this.channel) {
                await this.playChannel(this.channel);
            }
        } finally {
            this.toggling = false;
        }
    },

    pause() {
        this.video?.pause();
        this.playing = false;
        this.loading = false;
        this.pausePhase = 'pausing';
        savePlayerState({ wasPlaying: false });
        if (this.hls) this.hls.startLoad();
        this.emitState();
        this.updatePauseBuffer();
    },

    updateBufferSize() {
        const size = this.bufferSize || this.getBufferSize();
        this.bufferSize = size;
        applyHlsBufferConfig(this.hls, size);
        if (this.video) {
            this.video.preload = size > 60 ? 'auto' : 'metadata';
        }
        this.emitState();
    },

    async resumeIfWasPlaying() {
        if (!this.channel) return;
        try {
            await this.playChannel(this.channel);
        } catch (e) {
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.resumeBlocked = true;
                savePlayerState({ wasPlaying: false });
                this.emitState();
            }
        }
    },

    async playChannel(channelOrKey) {
        this.init();
        const generation = ++this.playGeneration;
        let channel = typeof channelOrKey === 'object' && channelOrKey !== null
            ? channelOrKey
            : null;

        if (!channel && typeof channelOrKey === 'string') {
            const parsed = parseChannelKey(channelOrKey);
            channel = await TvProviderRegistry.getChannel(parsed);
            if (generation !== this.playGeneration) return;
        }

        if (channel && !channel.url_resolved) {
            const parsed = parseChannelKey(channelKey(channel));
            channel = await TvProviderRegistry.getChannel(parsed);
            if (generation !== this.playGeneration) return;
        }

        const key = channelKey(channel);
        if (!key || !channel) return;

        this.recentRecordedForKey = null;
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.resumeBlocked = false;
        this.emitState();

        try {
            if (!channel.url_resolved) {
                throw new Error('No stream URL');
            }

            this.channel = normalizeChannel(channel, channel.providerId) || channel;
            savePlayerState({
                lastChannelKey: key,
                lastChannelName: channel.name || ''
            });

            await this.attachStream(channel.url_resolved, generation);
            if (generation !== this.playGeneration) return;
            await this.video.play();
            if (generation !== this.playGeneration) return;
        } catch (e) {
            if (generation !== this.playGeneration) return;
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.error = null;
                this.resumeBlocked = true;
                savePlayerState({ wasPlaying: false });
            } else {
                this.error = 'Stream unavailable';
            }
            if (typeof channelOrKey === 'object' && channelOrKey?.name) {
                this.channel = normalizeChannel(channelOrKey, channelOrKey.providerId) || channelOrKey;
            }
            this.emitState();
            if (blocked) throw e;
        }
    },

    async stop() {
        this.playGeneration += 1;
        if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
            try { await document.exitPictureInPicture(); } catch { /* ignore */ }
        }
        if (this.hls) {
            await this.destroyHls();
        }
        if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
        }
        this.playing = false;
        this.loading = false;
        this.loadPhase = 'idle';
        this.error = null;
        this.connection = 'idle';
        this.pausePhase = 'idle';
        savePlayerState({ wasPlaying: false });
        this.emitState();
    }
};
