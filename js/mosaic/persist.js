/**
 * Mosaic slot stub apply, persist, and stream restore.
 * Methods mix into MultiView (this === MultiView).
 */
import {
    loadPlayerState,
    savePlayerState
} from '../storage/playerState.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { TvProviderRegistry } from '../tvProviders/registry.js';
import { PosterCache } from '../storage/posterCache.js';
import { resolveRestorePlayMute } from '../player/pauseBuffer.js';
import { el } from '../tvUtils.js';
import { CORNER_IDS, SLOT_IDS } from './constants.js';

/**
 * Prefer mosaicSlots; fall back to lastChannelKey as a center-only map.
 * @param {{ mosaicSlots?: object, lastChannelKey?: string, lastChannelName?: string }} state
 * @returns {Record<string, object> | null}
 */
export function resolveSavedMosaicMap(state) {
    if (state?.mosaicSlots && Object.keys(state.mosaicSlots).length) {
        return state.mosaicSlots;
    }
    if (state?.lastChannelKey) {
        return {
            center: {
                key: state.lastChannelKey,
                name: state.lastChannelName || '',
                muted: true,
                url: ''
            }
        };
    }
    return null;
}

/**
 * Build a stub channel object from a mosaicSlots entry (no live URL resolve).
 * @param {{ key: string, name?: string, url?: string }} entry
 * @param {{ providerId?: string, channelId?: string, countrycode?: string, name?: string } | null} [extra]
 */
export function stubChannelFromEntry(entry, extra = null) {
    if (!entry?.key) return null;
    const parsed = parseChannelKey(entry.key);
    return {
        providerId: parsed?.providerId || extra?.providerId,
        channelId: parsed?.channelId || extra?.channelId,
        channeluuid: entry.key,
        name: entry.name || extra?.name || 'Last channel',
        url_resolved: entry.url || undefined,
        ...(extra?.countrycode ? { countrycode: extra.countrycode } : {})
    };
}

