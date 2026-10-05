/**
 * Mosaic mute/batch transport and channel play orchestration.
 * Methods mix into MultiView (this === MultiView).
 */
import { channelKey, normalizeChannel } from '../tvProviders/channelShape.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { showAppToast } from '../ui/toast.js';
import { el } from '../tvUtils.js';
import { TileFrames } from '../tileFrames.js';
import { cancelSlotPrefetch, cancelAllPrefetch } from '../player/channelPrefetch.js';
import { computeMosaicLaunchDelay } from '../player/loadBudget.js';
import { tvDebug } from '../player/tvDebug.js';
import { ChromecastManager } from '../cast/chromecastManager.js';
import { PLAY_ALL_SVG, PAUSE_ALL_SVG } from '../ui/tileHoverControls.js';
import { pushSlotChannelHistory, hasSlotChannelHistory, hasSlotChannelForward } from './channelHistory.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    MAX_MOSAIC_SLOTS,
    PLAY_FILL_ORDER,
    waitMs
} from './constants.js';
import { RadioBridge } from '../radio/radioBridge.js';

function radioEnabled() {
    return SettingsStore.getRadioEnabled() === true;
}

function RP() {
    return RadioBridge.getPlayer();
}

function RM() {
    return RadioBridge.getModule();
}

/**
 * Warm staging then commit (or play directly when nothing visible).
 * @param {object} mv MultiView
 * @param {string} id
 * @param {object} player
 * @param {object} normalized
 * @param {number} switchGen
 * @param {{ allowFallbackOnWarmFail?: boolean }} [opts]
 * @returns {Promise<'played-direct'|'committed'|'aborted'|'fallback'>}
 */
async function warmAndCommitOrPlay(mv, id, player, normalized, switchGen, {
    allowFallbackOnWarmFail = false
} = {}) {
    const hasVisibleContent = Boolean(
        player.channel
        && (player.playing || player.loading || player.pausePhase !== 'idle')
    );

    if (!hasVisibleContent) {
        await mv.withChannelSwitchTransition(
            id,
            () => player.playChannel(normalized),
            { skipOut: true }
        );
        return 'played-direct';
    }

    await player.startPrepareChannel(normalized, switchGen, { suppressUi: false });

    if (switchGen !== player.switchGeneration) return 'aborted';

    const bufferReady = await player.waitForPrepareReady(switchGen);

    if (!bufferReady || switchGen !== player.switchGeneration) {
        player.cancelPrepare();
        player._abortSwitchIntent();
        if (!allowFallbackOnWarmFail) return 'aborted';
        tvDebug('multiview', 'safe loading warm failed — fallback playChannel', { slot: id });
        await mv.withChannelSwitchTransition(
            id,
            () => player.playChannel(normalized),
            { skipIn: true }
        );
        return 'fallback';
    }

    let committed = false;
    await mv.withChannelSwitchTransition(
        id,
        {
            onPrepare: () => {},
            onCommit: async () => {
                committed = await player.commitPreparedChannel(
                    normalized,
                    switchGen,
                    { allowFallback: false }
                ) === true;
            }
        },
        {
            skipOut: false,
            skipIn: true
        }
    );

    return committed ? 'committed' : 'aborted';
}

/**
 * Shared post-switch cleanup for playChannelSafe / playOnSlotSafeLoading / playOnSlot.
 * @param {object} mv
 * @param {string} id
 * @param {object} channel
 * @param {object} player
 * @param {{ syncStatus?: boolean, previousKey?: string|null, skipHistory?: boolean }} [opts]
 */
async function finishSlotChannelSwitch(mv, id, channel, player, {
    syncStatus = true,
    previousKey = null,
    skipHistory = false
} = {}) {
    player._suppressErrorToast = false;
    if (!skipHistory) {
        pushSlotChannelHistory(id, previousKey, channelKey(channel || player?.channel));
    }
    mv.persistSlots();
    mv.scheduleRefreshTiles();
    if (syncStatus) mv.syncStatusChrome();
    mv.syncSettingsToggles();
    if (ChromecastManager.getActiveSlot() === id && ChromecastManager.isCasting()) {
        try {
            await ChromecastManager.loadMedia(channel);
        } catch { /* ignore */ }
    }
    if (id === 'center') mv.getPrimary()?.emitState();
}

