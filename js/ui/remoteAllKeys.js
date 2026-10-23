/**
 * Remote "all" keys — Play all ⇄ Pause all (one morphing key), Stop all, Mute all.
 *
 * The full remote renders dedicated mosaic keys (`#remote-play-all-btn`,
 * `#remote-stop-all-btn`, `#remote-mute-all-btn`) in the keypad grid, while the
 * mini floating remote keeps the same three actions inside its hover fly-outs
 * (`#remote-*-all-btn-mini`). Both carry `data-remote-all` (and the mute-all
 * volume percentage carries `data-remote-all-pct`), so a single sync pass keeps
 * every surface — including the OS popout document — in step.
 */
import { queryAllInApp } from '../tvUtils.js';
import { PLAY_ALL_SVG, PAUSE_ALL_SVG } from './tileHoverControls.js';

/** All buttons for one "all" action, across app documents. */
export function remoteAllKeys(kind) {
    if (!kind) return [];
    return queryAllInApp(`[data-remote-all="${kind}"]`);
}

/** Apply mute-all state to one button (remote keys + tile-chrome popout keys). */
export function applyMuteAllTo(btn, active) {
    const muted = active === true;
    const label = muted ? 'Unmute all' : 'Mute all';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(muted));
    const wave = btn.querySelector('.mosaic-mute-all-wave, .remote-mute-all-wave');
    const slash = btn.querySelector('.mosaic-mute-all-slash, .remote-mute-all-slash');
    if (wave) wave.style.opacity = muted ? '0' : '1';
    if (slash) slash.setAttribute('opacity', muted ? '1' : '0');
}

/** Mute all ⇄ Unmute all for every remote key (full remote + mini fly-out). */
export function syncMuteAllKeys(active) {
    remoteAllKeys('mute').forEach((btn) => applyMuteAllTo(btn, active));
}

/** Play all ⇄ Pause all — the key morphs to Pause all while everything plays. */
export function syncPlayAllKeys(allPlaying) {
    const isPause = allPlaying === true;
    const label = isPause ? 'Pause all' : 'Play all';
    remoteAllKeys('play').forEach((btn) => {
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', String(isPause));
        btn.innerHTML = isPause ? PAUSE_ALL_SVG : PLAY_ALL_SVG;
    });
}

/** Stop all — hidden/disabled unless at least one TV is playing. */
export function syncStopAllKeys(anyPlaying) {
    const active = anyPlaying === true;
    remoteAllKeys('stop').forEach((btn) => {
        btn.title = 'Stop all';
        btn.setAttribute('aria-label', 'Stop all');
        btn.classList.toggle('is-hidden', !active);
        btn.setAttribute('aria-disabled', String(!active));
        btn.setAttribute('aria-pressed', String(active));
    });
}

/** Master volume percentage shown inside the mute-all keys. */
export function setMuteAllPct(pct) {
    const text = String(Math.round(Number(pct) || 0));
    queryAllInApp('[data-remote-all-pct="mute"]').forEach((node) => {
        node.textContent = text;
    });
}
