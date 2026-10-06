/**
 * MagicTV radio player — HTML5 Audio with master×slot gain (room mix).
 */
import { RadioProviderRegistry } from './radioProviders/registry.js';
import {
    stationKey,
    parseStationKey
} from './stationShape.js';
import {
    DEFAULT_BROWSE_SORT,
    DEFAULT_BROWSE_SORT_DIR,
    DEFAULT_COUNTRY_SORT,
    getHideOfflineStations,
    getRadioRecentsCap,
    isUnlimitedRadioRecentsCap,
    loadRadioState,
    patchRadioState,
    setHideOfflineStations
} from './radioState.js';
import { RadioLibrary } from './radioLibrary.js';
import { RadioCast } from './radioCast.js';

/** @type {(() => number) | null} */
let getMasterVolume = null;

/** Only refresh Radio Browser after stream error when IDB station cache is this old. */
const STREAM_ERROR_REFRESH_MIN_AGE_MS = 60 * 60 * 1000;

function dispatchState(detail) {
    window.dispatchEvent(new CustomEvent('radio:state_changed', { detail }));
}

function isAbortError(e) {
    return e?.name === 'AbortError';
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
    /** Bumped on each playStation; stale generations must not touch player state. */
    playGeneration: 0,
    /** @type {AbortController|null} */
    _playAbort: null,
    /** Key we already attempted a stale-cache refresh for (avoid loops). */
    _streamRetryKey: null,

    init({ getSharedVolume } = {}) {
        RadioLibrary.reconcileVisitedStations();
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
                this.markVisited(key, this.station);
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
            this.onStreamError();
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
        const nowFav = RadioLibrary.toggleFavorite(keyOrStation);
        this.emitState();
        return nowFav;
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
        const cap = getRadioRecentsCap();
        patchRadioState({
            recentsMeta: isUnlimitedRadioRecentsCap(cap) ? meta : meta.slice(0, cap)
        });
    },

    clearRecents() {
        patchRadioState({ recentsMeta: [], recents: [] });
        this.emitState();
    },

    /* Favorites folders (TV FavoritesFolders / FavoritesReorder API surface) */

    getFavoriteFolders() {
        return RadioLibrary.getFavoriteFolders();
    },

    getFavoritesRootOrder() {
        return RadioLibrary.getFavoritesRootOrder();
    },

    getFavoriteFolder(id) {
        return RadioLibrary.getFavoriteFolder(id);
    },

    suggestFolderName() {
        return RadioLibrary.suggestFolderName();
    },

    createFavoriteFolder(name) {
        const folder = RadioLibrary.createFavoriteFolder(name);
        this.emitState();
        return folder;
    },

    renameFavoriteFolder(id, name) {
        const changed = RadioLibrary.renameFavoriteFolder(id, name);
        if (changed) this.emitState();
        return changed;
    },

    deleteFavoriteFolder(id) {
        const removed = RadioLibrary.deleteFavoriteFolder(id);
        if (removed) this.emitState();
        return removed;
    },

    reorderFavoritesRoot(orderedKeys) {
        const changed = RadioLibrary.reorderFavoritesRoot(orderedKeys);
        if (changed) this.emitState();
        return changed;
    },

    reorderFavoriteFolderItems(folderId, orderedKeys) {
        const changed = RadioLibrary.reorderFavoriteFolderItems(folderId, orderedKeys);
        if (changed) this.emitState();
        return changed;
    },

    moveFavoriteToFolder(stationKeyRef, folderId, opts) {
        const changed = RadioLibrary.moveFavoriteToFolder(stationKeyRef, folderId, opts);
        if (changed) this.emitState();
        return changed;
    },

    moveFavoriteToRoot(stationKeyRef, opts) {
        const changed = RadioLibrary.moveFavoriteToRoot(stationKeyRef, opts);
        if (changed) this.emitState();
        return changed;
    },

    /* Visited */

    markVisited(keyOrStation, station = null) {
        return RadioLibrary.markVisited(keyOrStation, station);
    },

    unvisitChannel(keyOrStation) {
        const changed = RadioLibrary.unvisitStation(keyOrStation);
        if (changed) this.emitState();
        return changed;
    },

    /** Alias matching TV FavoritesFolders naming for shared settings. */
    unvisitStation(keyOrStation) {
        return this.unvisitChannel(keyOrStation);
    },

    isVisited(keyOrStation) {
        return RadioLibrary.isVisited(keyOrStation);
    },

    getVisitedMeta() {
        return RadioLibrary.getVisitedMeta();
    },

    getVisitedKeys() {
        return RadioLibrary.getVisitedKeys();
    },

    reconcileVisitedStations() {
        RadioLibrary.reconcileVisitedStations();
    },

    /* Hidden */

    hideChannel(stationOrKey) {
        const hidden = RadioLibrary.hideStation(stationOrKey);
        if (hidden) this.emitState();
        return hidden;
    },

    unhideChannel(keyOrStation) {
        const shown = RadioLibrary.unhideStation(keyOrStation);
        if (shown) this.emitState();
        return shown;
    },

    getHiddenMeta() {
        return RadioLibrary.getHiddenMeta();
    },

    isHidden(keyOrStation) {
        return RadioLibrary.isHidden(keyOrStation);
    },

    filterVisibleStations(stations) {
        return RadioLibrary.filterVisible(stations);
    },

    getHideOfflineStations() {
        return getHideOfflineStations();
    },

    setHideOfflineStations(value) {
        const next = setHideOfflineStations(value);
        this.emitState();
        return next;
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

    /**
     * Resolve a key or partial station to a full record with url_resolved.
     * Uses cache by default (no mirror rediscovery).
     */
    async resolveStation(keyOrStation, { refresh = false, signal } = {}) {
        if (keyOrStation && typeof keyOrStation !== 'string' && keyOrStation.url_resolved && !refresh) {
            return keyOrStation;
        }
        const key = typeof keyOrStation === 'string'
            ? keyOrStation
            : stationKey(keyOrStation);
        const parsed = parseStationKey(key);
        if (!parsed?.stationId) return null;
        const provider = RadioProviderRegistry.get(parsed.providerId);
        return provider.getStationById(parsed.stationId, { refresh, signal });
    },

    /** True when IDB station cache is old enough to justify a refresh after stream failure. */
    async shouldRefreshOnStreamError(station) {
        const provider = RadioProviderRegistry.get(station?.providerId);
        if (typeof provider?.getStationCacheAge !== 'function') return false;
        const age = await provider.getStationCacheAge(station.stationId);
        return age != null && age >= STREAM_ERROR_REFRESH_MIN_AGE_MS;
    },

    failPlay(message, err) {
        this.loading = false;
        this.loadPhase = 'idle';
        this.playing = false;
        this.error = message;
        this.emitState();
        if (err) throw err;
        throw new Error(message);
    },

    async onStreamError() {
        const generation = this.playGeneration;
        const station = this.station;
        const key = stationKey(station);
        if (!station || !key) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
            return;
        }
        if (this._streamRetryKey === key) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
            return;
        }
        let shouldRefresh = false;
        try {
            shouldRefresh = await this.shouldRefreshOnStreamError(station);
        } catch {
            shouldRefresh = false;
        }
        if (generation !== this.playGeneration) return;
        if (!shouldRefresh) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
            return;
        }
        this._streamRetryKey = key;
        try {
            await this.playStation(station, { forceRefresh: true, fromStreamError: true });
        } catch {
            /* playStation emits state */
        }
    },

    /**
     * @param {string|object} keyOrStation
     * @param {{ forceRefresh?: boolean, fromStreamError?: boolean }} [opts]
     */
    async playStation(keyOrStation, opts = {}) {
        this.init();
        this.ensureAudio();

        const generation = ++this.playGeneration;
        if (this._playAbort) {
            try { this._playAbort.abort(); } catch { /* ignore */ }
        }
        this._playAbort = new AbortController();
        const { signal } = this._playAbort;

        if (!opts.fromStreamError) this._streamRetryKey = null;

        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.emitState();

        const stale = () => generation !== this.playGeneration;

        let station = null;
        try {
            station = await this.resolveStation(keyOrStation, {
                refresh: opts.forceRefresh === true,
                signal
            });
        } catch (e) {
            if (stale() || isAbortError(e) || signal.aborted) return;
            this.failPlay(e?.message || 'Station unavailable', e);
        }

        if (stale()) return;

        if (!station?.url_resolved) {
            this.failPlay('No stream URL');
        }
        if (station.lastcheckok === 0) {
            this.failPlay('Station offline');
        }

        // After force refresh, same URL will not recover a dead stream.
        if (opts.forceRefresh && opts.fromStreamError
            && typeof keyOrStation !== 'string'
            && keyOrStation?.url_resolved
            && station.url_resolved === keyOrStation.url_resolved) {
            this.failPlay('Stream unavailable');
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

        if (stale()) return;

        this.audio.src = station.url_resolved;
        this.streamUrl = station.url_resolved;
        this.applyAudioGain();

        try {
            await this.audio.play();
            if (stale()) return;
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            patchRadioState({ wasPlaying: true });
            this.emitState();

            if (RadioCast.isCasting()) {
                try {
                    await RadioCast.castStation(station.url_resolved, station.name);
                    if (stale()) return;
                    this.syncCastLocal();
                } catch { /* ignore cast reload errors */ }
            }
        } catch (e) {
            if (stale() || isAbortError(e) || signal.aborted) return;
            if (e?.name === 'NotAllowedError') {
                this.failPlay('Tap play to start', e);
            }
            // Immediate play() failure — optional one refresh if cache is stale.
            if (!opts.forceRefresh && !opts.fromStreamError) {
                let shouldRefresh = false;
                try {
                    shouldRefresh = await this.shouldRefreshOnStreamError(station);
                } catch {
                    shouldRefresh = false;
                }
                if (stale()) return;
                if (shouldRefresh) {
                    this._streamRetryKey = key;
                    return this.playStation(station, { forceRefresh: true, fromStreamError: true });
                }
            }
            this.failPlay('Playback failed', e);
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
        this.playGeneration += 1;
        if (this._playAbort) {
            try { this._playAbort.abort(); } catch { /* ignore */ }
            this._playAbort = null;
        }
        this._streamRetryKey = null;
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