export const persistMethods = {
    applySavedSlotStubs() {
        const state = loadPlayerState();
        const mosaic = resolveSavedMosaicMap(state);
        this.rememberedSlotKeys = {};
        if (!mosaic) {
            this.refreshTiles();
            return;
        }

        const keys = [];
        SLOT_IDS.forEach((id) => {
            const entry = mosaic[id];
            if (!entry?.key) return;
            this.rememberedSlotKeys[id] = entry.key;
            keys.push(entry.key);

            if (id !== 'center' && !this.slots[id]?.enabled) {
                this.setSideEnabled(id, true, { silent: true });
            }

            const startMuted = entry.muted !== false;
            const player = this.ensurePlayer(id, { startMuted });
            if (!player) return;
            player.muted = startMuted;
            player.applyAudioToVideo();

            if (!player.channel) {
                player.channel = stubChannelFromEntry(entry);
            }
        });

        this.syncLayout();
        this.mountAll();
        // Sync flush so stubs/posters paint before catalog work.
        this.refreshTiles();

        if (!keys.length) return;
        PosterCache.getPosters(keys).then((map) => {
            let painted = false;
            SLOT_IDS.forEach((id) => {
                const key = this.rememberedSlotKeys[id];
                const player = this.slots[id]?.player;
                if (!key || !player) return;
                const poster = map.get(key);
                if (!poster) return;
                if (!player.posterDataUrl) {
                    player.posterDataUrl = poster;
                    painted = true;
                }
            });
            if (painted) this.scheduleRefreshTiles();
        }).catch(() => {});
    },

    persistSlots() {
        const prev = loadPlayerState().mosaicSlots || {};
        const mosaicSlots = { ...prev };

        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            // Drop disabled corners from mosaicSlots; only rewrite enabled slots.
            if (!slot?.enabled) {
                delete mosaicSlots[id];
                return;
            }

            if (!slot.player?.channel) {
                // Before hydrate, empty players must not wipe saved satellites.
                if (!this.slotsHydrated) return;
                // Keep remembered stub assignments (instant restore) even if HLS failed.
                if (this.rememberedSlotKeys[id]) return;
                delete mosaicSlots[id];
                return;
            }
            const key = channelKey(slot.player.channel);
            if (!key || key.endsWith(':')) {
                if (!this.slotsHydrated) return;
                delete mosaicSlots[id];
                return;
            }
            mosaicSlots[id] = {
                key,
                name: slot.player.channel.name || '',
                muted: slot.player.muted !== false,
                url: slot.player.channel.url_resolved || slot.player.channel.url || ''
            };
        });

        const primary = this.getPrimary();
        const primaryKey = primary?.channel ? channelKey(primary.channel) : null;
        savePlayerState({
            mosaicSlots,
            ...(primaryKey && !primaryKey.endsWith(':')
                ? {
                    lastChannelKey: primaryKey,
                    lastChannelName: primary.channel.name || ''
                }
                : {})
        });
    },

    async restoreSlots() {
        const state = loadPlayerState();
        const mosaic = resolveSavedMosaicMap(state);
        if (!mosaic) {
            this.slotsHydrated = true;
            return false;
        }

        try {
            // Re-enable any satellite that has a saved channel so restore cannot skip it.
            CORNER_IDS.forEach((id) => {
                if (!mosaic[id]?.key) return;
                if (!this.slots[id]?.enabled) {
                    this.setSideEnabled(id, true, { silent: true });
                }
            });
            this.syncLayout();
            this.mountAll();
            this.syncSettingsToggles();

            const resolveEntry = async (entry) => {
                let channel = null;
                try {
                    channel = await TvProviderRegistry.getChannel(parseChannelKey(entry.key));
                } catch { /* ignore */ }

                if (channel?.url_resolved) return channel;

                const stub = stubChannelFromEntry(entry, channel);
                if (!stub?.url_resolved && !stub?.providerId && !stub?.channelId) return null;
                if (channel?.countrycode) stub.countrycode = channel.countrycode;
                return stub;
            };

            const restoreOne = async (id, { play } = {}) => {
                const entry = mosaic[id];
                if (!entry?.key) return;
                if (id !== 'center' && !this.slots[id]?.enabled) return;

                const desiredMuted = entry.muted !== false;
                const player = this.ensurePlayer(id, { startMuted: desiredMuted });
                player.muted = desiredMuted;
                player.applyAudioToVideo();

                const surface = el(`tv-playback-surface-${id}`);
                if (surface) player.mountVideo(surface);

                const channel = await resolveEntry(entry);
                if (!channel) {
                    player.channel = stubChannelFromEntry(entry);
                    player.emitState();
                    return;
                }

                if (!channel.url_resolved) {
                    player.channel = channel;
                    player.emitState();
                    return;
                }

                this.rememberedSlotKeys[id] = entry.key;

                if (play) {
                    // Muted-first autoplay (historical boot behavior); re-apply saved mute after.
                    const mutePlan = resolveRestorePlayMute(entry.muted);
                    player.muted = mutePlan.duringPlay;
                    player.applyAudioToVideo();
                    try {
                        await player.playChannel(channel);
                    } catch { /* autoplay may block */ }
                    // Keep last poster until live video paints; do not force-clear.
                    // Only unmute when playback actually started.
                    if (player.playing === true && !player.resumeBlocked) {
                        player.muted = mutePlan.afterPlay;
                    }
                } else {
                    await player.loadChannelPaused(channel);
                    player.muted = desiredMuted;
                }

                player.applyAudioToVideo();
            };

            const centerPlay = state.wasPlaying === true;
            await Promise.all([
                restoreOne('center', { play: centerPlay }),
                ...CORNER_IDS.map((id) => restoreOne(id, { play: false }))
            ]);

            this.mountAll();
            // One sync flush after all slots attach.
            this.refreshTiles();
            this.getPrimary()?.emitState();
            this.persistSlots();
            if (this.hasCustomPlacement()) {
                requestAnimationFrame(() => this.applyFreeLayout());
            }
            return true;
        } finally {
            this.slotsHydrated = true;
        }
    },
};
