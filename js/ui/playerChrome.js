import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, el, els } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { TvPip } from '../tvPip.js';
import { TileFrames } from '../tileFrames.js';
import { ChannelGrid } from './channelGrid.js';
import { Appearance } from './appearance.js';

let deps = {
    appState: null
};

export const PlayerChrome = {
    init({ appState }) {
        deps = { appState };
    },

    bindControls() {
        const playBtn = el('play-btn');
        const pauseBtn = el('pause-btn');
        const stopBtn = el('stop-btn');
        const volume = el('volume-slider');
        const muteBtn = el('mute-btn');
        const fullscreenBtn = el('fullscreen-btn');
        const pipBtn = el('pip-btn');

        if (playBtn) playBtn.addEventListener('click', () => TvPlayer.toggle());
        if (pauseBtn) pauseBtn.addEventListener('click', () => TvPlayer.pause());
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                TvPlayer.stop();
            });
        }
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                const video = TvPlayer.video;
                if (!video?.requestFullscreen) {
                    showAppToast('Fullscreen isn’t supported here');
                    return;
                }
                video.requestFullscreen().catch(() => showAppToast('Fullscreen blocked'));
            });
        }
        if (pipBtn) TvPip.registerButton(pipBtn);
        if (volume) {
            volume.addEventListener('input', (e) => {
                TvPlayer.setVolume(parseFloat(e.target.value) / 100);
            });
        }
        if (muteBtn) {
            muteBtn.addEventListener('click', () => TvPlayer.toggleMute());
            const updateMuteIcon = () => {
                const isMuted = TvPlayer.muted || TvPlayer.volume === 0;
                const wave = muteBtn.querySelector('#mute-wave');
                if (wave) wave.style.opacity = isMuted ? '0' : '1';
                muteBtn.setAttribute('aria-pressed', String(isMuted));
                muteBtn.title = isMuted ? 'Unmute' : 'Mute';
            };
            window.addEventListener('tv:state_changed', updateMuteIcon);
            updateMuteIcon();
        }
        const favBtn = el('fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', () => {
                ChannelGrid.toggleFavorite(TvPlayer.channel);
            });
            window.addEventListener('tv:state_changed', () => ChannelGrid.syncFavButtons());
        }
        const volPct = el('volume-pct');
        if (volPct) {
            const updateVolPct = () => {
                const shown = TvPlayer.muted ? 0 : TvPlayer.volume;
                volPct.textContent = `${Math.round((shown || 0) * 100)}%`;
            };
            window.addEventListener('tv:state_changed', updateVolPct);
            updateVolPct();
        }
    },

    bindSettings() {
        const buffer = el('buffer-size-select');
        if (buffer) {
            buffer.addEventListener('change', () => {
                const size = parseInt(buffer.value, 10);
                const clamped = TvPlayer.setBufferSize(Number.isFinite(size) ? size : 15);
                buffer.value = String(clamped);
                showAppToast(`Buffer size: ${clamped}s`);
            });
        }
        Appearance.bind();
    },

    syncSettingsFromState() {
        const buffer = el('buffer-size-select');
        if (buffer) buffer.value = String(TvPlayer.getBufferSize());
        const volume = el('volume-slider');
        if (volume) volume.value = String(Math.round((TvPlayer.volume || 0.85) * 100));
        Appearance.syncFromState();
    },

    updateNowPlayingHeader() {
        const channel = TvPlayer.channel;
        const name = channel?.name || deps.appState.lastName;
        const country = channel?.countrycode || deps.appState.lastCountry;

        const headerInfo = els('.tv-channel-info')[0];
        const headerName = el('header-channel-name');
        const headerFlag = el('header-channel-flag');

        if (!name && !channel) {
            if (headerInfo) headerInfo.classList.add('is-hidden');
            if (headerName) headerName.textContent = '';
            if (headerFlag) headerFlag.textContent = '';
            return;
        }

        if (headerInfo) headerInfo.classList.remove('is-hidden');
        if (headerName) headerName.textContent = name || 'Unknown';
        if (headerFlag) headerFlag.textContent = country ? countryFlagEmoji(country) : '';
    },

    onPlayerStateChanged(e) {
        const state = e.detail || {};

        TileFrames.setPlaybackBusy(
            state.playing === true
            || (state.loading === true && state.pausePhase === 'idle')
        );

        if (state.playing === true) {
            const url = state.channel?.url_resolved || state.channel?.url || '';
            if (url) TileFrames.notePlayingVideo(url, TvPlayer.video);
        }

        try { TvPlayer.mountVideo(el('tv-playback-surface')); } catch { /* ignore */ }

        const playBtn = el('play-btn');
        const pauseBtn = el('pause-btn');
        if (playBtn) playBtn.classList.toggle('is-hidden', state.playing === true);
        if (pauseBtn) pauseBtn.classList.toggle('is-hidden', state.playing !== true);

        const volume = el('volume-slider');
        if (volume && typeof state.volume === 'number') {
            volume.value = String(Math.round(state.volume * 100));
        }

        const bufferInfo = el('buffer-info');
        if (bufferInfo) {
            if (state.channel && state.loadPhase !== 'idle') {
                const buf = TvPlayer.getBufferInfo();
                bufferInfo.textContent = `Buffer: ${buf.buffered.toFixed(1)}s`;
            } else {
                bufferInfo.textContent = 'Buffer: —';
            }
        }
        const qualityInfo = el('quality-info');
        if (qualityInfo) {
            qualityInfo.textContent = state.channel ? `Quality: ${TvPlayer.qualityLabel || 'Auto'}` : 'Quality: —';
        }

        if (state.resumeBlocked) {
            showAppToast('Tap ▶ to start playback');
        } else if (state.error && !state.resumeBlocked) {
            showAppToast('Stream unavailable');
        }

        this.updateNowPlayingHeader();

        if (state.channel) {
            Appearance.updatePreviewTile();
        }
    }
};
