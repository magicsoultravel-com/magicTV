import { TvProviderRegistry } from './tvProviders/registry.js';
import {
    channelKey,
    parseChannelKey,
    migrateFavoriteRef,
    normalizeChannel
} from './tvProviders/channelShape.js';
import { canPlayNativeHls, isHlsUrl, loadHlsLibrary } from './tvHls.js';

const STATE_KEY = 'matrix_tv_state';
const RECENTS_CAP = 20;
const DEFAULT_BROWSER_W = 360;
const DEFAULT_BROWSER_H = 420;
const DEFAULT_BROWSE_SORT = 'name';
const DEFAULT_BROWSE_SORT_DIR = 'asc';
const DEFAULT_COUNTRY_SORT = 'count';
const DEFAULT_BUFFER_SIZE = 15; // seconds - default for stable playback
const MAX_BUFFER_SIZE = 120;
const MIN_BUFFER_SIZE = 5; // Allow users to reduce to 5 for faster channel switching
const DEFAULT_LIVE_OFFSET = 3;
const MAX_LIVE_OFFSET = 30;
const MIN_LIVE_OFFSET = 1;

function migrateRecentsMeta(raw) {
    if (Array.isArray(raw.recentsMeta) && raw.recentsMeta.length) {
        return raw.recentsMeta.map((entry) => {
            if (typeof entry === 'string') {
                return { key: migrateFavoriteRef(entry), name: '', logo: '', countrycode: '', at: 0 };
            }
            return {
                key: migrateFavoriteRef(entry.key),
                name: entry.name || '',
                logo: entry.logo || '',
                countrycode: entry.countrycode || '',
                at: Number.isFinite(entry.at) ? entry.at : 0
            };
        }).filter((e) => e.key);
    }
    if (Array.isArray(raw.recents)) {
        return raw.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            logo: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

function loadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        const favorites = Array.isArray(raw.favorites)
            ? raw.favorites.map(migrateFavoriteRef)
            : [];
        // Lightweight display metadata kept with favorite refs so the
        // favorites tab can draw real tiles immediately (no catalog wait).
        const favoritesMeta = (Array.isArray(raw.favoritesMeta) ? raw.favoritesMeta : [])
            .map((e) => ({
                key: migrateFavoriteRef(typeof e === 'string' ? e : e.key),
                name: (e && e.name) || '',
                logo: (e && e.logo) || '',
                countrycode: (e && e.countrycode) || ''
            }))
            .filter((e) => e.key && favorites.includes(e.key));
        const recentsMeta = migrateRecentsMeta(raw);
        const recents = recentsMeta.map((e) => e.key);
        const lastKey = raw.lastChannelKey || null;

        return {
            favorites,
            favoritesMeta,
            recents,
            recentsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastChannelKey: lastKey,
            lastChannelName: raw.lastChannelName || '',
            wasPlaying: raw.wasPlaying === true,
            hideOfflineChannels: raw.hideOfflineChannels !== false,
            browserW: Number.isFinite(raw.browserW) ? raw.browserW : DEFAULT_BROWSER_W,
            browserH: Number.isFinite(raw.browserH) ? raw.browserH : DEFAULT_BROWSER_H,
            browserX: Number.isFinite(raw.browserX) ? raw.browserX : null,
            browserY: Number.isFinite(raw.browserY) ? raw.browserY : null,
            browserFloating: raw.browserFloating === true,
            browseSort: raw.browseSort || DEFAULT_BROWSE_SORT,
            browseSortDir: raw.browseSortDir === 'asc' || raw.browseSortDir === 'desc'
                ? raw.browseSortDir
                : DEFAULT_BROWSE_SORT_DIR,
            countrySort: raw.countrySort || DEFAULT_COUNTRY_SORT,
            bufferSize: Number.isFinite(raw.bufferSize) ? Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, raw.bufferSize)) : DEFAULT_BUFFER_SIZE,
            liveOffset: Number.isFinite(raw.liveOffset) ? Math.min(MAX_LIVE_OFFSET, Math.max(MIN_LIVE_OFFSET, raw.liveOffset)) : DEFAULT_LIVE_OFFSET
        };
    } catch {
        return {
            favorites: [],
            favoritesMeta: [],
            recents: [],
            recentsMeta: [],
            volume: 0.85,
            lastChannelKey: null,
            lastChannelName: '',
            wasPlaying: false,
            hideOfflineChannels: true,
            browserW: DEFAULT_BROWSER_W,
            browserH: DEFAULT_BROWSER_H,
            browserX: null,
            browserY: null,
            browserFloating: false,
            browseSort: DEFAULT_BROWSE_SORT,
            browseSortDir: DEFAULT_BROWSE_SORT_DIR,
            countrySort: DEFAULT_COUNTRY_SORT,
            bufferSize: DEFAULT_BUFFER_SIZE,
            liveOffset: DEFAULT_LIVE_OFFSET
        };
    }
}

