/**
 * Float-only Magic Radio shell — cassette-style transport overlay.
 * Uniform scale 0.5–1.5 (same model as Magic Remote undocked); independent of browser/remote CSS.
 */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { bringOverlayToFront } from './moduleLayout.js';
import { RadioPlayer } from '../radio/radioPlayer.js';
import { RadioCast } from '../radio/radioCast.js';
import { stationKey } from '../radio/stationShape.js';
import { setMarqueeText } from './marquee.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    RADIO_BASE_W,
    RADIO_BASE_H,
    clampModuleScale,
    clampFloatGeometry,
    uniformScaleFromCorner,
    scaleFromWidth
} from './moduleScaleResize.js';

/** @type {{ sharedVolume?: number, focusRadio?: () => Promise<void> } | null} */
let multiViewRef = null;

async function getMultiView() {
    if (multiViewRef) return multiViewRef;
    const mod = await import('../multiView.js');
    multiViewRef = mod.MultiView;
    return multiViewRef;
}

const VIEW_PAD = 8;

/** @type {(opts?: { tab?: string }) => void} */
let openRadioBrowser = () => {};

let bound = false;
let open = false;
let pinned = false;
let scale = 1;
/** @type {{ left: number, top: number } | null} */
let position = null;
/** @type {{ mode: 'drag'|'resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number, originScale: number } | null} */
let gesture = null;

function moduleEl() {
    return el('radio-module');
}

function dialogEl() {
    return el('radio-module-dialog');
}

function viewportSize() {
    return {
        w: window.innerWidth || document.documentElement.clientWidth || 800,
        h: window.innerHeight || document.documentElement.clientHeight || 600
    };
}

function sizeForScale(s = scale) {
    const next = clampModuleScale(s);
    return {
        width: Math.round(RADIO_BASE_W * next),
        height: Math.round(RADIO_BASE_H * next),
        scale: next
    };
}

function currentGeometry() {
    const { width, height } = sizeForScale(scale);
    const { w: vw, h: vh } = viewportSize();
    const fallback = {
        left: Math.round((vw - width) / 2),
        top: Math.round(Math.max(48, (vh - height) / 3))
    };
    return clampFloatGeometry({
        left: position?.left ?? fallback.left,
        top: position?.top ?? fallback.top,
        width,
        height
    }, {
        minW: Math.round(RADIO_BASE_W * 0.5),
        minH: Math.round(RADIO_BASE_H * 0.5),
        viewPad: VIEW_PAD,
        vw,
        vh
    });
}

function applyScaleAndPosition() {
    const dialog = dialogEl();
    if (!dialog) return;
    const geom = currentGeometry();
    position = { left: geom.left, top: geom.top };
    scale = clampModuleScale(scale);
    dialog.style.setProperty('--radio-scale', String(scale));
    dialog.style.left = `${geom.left}px`;
    dialog.style.top = `${geom.top}px`;
    dialog.style.width = `${geom.width}px`;
    dialog.style.height = `${geom.height}px`;
}

function persistState() {
    const geom = currentGeometry();
    savePlayerState({
        radioModule: {
            left: geom.left,
            top: geom.top,
            width: geom.width,
            height: geom.height,
            scale,
            pinned,
            open
        }
    });
}

function showUI(show) {
    const modal = moduleEl();
    if (!modal) return;
    modal.classList.toggle('is-hidden', !show);
    modal.hidden = !show;
    modal.setAttribute('aria-hidden', String(!show));
    document.body.classList.toggle('radio-module-open', show);
    if (show) bringOverlayToFront('radio');
}

function restoreFromSaved(saved) {
    if (saved && Number.isFinite(saved.scale)) {
        scale = clampModuleScale(saved.scale);
    } else if (saved && Number.isFinite(saved.width)) {
        scale = scaleFromWidth(saved.width, RADIO_BASE_W);
    } else {
        scale = 1;
    }
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        position = { left: saved.left, top: saved.top };
    } else {
        position = null;
    }
    applyScaleAndPosition();
}

