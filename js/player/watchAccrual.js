/**
 * Watch-seconds accrual for a player instance (healthy / cast playback → bank time).
 */
import { channelKey } from '../tvProviders/channelShape.js';
import { addWatchSeconds } from '../storage/watchStats.js';
import { isHealthyWatchPlayback } from './pauseBuffer.js';

/** Max seconds credited in a single addWatchSeconds call (safety bound per chunk). */
export const WATCH_ACCRUAL_FLUSH_CAP_SEC = 30;

/**
 * @param {{
 *   getPlayer: () => object,
 *   shouldRecordRecents: () => boolean,
 *   isCastWatching?: () => boolean
 * }} deps
 */
export function createWatchAccrualControllers({
    getPlayer,
    shouldRecordRecents,
    isCastWatching = () => false
}) {
    let castTickTimer = 0;

    const watchPlaybackState = () => {
        const player = getPlayer();
        const video = player.video;
        return {
            hasChannel: Boolean(player.channel),
            playing: player.playing,
            loading: player.loading,
            loadPhase: player.loadPhase,
            wantPlaying: player.wantPlaying,
            error: player.error,
            pausePhase: player.pausePhase,
            stopped: player.stopped,
            posterDataUrl: player.posterDataUrl,
            freezePressure: player._freezePressure === true,
            videoPaused: video ? video.paused === true : true
        };
    };

    const shouldAccrueNow = () => {
        const player = getPlayer();
        if (!player.channel) return false;
        if (isCastWatching()) return true;
        return isHealthyWatchPlayback(watchPlaybackState());
    };

    const readMediaTime = () => {
        const t = Number(getPlayer().video?.currentTime);
        return Number.isFinite(t) ? t : NaN;
    };

    /**
     * Credit elapsed seconds in ≤cap chunks (no silent drop of overdue windows).
     * @param {string} key
     * @param {number} totalSec
     * @param {object|null} channel
     */
    const creditSeconds = (key, totalSec, channel) => {
        const player = getPlayer();
        let remaining = Math.max(0, Number(totalSec) || 0);
        if (remaining <= 0) return;
        while (remaining > 0) {
            const chunk = Math.min(remaining, WATCH_ACCRUAL_FLUSH_CAP_SEC);
            addWatchSeconds(key, chunk, channel);
            player.watchSessionSeconds = (Number(player.watchSessionSeconds) || 0) + chunk;
            remaining -= chunk;
        }
    };

    /**
     * Seconds to credit for the open window (media-clock preferred for local play).
     * @param {object} player
     * @param {boolean} castMode
     */
    const openElapsedSec = (player, castMode) => {
        if (!player.watchAccrueStartedAt) return 0;
        const wall = Math.max(0, (Date.now() - player.watchAccrueStartedAt) / 1000);
        if (castMode) return wall;
        const mediaAt = Number(player.watchAccrueMediaAt);
        const nowMedia = readMediaTime();
        if (Number.isFinite(mediaAt) && Number.isFinite(nowMedia) && nowMedia >= mediaAt) {
            const mediaDelta = nowMedia - mediaAt;
            // Live clocks can jump; prefer media when it moved, else wall.
            if (mediaDelta > 0.05) return Math.min(wall, mediaDelta);
        }
        return wall;
    };

    const clearOpenWindow = (player) => {
        player.watchAccrueKey = null;
        player.watchAccrueStartedAt = null;
        player.watchAccrueMediaAt = NaN;
    };

    const endWatchAccrual = (credit = true) => {
        const player = getPlayer();
        if (!player.watchAccrueStartedAt || !player.watchAccrueKey) return;
        if (credit) {
            const castMode = isCastWatching();
            const elapsed = openElapsedSec(player, castMode);
            if (elapsed > 0) {
                const currentKey = channelKey(player.channel);
                const meta = currentKey === player.watchAccrueKey ? player.channel : null;
                creditSeconds(player.watchAccrueKey, elapsed, meta);
            }
        }
        clearOpenWindow(player);
    };

    const flushWatchAccrual = () => endWatchAccrual(true);

    const abortWatchAccrual = () => endWatchAccrual(false);

    const startOpenWindow = (key) => {
        const player = getPlayer();
        if (player.watchSessionKey !== key) {
            player.watchSessionSeconds = 0;
            player.watchSessionKey = key;
        }
        player.watchAccrueKey = key;
        player.watchAccrueStartedAt = Date.now();
        player.watchAccrueMediaAt = readMediaTime();
    };

    const armCastTick = () => {
        if (castTickTimer || typeof setInterval !== 'function') return;
        castTickTimer = setInterval(() => {
            try {
                if (!isCastWatching()) {
                    clearCastTick();
                    syncWatchAccrual();
                    return;
                }
                syncWatchAccrual();
            } catch { /* ignore */ }
        }, 1000);
        // Node test runners: don't keep the process alive solely for cast ticks.
        if (typeof castTickTimer?.unref === 'function') castTickTimer.unref();
    };

    const clearCastTick = () => {
        if (!castTickTimer) return;
        clearInterval(castTickTimer);
        castTickTimer = 0;
    };

    const syncWatchAccrual = () => {
        const player = getPlayer();
        if (!shouldRecordRecents()) return;
        const key = channelKey(player.channel);
        if (!key || key.endsWith(':')) {
            flushWatchAccrual();
            if (!player.channel) {
                player.watchSessionSeconds = 0;
                player.watchSessionKey = null;
            }
            clearCastTick();
            return;
        }

        // Channel changed mid-window: bank prior key, then new tune starts fresh session.
        if (player.watchAccrueKey && player.watchAccrueKey !== key) {
            flushWatchAccrual();
        }
        if (player.watchSessionKey && player.watchSessionKey !== key) {
            player.watchSessionSeconds = 0;
            player.watchSessionKey = key;
        }

        if (shouldAccrueNow()) {
            if (isCastWatching()) armCastTick();
            else clearCastTick();

            if (player.watchAccrueKey === key && player.watchAccrueStartedAt) {
                const castMode = isCastWatching();
                const openFor = openElapsedSec(player, castMode);
                if (openFor < WATCH_ACCRUAL_FLUSH_CAP_SEC) return;
                // Bank overdue time in chunks, then reopen.
                flushWatchAccrual();
                startOpenWindow(key);
                return;
            }
            flushWatchAccrual();
            startOpenWindow(key);
            return;
        }

        flushWatchAccrual();
        clearCastTick();
    };

    const snapshotWatchAccrual = () => {
        flushWatchAccrual();
        // Restart when still accruable (incl. hidden + playing, or cast).
        syncWatchAccrual();
    };

    return {
        watchPlaybackState,
        endWatchAccrual,
        flushWatchAccrual,
        abortWatchAccrual,
        syncWatchAccrual,
        snapshotWatchAccrual,
        clearCastTick,
        shouldAccrueNow,
        openElapsedSec
    };
}
