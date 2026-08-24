/** Per-TV mini controls on the bottom screen-switcher strip (mute / play / stop). */

import { ACTION_ICONS } from './icons.js';
import { MUTE_SVG } from './tileHoverControls.js';

const MUTE_SVG_SMALL = MUTE_SVG.replace('width="14" height="14"', 'width="8" height="8"');
const PLAY_SVG_SMALL = ACTION_ICONS.play.replace('width="12" height="12"', 'width="8" height="8"');
const PAUSE_SVG_SMALL = ACTION_ICONS.pause.replace('width="12" height="12"', 'width="8" height="8"');
const STOP_SVG_SMALL = ACTION_ICONS.stop.replace('width="12" height="12"', 'width="8" height="8"');

function screenActionBtn(action, label, content) {
    return `<button type="button" class="tv-controls__screen-action tv-controls__screen-action--${action}" data-screen-action="${action}" title="${label}" aria-label="${label}">${content}</button>`;
}

/** Inject mute / play / stop chips into a screen-strip TV button (once). */
export function hydrateScreenBtnActions(btn) {
    if (!btn || btn.dataset.actionsHydrated === '1') return;
    btn.dataset.actionsHydrated = '1';
    btn.insertAdjacentHTML('beforeend', [
        screenActionBtn('mute', 'Unmute', MUTE_SVG_SMALL),
        screenActionBtn('play', 'Play', PLAY_SVG_SMALL),
        screenActionBtn('stop', 'Stop', STOP_SVG_SMALL)
    ].join(''));
}

/**
 * Sync mini control labels/icons to a slot player.
 * @param {HTMLElement} btn
 * @param {object|null} player
 * @param {{ intentPlaying: boolean, isMuted: boolean }} state
 */
export function syncScreenBtnActions(btn, player, { intentPlaying, isMuted }) {
    hydrateScreenBtnActions(btn);

    const muteBtn = btn.querySelector('[data-screen-action="mute"]');
    const playBtn = btn.querySelector('[data-screen-action="play"]');
    const stopBtn = btn.querySelector('[data-screen-action="stop"]');

    if (muteBtn) {
        muteBtn.classList.toggle('is-muted', isMuted);
        muteBtn.setAttribute('aria-pressed', String(isMuted));
        muteBtn.title = isMuted ? 'Unmute' : 'Mute';
        muteBtn.setAttribute('aria-label', muteBtn.title);
        const wave = muteBtn.querySelector('.tile-mute-wave');
        const slash = muteBtn.querySelector('.tile-mute-slash');
        if (wave) wave.style.opacity = isMuted ? '0' : '1';
        if (slash) slash.style.opacity = isMuted ? '1' : '0';
    }

    if (playBtn) {
        playBtn.innerHTML = intentPlaying ? PAUSE_SVG_SMALL : PLAY_SVG_SMALL;
        playBtn.title = intentPlaying ? 'Pause' : 'Play';
        playBtn.setAttribute('aria-label', playBtn.title);
        playBtn.disabled = !player?.channel;
    }

    if (stopBtn) {
        stopBtn.disabled = !player?.channel;
    }
}
