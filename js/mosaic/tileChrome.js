/**
 * Mosaic tile DOM refresh, control chrome, and tile action routing.
 * Methods mix into MultiView (this === MultiView).
 */
import { ACTION_ICONS, CARD_ICONS } from '../ui/icons.js';
import { showAppToast } from '../ui/toast.js';
import { TvPopoutWindows } from '../tvPopoutWindows.js';
import { countryFlagEmoji, el } from '../tvUtils.js';
import { TileFrames } from '../tileFrames.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { classifyTilePlayback, bankRemainingSeconds } from '../player/pauseBuffer.js';
import { ChromecastManager, formatCastError } from '../cast/chromecastManager.js';
import { channelIndexForScope, bindScopeCacheKey, chanNumberAccentDigits, tvLabelAccentChars } from '../channelNav.js';
import { SLOT_IDS, SLOT_SCREEN_LABELS, slotIsOccupied } from './constants.js';
import { setMarqueeText } from '../ui/marquee.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { formatWatchDuration, getLiveWatchSeconds } from '../storage/watchStats.js';
import { shieldLabel } from '../webstream/webShield.js';
import { buildYouTubeQueueTrayHtml } from '../ui/tileHoverControls.js';

/** Shield popout actions → the exact level they pick (the glyph cycles instead). */
const SHIELD_ACTION_LEVELS = {
    'shield-off': 'off',
    'shield-basic': 'basic',
    'shield-strict': 'strict'
};

function pipSupported() {
    return typeof document !== 'undefined'
        && typeof document.pictureInPictureEnabled === 'boolean'
        && document.pictureInPictureEnabled
        && typeof HTMLVideoElement !== 'undefined'
        && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
}

