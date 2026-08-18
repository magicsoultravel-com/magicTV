/**
 * Single global Chromecast session for magicTV.
 * One active cast slot at a time; browser is the remote control.
 */

const CAST_STATE_KEY = 'magicTV:castState';
const HOST_AUDIO_KEY = 'magicTV:castHostAudio';
const HOST_VIDEO_KEY = 'magicTV:castHostVideo';
const DEFAULT_RECEIVER_APP_ID = 'CC1AD845';
const CAST_SENDER_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

/** @type {import('../multiView.js').MultiView | null} */
let multiViewRef = null;

let sdkInitPromise = null;
let remotePlayerBound = false;
let contextListenersBound = false;
/** @type {cast.framework.CastContext | null} */
let castContext = null;
/** @type {cast.framework.RemotePlayer | null} */
let remotePlayer = null;
/** @type {cast.framework.RemotePlayerController | null} */
let remotePlayerController = null;

let castActiveSlotId = null;
let hostAudioEnabled = false;
let hostVideoEnabled = false;
let castPlaying = true;
let castMuted = false;
let castVolume = 1;
let currentChannel = null;

/** Snapshot of local player state before casting started. */
let localSnapshot = /** @type {{ wasPlaying: boolean, wasMuted: boolean } | null} */ (null);

function readBool(key, fallback = false) {
    try {
        const v = localStorage.getItem(key);
        if (v === 'true') return true;
        if (v === 'false') return false;
    } catch { /* ignore */ }
    return fallback;
}

function writeBool(key, value) {
    try { localStorage.setItem(key, String(Boolean(value))); } catch { /* ignore */ }
}

function loadCastPersistedState() {
    hostAudioEnabled = readBool(HOST_AUDIO_KEY, false);
    hostVideoEnabled = readBool(HOST_VIDEO_KEY, false);
    try {
        const raw = localStorage.getItem(CAST_STATE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveCastPersistedState() {
    try {
        localStorage.setItem(CAST_STATE_KEY, JSON.stringify({
            castActiveSlotId,
            castChannelUrl: currentChannel?.url_resolved || currentChannel?.url || '',
            castChannelName: currentChannel?.name || ''
        }));
    } catch { /* ignore */ }
}

function clearCastPersistedState() {
    try { localStorage.removeItem(CAST_STATE_KEY); } catch { /* ignore */ }
}

function emitCastStateChanged() {
    window.dispatchEvent(new CustomEvent('tv:cast_state_changed', {
        detail: {
            castActiveSlotId,
            isCasting: ChromecastManager.isCasting(),
            hostAudioEnabled,
            hostVideoEnabled
        }
    }));
}

function emitHostToggled() {
    window.dispatchEvent(new CustomEvent('tv:cast_host_toggled', {
        detail: { hostAudioEnabled, hostVideoEnabled }
    }));
}

function getSession() {
    return castContext?.getCurrentSession?.() || null;
}

function loadCastSdk() {
    if (sdkInitPromise) return sdkInitPromise;
    sdkInitPromise = new Promise((resolve, reject) => {
        if (window.cast?.framework) {
            resolve();
            return;
        }
        window.__onGCastApiAvailable = (isAvailable) => {
            if (isAvailable) resolve();
            else reject(new Error('Cast API unavailable'));
        };
        const existing = document.querySelector('script[data-cast-sender]');
        if (existing) {
            existing.addEventListener('load', () => {
                if (window.cast?.framework) resolve();
            }, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = CAST_SENDER_URL;
        script.dataset.castSender = '1';
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load Cast SDK'));
        document.head.appendChild(script);
    });
    return sdkInitPromise;
}

function setupRemotePlayer() {
    if (!window.cast?.framework || remotePlayerBound) return;
    remotePlayer = new cast.framework.RemotePlayer();
    remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);
    remotePlayerBound = true;

    const syncFromRemote = () => {
        castPlaying = remotePlayer?.isPaused === false;
        castMuted = remotePlayer?.isMuted === true;
        castVolume = typeof remotePlayer?.volumeLevel === 'number' ? remotePlayer.volumeLevel : castVolume;
        window.dispatchEvent(new CustomEvent('tv:cast_volume_changed', {
            detail: { volume: castVolume, muted: castMuted, playing: castPlaying }
        }));
    };

    remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
        syncFromRemote
    );
    remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
        syncFromRemote
    );
    remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
        syncFromRemote
    );
    remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
        syncFromRemote
    );
}

function bindCastContextListeners() {
    if (!castContext || contextListenersBound) return;
    contextListenersBound = true;
    castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event) => {
            const state = event.sessionState;
            if (state === cast.framework.SessionState.SESSION_ENDED
                || state === cast.framework.SessionState.SESSION_START_FAILED) {
                ChromecastManager._onSessionEnded();
            } else if (state === cast.framework.SessionState.SESSION_STARTED) {
                emitCastStateChanged();
            }
        }
    );
}

