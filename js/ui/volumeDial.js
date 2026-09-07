import { el } from '../tvUtils.js';
import { MultiView } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';

function applyDial(sliderId, dialId, pctId, value) {
    const slider = el(sliderId);
    const dial = el(dialId);
    const pctEl = el(pctId);
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    const pctInt = Math.round(clamped * 100);

    if (slider) slider.value = String(pctInt);
    if (pctEl) pctEl.textContent = String(pctInt);
    if (dial) dial.style.setProperty('--volume-fill', String(clamped));
}

/** Sync remote Master dial (shared) + TV dial (focused slot gain). */
export function syncVolumeDial(state) {
    const master = state?.volume ?? MultiView.sharedVolume ?? TvPlayer.volume ?? 0.85;
    const masterPct = Math.round(Math.max(0, Math.min(1, Number(master) || 0)) * 100);
    applyDial('volume-slider', 'volume-dial', 'volume-pct', master);

    const slotId = MultiView.statusSlotId || 'center';
    const slotVol = MultiView.slots?.[slotId]?.player?.volume;
    const tvVol = Number.isFinite(slotVol) ? slotVol : 1;
    const tvPct = Math.round(Math.max(0, Math.min(1, tvVol)) * 100);
    applyDial('tv-volume-slider', 'tv-volume-dial', 'tv-volume-pct', tvVol);

    // Mute rocker sits with TV vol± — show focused-TV %.
    const mutePct = el('remote-mute-vol-pct');
    if (mutePct) mutePct.textContent = String(tvPct);

    // Mute-all sits with mosaic controls — show master %.
    const muteAllPct = el('remote-mute-all-vol-pct');
    if (muteAllPct) muteAllPct.textContent = String(masterPct);
}
