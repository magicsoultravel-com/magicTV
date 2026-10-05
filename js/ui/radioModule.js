/**
 * Float-only Magic Radio shell — cassette-style transport overlay.
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

/** @type {{ sharedVolume?: number, focusRadio?: () => Promise<void> } | null} */
let multiViewRef = null;

async function getMultiView() {
    if (multiViewRef) return multiViewRef;
    const mod = await import('../multiView.js');
    multiViewRef = mod.MultiView;
    return multiViewRef;
}

const MIN_W = 280;
const MIN_H = 200;
const VIEW_PAD = 8;
const DEFAULT_GEOM = { left: 72, top: 96, width: 340, height: 260 };

/** @type {(opts?: { tab?: string }) => void} */
let openRadioBrowser = () => {};

let bound = false;
let open = false;
let pinned = false;
/** @type {{ mode: 'drag'|'resize', pointerId: number, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number } | null} */
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

function clampGeometry({ left, top, width, height }) {
    const { w: vw, h: vh } = viewportSize();
    let w = Math.max(MIN_W, Math.min(width, vw - VIEW_PAD * 2));
    let h = Math.max(MIN_H, Math.min(height, vh - VIEW_PAD * 2));
    let x = Math.min(Math.max(VIEW_PAD, left), vw - VIEW_PAD - Math.min(w, 80));
    let y = Math.min(Math.max(VIEW_PAD, top), vh - VIEW_PAD - 40);
    if (x + w > vw - VIEW_PAD) w = Math.max(MIN_W, vw - VIEW_PAD - x);
    if (y + h > vh - VIEW_PAD) h = Math.max(MIN_H, vh - VIEW_PAD - y);
    return { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

function readDialogGeometry() {
    const dialog = dialogEl();
    if (!dialog) return { ...DEFAULT_GEOM };
    const rect = dialog.getBoundingClientRect();
    return clampGeometry({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    });
}

function applyGeometry(geom) {
    const dialog = dialogEl();
    if (!dialog || !geom) return;
    const next = clampGeometry(geom);
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
}

function persistState() {
    const geom = readDialogGeometry();
    savePlayerState({
        radioModule: {
            ...geom,
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

function defaultGeometry() {
    const { w: vw, h: vh } = viewportSize();
    return clampGeometry({
        left: Math.round((vw - DEFAULT_GEOM.width) / 2),
        top: Math.round(Math.max(48, (vh - DEFAULT_GEOM.height) / 3)),
        width: DEFAULT_GEOM.width,
        height: DEFAULT_GEOM.height
    });
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
        if (station?.favicon) {
            art.innerHTML = `<img src="${station.favicon.replace(/"/g, '')}" alt="" loading="lazy">`;
        } else {
            art.innerHTML = '';
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
        const playIcon = playBtn.querySelector('[data-radio-icon="play"]');
        const pauseIcon = playBtn.querySelector('[data-radio-icon="pause"]');
        if (playIcon) playIcon.hidden = playing;
        if (pauseIcon) pauseIcon.hidden = !playing;
    }

    const muteBtn = el('radio-mute-btn');
    if (muteBtn) {
        muteBtn.classList.toggle('is-muted', muted);
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.title = muted ? 'Unmute' : 'Mute';
    }

    const favBtn = el('radio-fav-btn');
    if (favBtn) {
        favBtn.classList.toggle('is-active', fav);
        favBtn.setAttribute('aria-pressed', String(fav));
        favBtn.disabled = !key;
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

    const hostAudioBtn = el('radio-host-audio-btn');
    if (hostAudioBtn) {
        hostAudioBtn.hidden = !casting;
        hostAudioBtn.classList.toggle('is-active', hostAudio);
        hostAudioBtn.setAttribute('aria-pressed', String(hostAudio));
    }

    const castRow = el('radio-cast-controls');
    if (castRow) castRow.hidden = !casting;

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
    const geom = readDialogGeometry();
    gesture = {
        mode,
        pointerId,
        edge,
        startX: clientX,
        startY: clientY,
        originLeft: geom.left,
        originTop: geom.top,
        originW: geom.width,
        originH: geom.height
    };
    dialogEl()?.setPointerCapture?.(pointerId);
    bringOverlayToFront('radio');
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.mode === 'drag') {
        if (pinned) return;
        applyGeometry({
            left: gesture.originLeft + dx,
            top: gesture.originTop + dy,
            width: gesture.originW,
            height: gesture.originH
        });
        return;
    }
    let left = gesture.originLeft;
    let top = gesture.originTop;
    let width = gesture.originW;
    let height = gesture.originH;
    const edge = gesture.edge || 'se';
    if (edge.includes('e')) width = gesture.originW + dx;
    if (edge.includes('s')) height = gesture.originH + dy;
    if (edge.includes('w')) {
        width = gesture.originW - dx;
        left = gesture.originLeft + dx;
    }
    if (edge.includes('n')) {
        height = gesture.originH - dy;
        top = gesture.originTop + dy;
    }
    applyGeometry({ left, top, width, height });
}

function endGesture(e) {
    if (!gesture || (e && e.pointerId !== gesture.pointerId)) return;
    gesture = null;
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
        const drag = e.target.closest?.('[data-radio-module-drag]');
        const resize = e.target.closest?.('[data-radio-resize]');
        if (resize) {
            e.preventDefault();
            beginGesture('resize', e.pointerId, e.clientX, e.clientY, resize.getAttribute('data-radio-resize'));
            return;
        }
        if (drag && !e.target.closest('button, input, a, select')) {
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
        if (open) applyGeometry(readDialogGeometry());
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
        applyGeometry(saved || defaultGeometry());
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
