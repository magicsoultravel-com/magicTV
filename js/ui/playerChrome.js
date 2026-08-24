import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, el, els } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { TileFrames } from '../tileFrames.js';
import { ChannelGrid } from './channelGrid.js';
import { Appearance } from './appearance.js';
import { MultiView } from '../multiView.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { RemotePanel, syncRemoteChannelBar } from './remotePanel.js';
import { updateProgrammeHeader } from './guidePanel.js';
import { syncVolumeDial } from './volumeDial.js';

let deps = {
    appState: null
};

/** Edge-trigger key so resume/error toasts fire once per episode, not every state tick. */
let lastPlaybackToastKey = null;

export const PlayerChrome = {
    init({ appState }) {
        deps = { appState };
    },

    bindControls() {
        const volume = el('volume-slider');

        if (volume) {
            volume.addEventListener('input', (e) => {
                TvPlayer.setVolume(parseFloat(e.target.value) / 100);
                syncVolumeDial();
            });
        }
        window.addEventListener('tv:cast_volume_changed', () => {
            MultiView.scheduleRefreshTiles?.();
            syncVolumeDial();
        });
        window.addEventListener('tv:state_changed', () => { ChannelGrid.syncFavButtons(); ChannelGrid.syncPlayingTiles(); ChannelGrid.syncVisitedTiles(); });
        window.addEventListener('tv:state_changed', syncVolumeDial);
        syncVolumeDial();
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
        syncVolumeDial();
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

        updateProgrammeHeader().catch(() => {});
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

        syncVolumeDial();

        this.updateBufferQuality();
        RemotePanel.syncRemotePanel?.();
        syncRemoteChannelBar?.(deps.appState?.activeTab || 'remote');

        let toastKey = null;
        if (state.resumeBlocked) {
            toastKey = 'resumeBlocked';
        } else if (state.error) {
            toastKey = `error:${channelKey(state.channel) || ''}`;
        }
        if (toastKey) {
            if (toastKey !== lastPlaybackToastKey) {
                showAppToast(state.resumeBlocked ? 'Tap ▶ to start playback' : 'Stream unavailable');
                lastPlaybackToastKey = toastKey;
            }
        } else {
            lastPlaybackToastKey = null;
        }

        this.updateNowPlayingHeader();

        if (state.channel) {
            Appearance.updatePreviewTile();
        }
    },

    updateBufferQuality() {
        const formatBuffer = (player) => {
            const channel = player?.channel;
            const loadPhase = player?.loadPhase;
            if (!channel || loadPhase === 'idle') return 'Buffer: —';
            const buf = player.getBufferInfo?.() || { buffered: 0 };
            return `Buffer: ${(buf.buffered || 0).toFixed(1)}s`;
        };

        const formatQuality = (player) => {
            const channel = player?.channel;
            if (!channel) return 'Quality: —';
            let label = player?.qualityLabel || '—';
            if (!label || label === '—') {
                const h = player?.video?.videoHeight;
                if (h > 0) label = `${h}p`;
            }
            if (player?.qualityMode === 'auto') {
                return label && label !== '—'
                    ? `Quality: Auto (${label})`
                    : 'Quality: Auto';
            }
            return `Quality: ${label || '—'}`;
        };

        // Per-screen overlays on mosaic tiles.
        for (const id of ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
            const tile = el(`player-tile-${id}`);
            if (!tile) continue;
            const slot = MultiView.slots?.[id];
            const enabled = id === 'center' || slot?.enabled;
            const player = enabled ? (slot?.player || (id === 'center' ? MultiView.getPrimary?.() : null)) : null;
            const echo = tile.querySelector('.tv-player-tile__echo');
            const bufferEl = tile.querySelector('.tv-player-tile__buffer');
            const qualityEl = tile.querySelector('.tv-player-tile__quality-echo');
            const hasChannel = Boolean(player?.channel);
            echo?.classList.toggle('is-hidden', !enabled || !hasChannel);
            if (bufferEl) bufferEl.textContent = formatBuffer(player);
            if (qualityEl) qualityEl.textContent = formatQuality(player);
        }
    }
};