function buildMediaInfo(channel) {
    const url = (channel?.url_resolved || channel?.url || '').trim();
    const mediaInfo = new chrome.cast.media.MediaInfo(url, 'application/x-mpegURL');
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = channel?.name || 'magicTV';
    mediaInfo.metadata = metadata;
    return mediaInfo;
}

function getMedia() {
    return getSession()?.getMediaSession?.() || null;
}

async function loadMediaOnSession(session, channel) {
    const request = new chrome.cast.media.LoadRequest(buildMediaInfo(channel));
    request.autoplay = true;
    await session.loadMedia(request);
    castPlaying = true;
    if (remotePlayer) {
        castPlaying = remotePlayer.isPaused !== true;
        castMuted = remotePlayer.isMuted === true;
        if (typeof remotePlayer.volumeLevel === 'number') {
            castVolume = remotePlayer.volumeLevel;
        }
    }
}

function getLocalPlayer(slotId) {
    return multiViewRef?.slots?.[slotId]?.player || null;
}

function snapshotLocalPlayer(slotId) {
    const player = getLocalPlayer(slotId);
    if (!player) {
        localSnapshot = { wasPlaying: false, wasMuted: true };
        return;
    }
    localSnapshot = {
        wasPlaying: player.wantPlaying === true || player.playing === true,
        wasMuted: player.muted !== false
    };
}

function applyHostPlaybackState(slotId) {
    const player = getLocalPlayer(slotId);
    if (!player?.channel) return;
    if (!ChromecastManager.isCasting() || castActiveSlotId !== slotId) return;

    if (hostVideoEnabled) {
        if (player.wantPlaying !== true && !player.playing) {
            player.resume?.();
        }
    } else if (player.playing || player.wantPlaying) {
        player.pause?.();
    }

    if (hostAudioEnabled) {
        if (player.muted) player.unmute?.();
    } else if (!player.muted) {
        player.mute?.();
    }
    player.applyAudioToVideo?.();
}

function restoreLocalPlayer(slotId) {
    const player = getLocalPlayer(slotId);
    if (!player || !localSnapshot) return;

    if (localSnapshot.wasPlaying) {
        player.resume?.();
    } else if (player.playing || player.wantPlaying) {
        player.pause?.();
    }

    if (localSnapshot.wasMuted) {
        player.mute?.();
    } else {
        player.unmute?.();
    }
    player.applyAudioToVideo?.();
    localSnapshot = null;
}

