/**
 * MagicTV radio player — HTML5 Audio with master×slot gain (room mix).
 */
import { RadioProviderRegistry } from './radioProviders/registry.js';
import {
    stationKey,
    parseStationKey
} from './stationShape.js';
import {
    RADIO_RECENTS_CAP,
    DEFAULT_BROWSE_SORT,
    DEFAULT_BROWSE_SORT_DIR,
    DEFAULT_COUNTRY_SORT,
    loadRadioState,
    patchRadioState
} from './radioState.js';
import { RadioCast } from './radioCast.js';

/** @type {(() => number) | null} */
let getMasterVolume = null;

function dispatchState(detail) {
    window.dispatchEvent(new CustomEvent('radio:state_changed', { detail }));
}

export const RadioPlayer = {
    audio: null,
    station: null,
    playing: false,
    loading: false,
    loadPhase: 'idle',
    error: null,
    recentRecordedForKey: null,
    volume: loadRadioState().volume,
    muted: loadRadioState().muted === true,
    streamUrl: null,
    /** True while casting and host audio is off (local intentionally silent). */
    castLocalSuppressed: false,

    init({ getSharedVolume } = {}) {
        if (typeof getSharedVolume === 'function') {
            getMasterVolume = getSharedVolume;
        }
        if (this.audio) {
            this.applyAudioGain();
            return;
        }
        if (typeof Audio === 'undefined') {
            // Non-browser / test stubs — defer real element until play().
            const saved = loadRadioState();
            if (saved.lastStationKey) {
                const parsed = parseStationKey(saved.lastStationKey);
                this.station = {
                    providerId: parsed.providerId,
                    stationId: parsed.stationId,
                    stationuuid: saved.lastStationKey,
                    name: saved.lastStationName || 'Last station',
                    favicon: saved.lastStationFavicon || '',
                    countrycode: saved.lastStationCountrycode || ''
                };
                this.emitState();
            }
            return;
        }
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.bindAudioListeners(this.audio);
        this.applyAudioGain();

        const saved = loadRadioState();
        if (saved.lastStationKey) {
            const parsed = parseStationKey(saved.lastStationKey);
            this.station = {
                providerId: parsed.providerId,
                stationId: parsed.stationId,
                stationuuid: saved.lastStationKey,
                name: saved.lastStationName || 'Last station',
                favicon: saved.lastStationFavicon || '',
                countrycode: saved.lastStationCountrycode || ''
            };
            this.emitState();
        }
    },

    ensureAudio() {
        if (this.audio) return this.audio;
        if (typeof Audio === 'undefined') {
            throw new Error('Audio unavailable');
        }
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.bindAudioListeners(this.audio);
        this.applyAudioGain();
        return this.audio;
    },

    setMasterVolumeGetter(fn) {
        getMasterVolume = typeof fn === 'function' ? fn : null;
        this.applyAudioGain();
    },

    masterVolume() {
        const v = getMasterVolume?.();
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    },

    applyAudioGain() {
        if (!this.audio) return;
        const master = this.masterVolume();
        const slot = Number.isFinite(this.volume) ? this.volume : 1;
        const heard = Math.min(1, Math.max(0, master * slot));
        this.audio.volume = heard;
        const forceMute = this.muted || heard === 0 || this.castLocalSuppressed;
        this.audio.muted = forceMute;
    },

    bindAudioListeners(audio) {
        audio.addEventListener('loadstart', () => {
            this.loadPhase = 'connecting';
            this.emitState();
        });
        audio.addEventListener('canplay', () => {
            if (this.loadPhase !== 'idle') {
                this.loadPhase = 'idle';
                this.emitState();
            }
        });
        audio.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            patchRadioState({ wasPlaying: true });
            const key = stationKey(this.station);
            if (key && this.recentRecordedForKey !== key) {
                this.recentRecordedForKey = key;
                this.pushRecent(key, this.station);
            }
            this.emitState();
        });
        audio.addEventListener('pause', () => {
            this.playing = false;
            this.emitState();
        });
        audio.addEventListener('waiting', () => {
            this.loading = true;
            this.loadPhase = 'buffering';
            this.emitState();
        });
        audio.addEventListener('error', () => {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        audio.addEventListener('ended', () => {
            this.playing = false;
            this.loadPhase = 'idle';
            this.emitState();
        });
    },

    emitState() {
        dispatchState({
            station: this.station,
            playing: this.playing,
            loading: this.loading,
            loadPhase: this.loadPhase,
            error: this.error,
            volume: this.volume,
            muted: this.muted,
            castLocalSuppressed: this.castLocalSuppressed,
            favorites: this.getFavorites(),
            recents: this.getRecents(),
            recentsMeta: this.getRecentsMeta(),
            casting: RadioCast.isCasting(),
            castHostAudio: RadioCast.getHostAudio()
        });
    },

    isAudible() {
        if (!this.station?.url_resolved && !this.streamUrl && !this.playing) {
            // Has loaded station stub or actively playing/paused with src
            if (!this.station && !this.audio?.src) return false;
        }
        if (this.castLocalSuppressed && !RadioCast.getHostAudio()) {
            // Local silent while cast — not "audible" locally, but has a station
        }
        const hasStation = Boolean(this.station && (this.streamUrl || this.station.url_resolved || this.playing || this.audio?.src));
        if (!hasStation && !this.playing) return false;
        return !this.muted
            && this.masterVolume() > 0
            && (this.volume ?? 1) > 0
            && !this.castLocalSuppressed
            && (this.playing || (this.audio && !this.audio.paused && this.audio.src));
    },

    /** Soft audible check for mute-all UI (station loaded and not muted). */
    hasActiveStation() {
        return Boolean(this.station && (this.streamUrl || this.station.url_resolved || this.audio?.src || this.playing));
    },

    getFavorites() {
        return [...loadRadioState().favorites];
    },

    getRecents() {
        return [...loadRadioState().recents];
    },

    getRecentsMeta() {
        return loadRadioState().recentsMeta.map((e) => ({ ...e }));
    },

    getBrowseSort() {
        return loadRadioState().browseSort || DEFAULT_BROWSE_SORT;
    },

    saveBrowseSort(sort) {
        patchRadioState({ browseSort: sort || DEFAULT_BROWSE_SORT });
    },

    getBrowseSortDir() {
        return loadRadioState().browseSortDir || DEFAULT_BROWSE_SORT_DIR;
    },

    saveBrowseSortDir(dir) {
        patchRadioState({ browseSortDir: dir === 'desc' ? 'desc' : 'asc' });
    },

    getCountrySort() {
        return loadRadioState().countrySort || DEFAULT_COUNTRY_SORT;
    },

    saveCountrySort(sort) {
        patchRadioState({ countrySort: sort || DEFAULT_COUNTRY_SORT });
    },

    isFavorite(keyOrStation) {
        const key = typeof keyOrStation === 'string' ? keyOrStation : stationKey(keyOrStation);
        return key ? this.getFavorites().includes(key) : false;
    },

    toggleFavorite(keyOrStation) {
        const key = typeof keyOrStation === 'string' ? keyOrStation : stationKey(keyOrStation);
        if (!key) return false;
        const favorites = this.getFavorites();
        const idx = favorites.indexOf(key);
        if (idx >= 0) favorites.splice(idx, 1);
        else favorites.unshift(key);
        patchRadioState({ favorites });
        this.emitState();
        return idx < 0;
    },

    pushRecent(key, station) {
        if (!key) return;
        const meta = this.getRecentsMeta().filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: station?.name || '',
            favicon: station?.favicon || '',
            countrycode: station?.countrycode || '',
            at: Date.now()
        });
        patchRadioState({ recentsMeta: meta.slice(0, RADIO_RECENTS_CAP) });
    },

    clearRecents() {
        patchRadioState({ recentsMeta: [], recents: [] });
        this.emitState();
    },

    setVolume(value) {
        const clamped = Math.min(1, Math.max(0, Number(value) || 0));
        this.volume = clamped;
        patchRadioState({ volume: clamped });
        if (clamped > 0 && this.muted) {
            this.muted = false;
            patchRadioState({ muted: false });
        }
        this.applyAudioGain();
        this.emitState();
        return clamped;
    },

    mute() {
        this.muted = true;
        patchRadioState({ muted: true });
        this.applyAudioGain();
        this.emitState();
    },

    unmute() {
        if (this.masterVolume() <= 0) return;
        this.muted = false;
        if (!(this.volume > 0)) this.volume = 0.85;
        patchRadioState({ muted: false, volume: this.volume });
        this.applyAudioGain();
        this.emitState();
    },

    toggleMute() {
        if (this.muted || this.masterVolume() <= 0 || !(this.volume > 0)) this.unmute();
        else this.mute();
    },

    setCastLocalSuppressed(suppressed) {
        this.castLocalSuppressed = suppressed === true;
        this.applyAudioGain();
        this.emitState();
    },

    async playStation(keyOrStation) {
        this.init();
        this.ensureAudio();
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.emitState();

        let station = null;
        try {
            if (typeof keyOrStation === 'string') {
                const parsed = parseStationKey(keyOrStation);
                const provider = RadioProviderRegistry.get(parsed.providerId);
                station = await provider.getStationById(parsed.stationId, { forPlay: true });
            } else if (keyOrStation?.url_resolved) {
                station = keyOrStation;
            } else if (keyOrStation) {
                const key = stationKey(keyOrStation);
                const parsed = parseStationKey(key);
                const provider = RadioProviderRegistry.get(parsed.providerId);
                station = await provider.getStationById(parsed.stationId, { forPlay: true });
            }
        } catch (e) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = e?.message || 'Station unavailable';
            this.emitState();
            throw e;
        }

        if (!station?.url_resolved) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'No stream URL';
            this.emitState();
            throw new Error('No stream URL');
        }
        if (station.lastcheckok === 0) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'Station offline';
            this.emitState();
            throw new Error('Station offline');
        }

        this.station = station;
        this.recentRecordedForKey = null;
        const key = stationKey(station);
        patchRadioState({
            lastStationKey: key,
            lastStationName: station.name || '',
            lastStationFavicon: station.favicon || '',
            lastStationCountrycode: station.countrycode || ''
        });

        try {
            RadioProviderRegistry.get(station.providerId)?.reportClick?.(station.stationId);
        } catch { /* non-critical */ }

        this.audio.src = station.url_resolved;
        this.streamUrl = station.url_resolved;
        this.applyAudioGain();

        try {
            await this.audio.play();
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            patchRadioState({ wasPlaying: true });
            this.emitState();

            // If casting, reload cast with new station
            if (RadioCast.isCasting()) {
                try {
                    await RadioCast.castStation(station.url_resolved, station.name);
                    this.syncCastLocal();
                } catch { /* ignore cast reload errors */ }
            }
        } catch (e) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = e?.name === 'NotAllowedError' ? 'Tap play to start' : 'Playback failed';
            this.emitState();
            throw e;
        }
    },

    async play() {
        this.init();
        this.ensureAudio();
        if (this.audio?.src && this.station) {
            this.applyAudioGain();
            try {
                await this.audio.play();
                return;
            } catch {
                /* fall through to reload */
            }
        }
        const key = this.station
            ? stationKey(this.station)
            : loadRadioState().lastStationKey;
        if (!key) throw new Error('No station');
        await this.playStation(key);
    },

    pause() {
        if (!this.audio) return;
        this.audio.pause();
        this.playing = false;
        patchRadioState({ wasPlaying: false });
        this.emitState();
    },

    async togglePlay() {
        if (this.playing) this.pause();
        else await this.play();
    },

    stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.playing = false;
        this.loading = false;
        this.loadPhase = 'idle';
        this.streamUrl = null;
        this.error = null;
        this.castLocalSuppressed = false;
        patchRadioState({ wasPlaying: false });
        if (RadioCast.isCasting()) {
            RadioCast.stopAll().catch(() => {});
        }
        this.emitState();
    },

    syncCastLocal() {
        const casting = RadioCast.isCasting();
        const hostAudio = RadioCast.getHostAudio();
        this.setCastLocalSuppressed(casting && !hostAudio);
    }
};
