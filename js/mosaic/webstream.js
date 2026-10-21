/**
 * Web Video mode for one mosaic tile.
 *
 * Methods mix into MultiView (this === MultiView). Media mode plays a synthetic
 * `webstream:` channel through the normal player (so play/stop/mute/volume/
 * fullscreen/PiP/persist all keep working). Embed mode shows the page's own
 * player in an iframe over the tile surface and is explicitly best-effort.
 *
 * Rules:
 *  - Any TV tune on that slot detaches Web Video via `prepareSlotForPlay`.
 *  - Turning Web Video off restores the channel the tile had before.
 *  - `webstream:` keys never enter channel history / recents / lastChannelKey.
 */
import { showAppToast } from '../ui/toast.js';
import { el } from '../tvUtils.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { resolveWebStream, buildPlaybackSpec } from '../webstream/webStreamResolver.js';
import {
    WEBSTREAM_LABEL,
    WEBSTREAM_PROVIDER_ID,
    hostLabel,
    isWebStreamEntry,
    webStreamEntryConfig,
    webstreamChannel,
    webstreamChannelId,
    webstreamKey
} from '../webstream/webStreamLinks.js';
import {
    mountWebPageFrame,
    reloadWebPageFrame,
    unmountWebPageFrame,
    hasWebPageFrame,
    syncPageFrameMuted
} from '../webstream/webPagePlayer.js';
import {
    DEFAULT_SHIELD_LEVEL,
    isShieldLevel,
    nextShieldLevel,
    normalizeShieldLevel
} from '../webstream/webShield.js';
import { setWebStreamItemShield } from '../webstream/webStreamLibrary.js';

function surfaceFor(slotId) {
    // Concatenated on purpose: `el('literal')` ids are validated against
    // index.html by appBoot.test.mjs, and this one is per-slot.
    return el('tv-playback-surface-' + slotId);
}

function isWebStreamChannel(channel) {
    return channel?.providerId === WEBSTREAM_PROVIDER_ID;
}