export const ChromecastManager = {
    init(multiView) {
        multiViewRef = multiView;
        loadCastPersistedState();
        return this.ensureSdk().then(() => this.tryRestoreSession()).catch(() => {});
    },

    async ensureSdk() {
        await loadCastSdk();
        if (!window.cast?.framework) throw new Error('Cast framework missing');
        castContext = cast.framework.CastContext.getInstance();
        castContext.setOptions({
            receiverApplicationId: chrome.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || DEFAULT_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
            androidReceiverCompatible: true
        });
        setupRemotePlayer();
        bindCastContextListeners();
    },

    async tryRestoreSession() {
        const persisted = loadCastPersistedState();
        const session = getSession();
        if (!session) {
            if (persisted?.castActiveSlotId) clearCastPersistedState();
            castActiveSlotId = null;
            currentChannel = null;
            emitCastStateChanged();
            return;
        }

        if (persisted?.castActiveSlotId) {
            castActiveSlotId = persisted.castActiveSlotId;
            if (persisted.castChannelUrl) {
                currentChannel = {
                    url_resolved: persisted.castChannelUrl,
                    name: persisted.castChannelName || 'magicTV'
                };
            }
            emitCastStateChanged();
        }
    },

    isCasting() {
        return Boolean(getSession() && castActiveSlotId);
    },

    getActiveSlot() {
        return this.isCasting() ? castActiveSlotId : null;
    },

    getHostAudio() {
        return hostAudioEnabled;
    },

    getHostVideo() {
        return hostVideoEnabled;
    },

    isCastPlaying() {
        return castPlaying;
    },

    isCastMuted() {
        return castMuted;
    },

    getCastVolume() {
        return castVolume;
    },

    getCurrentChannel() {
        return currentChannel;
    },

    setHostAudio(enabled) {
        hostAudioEnabled = Boolean(enabled);
        writeBool(HOST_AUDIO_KEY, hostAudioEnabled);
        if (castActiveSlotId) applyHostPlaybackState(castActiveSlotId);
        emitHostToggled();
        emitCastStateChanged();
    },

    setHostVideo(enabled) {
        hostVideoEnabled = Boolean(enabled);
        writeBool(HOST_VIDEO_KEY, hostVideoEnabled);
        if (castActiveSlotId) applyHostPlaybackState(castActiveSlotId);
        emitHostToggled();
        emitCastStateChanged();
    },

    toggleHostAudio() {
        this.setHostAudio(!hostAudioEnabled);
    },

    toggleHostVideo() {
        this.setHostVideo(!hostVideoEnabled);
    },

    async startCast(slotId, channel) {
        await this.ensureSdk();
        const url = (channel?.url_resolved || channel?.url || '').trim();
        if (!url) throw new Error('No stream URL');

        const session = getSession();
        const sameSlot = castActiveSlotId === slotId && session;

        if (sameSlot) {
            await this.stopCast();
            return;
        }

        if (!castActiveSlotId || castActiveSlotId !== slotId) {
            snapshotLocalPlayer(slotId);
        }

        castActiveSlotId = slotId;
        currentChannel = channel;

        if (session) {
            await loadMediaOnSession(session, channel);
        } else {
            await castContext.requestSession();
            const newSession = getSession();
            if (!newSession) throw new Error('No cast session');
            await loadMediaOnSession(newSession, channel);
        }

        applyHostPlaybackState(slotId);
        saveCastPersistedState();
        emitCastStateChanged();
    },

    async loadMedia(channel) {
        const session = getSession();
        if (!session || !castActiveSlotId) return;
        currentChannel = channel;
        await loadMediaOnSession(session, channel);
        saveCastPersistedState();
        emitCastStateChanged();
    },

    play() {
        const media = getMedia();
        const channel = currentChannel
            || multiViewRef?.slots?.[castActiveSlotId]?.player?.channel
            || null;
        if (!media && channel) {
            void this.loadMedia(channel);
            return;
        }
        if (remotePlayerController && remotePlayer?.isPaused) {
            remotePlayerController.playOrPause();
        } else if (media?.play) {
            media.play(null, () => {}, () => {});
        }
        castPlaying = true;
        emitCastStateChanged();
    },

    pause() {
        const media = getMedia();
        if (remotePlayerController && remotePlayer && !remotePlayer.isPaused) {
            remotePlayerController.playOrPause();
        } else if (media?.pause) {
            media.pause(null, () => {}, () => {});
        }
        castPlaying = false;
        emitCastStateChanged();
    },

    togglePlayPause() {
        if (castPlaying) this.pause();
        else this.play();
    },

    stopMedia() {
        const media = getMedia();
        if (remotePlayerController?.stop) {
            remotePlayerController.stop();
        } else if (media?.stop) {
            media.stop(null, () => {}, () => {});
        }
        castPlaying = false;
        emitCastStateChanged();
    },

    async stopCast() {
        const slotId = castActiveSlotId;
        try {
            castContext?.endCurrentSession?.(true);
        } catch { /* ignore */ }
        ChromecastManager._onSessionEnded(slotId);
    },

    stop() {
        return this.stopMedia();
    },

    setVolume(level) {
        if (!remotePlayer || !remotePlayerController) return;
        const clamped = Math.min(1, Math.max(0, level));
        remotePlayer.volumeLevel = clamped;
        remotePlayerController.setVolumeLevel();
        castVolume = clamped;
        castMuted = clamped === 0;
        window.dispatchEvent(new CustomEvent('tv:cast_volume_changed', {
            detail: { volume: castVolume, muted: castMuted, playing: castPlaying }
        }));
        emitCastStateChanged();
    },

    adjustVolume(delta) {
        const next = (typeof remotePlayer?.volumeLevel === 'number' ? remotePlayer.volumeLevel : castVolume)
            + delta;
        this.setVolume(next);
    },

    setMuted(muted) {
        if (!remotePlayer || !remotePlayerController) return;
        const next = Boolean(muted);
        if (remotePlayer.isMuted !== next) {
            remotePlayerController.muteOrUnmute();
        }
        castMuted = next;
        window.dispatchEvent(new CustomEvent('tv:cast_volume_changed', {
            detail: { volume: castVolume, muted: castMuted, playing: castPlaying }
        }));
    },

    toggleCastMute() {
        this.setMuted(!castMuted);
    },

    _onSessionEnded(restoreSlotId = castActiveSlotId) {
        const slot = restoreSlotId || castActiveSlotId;
        if (!slot && !castActiveSlotId) return;
        castActiveSlotId = null;
        currentChannel = null;
        castPlaying = false;
        clearCastPersistedState();
        if (slot) restoreLocalPlayer(slot);
        emitCastStateChanged();
    }
};
