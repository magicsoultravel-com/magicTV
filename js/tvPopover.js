import { positionPanelBelowElement, clampPanelToViewport, raiseUndockedAttachStack } from './popoverPosition.js';
import { TvPlayer } from './tvPlayer.js';
import { TvPip } from './tvPip.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { showAppToast } from './toast.js';
import { channelKey } from './tvProviders/channelShape.js';

const MIN_BROWSER_W = 320;
const MIN_BROWSER_H = 280;

export const TvPopover = {
    panel: null,
    attachEl: null,
    iconAnchor: null,
    mode: null,
    activeTab: 'browse',
    outsideHandler: null,
    keyHandler: null,
    boundsHandler: null,
    onClose: null,
    onTabChange: null,
    onOpen: null,
    tabsBound: false,
    controlsBound: false,
    controlsUpdateInterval: null,

    ensurePanel() {
        if (this.panel) return this.panel;

        const panel = document.createElement('div');
        panel.className = 'tv-popover clock-style-popover is-hidden';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `
            <div class="sidebar-media-popover__header" data-tv-pop-drag>
                <button type="button" class="btn btn--compact btn-icon sidebar-media-popover__back is-hidden" data-tv-pop-back aria-label="Back">◀</button>
                <span class="sidebar-media-popover__title" data-tv-pop-title>TV</span>
                <span class="sidebar-media-popover__spacer"></span>
                <button type="button" class="card-act sidebar-media-popover__close" data-tv-pop-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="tv-popover__video-wrap is-hidden" data-tv-video-wrap>
                <div class="tv-popover__video-slot" data-tv-video-slot aria-label="Live video">
                    <div class="tv-video-controls" data-tv-video-controls>
                        <div class="tv-video-controls__top">
                            <div class="tv-stats-tooltip" data-tv-stats-tooltip>
                                <div class="tv-stats-tooltip__row">
                                    <span class="tv-stats-tooltip__label">Quality</span>
                                    <span class="tv-stats-tooltip__value" data-tv-stat-quality>-</span>
                                </div>
                                <div class="tv-stats-tooltip__row">
                                    <span class="tv-stats-tooltip__label">Bandwidth</span>
                                    <span class="tv-stats-tooltip__value" data-tv-stat-bandwidth>-</span>
                                </div>
                                <div class="tv-stats-tooltip__row">
                                    <span class="tv-stats-tooltip__label">Buffer</span>
                                    <span class="tv-stats-tooltip__value" data-tv-stat-buffer>-</span>
                                </div>
                            </div>
                            <div class="tv-video-controls__actions">
                                <button type="button" class="tv-controls-btn" data-tv-pip-btn title="Pop out" aria-label="Pop out" aria-pressed="false">${ACTION_ICONS.pictureInPicture}</button>
                                <button type="button" class="tv-controls-btn" data-tv-fav-btn title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.star}</button>
                                <button type="button" class="tv-controls-btn" data-tv-url-btn title="Copy channel link" aria-label="Copy channel link">${ACTION_ICONS.link}</button>
                                <div class="tv-video-controls__settings">
                                <button type="button" class="tv-controls-btn" data-tv-settings-btn title="Stream settings" aria-label="Stream settings" aria-expanded="false">
                                    <svg viewBox="0 0 12 12" width="14" height="14" focusable="false"><circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.5V2.2M6 9.8v-1.3M3.5 6H2.2M9.8 6H8.5M4.2 4.2 3.2 3.2M8.8 8.8l-1-1M7.8 4.2l1-1M4.2 7.8l-1 1" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/></svg>
                                </button>
                                <div class="tv-settings-popover is-hidden" data-tv-settings-popover role="menu">
                                    <div class="tv-settings-popover__header">
                                        <span class="tv-settings-popover__title">Stream settings</span>
                                        <button type="button" class="tv-settings-popover__close" data-tv-settings-close title="Close settings" aria-label="Close settings">${CARD_ICONS.close}</button>
                                    </div>
                                    <div class="tv-settings-popover__section">
                                        <span class="tv-settings-popover__label">Quality</span>
                                        <div class="tv-settings-popover__options" data-tv-quality-options></div>
                                    </div>
                                    <div class="tv-settings-popover__section tv-settings-popover__section--muted">
                                        <span class="tv-settings-popover__label">More settings coming soon</span>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                        <div class="tv-video-controls__center">
                            <button type="button" class="tv-controls-btn tv-play-btn" data-tv-play-pause-btn title="Play/Pause" aria-label="Play/Pause">
                                <svg data-tv-play-icon viewBox="0 0 12 12" width="20" height="20" focusable="false"></svg>
                            </button>
                        </div>
                        <div class="tv-video-controls__bottom">
                            <div class="tv-controls-bar" data-tv-controls-bar>
                                <div class="tv-controls-bar__buffer" data-tv-buffer-fill></div>
                                <div class="tv-controls-bar__seek-thumb" data-tv-seek-thumb></div>
                                <div class="tv-controls-bar__live"></div>
                            </div>
                            <div class="tv-controls-info">
                                <span data-tv-latency-info>Live</span>
                                <span class="tv-seek-info" data-tv-seek-info></span>
                                <div class="tv-volume-cluster" data-tv-volume-cluster>
                                    <button type="button" class="tv-controls-btn tv-volume-btn" data-tv-mute-btn title="Mute or unmute" aria-label="Mute or unmute" aria-pressed="false">
                                        <svg data-tv-mute-icon viewBox="0 0 12 12" width="12" height="12" focusable="false"></svg>
                                    </button>
                                    <button type="button" class="tv-controls-btn tv-volume-step" data-tv-volume-down title="Volume down" aria-label="Volume down">
                                        <svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1"/></svg>
                                    </button>
                                    <span class="tv-volume-pct" data-tv-volume-pct>85%</span>
                                    <button type="button" class="tv-controls-btn tv-volume-step" data-tv-volume-up title="Volume up" aria-label="Volume up">
                                        <svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 2.5v7M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1"/></svg>
                                    </button>
                                </div>
                                <span data-tv-quality-badge>Auto</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="sidebar-media-popover__toolbar is-hidden" data-tv-pop-toolbar></div>
            <div class="sidebar-media-popover__body" data-tv-pop-body></div>
            <div class="sidebar-media-popover__tabs" data-tv-pop-tabs>
                <button type="button" class="sidebar-media-popover__tab is-active" data-tv-tab="browse">Browse</button>
                <button type="button" class="sidebar-media-popover__tab" data-tv-tab="recents">Recents</button>
                <button type="button" class="sidebar-media-popover__tab" data-tv-tab="favorites">Favorites</button>
            </div>
            <div class="sidebar-media-popover__resize-se ff-resize ff-resize-se" data-tv-pop-resize aria-hidden="true"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-tv-pop-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        this.bindResize(panel);
        this.bindHeaderDrag(panel);
        this.bindTabs(panel);
        this.bindVideoControls(panel);
        panel.addEventListener('pointerdown', () => {
            raiseUndockedAttachStack(this.attachEl, panel);
        });
        this.panel = panel;
        return panel;
    },

    bindTabs(panel) {
        if (this.tabsBound) return;
        this.tabsBound = true;
        panel.querySelector('[data-tv-pop-tabs]')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tv-tab]');
            if (!btn || this.mode === 'special') return;
            e.stopPropagation();
            const tab = btn.getAttribute('data-tv-tab');
            if (tab && tab !== this.activeTab) {
                this.setActiveTab(tab);
                this.onTabChange?.(tab);
            }
        });
    },

    bindVideoControls(panel) {
        if (this.controlsBound) return;
        this.controlsBound = true;

        const controls = panel.querySelector('[data-tv-video-controls]');
        const slot = panel.querySelector('[data-tv-video-slot]');
        if (!controls || !slot) return;

        TvPip.registerButton(panel.querySelector('[data-tv-pip-btn]'));

        panel.querySelector('[data-tv-fav-btn]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            TvPlayer.toggleFavorite(TvPlayer.channel);
        });

        panel.querySelector('[data-tv-url-btn]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const channel = TvPlayer.channel;
            const key = channelKey(channel);
            if (!key || !channel?.url_resolved) {
                showAppToast('No channel to share');
                return;
            }
            const success = await copyPlainTextToClipboard(channel.url_resolved);
            if (success) {
                showAppToast('Channel link copied to clipboard');
            } else {
                showAppToast('Failed to copy channel link');
            }
        });

        panel.querySelector('[data-tv-play-pause-btn]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            TvPlayer.toggle();
        });

        // Volume cluster
        panel.querySelector('[data-tv-mute-btn]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            TvPlayer.toggleMute();
        });
        panel.querySelector('[data-tv-volume-up]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            TvPlayer.adjustVolume(0.05);
        });
        panel.querySelector('[data-tv-volume-down]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            TvPlayer.adjustVolume(-0.05);
        });

        // Inline settings popover
        const settingsBtn = panel.querySelector('[data-tv-settings-btn]');
        const settingsPopover = panel.querySelector('[data-tv-settings-popover]');
        const closeSettingsBtn = panel.querySelector('[data-tv-settings-close]');

        const closeSettings = () => {
            settingsPopover?.classList.add('is-hidden');
            settingsBtn?.setAttribute('aria-expanded', 'false');
        };
        const toggleSettings = () => {
            const isOpen = !settingsPopover?.classList.contains('is-hidden');
            if (isOpen) {
                closeSettings();
            } else {
                this.renderQualityOptions();
                settingsPopover?.classList.remove('is-hidden');
                settingsBtn?.setAttribute('aria-expanded', 'true');
            }
        };
        settingsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSettings();
        });
        closeSettingsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSettings();
        });

        // Close popover when clicking outside the settings area
        slot.addEventListener('click', (e) => {
            if (e.target.closest('.tv-video-controls__settings') || e.target.closest('.tv-controls-btn') || e.target.closest('.tv-controls-bar')) return;
            closeSettings();
            TvPlayer.toggle();
        });

        // Quality option selection
        panel.querySelector('[data-tv-quality-options]')?.addEventListener('click', (e) => {
            const opt = e.target.closest('[data-quality-index]');
            if (!opt) return;
            e.stopPropagation();
            TvPlayer.setQualityLevel(parseInt(opt.getAttribute('data-quality-index'), 10));
            this.renderQualityOptions();
        });

        this.bindSeekControls(panel);
    },

    bindSeekControls(panel) {
        const bar = panel.querySelector('[data-tv-controls-bar]');
        if (!bar) return;

        const getTargetTime = (clientX) => {
            const rect = bar.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const seekInfo = TvPlayer.getSeekInfo();
            const seekableStart = seekInfo.bufferedStart;
            const seekableEnd = seekInfo.bufferedEnd;
            const seekableDuration = Math.max(0, seekableEnd - seekableStart);
            return seekableDuration > 0 ? seekableStart + ratio * seekableDuration : seekInfo.current;
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            bar.setPointerCapture(e.pointerId);
            const target = getTargetTime(e.clientX);
            TvPlayer.seekTo(target);
            const onMove = (ev) => {
                const t = getTargetTime(ev.clientX);
                TvPlayer.seekTo(t);
            };
            const onUp = () => {
                bar.removeEventListener('pointermove', onMove);
                bar.removeEventListener('pointerup', onUp);
                bar.removeEventListener('pointercancel', onUp);
            };
            bar.addEventListener('pointermove', onMove);
            bar.addEventListener('pointerup', onUp);
            bar.addEventListener('pointercancel', onUp);
        };

        bar.addEventListener('pointerdown', onPointerDown);
    },

    renderQualityOptions() {
        const container = this.panel?.querySelector('[data-tv-quality-options]');
        if (!container) return;
        const opts = TvPlayer.getQualityOptions();
        const currentIdx = TvPlayer.getQualityLevelIndex();
        const currentLabel = TvPlayer.qualityLabel;
        container.innerHTML = opts.map((opt) => {
            const isActive = opt.index === -1
                ? !TvPlayer.hls || currentLabel === 'Auto' || currentIdx < 0
                : opt.index === currentIdx;
            return `<button type="button" class="tv-settings-option${isActive ? ' is-active' : ''}" data-quality-index="${opt.index}">${opt.label}</button>`;
        }).join('');
    },

    updateVideoControls() {
        const panel = this.panel;
        if (!panel || panel.classList.contains('is-hidden')) return;

        const state = {
            playing: TvPlayer.playing,
            qualityLabel: TvPlayer.qualityLabel,
            stats: TvPlayer.getStats()
        };

        const playIcon = panel.querySelector('[data-tv-play-icon]');
        if (playIcon) {
            if (state.playing) {
                playIcon.innerHTML = '<path d="M3.8 2.6v6.8M8.2 2.6v6.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/>';
            } else {
                playIcon.innerHTML = '<path d="M4.2 2.4v7.2l6-2.4z" fill="currentColor"/>';
            }
        }

        const bufferFill = panel.querySelector('[data-tv-buffer-fill]');
        const seekThumb = panel.querySelector('[data-tv-seek-thumb]');
        const seekInfoEl = panel.querySelector('[data-tv-seek-info]');
        if (bufferFill || seekThumb) {
            const seekInfo = state.stats.seekInfo || TvPlayer.getSeekInfo();
            const bufferPct = TvPlayer.getBufferPercentage();
            if (bufferFill) {
                bufferFill.style.width = `${bufferPct}%`;
            }
            if (seekThumb) {
                const thumbLeft = seekInfo.progress || 0;
                seekThumb.style.left = `${Math.min(100, Math.max(0, thumbLeft))}%`;
                seekThumb.classList.toggle('is-hidden', seekInfo.isLive && (seekInfo.behindLive === null || seekInfo.behindLive <= 1));
            }
            if (seekInfoEl) {
                if (seekInfo.isLive) {
                    const behind = seekInfo.behindLive !== null ? Math.round(seekInfo.behindLive) : '?';
                    const rewind = Math.round(seekInfo.bufferedEnd - seekInfo.current);
                    seekInfoEl.textContent = `${behind}s behind • ${rewind}s rewindable`;
                } else {
                    const cur = Math.floor(seekInfo.current);
                    const dur = Math.floor(seekInfo.bufferedEnd || seekInfo.current);
                    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
                    seekInfoEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
                }
            }
        }

        const favBtn = panel.querySelector('[data-tv-fav-btn]');
        if (favBtn) {
            const isFav = TvPlayer.channel ? TvPlayer.isFavorite(TvPlayer.channel) : false;
            favBtn.innerHTML = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
            favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
            favBtn.setAttribute('title', isFav ? 'Remove favorite' : 'Add favorite');
            favBtn.setAttribute('aria-label', isFav ? 'Remove favorite' : 'Add favorite');
            favBtn.classList.toggle('is-active', isFav);
        }

        const qualityBadge = panel.querySelector('[data-tv-quality-badge]');
        if (qualityBadge) {
            qualityBadge.textContent = state.qualityLabel || 'Auto';
        }

        const latencyInfo = panel.querySelector('[data-tv-latency-info]');
        if (latencyInfo && state.stats.liveLatency !== null) {
            const latency = state.stats.liveLatency;
            const latencySec = Math.round(latency);
            latencyInfo.textContent = `${latencySec}s behind`;
            latencyInfo.className = 'tv-controls-info__latency';
            if (latency < 2) {
                latencyInfo.classList.add('is-good');
            } else if (latency > 8) {
                latencyInfo.classList.add('is-poor');
            }
        } else if (latencyInfo) {
            latencyInfo.textContent = 'Live';
            latencyInfo.className = 'tv-controls-info__latency';
        }

        // Volume cluster refresh
        const volPct = panel.querySelector('[data-tv-volume-pct]');
        if (volPct) {
            volPct.textContent = `${Math.round((TvPlayer.muted ? 0 : TvPlayer.volume) * 100)}%`;
        }
        const muteBtn = panel.querySelector('[data-tv-mute-btn]');
        const muteIcon = panel.querySelector('[data-tv-mute-icon]');
        if (muteBtn && muteIcon) {
            const isMuted = TvPlayer.muted || TvPlayer.volume === 0;
            muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
            if (isMuted) {
                muteIcon.innerHTML = '<path d="M2.6 4.6h2l2.6-2.4v7.6L4.6 7.4h-2" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M8 4.2 10 7M10 4.2 8 7" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>';
            } else {
                muteIcon.innerHTML = '<path d="M2.6 4.6h2l2.6-2.4v7.6L4.6 7.4h-2" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M7.6 4.4a2.8 2.8 0 0 1 0 3.2M8.8 3.2a4.6 4.6 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>';
            }
        }

        // Keep quality options in sync while open
        const popover = panel.querySelector('[data-tv-settings-popover]');
        if (popover && !popover.classList.contains('is-hidden')) {
            this.renderQualityOptions();
        }
    },

    updateStatsDisplay() {
        const panel = this.panel;
        if (!panel) return;

        const stats = TvPlayer.getStats();
        
        const qualityEl = panel.querySelector('[data-tv-stat-quality]');
        const bandwidthEl = panel.querySelector('[data-tv-stat-bandwidth]');
        const bufferEl = panel.querySelector('[data-tv-stat-buffer]');

        if (qualityEl) {
            qualityEl.textContent = stats.qualityLevel || 'Auto';
        }

        if (bandwidthEl) {
            if (stats.bandwidth > 0) {
                const mbps = (stats.bandwidth / 1000000).toFixed(1);
                bandwidthEl.textContent = `${mbps} Mbps`;
            } else if (stats.connection === 'connecting' || stats.loadPhase === 'buffering') {
                bandwidthEl.textContent = 'estimating…';
            } else {
                bandwidthEl.textContent = '—';
            }
        }

        if (bufferEl) {
            const bufferSec = (stats.buffer.buffered || 0).toFixed(1);
            bufferEl.textContent = `${bufferSec}s`;
        }
    },

    startStatsUpdates() {
        if (this.controlsUpdateInterval) return;
        this.controlsUpdateInterval = setInterval(() => {
            if (!this.panel?.classList.contains('is-hidden') && this.mode !== 'special') {
                this.updateVideoControls();
                this.updateStatsDisplay();
            }
        }, 2000);
    },

    stopStatsUpdates() {
        if (this.controlsUpdateInterval) {
            clearInterval(this.controlsUpdateInterval);
            this.controlsUpdateInterval = null;
        }
    },

    setActiveTab(tab) {
        this.activeTab = tab;
        this.panel?.querySelectorAll('[data-tv-tab]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-tv-tab') === tab);
        });
    },

    setTabsVisible(visible) {
        this.panel?.querySelector('[data-tv-pop-tabs]')?.classList.toggle('is-hidden', !visible);
    },

    bindHeaderDrag(panel) {
        const header = panel.querySelector('[data-tv-pop-drag]');
        if (!header || header.dataset.dragBound === 'true') return;
        header.dataset.dragBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('[data-tv-pop-close]')
                || e.target.closest('[data-tv-pop-back]')
                || e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(panel.style.left) || panel.getBoundingClientRect().left;
            const startTop = parseFloat(panel.style.top) || panel.getBoundingClientRect().top;

            panel.classList.add('tv-popover--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                const nx = startLeft + (ev.clientX - startX);
                const ny = startTop + (ev.clientY - startY);
                const clamped = clampPanelToViewport(panel, nx, ny);
                panel.style.left = `${clamped.x}px`;
                panel.style.top = `${clamped.y}px`;
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                panel.classList.remove('tv-popover--dragging');
                header.releasePointerCapture(ev.pointerId);
                TvPlayer.saveBrowserPosition({
                    browserFloating: true,
                    browserX: parseFloat(panel.style.left) || 0,
                    browserY: parseFloat(panel.style.top) || 0
                });
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    },

    bindResize(panel) {
        const handle = panel.querySelector('[data-tv-pop-resize]');
        if (!handle) return;

        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = panel.offsetWidth;
            const startH = panel.offsetHeight;

            panel.classList.add('is-resizing');

            const onMove = (ev) => {
                const w = Math.max(MIN_BROWSER_W, startW + (ev.clientX - startX));
                const h = Math.max(MIN_BROWSER_H, startH + (ev.clientY - startY));
                panel.style.width = `${w}px`;
                panel.style.height = `${h}px`;
                this.reposition();
            };

            const onUp = () => {
                panel.classList.remove('is-resizing');
                TvPlayer.saveBrowserSize(panel.offsetWidth, panel.offsetHeight);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    },

    applyBrowserSize(panel) {
        const { w, h } = TvPlayer.getBrowserSize();
        panel.style.width = `${w}px`;
        panel.style.height = `${h}px`;
    },

    getVideoSlot() {
        return this.panel?.querySelector('[data-tv-video-slot]');
    },

    syncVideoMount() {
        const slot = this.getVideoSlot();
        const wrap = this.panel?.querySelector('[data-tv-video-wrap]');
        const inSettings = this.mode === 'special';
        const hasChannel = !!TvPlayer.channel;
        const showVideo = hasChannel && !inSettings && !this.panel?.classList.contains('is-hidden');
        wrap?.classList.toggle('is-hidden', !showVideo);
        if (showVideo && slot) {
            TvPlayer.mountVideo(slot);
            this.updateVideoControls();
        } else if (inSettings || this.panel?.classList.contains('is-hidden')) {
            TvPlayer.mountToHolder();
        }
    },

    open(mode, { attachEl, iconAnchor, title = 'TV', force = false, tab = 'browse' } = {}) {
        const wasOpen = !this.panel?.classList.contains('is-hidden');
        const sameBrowse = mode === 'browse'
            && this.mode === 'browse'
            && this.iconAnchor === iconAnchor
            && this.activeTab === tab;
        const sameSpecial = mode === 'special' && this.mode === 'special' && this.iconAnchor === iconAnchor;

        if (wasOpen && !force && (sameBrowse || sameSpecial)) {
            this.close();
            return false;
        }

        this.close(false);
        this.attachEl = attachEl;
        this.iconAnchor = iconAnchor;
        this.mode = mode;
        this.activeTab = mode === 'browse' ? tab : null;

        const panel = this.ensurePanel();
        this.applyBrowserSize(panel);
        panel.classList.remove('is-hidden');
        panel.setAttribute('aria-label', title);
        panel.querySelector('[data-tv-pop-title]').textContent = title;

        this.setTabsVisible(mode === 'browse');
        if (mode === 'browse') {
            this.setActiveTab(tab);
        }

        iconAnchor?.setAttribute('aria-expanded', 'true');
        raiseUndockedAttachStack(attachEl, panel);
        this.syncVideoMount();
        this.onOpen?.();
        this.startStatsUpdates();

        requestAnimationFrame(() => {
            this.reposition();
        });

        this.attachListeners();
        this.attachBoundsWatcher();
        return true;
    },

    attachBoundsWatcher() {
        if (this.boundsHandler) return;
        this.boundsHandler = () => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            this.reposition();
        };
        window.addEventListener('tools:desktop_bounds_changed', this.boundsHandler);
        window.addEventListener('resize', this.boundsHandler);
    },

    detachBoundsWatcher() {
        if (!this.boundsHandler) return;
        window.removeEventListener('tools:desktop_bounds_changed', this.boundsHandler);
        window.removeEventListener('resize', this.boundsHandler);
        this.boundsHandler = null;
    },

    attachListeners() {
        this.detachListeners();
        // Intentionally no outside-click dismiss — close via X (or Escape)
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    detachListeners() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    close(resetAnchor = true) {
        this.detachListeners();
        this.detachBoundsWatcher();
        this.stopStatsUpdates();
        // Clean up the inline settings popover on close.
        this.panel?.querySelector('[data-tv-settings-popover]')?.classList.add('is-hidden');
        this.panel?.querySelector('[data-tv-settings-btn]')?.setAttribute('aria-expanded', 'false');
        if (resetAnchor) {
            this.iconAnchor?.setAttribute('aria-expanded', 'false');
        }
        this.panel?.classList.add('is-hidden');
        TvPlayer.mountToHolder();
        this.attachEl = null;
        this.iconAnchor = null;
        this.mode = null;
        this.activeTab = 'browse';
        this.onClose?.();
    },

    getBodyEl() {
        return this.panel?.querySelector('[data-tv-pop-body]');
    },

    getToolbarEl() {
        return this.panel?.querySelector('[data-tv-pop-toolbar]');
    },

    setBackVisible(visible, onClick) {
        const back = this.panel?.querySelector('[data-tv-pop-back]');
        if (!back) return;
        back.classList.toggle('is-hidden', !visible);
        back.onclick = visible ? (e) => { e.stopPropagation(); onClick?.(); } : null;
    },

    setTitle(text) {
        const el = this.panel?.querySelector('[data-tv-pop-title]');
        if (el) el.textContent = text;
    },

    setToolbarHtml(html) {
        const toolbar = this.getToolbarEl();
        if (!toolbar) return;
        toolbar.innerHTML = html || '';
        toolbar.classList.toggle('is-hidden', !html);
    },

    reposition() {
        if (!this.panel || this.panel.classList.contains('is-hidden')) return;

        const { browserX, browserY, browserFloating } = TvPlayer.getBrowserPosition();
        if (browserFloating && browserX != null && browserY != null) {
            this.panel.style.left = `${browserX}px`;
            this.panel.style.top = `${browserY}px`;
            const clamped = clampPanelToViewport(
                this.panel,
                browserX,
                browserY
            );
            this.panel.style.left = `${clamped.x}px`;
            this.panel.style.top = `${clamped.y}px`;
            return;
        }

        if (!this.attachEl) return;
        positionPanelBelowElement(this.panel, this.attachEl);
        const clamped = clampPanelToViewport(
            this.panel,
            parseFloat(this.panel.style.left) || 0,
            parseFloat(this.panel.style.top) || 0
        );
        this.panel.style.left = `${clamped.x}px`;
        this.panel.style.top = `${clamped.y}px`;
    }
};