export const webStreamMethods = {
    /** @param {string} slotId */
    isWebStreamSlot(slotId) {
        if (this.webStreamState?.[slotId]) return true;
        return isWebStreamChannel(this.slots?.[slotId]?.player?.channel);
    },

    /** True when any tile currently runs Web Video. */
    hasWebStreamSlot() {
        if (Object.keys(this.webStreamState || {}).length) return true;
        return Object.values(this.slots || {}).some((slot) => isWebStreamChannel(slot?.player?.channel));
    },

    /** 'media' | 'embed' | '' for one tile. */
    webStreamMode(slotId) {
        return this.webStreamState?.[slotId]?.mode || '';
    },

    /** Page shield level for an embedded tile ('' when not embedding). */
    webStreamShieldFor(slotId) {
        const state = this.webStreamState?.[slotId];
        if (!state || state.mode !== 'embed') return '';
        return isShieldLevel(state.shield) ? state.shield : DEFAULT_SHIELD_LEVEL;
    },

    /**
     * Change the page shield on an embedded tile. Sandbox flags only apply at
     * navigation, so the frame is re-pointed (the page restarts). The level is
     * also remembered on the saved page, so replaying it later keeps the fix.
     * @param {string} slotId
     * @param {string} [level] omit to cycle basic → strict → off → basic
     * @returns {string} the new level ('' when the tile is not embedding)
     */
    setWebStreamShield(slotId, level = '') {
        const state = this.webStreamState?.[slotId];
        if (!state || state.mode !== 'embed') return '';
        const next = normalizeShieldLevel(level || nextShieldLevel(state.shield));
        if (next === state.shield) return next;
        state.shield = next;
        // Only re-navigate when a frame is actually on screen; a stopped tile
        // just remembers the level and applies it on the next ▶.
        const surface = surfaceFor(slotId);
        if (hasWebPageFrame(surface)) this.mountWebStreamFrame(slotId);
        if (state.pageUrl) setWebStreamItemShield({ pageUrl: state.pageUrl }, next);
        this.persistSlots?.();
        this.scheduleRefreshTiles?.();
        this.syncMosaicChrome?.();
        return next;
    },

    /**
     * Remember the channel this tile should get back when Web Video is turned
     * off (only the first non-webstream channel counts).
     * @param {string} slotId
     */
    _rememberWebStreamReturn(slotId) {
        this.webStreamReturn = this.webStreamReturn || {};
        if (this.webStreamReturn[slotId]) return;
        const previous = this.slots?.[slotId]?.player?.channel;
        if (previous && isWebStreamChannel(previous)) return;
        this.webStreamReturn[slotId] = previous
            ? {
                channel: previous,
                key: channelKey(previous),
                remembered: this.rememberedSlotKeys?.[slotId] || ''
            }
            : {
                channel: null,
                key: this.rememberedSlotKeys?.[slotId] || '',
                remembered: this.rememberedSlotKeys?.[slotId] || ''
            };
    },

    /**
     * Play a resolved stream on one tile.
     * @param {string} slotId
     * @param {{ pageUrl?: string, streamUrl: string, kind?: string, title?: string, proxyTemplate?: string, proxied?: boolean }} spec
     * @param {{ autoplay?: boolean, silent?: boolean, persist?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async playWebStream(slotId, spec, { autoplay = true, silent = false, persist = true } = {}) {
        const slot = this.slots?.[slotId];
        if (!slot || !spec) return false;
        const channel = webstreamChannel({
            pageUrl: spec.pageUrl || '',
            streamUrl: spec.streamUrl,
            kind: spec.kind || '',
            name: spec.title || '',
            proxyTemplate: spec.proxyTemplate || '',
            proxied: spec.proxied === true
        });
        if (!channel) {
            if (!silent) showAppToast('That link is not a playable .m3u8 or .mp4 URL');
            return false;
        }

        this._rememberWebStreamReturn(slotId);
        if (slotId !== 'center' && !slot.enabled) {
            this.setSideEnabled?.(slotId, true, { silent: true });
        }

        this.webStreamState = this.webStreamState || {};
        this.webStreamState[slotId] = {
            pageUrl: spec.pageUrl || channel.webStreamPageUrl || '',
            streamUrl: channel.url_resolved,
            kind: channel.streamKind || '',
            mode: 'media',
            title: spec.title || channel.name
        };
        this.rememberedSlotKeys = this.rememberedSlotKeys || {};
        this.rememberedSlotKeys[slotId] = channel.channeluuid;

        if (autoplay) {
            // Guard so prepareSlotForPlay()'s detach does not restore the old
            // channel while this new Web Video channel is being installed.
            this._wsIntent = this._wsIntent || {};
            this._wsIntent[slotId] = true;
            let landed = true;
            try {
                await this.playOnSlot?.(slotId, channel, { skipHistory: true });
            } catch {
                landed = false;
            } finally {
                delete this._wsIntent[slotId];
            }
            if (!landed) {
                if (this.webStreamState) delete this.webStreamState[slotId];
                if (!silent) showAppToast('Stream unavailable — try another link');
                return false;
            }
            const player = this.slots?.[slotId]?.player;
            if (player?.error && !silent) showAppToast('Stream unavailable — try another link');
        } else {
            // Restore = stopped slate. Nothing attaches until the user hits play.
            const player = this.ensurePlayer?.(slotId, { startMuted: slotId !== 'center' });
            if (player) {
                player.channel = channel;
                player.stopped = true;
                player.wantPlaying = false;
                player.playing = false;
                player.pausePhase = 'idle';
                player.loading = false;
                player.loadPhase = 'idle';
                player.error = null;
                player.emitState?.();
                this.mountAll?.();
            }
        }

        if (persist) {
            this.persistSlots?.();
            this.scheduleRefreshTiles?.();
            this.syncMosaicChrome?.();
            this.syncStatusChrome?.();
        }
        return true;
    },

    /**
     * Embed the page itself in a tile iframe (rung 4 fallback).
     * @param {string} slotId
     * @param {{ pageUrl?: string, frameUrl?: string, title?: string, shield?: string }} spec
     * @param {{ silent?: boolean, persist?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async playEmbeddedWebPage(slotId, { pageUrl = '', frameUrl = '', title = '', shield = '' } = {}, { silent = false, persist = true } = {}) {
        const slot = this.slots?.[slotId];
        const url = frameUrl || pageUrl;
        if (!slot || !url) {
            if (!silent) showAppToast('No page to embed');
            return false;
        }

        this._rememberWebStreamReturn(slotId);
        if (slotId !== 'center' && !slot.enabled) {
            this.setSideEnabled?.(slotId, true, { silent: true });
        }

        const player = this.ensurePlayer?.(slotId, { startMuted: slotId !== 'center' });
        const surface = surfaceFor(slotId);
        if (surface) player?.mountVideo?.(surface);
        try { await player?.stop?.(); } catch { /* ignore */ }

        const channelId = webstreamChannelId(pageUrl || url, url);
        const channel = {
            providerId: WEBSTREAM_PROVIDER_ID,
            channelId,
            channeluuid: `${WEBSTREAM_PROVIDER_ID}:${channelId}`,
            name: title || hostLabel(pageUrl || url) || WEBSTREAM_LABEL,
            url_resolved: '',
            logo: '',
            countrycode: '',
            categories: [],
            tags: '',
            webStreamPageUrl: pageUrl || '',
            webStreamEmbed: true
        };

        this.webStreamState = this.webStreamState || {};
        this.webStreamState[slotId] = {
            pageUrl: pageUrl || '',
            frameUrl: url,
            streamUrl: '',
            kind: '',
            mode: 'embed',
            title: channel.name,
            shield: isShieldLevel(shield)
                ? shield
                : (SettingsStore.getWebStreamShield?.() || DEFAULT_SHIELD_LEVEL)
        };
        this.rememberedSlotKeys = this.rememberedSlotKeys || {};
        this.rememberedSlotKeys[slotId] = channel.channeluuid;

        if (player) {
            player.channel = channel;
            player.stopped = true;
            player.wantPlaying = false;
            player.playing = false;
            player.pausePhase = 'idle';
            player.loading = false;
            player.loadPhase = 'idle';
            player.error = null;
            player.emitState?.();
        }
        this.mountWebStreamFrame(slotId);
        this.mountAll?.();

        if (persist) {
            this.persistSlots?.();
            this.scheduleRefreshTiles?.();
            this.syncMosaicChrome?.();
            this.syncStatusChrome?.();
        }
        return true;
    },

    /** Paint / repaint the page iframe for a tile in embed mode. */
    mountWebStreamFrame(slotId) {
        const state = this.webStreamState?.[slotId];
        const surface = surfaceFor(slotId);
        if (!state || state.mode !== 'embed' || !surface) return false;
        const mounted = Boolean(mountWebPageFrame(surface, {
            url: state.frameUrl,
            title: state.title || WEBSTREAM_LABEL,
            shield: isShieldLevel(state.shield) ? state.shield : DEFAULT_SHIELD_LEVEL
        }));
        // A muted tile comes back muted (same-origin pages only — see
        // `syncPageFrameMuted`; a remote page keeps its own sound).
        if (mounted) this.syncEmbeddedPageMute(slotId);
        return mounted;
    },

    /**
     * Mirror the tile's mute flag onto the embedded page.
     * The page's own audio is only reachable when it is same-origin.
     * @param {string} slotId
     * @returns {boolean} true when the page's media was reachable
     */
    syncEmbeddedPageMute(slotId) {
        if (this.webStreamMode(slotId) !== 'embed') return false;
        const surface = surfaceFor(slotId);
        if (!surface) return false;
        const player = this.slots?.[slotId]?.player;
        if (!player) return false;
        return syncPageFrameMuted(surface, player.muted !== false);
    },

    /**
     * Re-apply every embedded page's mute (Mute all / Mute other TVs) —
     * best effort: only same-origin pages can be reached.
     */
    syncEmbeddedPageMutes() {
        Object.keys(this.webStreamState || {}).forEach((slotId) => {
            if (this.webStreamMode(slotId) === 'embed') this.syncEmbeddedPageMute(slotId);
        });
    },

    /** Remove the page iframe (media mode never has one). */
    unmountWebStreamFrame(slotId) {
        const surface = surfaceFor(slotId);
        return surface ? unmountWebPageFrame(surface) : false;
    },

    /** Play button in embed mode: reload the embedded page. */
    reloadWebStreamFrame(slotId) {
        if (this.webStreamMode(slotId) !== 'embed') return false;
        const surface = surfaceFor(slotId);
        return surface ? reloadWebPageFrame(surface) : false;
    },

    /** ▶ in embed mode: put the page frame back (Stop removed it). */
    resumeEmbeddedWebPage(slotId) {
        const state = this.webStreamState?.[slotId];
        if (!state || state.mode !== 'embed') return false;
        const player = this.slots?.[slotId]?.player;
        const mounted = this.mountWebStreamFrame(slotId);
        if (player) {
            player.stopped = false;
            player.wantPlaying = false;
            player.playing = false;
            player.emitState?.();
        }
        this.scheduleRefreshTiles?.();
        return mounted;
    },

    /** ■ in embed mode: drop the page frame but keep the saved page. */
    stopEmbeddedWebPage(slotId) {
        const state = this.webStreamState?.[slotId];
        if (!state || state.mode !== 'embed') return false;
        this.unmountWebStreamFrame(slotId);
        const player = this.slots?.[slotId]?.player;
        if (player) {
            player.stopped = true;
            player.wantPlaying = false;
            player.playing = false;
            player.emitState?.();
        }
        this.scheduleRefreshTiles?.();
        return true;
    },

    /**
     * Drop Web Video bookkeeping without restoring anything. Synchronous and
     * safe to call from `prepareSlotForPlay()` just before a new TV tune.
     * @param {string} slotId
     * @param {{ restore?: boolean }} [opts]
     * @returns {boolean} true when a Web Video tile was detached
     */
    detachWebStreamModeSync(slotId, { restore = false } = {}) {
        const state = this.webStreamState?.[slotId];
        const player = this.slots?.[slotId]?.player;
        const hadWebVideo = Boolean(state) || isWebStreamChannel(player?.channel);
        if (!hadWebVideo) return false;

        this.unmountWebStreamFrame(slotId);

        // Our own switch: keep the state/channel being installed, never bounce
        // back to the old one (set by playWebStream before playOnSlot).
        if (this._wsIntent?.[slotId]) {
            this.scheduleRefreshTiles?.();
            return true;
        }

        if (this.webStreamState) delete this.webStreamState[slotId];
        const returnState = this.webStreamReturn?.[slotId] || null;
        if (this.webStreamReturn) delete this.webStreamReturn[slotId];
        this.scheduleRefreshTiles?.();

        if (restore) {
            if (returnState?.channel) {
                this.rememberedSlotKeys = this.rememberedSlotKeys || {};
                this.rememberedSlotKeys[slotId] = channelKey(returnState.channel) || returnState.key || '';
                Promise.resolve(this.playOnSlot?.(slotId, returnState.channel, { skipHistory: true }))
                    .catch(() => {});
            } else if (returnState?.key) {
                // Remembered-but-not-loaded TV channel: restore it as a stopped
                // stub (▶ attaches it) instead of dropping the assignment.
                const parsed = parseChannelKey(returnState.key);
                const player = this.ensurePlayer?.(slotId, { startMuted: slotId !== 'center' });
                if (player && parsed) {
                    player.channel = {
                        providerId: parsed.providerId,
                        channelId: parsed.channelId,
                        channeluuid: returnState.key,
                        name: '',
                        url_resolved: ''
                    };
                    player.stopped = true;
                    player.wantPlaying = false;
                    player.playing = false;
                    player.pausePhase = 'idle';
                    player.loading = false;
                    player.loadPhase = 'idle';
                    player.error = null;
                    player.emitState?.();
                }
                this.rememberedSlotKeys = this.rememberedSlotKeys || {};
                this.rememberedSlotKeys[slotId] = returnState.key;
                this.mountAll?.();
            } else {
                // Nothing to give back: clear the synthetic channel so the tile
                // returns to "Pick a channel" instead of a dead webstream name.
                const player = this.slots?.[slotId]?.player;
                if (player) {
                    player.channel = null;
                    player.stopped = true;
                    player.wantPlaying = false;
                    player.playing = false;
                    player.pausePhase = 'idle';
                    player.loading = false;
                    player.loadPhase = 'idle';
                    player.error = null;
                    player.emitState?.();
                }
                if (this.rememberedSlotKeys) delete this.rememberedSlotKeys[slotId];
                this.mountAll?.();
            }
        }
        return true;
    },

    /**
     * Turn Web Video off and restore the tile's previous TV channel.
     * @param {string} slotId
     * @param {{ silent?: boolean, persist?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async detachWebStreamMode(slotId, { silent = false, persist = true } = {}) {
        const had = this.isWebStreamSlot(slotId);
        this.detachWebStreamModeSync(slotId, { restore: true });
        if (!had) return false;
        if (persist) {
            this.persistSlots?.();
            this.scheduleRefreshTiles?.();
            this.syncMosaicChrome?.();
            this.syncStatusChrome?.();
        }
        if (!silent) showAppToast('Web Video off');
        return true;
    },

    /**
     * Persisted entry for a Web Video tile (or null when the slot is not one).
     * @param {string} slotId
     */
    webStreamSlotEntry(slotId) {
        const player = this.slots?.[slotId]?.player;
        const state = this.webStreamState?.[slotId];
        const channel = player?.channel;
        if (!state && !isWebStreamChannel(channel)) return null;

        const pageUrl = state?.pageUrl || channel?.webStreamPageUrl || '';
        const mode = state?.mode === 'embed' || channel?.webStreamEmbed === true ? 'embed' : 'media';
        const streamUrl = mode === 'embed' ? '' : (state?.streamUrl || channel?.url_resolved || '');
        if (!pageUrl && !streamUrl) return null;

        const volume = Number(player?.volume);
        return {
            kind: 'webstream',
            key: webstreamKey(pageUrl || streamUrl, streamUrl),
            providerId: WEBSTREAM_PROVIDER_ID,
            channelId: channel?.channelId || webstreamChannelId(pageUrl || streamUrl, streamUrl),
            pageUrl,
            streamUrl,
            streamKind: state?.kind || channel?.streamKind || '',
            mode,
            frameUrl: state?.frameUrl || (mode === 'embed' ? pageUrl : ''),
            shield: mode === 'embed' && isShieldLevel(state?.shield) ? state.shield : '',
            name: channel?.name || state?.title || '',
            muted: player?.muted !== false,
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
            url: ''
        };
    },

    /**
     * Restore saved Web Video tiles as paused placeholders (no autoplay).
     * @param {Record<string, object>} mosaic
     * @returns {Promise<number>} number of restored tiles
     */
    async restoreWebStreamSlots(mosaic) {
        if (!mosaic || typeof mosaic !== 'object') return 0;
        let restored = 0;
        for (const slotId of Object.keys(mosaic)) {
            const entry = mosaic[slotId];
            if (!isWebStreamEntry(entry)) continue;
            const config = webStreamEntryConfig(entry);
            if (!config) continue;
            if (slotId !== 'center' && !this.slots?.[slotId]?.enabled) {
                this.setSideEnabled?.(slotId, true, { silent: true });
            }
            let ok = false;
            if (entry.mode === 'embed') {
                ok = await this.playEmbeddedWebPage(slotId, {
                    pageUrl: config.pageUrl,
                    frameUrl: entry.frameUrl || config.pageUrl,
                    title: config.name,
                    shield: config.shield
                }, { silent: true, persist: false });
            } else if (config.streamUrl) {
                ok = await this.playWebStream(slotId, {
                    pageUrl: config.pageUrl,
                    streamUrl: config.streamUrl,
                    kind: config.kind,
                    title: config.name
                }, { autoplay: false, silent: true, persist: false });
            }
            if (ok) restored += 1;
        }
        return restored;
    },

    /** Forget Web Video bookkeeping for a slot that is being disabled. */
    forgetWebStreamSlot(slotId) {
        if (this.webStreamState) delete this.webStreamState[slotId];
        if (this.webStreamReturn) delete this.webStreamReturn[slotId];
        if (this._wsIntent) delete this._wsIntent[slotId];
    },

    /**
     * Swap moves the *players* between tiles; Web Video page/embed state is
     * tile-bound, so move it alongside and repaint the iframe on its new tile.
     * @param {string} sideId
     * @returns {boolean}
     */
    swapWebStreamSlots(sideId) {
        const hasState = Boolean(this.webStreamState?.center || this.webStreamState?.[sideId]);
        const hasReturn = Boolean(this.webStreamReturn?.center || this.webStreamReturn?.[sideId]);
        if (!hasState && !hasReturn) return false;

        this.unmountWebStreamFrame('center');
        this.unmountWebStreamFrame(sideId);

        const flip = (map) => {
            if (!map) return;
            const centerEntry = map.center;
            const sideEntry = map[sideId];
            delete map.center;
            delete map[sideId];
            if (sideEntry) map.center = sideEntry;
            if (centerEntry) map[sideId] = centerEntry;
        };
        flip(this.webStreamState);
        flip(this.webStreamReturn);

        this.mountWebStreamFrame('center');
        this.mountWebStreamFrame(sideId);
        this.scheduleRefreshTiles?.();
        return true;
    },

    /**
     * Re-resolve the saved page and play the fresh stream (signed URLs rotate
     * and expire). Falls back to embedding the page when nothing is extracted.
     * @param {string} slotId
     * @param {{ silent?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async reResolveWebStreamSlot(slotId, { silent = false } = {}) {
        const state = this.webStreamState?.[slotId];
        const pageUrl = state?.pageUrl || this.slots?.[slotId]?.player?.channel?.webStreamPageUrl || '';
        if (!pageUrl) {
            if (!silent) showAppToast('No page to re-scan');
            return false;
        }
        const proxyTemplate = SettingsStore.getWebStreamProxyTemplate?.() || '';
        const result = await resolveWebStream(pageUrl, { proxyTemplate });
        if (result.status === 'resolved') {
            const spec = buildPlaybackSpec(
                { pageUrl, url: result.url, kind: result.kind },
                { proxyTemplate, useProxy: Boolean(proxyTemplate), title: state?.title || '' }
            );
            return Boolean(spec) && this.playWebStream(slotId, spec, { silent });
        }
        if (result.frames?.length) {
            return this.playEmbeddedWebPage(slotId, {
                pageUrl,
                frameUrl: result.frames[0],
                title: state?.title || '',
                shield: this.webStreamShieldFor(slotId)
            }, { silent });
        }
        if (!silent) showAppToast(result.message || 'Could not re-resolve that page');
        return false;
    }
};