function saveState(patch) {
    // Merge onto the raw localStorage blob so sibling writers (registry
    // appearance settings, etc.) are not wiped by a filtered loadState().
    let raw = {};
    try {
        raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
    } catch { /* ignore */ }
    const current = loadState();
    const next = { ...raw, ...current, ...patch };
    if (next.recentsMeta) {
        next.recents = next.recentsMeta.map((e) => e.key);
    }
    if (next.favorites) {
        const favKeys = new Set(next.favorites);
        const seen = new Set();
        next.favoritesMeta = Array.isArray(next.favoritesMeta)
            ? next.favoritesMeta.filter((e) => favKeys.has(e.key) && !seen.has(e.key) && (seen.add(e.key), true))
            : [];
    }
    delete next.miniPlayerDocked;
    delete next.miniPlayerX;
    delete next.miniPlayerY;
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}

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
    volume: loadState().volume,
    lastVolume: loadState().volume || 0.85,
    muted: true, // Start muted for autoplay compliance; will be updated on user interaction
    videoMount: null,

    // Buffer management
    bufferSize: loadState().bufferSize || DEFAULT_BUFFER_SIZE,
    liveOffset: loadState().liveOffset || DEFAULT_LIVE_OFFSET,

    // Stream statistics
    connection: 'idle',
    bandwidth: 0,
    qualityLevel: 0,
    qualityLabel: 'Auto',
    errorCount: 0,
    retryCount: 0,
    maxRetries: 3,
    statsRefreshInterval: null,
    toggling: false,

    // Pause / seek state
    pausePhase: 'idle', // 'idle' | 'pausing' | 'buffering' | 'ready'
    seekInfo: null,

    // Quality adaptation
    currentMaxBitrate: null,

    // Bumps on each playChannel so stale attachStream / play() results are ignored
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
        this.video.autoplay = true; // Required for autoplay policy compliance
        this.video.preload = 'auto'; // Preload enables faster autoplay start
        // Autoplay requires muted in modern browsers; start muted for auto-start
        this.video.muted = true;
        this.video.volume = this.volume;
        this.muted = true; // Start muted so autoplay works
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
            // Video has enough data to play through - signal ready for smooth playback
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
            saveState({ wasPlaying: true });
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
        // Keep monitoring the buffer while paused so it fills to the user's
        // configured buffer size (progress fires when buffered ranges grow).
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

        const saved = loadState();
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

    mountToHolder() {
        this.mountVideo(this.videoHolder);
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

    getFavorites() {
        return [...loadState().favorites];
    },

    getFavoritesMeta() {
        return loadState().favoritesMeta.map((e) => ({ ...e }));
    },

    getRecents() {
        return [...loadState().recents];
    },

    getRecentsMeta() {
        return loadState().recentsMeta.map((e) => ({ ...e }));
    },

    getWasPlaying() {
        return loadState().wasPlaying;
    },

    getBrowseSort() {
        return loadState().browseSort || DEFAULT_BROWSE_SORT;
    },

    saveBrowseSort(sort) {
        saveState({ browseSort: sort || DEFAULT_BROWSE_SORT });
    },

    getBrowseSortDir() {
        const dir = loadState().browseSortDir;
        return dir === 'asc' || dir === 'desc' ? dir : DEFAULT_BROWSE_SORT_DIR;
    },

    saveBrowseSortDir(dir) {
        saveState({ browseSortDir: dir === 'desc' ? 'desc' : 'asc' });
    },

    getCountrySort() {
        return loadState().countrySort || DEFAULT_COUNTRY_SORT;
    },

    saveCountrySort(sort) {
        saveState({ countrySort: sort || DEFAULT_COUNTRY_SORT });
    },

    clearRecents() {
        saveState({ recentsMeta: [] });
        this.emitState();
    },

    getBrowserSize() {
        const s = loadState();
        return { w: s.browserW, h: s.browserH };
    },

    getBrowserPosition() {
        const s = loadState();
        return {
            browserX: s.browserX,
            browserY: s.browserY,
            browserFloating: s.browserFloating
        };
    },

    saveBrowserSize(w, h) {
        saveState({ browserW: w, browserH: h });
    },

    saveBrowserPosition(patch) {
        saveState(patch);
    },

    pushRecent(key, channel = null) {
        if (!key) return;
        const meta = loadState().recentsMeta.filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || '',
            at: Date.now()
        });
        saveState({ recentsMeta: meta.slice(0, RECENTS_CAP) });
    },

    isFavorite(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        return loadState().favorites.includes(key);
    },

    toggleFavorite(channel) {
        const key = channelKey(channel);
        if (!key) return false;
        const favorites = loadState().favorites;
        const idx = favorites.indexOf(key);
        if (idx >= 0) {
            favorites.splice(idx, 1);
            saveState({ favorites, favoritesMeta: loadState().favoritesMeta.filter((e) => e.key !== key) });
            this.emitState();
            return false;
        }
        favorites.unshift(key);
        const favoritesMeta = loadState().favoritesMeta.filter((e) => e.key !== key);
        favoritesMeta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || ''
        });
        saveState({ favorites, favoritesMeta });
        const parsed = parseChannelKey(key);
        TvProviderRegistry.getChannel(parsed).catch(() => {});
        this.emitState();
        return true;
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
        saveState({ volume: this.volume });
        this.emitState();
    },

    adjustVolume(delta) {
        const next = Math.min(1, Math.max(0, (this.muted ? this.lastVolume || 0.85 : this.volume) + delta));
        this.setVolume(next);
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
        if (this.muted) {
            this.unmute();
        } else {
            this.mute();
        }
    },

    setBufferSize(size) {
        const clamped = Math.min(MAX_BUFFER_SIZE, Math.max(MIN_BUFFER_SIZE, size));
        saveState({ bufferSize: clamped });
        this.bufferSize = clamped;
        if (this.hls) {
            this.hls.config.maxBufferLength = clamped;
            this.hls.config.maxBufferSize = 20 * 1024 * 1024; // Keep 20MB max
            this.hls.config.maxBitrate = 5000000; // Allow up to 5Mbps
        }
        this.emitState();
        return clamped;
    },

    getBufferSize() {
        return loadState().bufferSize || DEFAULT_BUFFER_SIZE;
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
            duration: duration
        };
    },

    getLiveOffset() {
        return loadState().liveOffset || DEFAULT_LIVE_OFFSET;
    },

    setLiveOffset(offset) {
        const clamped = Math.min(MAX_LIVE_OFFSET, Math.max(MIN_LIVE_OFFSET, offset));
        saveState({ liveOffset: clamped });
        this.liveOffset = clamped;
        if (this.hls) {
            this.hls.config.liveSyncDurationCount = clamped;
            this.hls.startLoad();
        }
        this.emitState();
        return clamped;
    },

    getSeekInfo() {
        const video = this.video;
        if (!video || !video.buffered || video.buffered.length === 0) {
            return { current: 0, bufferedStart: 0, bufferedEnd: 0, isLive: !Number.isFinite(video?.duration), progress: 0, behindLive: null };
        }
        const duration = video.duration;
        const isLive = !Number.isFinite(duration);
        const current = video.currentTime || 0;
        const bufferedStart = video.buffered.start(0);
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        // Allow seeking anywhere within the buffered range (both backward and forward)
        const seekableStart = bufferedStart;
        const seekableEnd = bufferedEnd;
        const seekableDuration = Math.max(0, seekableEnd - seekableStart);
        const progress = seekableDuration > 0 ? ((current - seekableStart) / seekableDuration) * 100 : 0;
        let behindLive = null;
        if (isLive && this.hls && typeof this.hls.latency === 'number') {
            behindLive = this.hls.latency;
        }
        return {
            current,
            bufferedStart: seekableStart,
            bufferedEnd: seekableEnd,
            isLive,
            progress: Math.min(100, Math.max(0, progress)),
            behindLive
        };
    },

    seekTo(time) {
        const video = this.video;
        if (!video || !video.buffered || video.buffered.length === 0) return;
        const duration = video.duration;
        const isLive = !Number.isFinite(duration);
        const current = video.currentTime || 0;
        const bufferedStart = video.buffered.start(0);
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const seekableStart = bufferedStart;
        const seekableEnd = bufferedEnd;
        const target = Math.min(seekableEnd, Math.max(seekableStart, time));
        if (target !== video.currentTime) {
            video.currentTime = target;
            this.emitState();
        }
    },

    updatePauseBuffer() {
        if (this.pausePhase === 'idle' || this.pausePhase === 'pausing') {
            const info = this.getBufferInfo();
            const target = this.bufferSize || DEFAULT_BUFFER_SIZE;
            if (info.buffered >= target * 0.9) {
                this.pausePhase = 'ready';
            } else {
                this.pausePhase = 'buffering';
                // Keep the HLS load loop active so the buffer fills up to the
                // user-configured target while paused.
                if (this.hls) {
                    this.hls.startLoad();
                }
            }
            this.emitState();
        }
    },

    getStats() {
        const bandwidth = this.getBandwidth();
        let qualityLevel = this.qualityLabel || 'Auto';
        // Derive the active level live when HLS has parsed levels.
        if (this.hls && Array.isArray(this.hls.levels)) {
            const idx = this.hls.currentLevel;
            if (idx >= 0 && this.hls.levels[idx]?.height) {
                qualityLevel = `${this.hls.levels[idx].height}p`;
            }
        }
        return {
            connection: this.connection || 'idle',
            bandwidth,
            qualityLevel,
            buffer: this.getBufferInfo(),
            errorCount: this.errorCount || 0,
            retryCount: this.retryCount || 0,
            bufferSize: this.bufferSize || DEFAULT_BUFFER_SIZE,
            liveLatency: this.getLiveLatency(),
            volume: this.volume,
            muted: this.muted,
            seekInfo: this.getSeekInfo(),
            pausePhase: this.pausePhase
        };
    },

    getBandwidth() {
        // HLS.js maintains a live ABR bandwidth estimate (bits/sec) on every
        // fragment load — no extra polling needed on our side.
        if (this.hls?.bandwidthEstimate) {
            return this.hls.bandwidthEstimate;
        }
        // Fallback: report the current level's declared bitrate.
        if (this.hls && Array.isArray(this.hls.levels)) {
            const idx = this.hls.currentLevel >= 0
                ? this.hls.currentLevel
                : this.hls.level;
            if (idx >= 0 && this.hls.levels[idx]?.bitrate) {
                return this.hls.levels[idx].bitrate;
            }
        }
        return this.bandwidth || 0;
    },

    getLiveLatency() {
        if (!this.video || !this.hls) return null;
        try {
            const latency = this.hls.latency;
            return typeof latency === 'number' ? latency : null;
        } catch {
            return null;
        }
    },

    getBufferPercentage() {
        const info = this.getBufferInfo();
        if (!info || info.buffered <= 0) return 0;
        // Live HLS streams report Infinity duration; fall back to the
        // configured target buffer size as the denominator (buffer health %).
        const denominator = Number.isFinite(info.duration) && info.duration > 0
            ? info.duration
            : (this.bufferSize || DEFAULT_BUFFER_SIZE);
        if (!denominator) return 0;
        return Math.min(100, Math.max(0, (info.buffered / denominator) * 100));
    },

    async destroyHls() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    },

    async attachStream(url, generation = this.playGeneration) {
        await this.destroyHls();
        if (generation !== this.playGeneration) return;
        const video = this.video;
        this.connection = 'connecting';
        video.removeAttribute('src');
        video.load();

        if (isHlsUrl(url)) {
            if (canPlayNativeHls(video)) {
                if (generation !== this.playGeneration) return;
                video.src = url;
                this.updateBufferSize();
                return;
            }
            const Hls = await loadHlsLibrary();
            if (generation !== this.playGeneration) return;
            if (!Hls.isSupported()) {
                throw new Error('HLS not supported');
            }
            await new Promise((resolve, reject) => {
                if (generation !== this.playGeneration) {
                    resolve();
                    return;
                }
                this.hls = new Hls({
                    maxBufferSize: 20 * 1024 * 1024, // 20MB max buffer (in bytes)
                    maxBufferLength: this.getBufferSize(), // Current target in seconds
                    minBufferLength: 1.0, // Minimum buffer to keep (helps with live TV)
                    maxBitrate: 5000000, // Allow up to 5Mbps for all buffer sizes
                    startPosition: 0,
                    enableWorker: true,
                    // Additional HLS.js config for quality adaptation
                    abrController: Hls.AbrController,
                    capLevelToPlayerImpl: true,
                    // Live stream specific settings
                    liveSyncDurationCount: this.getLiveOffset(), // Segments to sync to live edge
                    liveMaxLatencyDurationCount: 10 // Max latency for live streams
                });
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (generation !== this.playGeneration) {
                        resolve();
                        return;
                    }
                    this.connection = 'connected';
                    this.qualityLevel = 0;
                    this.qualityLabel = 'auto';
                    this.emitState();
                    resolve();
                });
                this.hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    if (generation !== this.playGeneration || !this.hls) return;
                    if (data.level !== undefined && this.hls.levels && this.hls.levels[data.level]) {
                        this.qualityLabel = `${this.hls.levels[data.level].height}p`;
                    }
                    this.emitState();
                });
                this.hls.on(Hls.Events.ERROR, (_, data) => {
                    if (generation !== this.playGeneration) return;
                    if (data.fatal) {
                        this.error = 'Stream unavailable';
                        this.errorCount = (this.errorCount || 0) + 1;
                        reject(new Error('Stream unavailable'));
                        return;
                    }
                    // Auto-recover non-fatal errors
                    if (!this.hls) return;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        this.hls.startLoad();
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        this.hls.recoverMediaError();
                    }
                });
                this.hls.on(Hls.Events.LEVEL_SWITCHING, (_, data) => {
                    if (generation !== this.playGeneration || !this.hls) return;
                    if (data.level !== undefined && this.hls.levels && this.hls.levels[data.level]) {
                        this.qualityLabel = `${this.hls.levels[data.level].height}p`;
                    }
                    this.emitState();
                });
                this.hls.on(Hls.Events.BUFFER_DEPTH_UPDATE, () => {
                    if (generation !== this.playGeneration) return;
                    this.emitState();
                });
                this.hls.loadSource(url);
                this.hls.attachMedia(video);
            });
            return;
        }

        if (generation !== this.playGeneration) return;
        video.src = url;
        this.updateBufferSize();
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
                    saveState({ wasPlaying: false });
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
        this.pausePhase = 'pausing';
        saveState({ wasPlaying: false });
        if (this.hls) {
            this.hls.startLoad();
        }
        this.emitState();
        this.updatePauseBuffer();
    },

    updateBufferSize() {
        const size = this.bufferSize || this.getBufferSize();
        this.bufferSize = size;
        if (this.hls) {
            this.hls.config.maxBufferLength = size;
            this.hls.config.maxBufferSize = 20 * 1024 * 1024;
            this.hls.config.maxBitrate = 5000000;
        }
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
                saveState({ wasPlaying: false });
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
            saveState({
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
                saveState({ wasPlaying: false });
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

    getQualityLevelIndex() {
        return this.hls?.currentLevel ?? -1;
    },

    getQualityOptions() {
        const levels = this.getQualityLabels();
        return [
            { label: 'Auto', index: -1 },
            ...levels.map((l) => ({ label: l.label, index: l.index }))
        ];
    },

    setQualityLevel(index) {
        if (!this.hls) return false;
        const target = Number.isFinite(index) ? index : -1;
        try {
            // hls.js: currentLevel = -1 enables ABR; otherwise pin the level.
            this.hls.currentLevel = target;
            if (target < 0) {
                this.qualityLabel = 'Auto';
            } else if (this.hls.levels?.[target]?.height) {
                this.qualityLabel = `${this.hls.levels[target].height}p`;
            }
            this.emitState();
            return true;
        } catch {
            return false;
        }
    },

    getQualityLabels() {
        if (!this.hls || !this.hls.levels) return [];
        return this.hls.levels.map((level, i) => ({
            label: level?.height ? `${level.height}p` : `Level ${i}`,
            bitrate: level?.bitrate || 0,
            index: i
        }));
    },

    setMaxQualityBitrate(bitrate) {
        if (this.hls) {
            this.hls.config.maxBitrate = bitrate;
            this.currentMaxBitrate = bitrate;
        }
    },

    // Close everything and cleanup
    async stop() {
        this.playGeneration += 1;
        // If the video is floating in a Picture-in-Picture window, bring it back first.
        if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
            try { await document.exitPictureInPicture(); } catch { /* ignore */ }
        }
        if (this.statsRefreshInterval) {
            clearInterval(this.statsRefreshInterval);
            this.statsRefreshInterval = null;
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
        saveState({ wasPlaying: false });
        this.emitState();
    }
};
