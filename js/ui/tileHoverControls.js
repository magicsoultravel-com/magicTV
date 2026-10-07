/** Shared HTML for per-tile hover control rows (local + optional cast). */

export const MUTE_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 4.5H5l3-3v9l-3-3H2.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z" fill="currentColor"/><path class="tile-mute-wave" d="M7 5.5c.5.5.5 1.5 0 2M8 4c1 1 1 3 0 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line class="tile-mute-slash" x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const BROWSE_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><rect x="1.5" y="1.5" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="1.5" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="7" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7" y="7" width="3.5" height="3.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

const SWAP_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M1.5 4h7M6.2 2.2 9.5 4 6.2 5.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 8h-7M5.8 6.2 2.5 8 5.8 9.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Swap arrows + speaker — swap onto main and unmute main. */
export const SWAP_UNMUTE_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path d="M1.2 3.2h5.2M4.6 1.6 7 3.2 4.6 4.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.2 8.8H2M4.6 7.2 2.2 8.8 4.6 10.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 4.2H11.8l3-3v9.6l-3-3H9.2a.5.5 0 0 1-.5-.5V4.7a.5.5 0 0 1 .5-.5z" fill="currentColor"/><path d="M14.2 5.1c.5.5.5 1.5 0 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

export const CAST_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2 16.1V7.9c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v8.2c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 12.5a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 12.5a2 2 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const RESET_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.2 6a3.8 3.8 0 0 1 6.5-2.6M9.8 6a3.8 3.8 0 0 1-6.5 2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.2 1.8v2.2H10.4M3.8 10.2V8H1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Σ on the left, middle chevron pointing right toward the action glyph. */
const ACTION_ALL_SIGMA = 'M6 2H1L4.8 6 1 10H6';

export const MUTE_ALL_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path class="mosaic-mute-all-sigma" d="${ACTION_ALL_SIGMA}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.2 4.2H9.8l3.2-3.2v9.8l-3.2-3.2H7.2a.55.55 0 0 1-.55-.55V4.75a.55.55 0 0 1 .55-.55z" fill="currentColor"/><path class="mosaic-mute-all-wave" d="M12.4 5.1c.55.55.55 1.7 0 2.25M13.7 3.5c1.1 1.1 1.1 3.4 0 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line class="mosaic-mute-all-slash" x1="6.4" y1="1.3" x2="16.2" y2="10.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0"/></svg>`;

/** "1" + down arrow + speaker — mute others, unmute this TV. */
export const MUTE_SOLO_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path d="M2.2 2.2v7.6M1.4 2.2h1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 3.2v5.6M3.8 7.2 5.2 8.8 6.6 7.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.2 4.2H10.8l3.2-3.2v9.8l-3.2-3.2H8.2a.55.55 0 0 1-.55-.55V4.75a.55.55 0 0 1 .55-.55z" fill="currentColor"/><path d="M13.4 5.1c.55.55.55 1.7 0 2.25M14.7 3.5c1.1 1.1 1.1 3.4 0 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const STOP_ALL_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path class="mosaic-stop-all-sigma" d="${ACTION_ALL_SIGMA}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="7.4" y="3.8" width="4.4" height="4.4" fill="currentColor"/></svg>`;

export const PLAY_ALL_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path class="mosaic-stop-all-sigma" d="${ACTION_ALL_SIGMA}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.6 3.2v5.6l5.2-2.8-5.2-2.8z" fill="currentColor"/></svg>`;

export const PAUSE_ALL_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><path class="mosaic-stop-all-sigma" d="${ACTION_ALL_SIGMA}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="8.2" y="2.6" width="1.7" height="6.8" fill="currentColor"/><rect x="11.4" y="2.6" width="1.7" height="6.8" fill="currentColor"/></svg>`;

/** Stop square + play triangle — stop, wait, play same channel. */
export const STOP_PLAY_SVG = `<svg viewBox="0 0 18 12" width="18" height="14" focusable="false" aria-hidden="true"><rect x="1.4" y="2.8" width="5.2" height="6.4" rx="0.6" fill="currentColor"/><path d="M9.2 2.8v6.4l6.2-3.2-6.2-3.2z" fill="currentColor"/></svg>`;