export const tileChromeMethods = {
    /**
     * Coalesce mosaic chrome DOM sync to one walk per animation frame.
     */
    scheduleRefreshTiles() {
        if (this._refreshTilesRaf) return;
        const run = () => {
            this._refreshTilesRaf = 0;
            this.refreshTiles();
        };
        if (typeof requestAnimationFrame === 'function') {
            this._refreshTilesRaf = requestAnimationFrame(run);
        } else {
            this._refreshTilesRaf = setTimeout(run, 0);
        }
    },

    /**
     * Snap channel-grid tiles from any mosaic slot that is playing.
     * @param {object} player
     */
    noteSlotPlayingForTiles(player) {
        if (!player?.playing) return;
        const url = player.channel?.url_resolved || player.channel?.url || '';
        if (!url || !player.video) return;
        const key = channelKey(player.channel);
        TileFrames.notePlayingVideo(url, player.video, key);
    },

    async handleTileAction(slotId, action, { target = 'local', triggerEl = null } = {}) {
        if (action === 'reset') {
            this.resetToSelectedLayout();
            return;
        }

        if (action === 'mute-solo') {
            this.muteSolo(slotId);
            return;
        }

        if (action === 'mute-all') {
            if (this.isMuteAllActive()) this.unmuteAll();
            else this.muteAll();
            return;
        }

        if (action === 'play-all') {
            // Chrome popout only shows when something is paused — always playAll.
            // Remote morphs to pause-all via sync; still ok to toggle when all playing.
            if (this.isAllPlaying()) await this.pauseAll();
            else await this.playAll();
            return;
        }

        if (action === 'stop-all') {
            await this.stopAll();
            return;
        }

        if (action === 'stop-play') {
            const player = this.slots[slotId]?.player;
            if (this.isWebStreamSlot(slotId)) {
                if (this.webStreamMode(slotId) === 'embed') {
                    this.reloadWebStreamFrame(slotId);
                    return;
                }
                // Signed page URLs rotate: Stop & Play re-scans the page and
                // starts the fresh stream (direct-URL tiles fall through).
                if (this.webStreamState?.[slotId]?.pageUrl) {
                    await this.reResolveWebStreamSlot(slotId);
                    return;
                }
            }
            if (!player?.channel) return;
            if (player.kind === 'youtube') {
                await player.stop();
                player.resume();
                this.persistSlots();
                this.scheduleRefreshTiles();
                return;
            }
            const channel = player.channel;
            const key = channelKey(channel);
            const gen = (player._stopPlayGeneration = (player._stopPlayGeneration || 0) + 1);
            const shouldAnimate = player.playing || player.loading || player.pausePhase !== 'idle';
            if (shouldAnimate) {
                await this.withChannelSwitchTransition(slotId, () => player.stop());
            } else {
                await player.stop();
            }
            this.persistSlots();
            this.scheduleRefreshTiles();
            const { waitMs } = await import('./constants.js');
            await waitMs(1000);
            if (gen !== player._stopPlayGeneration) return;
            if (channelKey(player.channel) !== key) return;
            await player.playChannel(channel);
            this.persistSlots();
            this.scheduleRefreshTiles();
            return;
        }

        if (action === 'chan-prev' || action === 'chan-next') {
            const {
                stepSlotChannelBack,
                stepSlotChannelForward
            } = await import('./channelHistory.js');
            const player = this.slots[slotId]?.player;
            const currentKey = player?.channel ? channelKey(player.channel) : null;
            const targetKey = action === 'chan-prev'
                ? stepSlotChannelBack(slotId, currentKey)
                : stepSlotChannelForward(slotId, currentKey);
            if (!targetKey) {
                showAppToast(action === 'chan-prev' ? 'No previous channel' : 'No next channel');
                this.syncMosaicChrome();
                return;
            }
            const { parseChannelKey } = await import('../tvProviders/channelShape.js');
            const { TvProviderRegistry } = await import('../tvProviders/registry.js');
            const parsed = parseChannelKey(targetKey);
            const channel = await TvProviderRegistry.getChannel(parsed);
            if (!channel?.url_resolved) {
                showAppToast(action === 'chan-prev'
                    ? 'Previous channel unavailable'
                    : 'Next channel unavailable');
                this.syncMosaicChrome();
                return;
            }
            await this.playOnSlot(slotId, channel, { skipHistory: true });
            this.syncMosaicChrome();
            return;
        }

        if (slotId === 'center' && (action === 'dismiss' || action === 'swap' || action === 'swap-unmute')) return;

        if (action === 'dismiss') {
            if (this.statusSlotId === slotId) this.setStatusSlot('center');
            this.setSideEnabled(slotId, false);
            return;
        }

        if (SLOT_IDS.includes(slotId) && this.slots[slotId]?.enabled) {
            this.setStatusSlot(slotId);
        }

        if (action === 'browse') {
            const { RemoteModule } = await import('../ui/remoteModule.js');
            RemoteModule.openTvCatalog({ slotId, tab: 'browse' });
            return;
        }

        if (action === 'youtube') {
            if (this.isYouTubeSlot(slotId)) {
                await this.detachYouTubeMode(slotId);
                this.syncMosaicChrome();
                return;
            }
            const { YouTubePicker } = await import('../ui/youtubePicker.js');
            YouTubePicker.open({
                slotId,
                start: (videoId, meta) => this.enterYouTubeMode(slotId, videoId, {
                    title: meta?.title || '',
                    autoplay: true
                })
            });
            return;
        }

        // YouTube queue controls — handled before the "player exists" gate
        // because a stale click after leaving YouTube mode must not throw.
        if (action === 'yt-prev' || action === 'yt-next') {
            await this.stepYouTubeQueue?.(slotId, action === 'yt-next' ? 1 : -1);
            return;
        }

        if (action === 'yt-queue') {
            this.toggleYouTubeQueueTray?.(slotId);
            return;
        }

        if (action === 'yt-play') {
            const index = Number(triggerEl?.getAttribute?.('data-yt-index'));
            if (Number.isFinite(index)) this.playYouTubeQueueIndex?.(slotId, index);
            return;
        }

        if (action === 'web-video') {
            if (this.isWebStreamSlot(slotId)) {
                await this.detachWebStreamMode(slotId);
                this.syncMosaicChrome();
                return;
            }
            const { WebStreamPicker } = await import('../ui/webStreamPicker.js');
            WebStreamPicker.open({
                slotId,
                play: (spec) => (spec?.mode === 'embed'
                    ? this.playEmbeddedWebPage(slotId, spec)
                    : this.playWebStream(slotId, spec))
            });
            return;
        }

        if (action === 'shield' || SHIELD_ACTION_LEVELS[action]) {
            if (this.webStreamMode(slotId) !== 'embed') {
                showAppToast('Page shield applies to embedded pages only');
                return;
            }
            // The glyph cycles; a popout option names its level outright.
            const next = this.setWebStreamShield(slotId, SHIELD_ACTION_LEVELS[action] || '');
            if (next) showAppToast(`Page shield: ${shieldLabel(next)}`);
            return;
        }

        if (action === 'cast') {
            const player = this.slots[slotId]?.player;
            if (player?.kind === 'youtube') {
                showAppToast('YouTube tiles can’t be cast');
                return;
            }
            if (this.webStreamMode(slotId) === 'embed') {
                showAppToast('Embedded pages can’t be cast');
                return;
            }
            if (player?.channel?.providerId === 'webstream' && player.channel.proxyTemplate) {
                showAppToast('Proxied Web Video can’t be cast');
                return;
            }
            const channel = player?.channel;
            const url = channel?.url_resolved || channel?.url || '';
            if (!url) {
                showAppToast('Pick a channel before casting');
                return;
            }
            try {
                await ChromecastManager.startCast(slotId, channel);
            } catch (err) {
                const msg = String(err?.message || err || '');
                if (!msg.toLowerCase().includes('cancel')) {
                    showAppToast(formatCastError(err));
                }
            }
            this.scheduleRefreshTiles();
            return;
        }

        const player = this.slots[slotId]?.player;
        if (!player) return;

        const castActive = ChromecastManager.getActiveSlot() === slotId;
        const useCast = castActive && ChromecastManager.isCasting() && target === 'cast';

        switch (action) {
            case 'play':
                if (useCast) ChromecastManager.togglePlayPause();
                else if (this.webStreamMode(slotId) === 'embed') this.resumeEmbeddedWebPage(slotId);
                else player.toggle();
                break;
            case 'bank':
                if (!useCast) player.toggleBankBuffer?.();
                break;
            case 'stop':
                if (useCast) {
                    await ChromecastManager.stopMedia();
                } else if (this.webStreamMode(slotId) === 'embed') {
                    this.stopEmbeddedWebPage(slotId);
                    this.persistSlots();
                } else {
                    player._stopPlayGeneration = (player._stopPlayGeneration || 0) + 1;
                    const shouldAnimate = player.playing || player.loading || player.pausePhase !== 'idle';
                    if (shouldAnimate) {
                        await this.withChannelSwitchTransition(slotId, () => player.stop());
                    } else {
                        await player.stop();
                    }
                    this.persistSlots();
                }
                break;
            case 'mute':
                if (useCast) {
                    ChromecastManager.toggleCastMute();
                } else if (player.channel) {
                    player.toggleMute();
                    this.persistSlots();
                    // Same tray on a page tile: the flag always flips, but the
                    // page's own audio is only reachable when it is same-origin.
                    if (this.webStreamMode(slotId) === 'embed'
                        && !this.syncEmbeddedPageMute(slotId)) {
                        showAppToast('Embedded pages keep their own sound');
                    }
                }
                break;
            case 'vol-up':
                if (useCast) {
                    ChromecastManager.adjustVolume(0.1);
                } else if (player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) + 0.05);
                }
                break;
            case 'vol-down':
                if (useCast) {
                    ChromecastManager.adjustVolume(-0.1);
                } else if (player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) - 0.05);
                }
                break;
            case 'chan-up':
            case 'chan-down': {
                const { navigateChannel } = await import('../channelNav.js');
                await navigateChannel(slotId, action === 'chan-up' ? 'up' : 'down');
                break;
            }
            case 'swap':
            case 'swap-unmute': {
                // swap-unmute: commitSwap → muteSolo('center') (unmute main, mute others + radio)
                await this.swapWithCenter(slotId, {
                    unmuteCenter: action === 'swap-unmute'
                });
                if (ChromecastManager.isCasting()) {
                    const activeSlot = ChromecastManager.getActiveSlot();
                    const activePlayer = activeSlot ? this.slots[activeSlot]?.player : null;
                    if (activePlayer?.channel) {
                        ChromecastManager.loadMedia(activePlayer.channel).catch(() => {});
                    }
                }
                break;
            }
            case 'fav':
                if (player.channel && player.kind !== 'youtube') {
                    FavoritesRecents.toggleFavorite(player.channel);
                    this.getPrimary()?.emitState();
                }
                break;
            case 'fullscreen': {
                if (this.webStreamMode(slotId) === 'embed') {
                    const { fullscreenWebPageFrame } = await import('../webstream/webPagePlayer.js');
                    const ok = await fullscreenWebPageFrame(el(`tv-playback-surface-${slotId}`));
                    if (!ok) showAppToast('Fullscreen blocked');
                    break;
                }
                if (player.kind === 'youtube') {
                    const frameWrap = player.videoHolder;
                    if (!frameWrap?.requestFullscreen) {
                        showAppToast('Fullscreen isn’t supported here');
                        break;
                    }
                    try {
                        await frameWrap.requestFullscreen();
                    } catch {
                        showAppToast('Fullscreen blocked');
                    }
                    break;
                }
                const video = player.video;
                if (!video?.requestFullscreen) {
                    showAppToast('Fullscreen isn’t supported here');
                    break;
                }
                try {
                    await video.requestFullscreen();
                } catch {
                    showAppToast('Fullscreen blocked');
                }
                break;
            }
            case 'pip': {
                if (this.webStreamMode(slotId) === 'embed') {
                    showAppToast('Pop out isn’t available for embedded pages');
                    break;
                }
                if (player.kind === 'youtube') {
                    showAppToast('Pop out isn’t available in YouTube mode');
                    break;
                }
                if (slotId === 'center') {
                    const { TvPip } = await import('../tvPip.js');
                    await TvPip.toggle();
                    break;
                }
                const video = player.video;
                const url = player.channel?.url_resolved || player.channel?.url || '';
                await TvPopoutWindows.detach({
                    slotId,
                    video,
                    url,
                    name: player.channel?.name || 'magicTV',
                    muted: player.muted !== false,
                    pipSupported: pipSupported()
                });
                break;
            }
            default:
                break;
        }
        this.scheduleRefreshTiles();
    },

    refreshTiles() {
        if (typeof document === 'undefined') return;
        /** @type {Map<string, Map<string, number>>} */
        const numberMaps = new Map();
        const numbersForSlot = (slotId) => {
            const scope = FavoritesRecents.getChanBindScope(slotId);
            const cacheKey = bindScopeCacheKey(scope);
            let map = numberMaps.get(cacheKey);
            if (!map) {
                map = channelIndexForScope(scope).numberByKey;
                numberMaps.set(cacheKey, map);
            }
            return map;
        };
        const multiTv = SLOT_IDS.filter((sid) => sid === 'center' || this.slots[sid]?.enabled).length >= 2;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            const slot = this.slots[id];
            if (!tile || !slot) return;

            const player = slot.player;
            const rememberedKey = this.rememberedSlotKeys[id] || '';
            const hasChannel = slotIsOccupied(player?.channel, rememberedKey);
            const empty = tile.querySelector('.tv-player-tile__empty');
            const mediaPlaying = player?.playing === true;
            const tuningLive = player?.preparing === true && mediaPlaying;
            const isBanking = player?.banking === true;
            const {
                uiPlaying,
                uiLoading,
                uiPaused,
                uiStopped,
                uiDisconnected,
                uiBanking
            } = classifyTilePlayback({
                hasChannel,
                playing: mediaPlaying,
                posterDataUrl: player?.posterDataUrl,
                pausePhase: player?.pausePhase,
                stopped: player?.stopped === true,
                loading: player?.loading === true,
                loadPhase: player?.loadPhase || 'idle',
                wantPlaying: player?.wantPlaying === true,
                preparing: player?.preparing === true,
                error: player?.error || null,
                banking: isBanking
            });

            const enabled = id === 'center' || slot.enabled === true;
            const tvIdEl = tile.querySelector('.tv-player-tile__tv-id');
            if (tvIdEl) {
                if (multiTv && enabled) {
                    const label = SLOT_SCREEN_LABELS[id] || '1';
                    const parts = tvLabelAccentChars(label);
                    const fingerprint = parts.map((p) => `${p.char}:${p.accent}`).join('');
                    if (tvIdEl.dataset.tvFingerprint !== fingerprint) {
                        tvIdEl.dataset.tvFingerprint = fingerprint;
                        tvIdEl.replaceChildren(
                            ...parts.map(({ char, accent }) => {
                                const span = document.createElement('span');
                                span.dataset.accent = String(accent);
                                span.textContent = char;
                                return span;
                            })
                        );
                    }
                    tvIdEl.setAttribute('aria-label', `TV ${label}`);
                    tvIdEl.classList.remove('is-hidden');
                } else {
                    tvIdEl.replaceChildren();
                    delete tvIdEl.dataset.tvFingerprint;
                    tvIdEl.classList.add('is-hidden');
                }
            }
            tile.classList.toggle('is-empty', !hasChannel);
            tile.classList.toggle('is-playing', uiPlaying);
            tile.classList.toggle('is-loading', uiLoading);
            tile.classList.toggle('is-preparing', tuningLive);
            tile.classList.toggle('is-paused', uiPaused);
            tile.classList.toggle('is-stopped', uiStopped);
            tile.classList.toggle('is-disconnected', uiDisconnected);
            tile.classList.toggle('is-banking', uiBanking);
            tile.classList.toggle('is-youtube', player?.kind === 'youtube');
            const wsMode = this.webStreamMode?.(id) || '';
            const isWebStream = Boolean(wsMode) || player?.channel?.providerId === 'webstream';
            tile.classList.toggle('is-webstream', isWebStream);
            tile.classList.toggle('is-webpage', wsMode === 'embed');
            if (isWebStream) {
                const castable = wsMode !== 'embed'
                    && !player?.channel?.proxyTemplate
                    && Boolean(player?.channel?.url_resolved);
                tile.classList.toggle('is-webstream-castable', castable);
                // A re-mount can strip the surface; put the page frame back.
                if (wsMode === 'embed' && !tile.querySelector('.webstream-frame-wrap')) {
                    this.mountWebStreamFrame?.(id);
                }
            }
            const stateEl = tile.querySelector('.tv-player-tile__playback-state');
            const countdownEl = tile.querySelector('.tv-player-tile__retry-countdown');
            if (stateEl) {
                if (uiDisconnected) {
                    stateEl.setAttribute('aria-hidden', 'false');
                    stateEl.setAttribute('role', 'img');
                    const deadlineAt = Number(player?._autoRetryDeadlineAt) || 0;
                    const remainingSec = deadlineAt > 0
                        ? Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000))
                        : 0;
                    if (countdownEl) {
                        if (deadlineAt > 0) {
                            countdownEl.hidden = false;
                            countdownEl.textContent = String(remainingSec);
                        } else {
                            countdownEl.hidden = true;
                            countdownEl.textContent = '';
                        }
                    }
                    stateEl.setAttribute(
                        'aria-label',
                        deadlineAt > 0
                            ? `Unable to connect. Reconnecting in ${remainingSec}s`
                            : 'Unable to connect'
                    );
                } else if (uiBanking) {
                    stateEl.setAttribute('aria-hidden', 'false');
                    stateEl.setAttribute('role', 'status');
                    const ahead = Number(player?.getBufferInfo?.()?.buffered) || 0;
                    const target = Number(player?.getBufferSize?.() ?? player?.bufferSize) || 0;
                    const remainingSec = bankRemainingSeconds(ahead, target);
                    const held = Math.max(0, Math.floor(ahead));
                    if (countdownEl) {
                        countdownEl.hidden = false;
                        countdownEl.textContent = remainingSec > 0
                            ? String(remainingSec)
                            : String(held || target || 0);
                    }
                    stateEl.setAttribute(
                        'aria-label',
                        remainingSec > 0
                            ? `Banking buffer — ${remainingSec}s remaining`
                            : `Banking buffer — ready`
                    );
                } else {
                    stateEl.setAttribute('aria-hidden', 'true');
                    stateEl.removeAttribute('role');
                    stateEl.removeAttribute('aria-label');
                    if (countdownEl) {
                        countdownEl.hidden = true;
                        countdownEl.textContent = '';
                    }
                }
            }
            // Never show “Pick a channel” for a remembered/saved assignment.
            if (empty) empty.classList.toggle('is-hidden', hasChannel);

            const nameEl = tile.querySelector('.tv-player-tile__name');
            if (nameEl) {
                const name = (player?.channel?.name || '').trim();
                const nameTextEl = nameEl.querySelector('.tv-player-tile__name-text');
                const flagEl = nameEl.querySelector('.tv-player-tile__flag');
                const chanNumEl = nameEl.querySelector('.tv-player-tile__chan-num');
                if (hasChannel && name) {
                    if (nameTextEl) setMarqueeText(nameTextEl, name);
                    else nameEl.textContent = name;
                    if (flagEl) {
                        const code = player?.channel?.countrycode || '';
                        flagEl.textContent = code ? countryFlagEmoji(code) : '';
                    }
                    if (chanNumEl) {
                        const num = numbersForSlot(id).get(channelKey(player.channel));
                        if (Number.isFinite(num)) {
                            const parts = chanNumberAccentDigits(num);
                            chanNumEl.replaceChildren(
                                ...parts.map(({ digit, accent }) => {
                                    const span = document.createElement('span');
                                    span.dataset.accent = String(accent);
                                    span.textContent = digit;
                                    return span;
                                })
                            );
                            chanNumEl.classList.remove('is-hidden');
                        } else {
                            chanNumEl.replaceChildren();
                            chanNumEl.classList.add('is-hidden');
                        }
                    }
                    nameEl.classList.remove('is-hidden');
                } else {
                    if (nameTextEl) setMarqueeText(nameTextEl, '');
                    else nameEl.textContent = '';
                    if (flagEl) flagEl.textContent = '';
                    if (chanNumEl) {
                        chanNumEl.replaceChildren();
                        chanNumEl.classList.add('is-hidden');
                    }
                    nameEl.classList.add('is-hidden');
                }
            }

            const posterEl = tile.querySelector('.tv-player-tile__poster');
            // Cover black gaps: keep poster while loading/awaiting first paint, or when
            // the <video> has no decoded frame yet.
            const videoHasFrame = Boolean(player?.video?.videoWidth > 0);
            const showPoster = Boolean(
                hasChannel
                && player
                && player.posterDataUrl
                && !uiPlaying
                && !tuningLive
                && (uiLoading || uiBanking || !videoHasFrame)
            );
            tile.classList.toggle('has-poster', showPoster);
            if (posterEl) {
                if (showPoster) {
                    if (posterEl.getAttribute('src') !== player.posterDataUrl) {
                        posterEl.src = player.posterDataUrl;
                    }
                    posterEl.classList.remove('is-hidden');
                } else {
                    posterEl.classList.add('is-hidden');
                }
            }

            this.syncTileCastUi(tile, id, player);
            this.syncYouTubeQueueChrome(tile, id, player);
            this.syncTileWatchEcho(tile, player);
        });
        this.syncMosaicChrome();
        if (this.screensStripExpanded) this.syncScreenControls();
        this.ensureWatchChromeTick();
    },

    /**
     * Update session / total play-time chrome on one mosaic tile.
     * @param {HTMLElement} tile
     * @param {object|null|undefined} player
     */
    syncTileWatchEcho(tile, player) {
        const watchEl = tile?.querySelector('.tv-player-tile__watch-echo');
        if (!watchEl) return;
        const showSession = SettingsStore.getShowMosaicWatchSession();
        const showTotal = SettingsStore.getShowMosaicWatchTotal();
        const hasChannel = Boolean(player?.channel);
        if (!hasChannel || (!showSession && !showTotal)) {
            watchEl.classList.add('is-hidden');
            watchEl.setAttribute('aria-hidden', 'true');
            return;
        }
        const { session, total } = getLiveWatchSeconds(player);
        const sessionEl = watchEl.querySelector('.tv-player-tile__watch-session');
        const totalEl = watchEl.querySelector('.tv-player-tile__watch-total');
        const sepEl = watchEl.querySelector('.tv-player-tile__watch-sep');
        if (sessionEl) {
            sessionEl.textContent = showSession ? formatWatchDuration(session) : '';
            sessionEl.classList.toggle('is-hidden', !showSession);
        }
        if (totalEl) {
            totalEl.textContent = showTotal ? formatWatchDuration(total) : '';
            totalEl.classList.toggle('is-hidden', !showTotal);
        }
        if (sepEl) sepEl.classList.toggle('is-hidden', !(showSession && showTotal));
        watchEl.classList.remove('is-hidden');
        watchEl.setAttribute('aria-hidden', 'false');
    },

    /** Lightweight 1s tick for watch-echo text (and cast accrual sync). */
    ensureWatchChromeTick() {
        const need = SettingsStore.getShowMosaicWatchSession()
            || SettingsStore.getShowMosaicWatchTotal()
            || ChromecastManager.isCasting();
        if (!need) {
            this.stopWatchChromeTick();
            return;
        }
        if (this._watchChromeTick) return;
        this._watchChromeTick = setInterval(() => {
            this.updateWatchChromeOnly();
        }, 1000);
        if (typeof this._watchChromeTick?.unref === 'function') this._watchChromeTick.unref();
    },

    stopWatchChromeTick() {
        if (!this._watchChromeTick) return;
        clearInterval(this._watchChromeTick);
        this._watchChromeTick = 0;
    },

    updateWatchChromeOnly() {
        const showSession = SettingsStore.getShowMosaicWatchSession();
        const showTotal = SettingsStore.getShowMosaicWatchTotal();
        const casting = ChromecastManager.isCasting();
        if (!showSession && !showTotal && !casting) {
            this.stopWatchChromeTick();
            return;
        }
        for (const id of SLOT_IDS) {
            const slot = this.slots?.[id];
            const player = slot?.player;
            if (player?.syncWatchAccrual) {
                try { player.syncWatchAccrual(); } catch { /* ignore */ }
            }
            if (!showSession && !showTotal) continue;
            const tile = el(`player-tile-${id}`);
            if (tile) this.syncTileWatchEcho(tile, player);
        }
    },

    /**
     * Keep the YouTube prev / next buttons and thumbnail tray in sync. The tray
     * is only re-rendered when its structural key changes, because this runs on
     * every playback-state tick.
     * @param {HTMLElement} tile
     * @param {string} slotId
     * @param {object|null|undefined} player
     */
    syncYouTubeQueueChrome(tile, slotId, player) {
        const wrap = tile?.querySelector?.('.tv-controls__ytqueue-wrap');
        if (!wrap) return;
        const active = player?.kind === 'youtube';
        const state = active && typeof this.youtubeQueueState === 'function'
            ? this.youtubeQueueState(slotId)
            : null;

        const prev = wrap.querySelector('[data-tile-action="yt-prev"]');
        if (prev) {
            const hasPrev = Boolean(state?.hasPrev);
            prev.disabled = !hasPrev;
            prev.setAttribute('aria-disabled', String(!hasPrev));
            prev.title = hasPrev ? 'Previous video' : 'No previous video';
            prev.setAttribute('aria-label', prev.title);
        }

        const next = wrap.querySelector('[data-tile-action="yt-next"]');
        if (next) {
            const hasNext = Boolean(state?.hasNext);
            next.disabled = !hasNext;
            next.setAttribute('aria-disabled', String(!hasNext));
            const label = !hasNext && state?.relatedLoading
                ? 'Finding more videos…'
                : (hasNext ? 'Next video' : 'No next video');
            next.title = label;
            next.setAttribute('aria-label', label);
        }

        const open = Boolean(state?.open);
        const toggle = wrap.querySelector('[data-tile-action="yt-queue"]');
        if (toggle) {
            toggle.classList.toggle('is-active', open);
            toggle.setAttribute('aria-expanded', String(open));
        }
        wrap.classList.toggle('is-open', open);

        const items = state?.items || [];
        const tray = wrap.querySelector('[data-yt-queue-tray]');
        if (tray) tray.setAttribute('aria-hidden', String(items.length === 0));

        const strip = wrap.querySelector('[data-yt-queue-strip]');
        if (!strip) return;
        const index = state?.index ?? -1;
        const loading = Boolean(state?.relatedLoading);
        const key = `${index}|${loading ? 1 : 0}|${items.map((item) => item.videoId).join(',')}`;
        if (strip.dataset.ytQueueKey === key) return;
        strip.dataset.ytQueueKey = key;
        strip.innerHTML = buildYouTubeQueueTrayHtml({ items, index, relatedLoading: loading });
    },

    syncTileCastUi(tile, slotId, player) {
        const isCasting = ChromecastManager.isCasting();
        const isActiveCastSlot = ChromecastManager.getActiveSlot() === slotId;
        const hostVideo = ChromecastManager.getHostVideo();

        const castRow = tile.querySelector('[data-controls-row="cast"]');
        const localRow = tile.querySelector('[data-controls-row="local"]');
        const hover = tile.querySelector('.tv-player-tile__hover');
        const localLabel = tile.querySelector('.tv-controls__row-label--local');

        const dual = isCasting && isActiveCastSlot;

        tile.classList.toggle('is-casting-slot', dual);

        if (hover) {
            hover.classList.toggle('is-casting', dual);
            hover.classList.toggle('has-dual-rows', dual);
        }

        if (castRow) {
            castRow.hidden = !dual;
        }
        if (localRow) {
            localRow.hidden = false;
        }
        if (localLabel) {
            localLabel.classList.toggle('is-hidden', !dual);
        }

        const castVolRocker = tile.querySelector('[data-tile-cast-vol-rocker]');
        if (castVolRocker) {
            castVolRocker.hidden = !dual;
        }

        tile.querySelectorAll('[data-tile-action="cast"]').forEach((castBtn) => {
            const active = isCasting && isActiveCastSlot;
            castBtn.dataset.castActive = String(active);
            castBtn.classList.toggle('is-casting', active);
            castBtn.setAttribute('aria-pressed', String(active));
            castBtn.title = active ? 'Stop casting' : 'Cast';
            castBtn.setAttribute('aria-label', active ? 'Stop casting' : 'Cast');
        });

        tile.querySelectorAll('[data-cast-toggle="host-video"]').forEach((btn) => {
            btn.classList.toggle('is-active', hostVideo);
            btn.setAttribute('aria-pressed', String(hostVideo));
        });

        const intentPlaying = player?.wantPlaying === true || player?.playing === true;
        const isBanking = player?.banking === true;
        const showAudio = this.isSlotAudible(player);

        tile.querySelectorAll('[data-controls-row="local"] [data-tile-action]').forEach((btn) => {
            this.syncTileControlButton(btn, player, slotId, {
                intentPlaying,
                isBanking,
                isMuted: !showAudio,
                target: 'local'
            });
        });

        const volPct = tile.querySelector('[data-tile-vol-pct]');
        if (volPct) {
            const slotVol = Math.min(1, Math.max(0, Number.isFinite(player?.volume) ? player.volume : 1));
            volPct.textContent = String(Math.round(slotVol * 100));
        }

        const castVolPct = tile.querySelector('[data-tile-cast-vol-pct]');
        if (castVolPct) {
            const castVol = Math.min(1, Math.max(0, Number(ChromecastManager.getCastVolume()) || 0));
            castVolPct.textContent = String(Math.round(castVol * 100));
        }

        if (isCasting && isActiveCastSlot) {
            const castPlaying = ChromecastManager.isCastPlaying();
            const castMuted = ChromecastManager.isCastMuted();
            tile.querySelectorAll('[data-controls-row="cast"] [data-tile-action]').forEach((btn) => {
                this.syncTileControlButton(btn, player, slotId, {
                    intentPlaying: castPlaying,
                    isMuted: castMuted,
                    target: 'cast'
                });
            });
        }
    },

    syncTileControlButton(btn, player, slotId, { intentPlaying, isMuted, target, isBanking = false }) {
        const action = btn.getAttribute('data-tile-action');
        if (action === 'yt-prev' || action === 'yt-next' || action === 'yt-queue' || action === 'yt-play') {
            // Queue button states live in syncYouTubeQueueChrome().
            return;
        }
        if (action === 'play') {
            btn.classList.remove('is-hidden');
            // While banking, Pause demotes to stay-paused; label stays Pause.
            btn.textContent = intentPlaying || isBanking ? '⏸' : '▶';
            btn.title = isBanking
                ? 'Pause (stop banking)'
                : (intentPlaying ? 'Pause' : 'Play');
            btn.setAttribute('aria-label', btn.title);
            return;
        }
        if (action === 'bank') {
            btn.classList.toggle('is-active', isBanking === true);
            btn.setAttribute('aria-pressed', String(isBanking === true));
            btn.title = isBanking ? 'Cancel bank — resume' : 'Bank buffer';
            btn.setAttribute('aria-label', btn.title);
            return;
        }
        if (action === 'mute') {
            btn.classList.toggle('is-muted', isMuted);
            btn.setAttribute('aria-pressed', String(isMuted));
            btn.title = isMuted ? 'Unmute' : 'Mute';
            const wave = btn.querySelector('.tile-mute-wave');
            const slash = btn.querySelector('.tile-mute-slash');
            if (wave) wave.style.opacity = isMuted ? '0' : '1';
            if (slash) slash.style.opacity = isMuted ? '1' : '0';
            return;
        }
        if (action === 'youtube') {
            const active = player?.kind === 'youtube';
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
            btn.title = active ? 'Exit YouTube mode' : 'YouTube mode';
            btn.setAttribute('aria-label', btn.title);
            return;
        }
        if (action === 'web-video') {
            const active = this.isWebStreamSlot(slotId);
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
            btn.title = active ? 'Exit Web Video' : 'Web video (any URL)';
            btn.setAttribute('aria-label', btn.title);
            return;
        }
        if (action === 'shield') {
            const embedding = this.webStreamMode(slotId) === 'embed';
            const level = embedding ? (this.webStreamShieldFor(slotId) || '') : '';
            const off = level === 'off';
            btn.classList.toggle('is-active', embedding && !off);
            btn.classList.toggle('is-off', embedding && off);
            btn.setAttribute('aria-pressed', String(embedding && !off));
            btn.title = embedding
                ? `Page shield: ${shieldLabel(level) || 'Basic'} — click to cycle`
                : 'Page shield (embed mode only)';
            btn.setAttribute('aria-label', btn.title);
            const check = btn.querySelector('.tile-shield-check');
            const slash = btn.querySelector('.tile-shield-slash');
            if (check) check.style.opacity = off ? '0' : '1';
            if (slash) slash.style.opacity = off ? '1' : '0';
            return;
        }
        if (SHIELD_ACTION_LEVELS[action]) {
            // Popout options mirror the live level as a radio group.
            const embedding = this.webStreamMode(slotId) === 'embed';
            const level = embedding ? (this.webStreamShieldFor(slotId) || '') : '';
            const active = embedding && level === SHIELD_ACTION_LEVELS[action];
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
            return;
        }
        if (action === 'fav') {
            if (player?.channel) {
                const isFav = FavoritesRecents.isFavorite(player.channel);
                btn.classList.toggle('is-active', isFav);
                btn.innerHTML = isFav ? CARD_ICONS.starFilled : '☆';
                btn.setAttribute('aria-pressed', String(isFav));
            } else {
                btn.classList.remove('is-active');
                btn.textContent = '☆';
            }
            return;
        }
        if (action === 'pip') {
            const nativeSupported = pipSupported();
            const windowOpen = TvPopoutWindows.isOpen(slotId);
            const nativeActive = nativeSupported && document.pictureInPictureElement === player?.video;
            const active = nativeActive || windowOpen;
            btn.classList.remove('is-hidden');
            btn.classList.toggle('is-active', active);
            btn.innerHTML = active
                ? ACTION_ICONS.pictureInPictureExit
                : ACTION_ICONS.pictureInPicture;
            btn.title = active ? 'Pop in' : 'Pop out';
            btn.setAttribute('aria-label', active ? 'Pop in' : 'Pop out');
        }
    }
};