function syncTransportUi() {
    const station = RadioPlayer.station;
    const playing = RadioPlayer.playing;
    const muted = RadioPlayer.muted || RadioPlayer.castLocalSuppressed;
    const casting = RadioCast.isCasting();
    const hostAudio = RadioCast.getHostAudio();
    const key = stationKey(station);
    const fav = key ? RadioPlayer.isFavorite(key) : false;

    const art = el('radio-now-art');
    if (art) {
        const cassette = `<span class="radio-module__art-cassette" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="8" width="14" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="16" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>`;
        if (station?.favicon) {
            art.innerHTML = `${cassette}<img src="${station.favicon.replace(/"/g, '')}" alt="" loading="lazy">`;
        } else {
            art.innerHTML = cassette;
        }
    }

    const title = el('radio-now-title');
    if (title) {
        const name = station?.name || 'No station';
        title.title = name;
        setMarqueeText(title, name);
    }

    const playBtn = el('radio-play-btn');
    if (playBtn) {
        playBtn.classList.toggle('is-playing', playing);
        playBtn.setAttribute('aria-pressed', String(playing));
        playBtn.title = playing ? 'Pause' : 'Play';
        playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        playBtn.innerHTML = playing ? ACTION_ICONS.pause : ACTION_ICONS.play;
    }

    const muteBtn = el('radio-mute-btn');
    if (muteBtn) {
        muteBtn.classList.toggle('is-muted', muted);
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.title = muted ? 'Unmute' : 'Mute';
        muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        const wave = muteBtn.querySelector('.tile-mute-wave');
        const slash = muteBtn.querySelector('.tile-mute-slash');
        if (wave) wave.style.opacity = muted ? '0' : '1';
        if (slash) slash.style.opacity = muted ? '1' : '0';
    }

    const favBtn = el('radio-fav-btn');
    if (favBtn) {
        favBtn.classList.toggle('is-active', fav);
        favBtn.setAttribute('aria-pressed', String(fav));
        favBtn.disabled = !key;
        favBtn.innerHTML = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
    }

    const vol = el('radio-volume-slider');
    if (vol) {
        vol.value = String(Math.round((RadioPlayer.volume ?? 0.85) * 100));
    }
    const volPct = el('radio-volume-pct');
    if (volPct) volPct.textContent = String(Math.round((RadioPlayer.volume ?? 0.85) * 100));

    const castBtn = el('radio-cast-btn');
    if (castBtn) {
        castBtn.classList.toggle('is-casting', casting);
        castBtn.setAttribute('aria-pressed', String(casting));
        castBtn.title = casting ? 'Stop casting' : 'Cast';
    }

    const castMenu = el('radio-cast-menu');
    if (castMenu) {
        castMenu.hidden = !casting;
        castMenu.classList.toggle('is-hidden', !casting);
        castMenu.setAttribute('aria-hidden', String(!casting));
    }

    const hostAudioBtn = el('radio-host-audio-btn');
    if (hostAudioBtn) {
        hostAudioBtn.classList.toggle('is-active', hostAudio);
        hostAudioBtn.setAttribute('aria-pressed', String(hostAudio));
    }

    const castVol = el('radio-cast-volume-slider');
    if (castVol) {
        castVol.value = String(Math.round((RadioCast.getCastVolume() || 0) * 100));
    }
    const castVolPct = el('radio-cast-volume-pct');
    if (castVolPct) {
        castVolPct.textContent = String(Math.round((RadioCast.getCastVolume() || 0) * 100));
    }
    const castMuteBtn = el('radio-cast-mute-btn');
    if (castMuteBtn) {
        const cm = RadioCast.isCastMuted();
        castMuteBtn.classList.toggle('is-muted', cm);
        castMuteBtn.setAttribute('aria-pressed', String(cm));
        castMuteBtn.title = cm ? 'Unmute cast' : 'Mute cast';
        const wave = castMuteBtn.querySelector('.tile-mute-wave');
        const slash = castMuteBtn.querySelector('.tile-mute-slash');
        if (wave) wave.style.opacity = cm ? '0' : '1';
        if (slash) slash.style.opacity = cm ? '1' : '0';
    }

    const err = el('radio-error');
    if (err) {
        err.textContent = RadioPlayer.error || '';
        err.hidden = !RadioPlayer.error;
    }

    moduleEl()?.classList.toggle('is-casting', casting);
    moduleEl()?.classList.toggle('is-playing', playing);
}