/** Previous channel — curved back arrow. */
export const CHAN_PREV_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M4.2 3.2 2 5.4l2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 5.4h4.6a3.2 3.2 0 0 1 0 6.4H5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** Next channel in history — curved forward arrow. */
export const CHAN_NEXT_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M7.8 3.2 10 5.4 7.8 7.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 5.4H5.2a3.2 3.2 0 0 0 0 6.4H6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const VOL_DOWN_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const VOL_UP_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const CHAN_CHEVRON_UP = `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M2.5 8 6 4l3.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CHAN_CHEVRON_DOWN = `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M2.5 4 6 8l3.5-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const CHAN_BIND_SVG = `<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><path d="M2 3.5h8M2 6h8M2 8.5h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="9.2" cy="8.5" r="1.3" fill="currentColor"/></svg>`;

/** Bank buffer — fill toward headroom (hourglass-ish stack). */
export const BANK_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><path d="M3 2.2h6M3 9.8h6M3.4 2.5 6 6l2.6-3.5M3.4 9.5 6 6l2.6 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 6.8h2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

/** Clock + hop — TV Travel auto-rotate. */
export const TV_TRAVEL_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 2.4v3.2l2.2 1.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.6 3.2 10.6 2.2M10.6 2.2H9M10.6 2.2V3.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const VOL_CHEVRON_UP = CHAN_CHEVRON_UP;
const VOL_CHEVRON_DOWN = CHAN_CHEVRON_DOWN;

export { VOL_CHEVRON_UP, VOL_CHEVRON_DOWN };

const HOST_VIDEO_SVG = `<svg viewBox="0 0 12 12" width="14" height="14" focusable="false" aria-hidden="true"><rect x="1.6" y="2.2" width="8.8" height="6.2" rx="0.7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.2 10.2h3.6M6 8.4v1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function controlBtn(action, label, content, target, extraClass = '') {
    const cls = `tv-controls__btn ${extraClass}`.trim();
    return `<button type="button" class="${cls}" data-tile-action="${action}" data-controls-target="${target}" title="${label}" aria-label="${label}">${content}</button>`;
}

function muteBtn(target) {
    return `<button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-controls__volume-btn is-muted" data-tile-action="mute" data-controls-target="${target}" title="Unmute" aria-label="Unmute" aria-pressed="true">${MUTE_SVG}</button>`;
}

function muteWrap(target) {
    return `<div class="tv-controls__mute-wrap">
        ${muteBtn(target)}
        <div class="tv-controls__mute-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="mute-solo" data-controls-target="${target}" title="Mute other TVs" aria-label="Mute other TVs">${MUTE_SOLO_SVG}</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-2" data-tile-action="mute-all" data-controls-target="${target}" title="Mute all" aria-label="Mute all" aria-pressed="false">${MUTE_ALL_SVG}</button>
        </div>
    </div>`;
}

function playWrap(target) {
    return `<div class="tv-controls__play-wrap">
        ${controlBtn('play', 'Play', '▶', target, 'tv-controls__btn--main-1')}
        <div class="tv-controls__play-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="bank" data-controls-target="${target}" title="Bank buffer" aria-label="Bank buffer" aria-pressed="false">${BANK_SVG}</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-2" data-tile-action="play-all" data-controls-target="${target}" title="Play all" aria-label="Play all">${PLAY_ALL_SVG}</button>
        </div>
    </div>`;
}

function stopWrap(target) {
    return `<div class="tv-controls__stop-wrap">
        ${controlBtn('stop', 'Stop', '⏹', target, 'tv-controls__btn--main-1')}
        <div class="tv-controls__stop-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="stop-play" data-controls-target="${target}" title="Stop &amp; play" aria-label="Stop and play">${STOP_PLAY_SVG}</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-2" data-tile-action="stop-all" data-controls-target="${target}" title="Stop all" aria-label="Stop all">${STOP_ALL_SVG}</button>
        </div>
    </div>`;
}

/** Vertical rocker outside the bottom strip — left mid-height of the tile. */
export function buildTileVolRockerHtml(target = 'local') {
    return `<div class="tv-player-tile__rocker tv-player-tile__vol-rocker" data-tile-vol-rocker>
        <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-player-tile__rocker-btn" data-tile-action="vol-up" data-controls-target="${target}" title="Volume up" aria-label="Volume up">${VOL_UP_SVG}</button>
        <span class="tv-player-tile__rocker-mid tv-player-tile__vol-rocker-pct" data-tile-vol-pct aria-hidden="true">100</span>
        <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-player-tile__rocker-btn" data-tile-action="vol-down" data-controls-target="${target}" title="Volume down" aria-label="Volume down">${VOL_DOWN_SVG}</button>
    </div>`;
}

