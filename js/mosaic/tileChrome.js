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
import { classifyTilePlayback } from '../player/pauseBuffer.js';
import { ChromecastManager } from '../cast/chromecastManager.js';
import { buildChannelIndex, chanNumberAccentDigits, tvLabelAccentChars } from '../channelNav.js';
import { SLOT_IDS, SLOT_SCREEN_LABELS, slotIsOccupied } from './constants.js';

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

    async handleTileAction(slotId, action, { target = 'local' } = {}) {
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
            if (this.isAllPlaying()) await this.pauseAll();
            else await this.playAll();
            return;
        }

        if (action === 'stop-all') {
            await this.stopAll();
            return;
        }

        if (slotId === 'center' && (action === 'dismiss' || action === 'swap')) return;

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
            RemoteModule.toggle(slotId, { tab: 'browse' });
            return;
        }

        if (action === 'cast') {
            const player = this.slots[slotId]?.player;
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
                    showAppToast('Cast failed');
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
                else player.toggle();
                break;
            case 'stop':
                if (useCast) {
                    await ChromecastManager.stopMedia();
                } else {
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
                }
                break;
            case 'vol-up':
                if (!useCast && player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) + 0.05);
                }
                break;
            case 'vol-down':
                if (!useCast && player.channel) {
                    this.setSlotVolume(slotId, (player.volume ?? 1) - 0.05);
                }
                break;
            case 'chan-up':
            case 'chan-down': {
                const { navigateChannel } = await import('../channelNav.js');
                await navigateChannel(slotId, action === 'chan-up' ? 'up' : 'down');
                break;
            }
            case 'cast-vol-down':
                if (castActive && ChromecastManager.isCasting()) {
                    ChromecastManager.adjustVolume(-0.1);
                }
                break;
            case 'cast-vol-up':
                if (castActive && ChromecastManager.isCasting()) {
                    ChromecastManager.adjustVolume(0.1);
                }
                break;
            case 'swap':
                this.swapWithCenter(slotId);
                if (ChromecastManager.isCasting()) {
                    const activeSlot = ChromecastManager.getActiveSlot();
                    const activePlayer = activeSlot ? this.slots[activeSlot]?.player : null;
                    if (activePlayer?.channel) {
                        ChromecastManager.loadMedia(activePlayer.channel).catch(() => {});
                    }
                }
                break;
            case 'fav':
                if (player.channel) {
                    FavoritesRecents.toggleFavorite(player.channel);
                    this.getPrimary()?.emitState();
                }
                break;
            case 'fullscreen': {
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
            const cacheKey = scope?.mode === 'folder'
                ? `folder:${scope.folderId || ''}`
                : 'favorites';
            let map = numberMaps.get(cacheKey);
            if (!map) {
                map = buildChannelIndex(scope).numberByKey;
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
            const { uiPlaying, uiLoading, uiPaused, uiStopped, uiDisconnected } = classifyTilePlayback({
                hasChannel,
                playing: mediaPlaying,
                posterDataUrl: player?.posterDataUrl,
                pausePhase: player?.pausePhase,
                stopped: player?.stopped === true,
                loading: player?.loading === true,
                loadPhase: player?.loadPhase || 'idle',
                wantPlaying: player?.wantPlaying === true,
                preparing: player?.preparing === true,
                error: player?.error || null
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
            const stateEl = tile.querySelector('.tv-player-tile__playback-state');
            if (stateEl) {
                if (uiDisconnected) {
                    stateEl.setAttribute('aria-hidden', 'false');
                    stateEl.setAttribute('role', 'img');
                    stateEl.setAttribute('aria-label', 'Unable to connect');
                } else {
                    stateEl.setAttribute('aria-hidden', 'true');
                    stateEl.removeAttribute('role');
                    stateEl.removeAttribute('aria-label');
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
                    if (nameTextEl) nameTextEl.textContent = name;
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
                    if (nameTextEl) nameTextEl.textContent = '';
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
                && (uiLoading || !videoHasFrame)
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
        });
        this.syncMosaicChrome();
        if (this.screensStripExpanded) this.syncScreenControls();
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
        const showAudio = this.isSlotAudible(player);

        tile.querySelectorAll('[data-controls-row="local"] [data-tile-action]').forEach((btn) => {
            this.syncTileControlButton(btn, player, slotId, {
                intentPlaying,
                isMuted: !showAudio,
                target: 'local'
            });
        });

        const volPct = tile.querySelector('[data-tile-vol-pct]');
        if (volPct) {
            const slotVol = Math.min(1, Math.max(0, Number.isFinite(player?.volume) ? player.volume : 1));
            volPct.textContent = String(Math.round(slotVol * 100));
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

    syncTileControlButton(btn, player, slotId, { intentPlaying, isMuted, target }) {
        const action = btn.getAttribute('data-tile-action');
        if (action === 'play') {
            btn.classList.remove('is-hidden');
            btn.textContent = intentPlaying ? '⏸' : '▶';
            btn.title = intentPlaying ? 'Pause' : 'Play';
            btn.setAttribute('aria-label', intentPlaying ? 'Pause' : 'Play');
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