function beginGesture(mode, pointerId, clientX, clientY, edge) {
    const geom = currentGeometry();
    gesture = {
        mode,
        pointerId,
        edge,
        startX: clientX,
        startY: clientY,
        originLeft: geom.left,
        originTop: geom.top,
        originW: geom.width,
        originH: geom.height,
        originScale: scale
    };
    const dialog = dialogEl();
    dialog?.setPointerCapture?.(pointerId);
    dialog?.classList.toggle('is-dragging', mode === 'drag');
    dialog?.querySelector('[data-radio-module-drag]')?.classList.toggle('is-dragging', mode === 'drag');
    bringOverlayToFront('radio');
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.mode === 'drag') {
        if (pinned) return;
        position = {
            left: gesture.originLeft + dx,
            top: gesture.originTop + dy
        };
        applyScaleAndPosition();
        return;
    }
    const next = uniformScaleFromCorner({
        originLeft: gesture.originLeft,
        originTop: gesture.originTop,
        originW: gesture.originW,
        originH: gesture.originH,
        originScale: gesture.originScale,
        baseW: RADIO_BASE_W,
        baseH: RADIO_BASE_H,
        dx,
        dy,
        edge: gesture.edge || 'se'
    });
    scale = next.scale;
    position = { left: next.left, top: next.top };
    applyScaleAndPosition();
}

function endGesture(e) {
    if (!gesture || (e && e.pointerId !== gesture.pointerId)) return;
    gesture = null;
    const dialog = dialogEl();
    dialog?.classList.remove('is-dragging');
    dialog?.querySelector('[data-radio-module-drag]')?.classList.remove('is-dragging');
    persistState();
}

async function handleAction(action) {
    try {
        switch (action) {
            case 'play':
                await RadioPlayer.togglePlay();
                break;
            case 'stop':
                RadioPlayer.stop();
                break;
            case 'browse':
                openRadioBrowser({ tab: 'browse' });
                break;
            case 'favorite':
                if (RadioPlayer.station) RadioPlayer.toggleFavorite(RadioPlayer.station);
                break;
            case 'mute':
                RadioPlayer.toggleMute();
                break;
            case 'focus-radio': {
                const mv = await getMultiView();
                await mv.focusRadio?.();
                break;
            }
            case 'cast':
                if (RadioCast.isCasting()) {
                    await RadioCast.stopAll();
                    RadioPlayer.syncCastLocal();
                } else {
                    const url = RadioPlayer.streamUrl || RadioPlayer.station?.url_resolved;
                    if (!url) {
                        showAppToast('Play a station first');
                        break;
                    }
                    await RadioCast.castStation(url, RadioPlayer.station?.name);
                    RadioPlayer.syncCastLocal();
                }
                break;
            case 'host-audio':
                RadioCast.toggleHostAudio();
                RadioPlayer.syncCastLocal();
                break;
            case 'cast-mute':
                RadioCast.toggleCastMute();
                break;
            case 'close':
                RadioModule.close();
                break;
            default:
                break;
        }
    } catch (err) {
        if (err?.message && !/cancel/i.test(err.message)) {
            showAppToast(err.message);
        }
    }
    syncTransportUi();
}

