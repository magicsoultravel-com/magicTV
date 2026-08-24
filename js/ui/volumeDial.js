import { el } from '../tvUtils.js';
import { MultiView } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';

/** Sync full-width remote volume bar to global mosaic volume (one slider, all TVs). */
export function syncVolumeDial(state) {
    const slider = el('volume-slider');
    const dial = el('volume-dial');
    const pctEl = el('volume-pct');
    const raw = state?.volume ?? MultiView.sharedVolume ?? TvPlayer.volume ?? 0.85;
    const clamped = Math.max(0, Math.min(1, Number(raw) || 0));
    const pctInt = Math.round(clamped * 100);

    if (slider) slider.value = String(pctInt);
    if (pctEl) pctEl.textContent = String(pctInt);
    if (dial) dial.style.setProperty('--volume-fill', String(clamped));
}
