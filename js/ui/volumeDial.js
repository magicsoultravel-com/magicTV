import { el } from '../tvUtils.js';
import { MultiView } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';

/** Sync full-width remote volume bar to global mosaic volume (one slider, all TVs). */
export function syncVolumeDial() {
    const slider = el('volume-slider');
    const dial = el('volume-dial');
    const pctEl = el('volume-pct');
    const primary = MultiView.getPrimary?.();
    const shared = MultiView.sharedVolume ?? TvPlayer.volume ?? 0.85;
    const muted = primary?.muted === true || shared <= 0;
    const shown = muted ? 0 : shared;
    const pctInt = Math.round(shown * 100);

    if (slider) slider.value = String(pctInt);
    if (pctEl) pctEl.textContent = String(pctInt);
    if (dial) dial.style.setProperty('--volume-fill', String(Math.max(0, Math.min(1, shown))));
}