/** Cast target volume rocker — cast icon above ±/%; shown only while casting this tile. */
export function buildTileCastVolRockerHtml() {
    return `<div class="tv-player-tile__rocker tv-player-tile__vol-rocker tv-player-tile__vol-rocker--cast" data-tile-cast-vol-rocker hidden>
        <span class="tv-player-tile__rocker-cast-icon" title="Cast volume" aria-hidden="true">${CAST_SVG}</span>
        <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-player-tile__rocker-btn" data-tile-action="vol-up" data-controls-target="cast" title="Cast volume up" aria-label="Cast volume up">${VOL_UP_SVG}</button>
        <span class="tv-player-tile__rocker-mid tv-player-tile__vol-rocker-pct" data-tile-cast-vol-pct aria-hidden="true">100</span>
        <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-player-tile__rocker-btn" data-tile-action="vol-down" data-controls-target="cast" title="Cast volume down" aria-label="Cast volume down">${VOL_DOWN_SVG}</button>
    </div>`;
}

function chanDownWrap(target) {
    return `<div class="tv-controls__chan-prev-wrap">
        <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-player-tile__rocker-btn" data-tile-action="chan-down" data-controls-target="${target}" title="Channel down" aria-label="Channel down">${CHAN_CHEVRON_DOWN}</button>
        <div class="tv-controls__chan-prev-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="chan-prev" data-controls-target="${target}" title="Previous channel" aria-label="Previous channel" hidden>${CHAN_PREV_SVG}</button>
        </div>
    </div>`;
}

function chanUpWrap(target) {
    return `<div class="tv-controls__chan-next-wrap">
        <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-player-tile__rocker-btn" data-tile-action="chan-up" data-controls-target="${target}" title="Channel up" aria-label="Channel up">${CHAN_CHEVRON_UP}</button>
        <div class="tv-controls__chan-next-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="chan-next" data-controls-target="${target}" title="Next channel" aria-label="Next channel" hidden>${CHAN_NEXT_SVG}</button>
        </div>
    </div>`;
}

/** Vertical channel rocker — right mid-height of the tile. */
export function buildTileChanRockerHtml(target = 'local') {
    return `<div class="tv-player-tile__rocker tv-player-tile__chan-rocker" data-tile-chan-rocker>
        ${chanUpWrap(target)}
        <div class="tv-player-tile__rocker-mid tv-player-tile__chan-bind-wrap">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-player-tile__rocker-btn tv-player-tile__chan-bind-btn" data-tile-chan-bind-btn title="Bind channels" aria-label="Bind channels" aria-haspopup="menu" aria-expanded="false">${CHAN_BIND_SVG}</button>
            <div class="chan-bind-menu tv-player-tile__chan-bind-menu" role="menu" aria-label="Channel bind scope" hidden></div>
        </div>
        ${chanDownWrap(target)}
    </div>`;
}

/** Refresh vol/chan rocker markup on all mosaic tiles (e.g. after style updates). */
export function syncTileRockers() {
    if (typeof document === 'undefined') return;
    const mosaic = document.getElementById('player-mosaic');
    if (!mosaic) return;

    mosaic.querySelectorAll('.tv-player-tile').forEach((tile) => {
        const hover = tile.querySelector('.tv-player-tile__hover');
        if (!hover) return;

        const castVol = tile.querySelector('[data-tile-cast-vol-rocker]');
        if (castVol) castVol.outerHTML = buildTileCastVolRockerHtml();
        else hover.insertAdjacentHTML('beforebegin', buildTileCastVolRockerHtml());

        const vol = tile.querySelector('[data-tile-vol-rocker]');
        if (vol) vol.outerHTML = buildTileVolRockerHtml('local');
        else hover.insertAdjacentHTML('beforebegin', buildTileVolRockerHtml('local'));

        const chan = tile.querySelector('[data-tile-chan-rocker]');
        if (chan) chan.outerHTML = buildTileChanRockerHtml('local');
        else hover.insertAdjacentHTML('beforebegin', buildTileChanRockerHtml('local'));
    });
}

function castWrap() {
    return `<div class="tv-controls__cast-wrap">
        <button type="button" class="tv-controls__btn tv-controls__btn--main-2 tv-controls__cast-btn" data-tile-action="cast" data-cast-active="false" title="Cast" aria-label="Cast" aria-pressed="false">${CAST_SVG}</button>
        <div class="tv-controls__cast-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-cast-toggle="host-video" title="Video on host PC" aria-label="Video on host PC" aria-pressed="false">${HOST_VIDEO_SVG}</button>
        </div>
    </div>`;
}

