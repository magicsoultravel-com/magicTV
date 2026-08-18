import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, el, els } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { TileFrames } from '../tileFrames.js';
import { ChannelGrid } from './channelGrid.js';
import { Appearance } from './appearance.js';
import { MultiView } from '../multiView.js';
import { channelKey } from '../tvProviders/channelShape.js';

let deps = {
    appState: null
};

export const PlayerChrome = {
    init({ appState }) {
        deps = { appState };
    },

    bindControls() {
        const volume = el('volume-slider');

        if (volume) {
            volume.addEventListener('input', (e) => {
                TvPlayer.setVolume(parseFloat(e.target.value) / 100);
            });
        }
        window.addEventListener('tv:cast_volume_changed', () => {
            MultiView.scheduleRefreshTiles?.();
        });
        window.addEventListener('tv:state_changed', () => { ChannelGrid.syncFavButtons(); ChannelGrid.syncPlayingTiles(); ChannelGrid.syncVisitedTiles(); });
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
        MultiView.bindSettings();
    },

    syncSettingsFromState() {
        const buffer = el('buffer-size-select');
        if (buffer) buffer.value = String(TvPlayer.getBufferSize());
        const volume = el('volume-slider');
        if (volume) volume.value = String(Math.round((TvPlayer.volume || 0.85) * 100));
        Appearance.syncFromState();
        MultiView.syncSettingsToggles();
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
            state.wantPlaying === true
            || state.playing === true
            || (state.loading === true && state.pausePhase === 'idle')
        );

        if (state.wantPlaying === true || state.playing === true) {
            const url = state.channel?.url_resolved || state.channel?.url || '';
            if (url) {
                // Gated inside TileFrames — no-op once noted; safe under mash.
                TileFrames.notePlayingVideo(url, TvPlayer.video, channelKey(state.channel));
            }
        }

        // Remount only when center surface lost the video (not every state tick).
        const surface = el('tv-playback-surface-center');
        const video = TvPlayer.video;
        if (surface && video && video.parentElement !== surface) {
            try { TvPlayer.mountVideo(); } catch { /* ignore */ }
        }

        const volume = el('volume-slider');
        if (volume && typeof state.volume === 'number') {
            volume.value = String(Math.round(state.volume * 100));
        }

        this.updateBufferQuality();

        if (state.resumeBlocked) {
            showAppToast('Tap ▶ to start playback');
        } else if (state.error && !state.resumeBlocked) {
            showAppToast('Stream unavailable');
        }

        this.updateNowPlayingHeader();

        if (state.channel) {
            Appearance.updatePreviewTile();
        }
    },

    updateBufferQuality() {
        const player = MultiView.getStatusPlayer() || MultiView.getPrimary();
        const channel = player?.channel;
        const loadPhase = player?.loadPhase;

        const bufferInfo = el('buffer-info');
        if (bufferInfo) {
            if (channel && loadPhase !== 'idle') {
                const buf = player.getBufferInfo?.() || { buffered: 0 };
                bufferInfo.textContent = `Buffer: ${(buf.buffered || 0).toFixed(1)}s`;
            } else {
                bufferInfo.textContent = 'Buffer: —';
            }
        }

        const qualityInfo = el('quality-info');
        if (qualityInfo) {
            let label = player?.qualityLabel || '—';
            if (channel && (!label || label === '—')) {
                const h = player?.video?.videoHeight;
                if (h > 0) label = `${h}p`;
            }
            if (!channel) {
                qualityInfo.textContent = 'Quality: —';
            } else if (player?.qualityMode === 'auto') {
                qualityInfo.textContent = label && label !== '—'
                    ? `Quality: Auto (${label})`
                    : 'Quality: Auto';
            } else {
                qualityInfo.textContent = `Quality: ${label || '—'}`;
            }
        }
    }
};
