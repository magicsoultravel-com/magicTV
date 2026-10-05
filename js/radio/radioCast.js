/**
 * Radio Google Cast — Default Media Receiver + host-audio dual path.
 * Shares the browser Cast session world with TV ChromecastManager.
 */
import { loadRadioState, patchRadioState } from './radioState.js';

const CAST_SDK_TIMEOUT_MS = 4000;

async function loadCastSdk() {
    const deadline = Date.now() + CAST_SDK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (typeof window !== 'undefined' && window.cast?.framework && window.chrome?.cast) {
            return window.cast.framework;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Google Cast SDK unavailable');
}

function contentTypeForUrl(url) {
    const path = String(url || '').split('?')[0].toLowerCase();
    if (path.endsWith('.aac')) return 'audio/aac';
    if (path.endsWith('.ogg') || path.endsWith('.oga')) return 'audio/ogg';
    if (path.endsWith('.m3u8')) return 'application/x-mpegURL';
    return 'audio/mpeg';
}

function dispatchChanged() {
    window.dispatchEvent(new CustomEvent('radio:cast_state_changed'));
}

export const RadioCast = {
    context: null,
    session: null,
    castDeviceName: null,
    available: false,
    casting: false,
    initPromise: null,
    hostAudioEnabled: loadRadioState().castHostAudio === true,
    castVolume: 1,
    castMuted: false,
    castPlaying: true,
    remotePlayer: null,
    remotePlayerController: null,

    async init() {
        if (this.available) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.initSdk().finally(() => {
            this.initPromise = null;
        });
        return this.initPromise;
    },

    async initSdk() {
        try {
            await loadCastSdk();
            this.available = true;

            const context = window.cast.framework.CastContext.getInstance();
            context.setOptions({
                receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });
            this.context = context;

            context.addEventListener(
                window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                () => this.syncFromContext()
            );

            this.bindRemotePlayer();
            this.dispatchChanged();
        } catch (e) {
            console.warn('Radio Cast init failed:', e);
        }
    },

    bindRemotePlayer() {
        if (!window.cast?.framework || this.remotePlayer) return;
        this.remotePlayer = new cast.framework.RemotePlayer();
        this.remotePlayerController = new cast.framework.RemotePlayerController(this.remotePlayer);
        this.remotePlayerController.addEventListener(
            cast.framework.RemotePlayerEventType.ANY_CHANGE,
            () => {
                if (typeof this.remotePlayer.volumeLevel === 'number') {
                    this.castVolume = this.remotePlayer.volumeLevel;
                }
                this.castMuted = this.remotePlayer.isMuted === true;
                this.castPlaying = this.remotePlayer.isPaused !== true;
                this.dispatchChanged();
            }
        );
    },

    syncFromContext() {
        if (!this.context) return;
        this.session = this.context.getCurrentSession();
        this.castDeviceName = this.session?.getCastDevice()?.friendlyName || null;
        this.casting = !!this.session;
        this.dispatchChanged();
        // Notify player to sync local suppress
        window.dispatchEvent(new CustomEvent('radio:cast_session_sync'));
    },

    dispatchChanged() {
        dispatchChanged();
    },

    getStatus() {
        return {
            available: this.available,
            casting: this.casting,
            deviceName: this.castDeviceName,
            hostAudio: this.hostAudioEnabled,
            volume: this.castVolume,
            muted: this.castMuted,
            playing: this.castPlaying
        };
    },

    isCasting() {
        return this.casting === true;
    },

    getHostAudio() {
        return this.hostAudioEnabled === true;
    },

    setHostAudio(enabled) {
        this.hostAudioEnabled = enabled === true;
        patchRadioState({ castHostAudio: this.hostAudioEnabled });
        this.dispatchChanged();
        window.dispatchEvent(new CustomEvent('radio:cast_session_sync'));
        return this.hostAudioEnabled;
    },

    toggleHostAudio() {
        return this.setHostAudio(!this.hostAudioEnabled);
    },

    getCastVolume() {
        return this.castVolume;
    },

    isCastMuted() {
        return this.castMuted === true;
    },

    isCastPlaying() {
        return this.castPlaying === true;
    },

    setCastVolume(level) {
        const clamped = Math.min(1, Math.max(0, Number(level) || 0));
        this.castVolume = clamped;
        if (this.remotePlayer && this.remotePlayerController) {
            this.remotePlayer.volumeLevel = clamped;
            this.remotePlayerController.setVolumeLevel();
        }
        this.dispatchChanged();
    },

    adjustCastVolume(delta) {
        this.setCastVolume((this.castVolume || 0) + delta);
    },

    toggleCastMute() {
        if (!this.remotePlayerController) return;
        this.remotePlayerController.muteOrUnmute();
    },

    async castStation(url, name) {
        if (!this.available) await this.init();
        if (!this.available || !this.context) {
            throw new Error('Google Cast is not available in this browser.');
        }
        if (!url) throw new Error('No station URL to cast.');

        // End any existing session (TV or prior radio) so radio takes over
        try {
            if (this.context.getCurrentSession()) {
                await this.context.endCurrentSession(true);
            }
        } catch { /* ignore */ }

        try {
            await this.context.requestSession();
        } catch (err) {
            const cancelCode = window.chrome?.cast?.ErrorCode?.CANCEL;
            if (err === cancelCode || err?.code === cancelCode) {
                throw new Error('Cast cancelled');
            }
            throw new Error('Could not start cast session.');
        }

        const session = this.context.getCurrentSession();
        if (!session) throw new Error('Cast session not started.');

        this.session = session;
        this.castDeviceName = session.getCastDevice()?.friendlyName || null;
        this.casting = true;
        this.dispatchChanged();

        const media = new window.chrome.cast.media.MediaInfo(url, contentTypeForUrl(url));
        media.streamType = window.chrome.cast.media.StreamType.LIVE;
        const meta = new window.chrome.cast.media.GenericMediaMetadata();
        meta.metadataType = window.chrome.cast.media.MetadataType.GENERIC;
        meta.title = name || 'Radio';
        media.metadata = meta;

        const request = new window.chrome.cast.media.LoadRequest(media);
        request.autoplay = true;

        try {
            await session.loadMedia(request);
        } catch (err) {
            const cancelCode = window.chrome?.cast?.ErrorCode?.CANCEL;
            if (err === cancelCode || err?.code === cancelCode) {
                throw new Error('Cast cancelled');
            }
            throw new Error('Could not load stream on cast device.');
        }

        this.casting = true;
        this.bindRemotePlayer();
        this.dispatchChanged();
        window.dispatchEvent(new CustomEvent('radio:cast_session_sync'));
    },

    async stopAll() {
        if (this.context) {
            try {
                await this.context.endCurrentSession(true);
            } catch { /* ignore */ }
        }
        this.session = null;
        this.castDeviceName = null;
        this.casting = false;
        this.dispatchChanged();
        window.dispatchEvent(new CustomEvent('radio:cast_session_sync'));
    }
};