/**
 * Enable corner + mount + ensure player for a slot play.
 * @param {object} mv
 * @param {string} id
 * @returns {object|null} player
 */
function prepareSlotForPlay(mv, id) {
    cancelSlotPrefetch(id);
    if (CORNER_IDS.includes(id) && !mv.slots[id]?.enabled) {
        mv.setSideEnabled(id, true);
    }
    mv.setStatusSlot(id);
    mv.mountAll();
    const startMuted = id !== 'center';
    const player = mv.ensurePlayer(id, { startMuted });
    if (!player) return null;
    const surface = el(`tv-playback-surface-${id}`);
    if (surface) player.mountVideo(surface);
    return player;
}

export const playbackMethods = {
    isSlotAudible(player) {
        return Boolean(
            player?.channel
            && player.muted === false
            && this.sharedVolume > 0
            && (player.volume ?? 1) > 0
        );
    },

    isMuteAllActive() {
        if (this.sharedVolume <= 0) return true;
        let anyEnabled = false;
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled) continue;
            anyEnabled = true;
            if (this.isSlotAudible(slot.player)) return false;
        }
        const player = RP();
        const mod = RM();
        if (radioEnabled() && mod?.isOpen?.() && player?.hasActiveStation?.()) {
            anyEnabled = true;
            if (player.isAudible?.()) return false;
        }
        if (!anyEnabled) return true;
        if (radioEnabled() && mod?.isOpen?.() && player?.hasActiveStation?.()) {
            return !player.isAudible?.();
        }
        return true;
    },

    isAnyPlaying() {
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) continue;
            if (slot.player.wantPlaying === true || slot.player.playing === true) return true;
        }
        if (radioEnabled() && RP()?.playing) return true;
        return false;
    },

    isAllPlaying() {
        let hasChannel = false;
        for (const id of SLOT_IDS) {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) continue;
            hasChannel = true;
            if (!(slot.player.wantPlaying === true || slot.player.playing === true)) return false;
        }
        const player = RP();
        const mod = RM();
        if (radioEnabled() && mod?.isOpen?.() && player?.hasActiveStation?.()) {
            hasChannel = true;
            if (!player.playing) return false;
        }
        return hasChannel;
    },

    muteAll() {
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            slot.player.mute();
        });
        if (radioEnabled() && RP()?.hasActiveStation?.()) RP().mute();
        this.persistSlots();
        // emitState → onState → scheduleRefreshTiles
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    /** Mute every other TV; unmute this one (one-way). Also mutes radio. */
    muteSolo(slotId) {
        if (this.sharedVolume <= 0) {
            const restored = this.lastVolume > 0 ? this.lastVolume : 0.85;
            this.setSharedVolume(restored);
        }
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            if (id === slotId) slot.player.unmute();
            else slot.player.mute();
        });
        if (radioEnabled()) RP()?.mute?.();
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    unmuteAll() {
        if (this.sharedVolume <= 0) {
            const restored = this.lastVolume > 0 ? this.lastVolume : 0.85;
            this.setSharedVolume(restored);
        }
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            slot.player.unmute();
        });
        if (radioEnabled() && RP()?.hasActiveStation?.()) RP().unmute();
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    /** Mute all TVs and play/unmute radio. */
    async focusRadio() {
        if (!radioEnabled()) return;
        const mod = RM();
        const player = RP();
        if (!mod || !player) return;
        if (!mod.isOpen?.()) mod.open();
        SLOT_IDS.forEach((id) => {
            const slot = this.slots[id];
            if (!slot?.enabled || !slot.player?.channel) return;
            slot.player.mute();
        });
        if (this.sharedVolume <= 0) {
            const restored = this.lastVolume > 0 ? this.lastVolume : 0.85;
            this.setSharedVolume(restored);
        }
        player.unmute();
        try {
            if (!player.playing) await player.play();
        } catch { /* toast handled by caller UI */ }
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
        mod.syncTransportUi?.();
    },

    async stopAll() {
        // Fire-stagger: kick each slot ~500ms apart without awaiting completion
        // (same shape as playChannelsOnMosaic). Awaiting each transition used to
        // stall the whole batch when alt-tab paused WAAPI/rAF mid-wipe.
        const targets = SLOT_IDS
            .map((id) => ({ id, slot: this.slots[id] }))
            .filter(({ slot }) => slot?.enabled && slot?.player?.channel);
        const stepMs = computeMosaicLaunchDelay(1, 500);
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        TileFrames.setPlaybackBusy(true);
        const jobs = [];
        try {
            for (let i = 0; i < targets.length; i++) {
                if (i > 0) await waitMs(stepMs);
                const { id, slot } = targets[i];
                const player = slot?.player;
                if (!player?.channel) continue;
                const shouldAnimate = !hidden
                    && (player.playing || player.loading || player.pausePhase !== 'idle');
                jobs.push(
                    shouldAnimate
                        ? this.withChannelSwitchTransition(
                            id,
                            () => player.stop().catch(() => {})
                        )
                        : player.stop().catch(() => {})
                );
            }
            await Promise.allSettled(jobs);
        } finally {
            if (!this.isAnyPlaying()) TileFrames.setPlaybackBusy(false);
        }
        if (SettingsStore.getRadioEnabled()) {
            RP()?.stop?.();
        }
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    async playAll() {
        // Fire-stagger fresh plays / resumes: kick starts ~500ms apart, join at
        // the end. Hidden tab skips transitions (no WAAPI hang on alt-tab).
        const targets = SLOT_IDS
            .map((id) => ({ id, slot: this.slots[id] }))
            .filter(({ slot }) => {
                const player = slot?.player;
                if (!slot?.enabled || !player?.channel) return false;
                return !(player.wantPlaying === true || player.playing === true);
            });
        const stepMs = computeMosaicLaunchDelay(1, 500);
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        TileFrames.setPlaybackBusy(true);
        const jobs = [];
        try {
            for (let i = 0; i < targets.length; i++) {
                if (i > 0) await waitMs(stepMs);
                const { id, slot } = targets[i];
                const player = slot?.player;
                if (!player?.channel) continue;
                // The stagger leaves a window where a slot may have started
                // playing on its own — never double-start it.
                if (player.wantPlaying === true || player.playing === true) continue;
                jobs.push((async () => {
                    try {
                        if (player.channel.url_resolved && !player.stopped) {
                            await player.resume();
                            return;
                        }
                        if (hidden) {
                            await player.playChannel(player.channel);
                            return;
                        }
                        await this.withChannelSwitchTransition(
                            id,
                            () => player.playChannel(player.channel),
                            { skipOut: true }
                        );
                    } catch {
                        /* ignore per-slot failures */
                    }
                })());
            }
            await Promise.allSettled(jobs);
        } finally {
            if (!this.isAnyPlaying()) TileFrames.setPlaybackBusy(false);
        }
        if (radioEnabled()
            && RM()?.isOpen?.()
            && RP()?.hasActiveStation?.()
            && !RP()?.playing) {
            try { await RP().play(); } catch { /* ignore */ }
        }
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    async pauseAll() {
        await Promise.all(SLOT_IDS.map(async (id) => {
            const slot = this.slots[id];
            const player = slot?.player;
            if (!slot?.enabled || !player?.channel) return;
            if (player.wantPlaying !== true && player.playing !== true) return;
            try {
                player.pause();
            } catch {
                /* ignore per-slot failures */
            }
        }));
        if (radioEnabled() && RP()?.playing) {
            RP().pause();
        }
        this.persistSlots();
        this.getPrimary()?.emitState();
        this.syncMosaicChrome();
    },

    syncMosaicChrome() {
        if (typeof document === 'undefined') return;
        const app = el('app-container') || document.body;
        const muteAllActive = this.isMuteAllActive();
        app.classList.toggle('is-mute-all-active', muteAllActive);

        const muteAllBtns = [
            el('remote-mute-all-btn'),
            ...Array.from(document.querySelectorAll(
                '#player-mosaic .tv-controls__mute-popout [data-tile-action="mute-all"]'
            ))
        ].filter(Boolean);
        muteAllBtns.forEach((btn) => {
            const label = muteAllActive ? 'Unmute all' : 'Mute all';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-pressed', String(muteAllActive));
            const wave = btn.querySelector('.mosaic-mute-all-wave, .remote-mute-all-wave');
            const slash = btn.querySelector('.mosaic-mute-all-slash, .remote-mute-all-slash');
            if (wave) wave.style.opacity = muteAllActive ? '0' : '1';
            if (slash) slash.setAttribute('opacity', muteAllActive ? '1' : '0');
        });

        const anyPlaying = this.isAnyPlaying();
        const allPlaying = this.isAllPlaying();

        // Remote play-all morphs to pause-all; tile chrome play-all only shows when needed.
        const remotePlayAll = el('remote-play-all-btn');
        if (remotePlayAll) {
            const isPause = allPlaying;
            const label = isPause ? 'Pause all' : 'Play all';
            remotePlayAll.title = label;
            remotePlayAll.setAttribute('aria-label', label);
            remotePlayAll.setAttribute('aria-pressed', String(isPause));
            remotePlayAll.innerHTML = isPause ? PAUSE_ALL_SVG : PLAY_ALL_SVG;
        }

        const mosaic = el('player-mosaic');
        mosaic?.querySelectorAll('.tv-controls__play-popout [data-tile-action="play-all"]').forEach((btn) => {
            const hide = allPlaying;
            btn.classList.toggle('is-hidden', hide);
            btn.hidden = hide;
        });

        const remoteStopAll = el('remote-stop-all-btn');
        if (remoteStopAll) {
            remoteStopAll.title = 'Stop all';
            remoteStopAll.setAttribute('aria-label', 'Stop all');
            remoteStopAll.classList.toggle('is-hidden', !anyPlaying);
            remoteStopAll.setAttribute('aria-disabled', String(!anyPlaying));
            remoteStopAll.setAttribute('aria-pressed', String(anyPlaying));
        }

        mosaic?.querySelectorAll('.tv-controls__stop-popout [data-tile-action="stop-all"]').forEach((btn) => {
            const hide = !anyPlaying;
            btn.classList.toggle('is-hidden', hide);
            btn.hidden = hide;
        });

        mosaic?.querySelectorAll('.tv-player-tile').forEach((tile) => {
            const slotId = tile.getAttribute('data-slot');
            if (!slotId) return;
            const prevBtn = tile.querySelector('[data-tile-action="chan-prev"]');
            if (prevBtn) {
                const hasPrev = hasSlotChannelHistory(slotId);
                prevBtn.hidden = !hasPrev;
                prevBtn.classList.toggle('is-hidden', !hasPrev);
            }
            const nextBtn = tile.querySelector('[data-tile-action="chan-next"]');
            if (nextBtn) {
                const hasNext = hasSlotChannelForward(slotId);
                nextBtn.hidden = !hasNext;
                nextBtn.classList.toggle('is-hidden', !hasNext);
            }
        });

        if (typeof document !== 'undefined') {
            import('../ui/remotePanel.js').then(({ RemotePanel }) => RemotePanel.syncRemotePanel?.()).catch(() => {});
        }
    },

    playOnPrimary(channel) {
        return this.playOnSlot('center', channel);
    },

    /**
     * Play a channel using safe-loading semantics regardless of the global
     * channel-switch mode. Returns true only when the staging buffer was
     * warmed and the swap committed/playing. Never falls back to a
     * destructive playChannel() that would stop the current stream before the
     * next one is confirmed.
     * @param {string} slotId
     * @param {object} channel
     * @returns {Promise<boolean>}
     */
    async playChannelSafe(slotId, channel, { skipHistory = false } = {}) {
        const id = slotId || 'center';
        const player = prepareSlotForPlay(this, id);
        if (!player) return false;

        const previousKey = channelKey(player.channel);
        const normalized = normalizeChannel(channel, channel?.providerId) || channel;
        const key = channelKey(normalized);

        player._suppressErrorToast = true;
        player.switchGeneration = (player.switchGeneration || 0) + 1;
        const switchGen = player.switchGeneration;
        tvDebug('multiview', 'playChannelSafe', { slot: id, key });

        try {
            const result = await warmAndCommitOrPlay(
                this, id, player, normalized, switchGen,
                { allowFallbackOnWarmFail: false }
            );
            if (result === 'played-direct') return player.playing === true;
            if (result === 'committed') return player.playing === true;
            return false;
        } finally {
            await finishSlotChannelSwitch(this, id, channel, player, {
                syncStatus: true,
                previousKey,
                skipHistory
            });
        }
    },

    /**
     * Safe Loading: hold current stream/UI until next channel is confirmed on staging.
     * @param {string} id
     * @param {object} channel
     * @param {object} player
     * @param {object} normalized
     * @param {string} key
     * @param {{ skipHistory?: boolean, previousKey?: string|null }} [opts]
     */
    async playOnSlotSafeLoading(id, channel, player, normalized, key, {
        skipHistory = false,
        previousKey = null
    } = {}) {
        cancelSlotPrefetch(id);
        showAppToast('Fetching next channel…');
        this.syncStatusChrome();

        player._suppressErrorToast = true;
        player.switchGeneration = (player.switchGeneration || 0) + 1;
        const switchGen = player.switchGeneration;
        tvDebug('multiview', 'safe loading switch', { slot: id, key });

        try {
            const result = await warmAndCommitOrPlay(
                this, id, player, normalized, switchGen,
                { allowFallbackOnWarmFail: true }
            );

            if (result === 'aborted' && switchGen === player.switchGeneration) {
                player._abortSwitchIntent();
                showAppToast('Could not load channel');
            }

            this.syncStatusChrome();
        } finally {
            await finishSlotChannelSwitch(this, id, channel, player, {
                syncStatus: true,
                previousKey,
                skipHistory
            });
        }
    },

    /**
     * Play a channel on a specific mosaic slot (enables the side if needed).
     * @param {string} slotId
     * @param {object} channel
     * @param {{ skipHistory?: boolean }} [opts]
     */
    playOnSlot(slotId, channel, { skipHistory = false } = {}) {
        const id = slotId || 'center';
        const player = prepareSlotForPlay(this, id);
        if (!player) return Promise.reject(new Error(`No player for slot ${id}`));

        const previousKey = channelKey(player.channel);
        const normalized = normalizeChannel(channel, channel?.providerId) || channel;
        const key = channelKey(normalized);

        if (SettingsStore.getChanSwitchMode() === 'safeLoading') {
            return this.playOnSlotSafeLoading(id, channel, player, normalized, key, {
                skipHistory,
                previousKey
            });
        }

        const hasVisibleContent = Boolean(
            player.channel
            && (player.playing || player.loading || player.pausePhase !== 'idle')
        );

        player.switchGeneration = (player.switchGeneration || 0) + 1;
        const switchGen = player.switchGeneration;
        player._suppressErrorToast = true;

        // Only Safe Loading benefits from a background warm (it waits for the
        // staging buffer). Classic mode immediately falls back to playChannel,
        // so starting a warm here would just double the HLS traffic per click.
        if (hasVisibleContent && SettingsStore.getChanSwitchMode() === 'safeLoading') {
            void player.startPrepareChannel(normalized, switchGen, { suppressUi: false });
        }

        return this.withChannelSwitchTransition(
            id,
            async () => {
                // Mash guard: a newer pick superseded this one — never act on the stale channel.
                if (switchGen !== player.switchGeneration) return;
                if (player.isPrepareReady()) {
                    const committed = await player.commitPreparedChannel(
                        normalized,
                        switchGen,
                        { allowFallback: true }
                    );
                    if (committed === true) return;
                    player._abortSwitchIntent();
                } else {
                    player.cancelPrepare();
                }
                await player.playChannel(normalized);
            },
            { skipOut: !hasVisibleContent }
        ).finally(async () => {
            await finishSlotChannelSwitch(this, id, channel, player, {
                syncStatus: false,
                previousKey,
                skipHistory
            });
        });
    },

    /**
     * Pause other slots and start playback on one mosaic screen (resume modal).
     * @param {string} slotId
     */
    async playExclusiveSlot(slotId) {
        const id = slotId || 'center';
        if (CORNER_IDS.includes(id) && !this.slots[id]?.enabled) {
            this.setSideEnabled(id, true);
        }

        for (const otherId of SLOT_IDS) {
            if (otherId === id) continue;
            const player = this.slots[otherId]?.player;
            if (!player) continue;
            if (player.playing || player.wantPlaying) player.pause();
        }

        this.setStatusSlot(id);
        this.mountAll();
        const startMuted = id !== 'center';
        const player = this.ensurePlayer(id, { startMuted });
        if (!player?.channel) return;

        TileFrames.setPlaybackBusy(true);
        if (player.playing) {
            this.persistSlots();
            this.scheduleRefreshTiles();
            player.emitState?.();
            return;
        }

        const surface = el(`tv-playback-surface-${id}`);
        if (surface) player.mountVideo(surface);

        try {
            if (player.channel.url_resolved && !player.stopped) {
                await player.resume();
            } else {
                await player.playChannel(player.channel);
            }
        } finally {
            this.persistSlots();
            this.scheduleRefreshTiles();
            this.syncSettingsToggles();
            player.emitState?.();
        }
    },

    /**
     * Play channels across mosaic slots in display order (center first, then corners).
     * Enables only the slots needed for the list (capped at MAX_MOSAIC_SLOTS) and disables unused corners.
     * @param {object[]} channels
     */
    async playChannelsOnMosaic(channels) {
        const list = (Array.isArray(channels) ? channels : [])
            .filter(Boolean)
            .slice(0, Math.min(this.getMaxMosaicSlots?.() ?? MAX_MOSAIC_SLOTS, PLAY_FILL_ORDER.length));
        if (!list.length) return;

        this.init();

        const used = new Set(PLAY_FILL_ORDER.slice(0, list.length));
        for (const id of CORNER_IDS) {
            this.setSideEnabled(id, used.has(id), { silent: true });
        }

        this.syncLayout();
        this.mountAll();

        const plays = [];
        const launchOne = (channel, slotId) => {
            const startMuted = slotId !== 'center';
            const player = this.ensurePlayer(slotId, { startMuted });
            if (!player) return Promise.resolve();
            if (startMuted) {
                player.muted = true;
                player.applyAudioToVideo();
            }
            const surface = el(`tv-playback-surface-${slotId}`);
            if (surface) player.mountVideo(surface);
            return player.playChannel(channel).catch((err) => {
                const blocked = err?.name === 'NotAllowedError'
                    || String(err?.message || '').toLowerCase().includes('not allowed');
                if (!blocked) console.warn(`playChannelsOnMosaic ${slotId} failed`, err);
                return null;
            });
        };

        // Batch launches compete with everything else: drop prefetch, mark
        // playback busy, and stagger the fresh attaches so up to MAX_MOSAIC_SLOTS
        // new manifests don't all slam the connection pool at once.
        cancelAllPrefetch();
        TileFrames.setPlaybackBusy(true);

        try {
            for (let i = 0; i < list.length; i++) {
                const channel = list[i];
                const slotId = PLAY_FILL_ORDER[i];
                plays.push(launchOne(channel, slotId));
                if (i < list.length - 1) {
                    await waitMs(computeMosaicLaunchDelay(1));
                }
            }
            await Promise.allSettled(plays);
        } finally {
            if (!this.isAnyPlaying()) TileFrames.setPlaybackBusy(false);
        }
        this.persistSlots();
        this.syncSettingsToggles();
        this.getPrimary()?.emitState();
    }
};
