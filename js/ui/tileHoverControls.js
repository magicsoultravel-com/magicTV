/** Shared HTML for per-tile hover control rows (local + optional cast). */

export const MUTE_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 4.5H5l3-3v9l-3-3H2.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z" fill="currentColor"/><path class="tile-mute-wave" d="M7 5.5c.5.5.5 1.5 0 2M8 4c1 1 1 3 0 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line class="tile-mute-slash" x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const BROWSE_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><rect x="1.5" y="1.5" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="1.5" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="7" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="7" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

const SWAP_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M1.5 4h7M6.2 2.2 9.5 4 6.2 5.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 8h-7M5.8 6.2 2.5 8 5.8 9.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const CAST_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2 16.1V7.9c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v8.2c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 12.5a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 12.5a2 2 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const RESET_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.2 6a3.8 3.8 0 0 1 6.5-2.6M9.8 6a3.8 3.8 0 0 1-6.5 2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.2 1.8v2.2H10.4M3.8 10.2V8H1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const MUTE_ALL_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path d="M1 2h5L2.2 6 6 10H1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.2 4.2H9.8l3.2-3.2v9.8l-3.2-3.2H7.2a.55.55 0 0 1-.55-.55V4.75a.55.55 0 0 1 .55-.55z" fill="currentColor"/><path class="mosaic-mute-all-wave" d="M12.4 5.1c.55.55.55 1.7 0 2.25M13.7 3.5c1.1 1.1 1.1 3.4 0 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line class="mosaic-mute-all-slash" x1="6.4" y1="1.3" x2="16.2" y2="10.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0"/></svg>`;

export const VOL_DOWN_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const VOL_UP_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const HOST_VIDEO_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><rect x="1.6" y="2.2" width="8.8" height="6.2" rx="0.7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.2 10.2h3.6M6 8.4v1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function controlBtn(action, label, content, target, extraClass = '') {
    const cls = `tv-controls__btn ${extraClass}`.trim();
    return `<button type="button" class="${cls}" data-tile-action="${action}" data-controls-target="${target}" title="${label}" aria-label="${label}">${content}</button>`;
}

function muteBtn(target) {
    return `<button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-controls__volume-btn is-muted" data-tile-action="mute" data-controls-target="${target}" title="Unmute" aria-label="Unmute" aria-pressed="true">${MUTE_SVG}</button>`;
}

function castWrap() {
    return `<div class="tv-controls__cast-wrap">
        <button type="button" class="tv-controls__btn tv-controls__btn--main-2 tv-controls__cast-btn" data-tile-action="cast" data-cast-active="false" title="Cast" aria-label="Cast" aria-pressed="false">${CAST_SVG}</button>
        <div class="tv-controls__cast-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-cast-toggle="host-video" title="Video on host PC" aria-label="Video on host PC" aria-pressed="false">${HOST_VIDEO_SVG}</button>
        </div>
    </div>`;
}

function coreRowButtons(target) {
    return [
        controlBtn('browse', 'Pick channel', BROWSE_SVG, target, 'tv-controls__btn--main-3'),
        controlBtn('play', 'Play', '▶', target, 'tv-controls__btn--main-1'),
        controlBtn('stop', 'Stop', '⏹', target, 'tv-controls__btn--main-1'),
        controlBtn('pip', 'Pop out', '⬆', target, 'tv-controls__btn--main-2'),
        controlBtn('fullscreen', 'Fullscreen', '⛶', target, 'tv-controls__btn--main-2 tv-controls__action-btn'),
        controlBtn('fav', 'Toggle favorite', '☆', target, 'tv-controls__btn--main-3 tv-controls__fav-btn'),
        muteBtn(target)
    ].join('');
}

function cornerExtras(target) {
    return controlBtn('swap', 'Swap with main', SWAP_SVG, target, 'tv-controls__btn--main-1');
}

function centerExtras(target) {
    return [
        `<button type="button" class="tv-controls__btn tv-controls__btn--main-2 mosaic-reset-btn is-hidden" id="mosaic-reset-btn" data-tile-action="reset" data-controls-target="${target}" title="Reset multi-TV layout" aria-label="Reset multi-TV layout" hidden>${RESET_SVG}</button>`,
        `<button type="button" class="tv-controls__btn tv-controls__btn--main-2 tv-controls__volume-btn" id="mosaic-mute-all-btn" data-tile-action="mute-all" data-controls-target="${target}" title="Mute all" aria-label="Mute all" aria-pressed="false">${MUTE_ALL_SVG}</button>`
    ].join('');
}

/**
 * @param {'corner' | 'center'} variant
 * @returns {string}
 */
export function buildTileHoverHtml(variant) {
    const extras = variant === 'center' ? centerExtras('local') : cornerExtras('local');

    return `<div class="tv-controls__row tv-controls__row--cast" data-controls-row="cast" hidden>
        <span class="tv-controls__row-label">CAST</span>
        ${controlBtn('play', 'Play', '▶', 'cast', 'tv-controls__btn--main-1')}
        ${controlBtn('stop', 'Stop', '⏹', 'cast', 'tv-controls__btn--main-1')}
        ${muteBtn('cast')}
        ${controlBtn('cast-vol-down', 'Volume down', VOL_DOWN_SVG, 'cast', 'tv-controls__btn--main-1')}
        ${controlBtn('cast-vol-up', 'Volume up', VOL_UP_SVG, 'cast', 'tv-controls__btn--main-1')}
    </div>
    <div class="tv-controls__row tv-controls__row--local" data-controls-row="local">
        <span class="tv-controls__row-label tv-controls__row-label--local is-hidden">Local</span>
        ${coreRowButtons('local')}
        ${extras}
        ${castWrap()}
    </div>`;
}

/**
 * Inject dual-row hover controls into all mosaic tiles (once).
 */
export function hydrateTileHoverControls() {
    if (typeof document === 'undefined') return;
    const mosaic = document.getElementById('player-mosaic');
    if (!mosaic || mosaic.dataset.hoverHydrated === '1') return;
    mosaic.dataset.hoverHydrated = '1';

    mosaic.querySelectorAll('.tv-player-tile').forEach((tile) => {
        const hover = tile.querySelector('.tv-player-tile__hover');
        if (!hover) return;
        const slotId = tile.getAttribute('data-slot');
        const variant = slotId === 'center' ? 'center' : 'corner';
        hover.innerHTML = buildTileHoverHtml(variant);
    });
}
