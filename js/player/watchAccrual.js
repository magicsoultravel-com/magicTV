/**
 * Watch-seconds accrual for a player instance (healthy playback → bank time).
 */
import { channelKey } from '../tvProviders/channelShape.js';
import { addWatchSeconds } from '../storage/watchStats.js';
import { isHealthyWatchPlayback } from './pauseBuffer.js';

/** Max wall-clock seconds credited in a single flush (guards hidden-tab / stuck windows). */
export const WATCH_ACCRUAL_FLUSH_CAP_SEC = 30;

/**
 * @param {{
 *   getPlayer: () => object,
 *   shouldRecordRecents: () => boolean
 * }} deps
 */
export function createWatchAccrualControllers({ getPlayer, shouldRecordRecents }) {
    const watchPlaybackState = () => {
        const player = getPlayer();
        return {
            hasChannel: Boolean(player.channel),
            playing: player.playing,
            loading: player.loading,
            loadPhase: player.loadPhase,
            wantPlaying: player.wantPlaying,
            error: player.error,
            pausePhase: player.pausePhase,
            stopped: player.stopped,
            posterDataUrl: player.posterDataUrl
        };
    };

    const endWatchAccrual = (credit = true) => {
        const player = getPlayer();
        if (!player.watchAccrueStartedAt || !player.watchAccrueKey) return;
        if (credit) {
            const elapsed = Math.min(
                (Date.now() - player.watchAccrueStartedAt) / 1000,
                WATCH_ACCRUAL_FLUSH_CAP_SEC
            );
            if (elapsed > 0) {
                addWatchSeconds(player.watchAccrueKey, elapsed, player.channel);
            }
        }
        player.watchAccrueKey = null;
        player.watchAccrueStartedAt = null;
    };

    const flushWatchAccrual = () => endWatchAccrual(true);

    const abortWatchAccrual = () => endWatchAccrual(false);

    const syncWatchAccrual = () => {
        const player = getPlayer();
        if (!shouldRecordRecents()) return;
        const key = channelKey(player.channel);
        if (!key) {
            flushWatchAccrual();
            return;
        }
        if (isHealthyWatchPlayback(watchPlaybackState())) {
            if (player.watchAccrueKey === key && player.watchAccrueStartedAt) {
                const openFor = (Date.now() - player.watchAccrueStartedAt) / 1000;
                // Bank periodically so long sessions aren't lost to the per-flush safety cap.
                if (openFor < WATCH_ACCRUAL_FLUSH_CAP_SEC) return;
                flushWatchAccrual();
                player.watchAccrueKey = key;
                player.watchAccrueStartedAt = Date.now();
                return;
            }
            flushWatchAccrual();
            player.watchAccrueKey = key;
            player.watchAccrueStartedAt = Date.now();
            return;
        }
        flushWatchAccrual();
    };

    const snapshotWatchAccrual = () => {
        flushWatchAccrual();
        // Do not restart accrual while hidden — wall-clock would inflate in the background.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        syncWatchAccrual();
    };

    return {
        watchPlaybackState,
        endWatchAccrual,
        flushWatchAccrual,
        abortWatchAccrual,
        syncWatchAccrual,
        snapshotWatchAccrual
    };
}