/** Multi-TV auto-rotate — hover slide-out with Off / Quick / Slow / Random. */
function travelWrap(target) {
    return `<div class="tv-controls__travel-wrap is-hidden">
        <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-controls__travel-btn" data-tile-action="tv-travel" data-controls-target="${target}" title="TV Travel" aria-label="TV Travel" aria-pressed="false">${TV_TRAVEL_SVG}</button>
        <div class="tv-controls__travel-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-controls__travel-opt" data-tile-action="tv-travel-off" data-controls-target="${target}" title="Off" aria-label="TV Travel off" aria-pressed="false">Off</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1 tv-controls__travel-opt" data-tile-action="tv-travel-quick" data-controls-target="${target}" title="Quick" aria-label="TV Travel quick" aria-pressed="false">Q</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-2 tv-controls__travel-opt" data-tile-action="tv-travel-slow" data-controls-target="${target}" title="Slow" aria-label="TV Travel slow" aria-pressed="false">S</button>
            <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-controls__travel-opt" data-tile-action="tv-travel-random" data-controls-target="${target}" title="Random (Channel switch)" aria-label="TV Travel random" aria-pressed="false">R</button>
        </div>
    </div>`;
}

function coreRowButtons(target) {
    return [
        controlBtn('browse', 'Pick channel', BROWSE_SVG, target, 'tv-controls__btn--main-3'),
        playWrap(target),
        stopWrap(target),
        controlBtn('pip', 'Pop out', '⬆', target, 'tv-controls__btn--main-2'),
        controlBtn('fullscreen', 'Fullscreen', '⛶', target, 'tv-controls__btn--main-2 tv-controls__action-btn'),
        controlBtn('fav', 'Toggle favorite', '☆', target, 'tv-controls__btn--main-3 tv-controls__fav-btn'),
        muteWrap(target),
        travelWrap(target)
    ].join('');
}

function cornerExtras(target) {
    return `<div class="tv-controls__swap-wrap">
        ${controlBtn('swap', 'Swap with main', SWAP_SVG, target, 'tv-controls__btn--main-1')}
        <div class="tv-controls__swap-popout" aria-hidden="true">
            <button type="button" class="tv-controls__btn tv-controls__btn--main-1" data-tile-action="swap-unmute" data-controls-target="${target}" title="Swap &amp; unmute" aria-label="Swap and unmute">${SWAP_UNMUTE_SVG}</button>
        </div>
    </div>`;
}

/**
 * @param {'corner' | 'center'} variant
 * @returns {string}
 */
export function buildTileHoverHtml(variant) {
    const extras = variant === 'center' ? '' : cornerExtras('local');

    return `<div class="tv-controls__row tv-controls__row--cast" data-controls-row="cast" hidden>
        <span class="tv-controls__row-label">CAST</span>
        ${controlBtn('play', 'Play', '▶', 'cast', 'tv-controls__btn--main-1')}
        ${controlBtn('stop', 'Stop', '⏹', 'cast', 'tv-controls__btn--main-1')}
        ${muteBtn('cast')}
    </div>
    <div class="tv-controls__row tv-controls__row--local" data-controls-row="local">
        <span class="tv-controls__row-label tv-controls__row-label--local is-hidden">Local</span>
        ${coreRowButtons('local')}
        ${extras}
        ${castWrap()}
    </div>`;
}

/** Ensure TV Travel wrap exists on already-hydrated tiles (hot reload / upgrades). */
function ensureTravelWraps(mosaic) {
    mosaic.querySelectorAll('.tv-player-tile').forEach((tile) => {
        const row = tile.querySelector('[data-controls-row="local"]');
        if (!row || row.querySelector('.tv-controls__travel-wrap')) return;
        const cast = row.querySelector('.tv-controls__cast-wrap');
        const html = travelWrap('local');
        if (cast) cast.insertAdjacentHTML('beforebegin', html);
        else row.insertAdjacentHTML('beforeend', html);
    });
}

/**
 * Inject dual-row hover controls + outside-strip vol rocker into all mosaic tiles (once).
 */
export function hydrateTileHoverControls() {
    if (typeof document === 'undefined') return;
    const mosaic = document.getElementById('player-mosaic');
    if (!mosaic) return;

    if (mosaic.dataset.hoverHydrated === '1') {
        ensureTravelWraps(mosaic);
        return;
    }
    mosaic.dataset.hoverHydrated = '1';

    mosaic.querySelectorAll('.tv-player-tile').forEach((tile) => {
        const hover = tile.querySelector('.tv-player-tile__hover');
        if (!hover) return;
        const slotId = tile.getAttribute('data-slot');
        const variant = slotId === 'center' ? 'center' : 'corner';
        hover.innerHTML = buildTileHoverHtml(variant);
        syncTileRockers();
    });
}
