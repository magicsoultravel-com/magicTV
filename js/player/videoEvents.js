/**
 * Bind native <video> event listeners for a player instance.
 */
import { channelKey } from '../tvProviders/channelShape.js';
import { savePlayerState } from '../storage/playerState.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { scheduleSlotPrefetch } from './channelPrefetch.js';
import {
    shouldAcceptPlayingEvent,
    shouldAcceptPauseEvent,
    shouldClearStaleBufferOnTimeupdate
} from './pauseBuffer.js';

/**
 * @param {object} player
 * @param {HTMLVideoElement} videoEl
 * @param {{
 *   shouldRecordRecents: () => boolean,
 *   syncWatchAccrual: () => void
 * }} deps
 */
export function bindPlayerVideoEvents(player, videoEl, { shouldRecordRecents, syncWatchAccrual }) {
    if (!videoEl) return;
    const isActive = () => videoEl === player.video;

    videoEl.addEventListener('loadstart', () => {
        if (!isActive()) return;
        player._noteLoadProgress('loadstart');
        player.loadPhase = 'connecting';
        player.emitState();
    });
    videoEl.addEventListener('canplay', () => {
        if (!isActive()) return;
        player._noteLoadProgress('canplay');
        if (player.loadPhase !== 'idle') {
            player.loadPhase = 'idle';
            player.emitState();
        }
    });
    videoEl.addEventListener('canplaythrough', () => {
        if (!isActive()) return;
        player._noteLoadProgress('canplaythrough');
        if (player.loading) {
            player.loading = false;
            player.emitState();
        }
        player._clearStuckLoadWatchdog();
    });
    videoEl.addEventListener('playing', () => {
        if (!isActive()) return;
        player._clearStuckLoadWatchdog();
        if (!shouldAcceptPlayingEvent(player.wantPlaying)) {
            return;
        }
        player.playing = true;
        player.loading = false;
        player.loadPhase = 'idle';
        player.pausePhase = 'idle';
        player.stopped = false;
        player.error = null;
        player.resumeBlocked = false;
        player.posterDataUrl = null;
        if (shouldRecordRecents()) savePlayerState({ wasPlaying: true });
        const key = channelKey(player.channel);
        if (shouldRecordRecents() && key && player.recentRecordedForKey !== key) {
            player.recentRecordedForKey = key;
            FavoritesRecents.pushRecent(key, player.channel);
            FavoritesRecents.markVisited(key, player.channel);
        }
        player.emitState();
        scheduleSlotPrefetch(player.id, player);
    });
    videoEl.addEventListener('timeupdate', () => {
        if (!isActive()) return;
        player._noteLoadProgress('timeupdate');
        if (player.pausePhase !== 'idle') {
            player.updatePauseBuffer();
        }
        if (shouldClearStaleBufferOnTimeupdate({
            wantPlaying: player.wantPlaying,
            playing: player.playing,
            videoPaused: player.video?.paused !== false,
            loading: player.loading,
            loadPhase: player.loadPhase
        })) {
            player.loading = false;
            player.loadPhase = 'idle';
            player.emitState();
            return;
        }
        player._clearStuckLoadWatchdog();
        syncWatchAccrual();
    });
    videoEl.addEventListener('progress', () => {
        if (!isActive()) return;
        player._noteLoadProgress('progress');
        if (player.pausePhase !== 'idle') {
            player.updatePauseBuffer();
        }
        player._clearStuckLoadWatchdog();
    });
    videoEl.addEventListener('pause', () => {
        if (!isActive()) return;
        if (!shouldAcceptPauseEvent(player.wantPlaying)) {
            return;
        }
        player.playing = false;
        if (player.pausePhase !== 'idle') {
            player.updatePauseBuffer();
        }
        player.emitState();
    });
    videoEl.addEventListener('waiting', () => {
        if (!isActive()) return;
        if (player.wantPlaying !== true) return;
        player.loading = true;
        player.loadPhase = 'buffering';
        if (player.pausePhase !== 'idle') {
            player.pausePhase = 'buffering';
        }
        player._armStuckLoadWatchdog();
        player.emitState();
    });
    videoEl.addEventListener('stalled', () => {
        if (!isActive()) return;
        if (player.wantPlaying !== true) return;
        if (player.playing || player.loading) {
            player.loadPhase = 'buffering';
            if (player.pausePhase !== 'idle') {
                player.pausePhase = 'buffering';
            }
            player._armStuckLoadWatchdog();
            player.emitState();
        }
    });
    videoEl.addEventListener('error', () => {
        if (!isActive()) return;
        player._clearStuckLoadWatchdog();
        player.loading = false;
        player.loadPhase = 'idle';
        player.playing = false;
        player.error = 'Stream unavailable';
        player.emitState();
    });
    videoEl.addEventListener('ended', () => {
        if (!isActive()) return;
        player._clearStuckLoadWatchdog();
        player.playing = false;
        player.loadPhase = 'idle';
        player.emitState();
    });
}