function bindOnce() {
    if (bound) return;
    bound = true;
    const modal = moduleEl();
    if (!modal) return;

    modal.addEventListener('pointerdown', (e) => {
        bringOverlayToFront('radio');
        const resize = e.target.closest?.('[data-radio-resize]');
        if (resize) {
            e.preventDefault();
            beginGesture('resize', e.pointerId, e.clientX, e.clientY, resize.getAttribute('data-radio-resize'));
            return;
        }
        // Drag anywhere grab-cursor shows (dialog/body/header), except interactive controls
        if (e.target.closest?.('button, input, select, textarea, a, label, [data-radio-resize]')) {
            return;
        }
        if (e.target.closest?.('.radio-module__dialog, [data-radio-module-drag]')) {
            e.preventDefault();
            beginGesture('drag', e.pointerId, e.clientX, e.clientY);
        }
    });

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);

    modal.addEventListener('click', (e) => {
        const dismiss = e.target.closest?.('[data-radio-module-dismiss]');
        if (dismiss && !pinned) {
            RadioModule.close();
            return;
        }
        const btn = e.target.closest?.('[data-radio-action]');
        if (btn) {
            e.preventDefault();
            handleAction(btn.getAttribute('data-radio-action'));
        }
    });

    el('radio-volume-slider')?.addEventListener('input', (e) => {
        RadioPlayer.setVolume(Number(e.target.value) / 100);
        syncTransportUi();
    });
    el('radio-cast-volume-slider')?.addEventListener('input', (e) => {
        RadioCast.setCastVolume(Number(e.target.value) / 100);
        syncTransportUi();
    });

    window.addEventListener('radio:state_changed', () => syncTransportUi());
    window.addEventListener('radio:cast_state_changed', () => syncTransportUi());
    window.addEventListener('radio:cast_session_sync', () => {
        RadioPlayer.syncCastLocal();
        syncTransportUi();
    });
    window.addEventListener('resize', () => {
        if (open) applyScaleAndPosition();
    });
}

export const RadioModule = {
    init({ openBrowser } = {}) {
        if (typeof openBrowser === 'function') openRadioBrowser = openBrowser;
        bindOnce();
        RadioPlayer.init({
            getSharedVolume: () => multiViewRef?.sharedVolume ?? 1
        });
        getMultiView().then((mv) => {
            RadioPlayer.setMasterVolumeGetter(() => mv.sharedVolume ?? 1);
        }).catch(() => {});
        RadioCast.init().catch(() => {});
        this.syncEnabledUi();
        syncTransportUi();
    },

    isOpen() {
        return open;
    },

    isEnabled() {
        return SettingsStore.getRadioEnabled() === true;
    },

    syncEnabledUi() {
        const enabled = this.isEnabled();
        const btn = el('remote-radio-btn');
        if (btn) {
            btn.hidden = !enabled;
            btn.classList.toggle('is-hidden', !enabled);
        }
        document.body.classList.toggle('radio-enabled', enabled);
        if (!enabled && open) this.close();
    },

    setEnabled(enabled) {
        SettingsStore.setRadioEnabled(enabled === true);
        this.syncEnabledUi();
        return SettingsStore.getRadioEnabled();
    },

    open() {
        if (!this.isEnabled()) {
            showAppToast('Enable Radio in Settings');
            return;
        }
        bindOnce();
        RadioPlayer.init({
            getSharedVolume: () => multiViewRef?.sharedVolume ?? 1
        });
        getMultiView().then((mv) => {
            RadioPlayer.setMasterVolumeGetter(() => mv.sharedVolume ?? 1);
        }).catch(() => {});
        const saved = loadPlayerState().radioModule;
        restoreFromSaved(saved);
        if (saved?.pinned) {
            pinned = true;
            moduleEl()?.classList.toggle('is-pinned', true);
        }
        open = true;
        showUI(true);
        persistState();
        syncTransportUi();
    },

    close() {
        RadioPlayer.stop();
        open = false;
        showUI(false);
        persistState();
    },

    toggle() {
        if (open) this.close();
        else this.open();
    },

    syncTransportUi
};
