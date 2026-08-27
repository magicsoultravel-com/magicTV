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
    applyDial('volume-slider', 'volume-dial', 'volume-pct', master);

    const slotId = MultiView.statusSlotId || 'center';
    const slotVol = MultiView.slots?.[slotId]?.player?.volume;
    applyDial('tv-volume-slider', 'tv-volume-dial', 'tv-volume-pct', Number.isFinite(slotVol) ? slotVol : 1);
}
