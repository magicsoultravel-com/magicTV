/**
 * Post-boot "Jump right back in..." session modal.
 * Lists saved mosaic tiles (and radio cassette when enabled); user picks one to play or dismisses.
 */
import { el, countryFlagEmoji } from '../tvUtils.js';
import { loadPlayerState } from '../storage/playerState.js';
import { resolveSavedMosaicMap } from '../mosaic/persist.js';
import { PLAY_FILL_ORDER, slotOutlineAccent } from '../mosaic/constants.js';
import { fetchStoredFramesForMosaic, resolveStoredFrameDataUrl, collectFrameLookupKeys } from '../mosaic/frameLookup.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';
import { applyMarquee, marqueeInnerHtml } from './marquee.js';
import { tvLabelAccentChars, chanNumberAccentHtml, channelIndexForScope, bindScopeCacheKey } from '../channelNav.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { RemoteModule } from './remoteModule.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { loadRadioState } from '../radio/radioState.js';

let open = false;
/** @type {(() => void) | null} */
let resolveClose = null;
/** @type {Element | null} */
let previousFocus = null;
let bound = false;
/** @type {{ kind: 'tab', tab: string } | { kind: 'action', action: string } | null} */
let pendingShortcut = null;

/** Compact cassette SVG matching #radio-module (viewBox 120×70). */
const RESUME_CASSETTE_SVG = `<svg viewBox="0 0 120 70" focusable="false" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect class="radio-module__cassette-body" x="4" y="6" width="112" height="56" rx="5" fill="none" stroke-width="1.2"/>
    <rect class="radio-module__cassette-label" x="18" y="10" width="84" height="13" rx="2" fill="none" stroke-width="1"/>
    <rect class="radio-module__cassette-window" x="28" y="28" width="64" height="16" rx="2" fill="none" stroke-width="1"/>
    <g class="radio-module__cassette-reel">
        <circle class="radio-module__cassette-reel-disc" cx="40" cy="36" r="7.5"/>
        <path class="radio-module__cassette-reel-teeth" d="M40 28.5v2.8M46.6 30.9l-2 2M47.5 36h-2.8M46.6 41.1l-2-2M40 43.5v-2.8M33.4 41.1l2-2M32.5 36h2.8M33.4 30.9l2 2"/>
        <circle class="radio-module__cassette-reel-hub-shade" cx="40.85" cy="36.85" r="3.1"/>
        <circle class="radio-module__cassette-reel-hub" cx="40" cy="36" r="2.85"/>
        <circle class="radio-module__cassette-reel-hub-shine" cx="39.05" cy="35.05" r="1.35"/>
        <circle class="radio-module__cassette-reel-bolt" cx="40" cy="36" r="1"/>
    </g>
    <g class="radio-module__cassette-reel radio-module__cassette-reel--right">
        <circle class="radio-module__cassette-reel-disc" cx="80" cy="36" r="7.5"/>
        <path class="radio-module__cassette-reel-teeth" d="M80 28.5v2.8M86.6 30.9l-2 2M87.5 36h-2.8M86.6 41.1l-2-2M80 43.5v-2.8M73.4 41.1l2-2M72.5 36h2.8M73.4 30.9l2 2"/>
        <circle class="radio-module__cassette-reel-hub-shade" cx="80.85" cy="36.85" r="3.1"/>
        <circle class="radio-module__cassette-reel-hub" cx="80" cy="36" r="2.85"/>
        <circle class="radio-module__cassette-reel-hub-shine" cx="79.05" cy="35.05" r="1.35"/>
        <circle class="radio-module__cassette-reel-bolt" cx="80" cy="36" r="1"/>
    </g>
</svg>`;

const RESUME_CASSETTE_ART_FALLBACK = `<span class="radio-module__art-fallback" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="8" width="14" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="16" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>`;

/**
 * @typedef {{ kind?: 'tv', slotId: string, channelName: string, channelKey: string, isLastActive: boolean }} TvResumeTile
 * @typedef {{ kind: 'radio', stationKey: string, stationName: string, favicon: string, countrycode: string }} RadioResumeTile
 * @typedef {TvResumeTile | RadioResumeTile} ResumeTile
 */

/**
 * @returns {ResumeTile[]}
 */
export function collectSessionTiles() {
    const state = loadPlayerState();
    const mosaic = resolveSavedMosaicMap(state);
    const lastActive = state.remoteModule?.targetSlotId || 'center';

    /** @type {ResumeTile[]} */
    const tiles = mosaic
        ? PLAY_FILL_ORDER
            .filter((slotId) => mosaic[slotId]?.key)
            .map((slotId) => ({
                kind: 'tv',
                slotId,
                channelName: mosaic[slotId].name || 'Last channel',
                channelKey: mosaic[slotId].key,
                isLastActive: slotId === lastActive
            }))
        : [];

    if (SettingsStore.getRadioEnabled() === true) {
        const radio = loadRadioState();
        if (radio.lastStationKey) {
            tiles.push({
                kind: 'radio',
                stationKey: radio.lastStationKey,
                stationName: radio.lastStationName || 'Last station',
                favicon: radio.lastStationFavicon || '',
                countrycode: radio.lastStationCountrycode || ''
            });
        }
    }

    return tiles;
}

function modalEl() {
    return el('resume-session-modal');
}

function dialogEl() {
    return el('resume-session-dialog');
}

function showModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-resume-session');
    try {
        RemoteModule.ensureCollapsedDockTab?.();
    } catch { /* remote may not be ready in tests */ }
}

function hideModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-resume-session');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function channelInitial(name) {
    const trimmed = String(name || '').trim();
    return (trimmed[0] || '?').toUpperCase();
}

/**
 * @param {RadioResumeTile} tile
 */
function renderRadioTileHtml(tile) {
    const name = tile.stationName || 'Last station';
    const flag = tile.countrycode ? countryFlagEmoji(tile.countrycode) : '';
    const artHtml = tile.favicon
        ? `<img src="${escapeHtml(tile.favicon)}" alt="" loading="lazy">`
        : RESUME_CASSETTE_ART_FALLBACK;
    return `<li class="resume-session__item resume-session__item--radio">
        <button type="button" class="resume-session__tile resume-session__tile--radio" data-resume-kind="radio" data-outline-accent="2" aria-label="Play radio: ${escapeHtml(name)}">
            <span class="resume-session__tile-frame resume-session__tile-frame--cassette">
                <span class="resume-session__cassette">
                    ${RESUME_CASSETTE_SVG}
                    <span class="resume-session__cassette-label">
                        <span class="resume-session__cassette-leading">
                            <span class="tv-header-channel-flag" aria-hidden="true">${escapeHtml(flag)}</span>
                            <span class="radio-module__art" aria-hidden="true">${artHtml}</span>
                        </span>
                        <span class="resume-session__cassette-title tv-header-now-playing marquee" title="${escapeHtml(name)}">${marqueeInnerHtml(name)}</span>
                        <span class="resume-session__cassette-balance" aria-hidden="true"></span>
                    </span>
                </span>
            </span>
        </button>
    </li>`;
}

/**
 * @param {TvResumeTile} tile
 * @param {Map<string, string>} posterMap
 * @param {(slotId: string, key: string) => number | null} resolveChanNum
 */
function renderTvTileHtml(tile, posterMap, resolveChanNum) {
    const { slotId, channelName, channelKey, isLastActive } = tile;
    const screenNum = SLOT_SCREEN_LABELS[slotId] || slotId;
    const accent = slotOutlineAccent(slotId);
    const activeClass = isLastActive ? ' is-last-active' : '';
    const playerPoster = MultiView.slots[slotId]?.player?.posterDataUrl || '';
    const cachedPoster = posterMap.get(channelKey) || '';
    const poster = playerPoster || cachedPoster;
    const initial = channelInitial(channelName);
    const posterHtml = poster
        ? `<img class="resume-session__tile-poster" src="${escapeHtml(poster)}" alt="" decoding="async">`
        : `<img class="resume-session__tile-poster is-hidden" alt="" decoding="async">`;
    const fallbackClass = poster ? ' is-hidden' : '';
    const tvLabelHtml = tvLabelAccentChars(screenNum)
        .map(({ char, accent: a }) => `<span data-accent="${a}">${escapeHtml(char)}</span>`)
        .join('');
    const chanNum = resolveChanNum(slotId, channelKey);
    const chanNumHtml = Number.isFinite(chanNum)
        ? `<span class="resume-session__tile-chan-num" aria-hidden="true">${chanNumberAccentHtml(chanNum)}</span>`
        : '';
    return `<li class="resume-session__item${activeClass}">
        <button type="button" class="resume-session__tile" data-slot-id="${escapeHtml(slotId)}" data-outline-accent="${accent}" aria-label="Play TV ${escapeHtml(screenNum)}: ${escapeHtml(channelName)}">
            <span class="resume-session__tile-frame">
                ${posterHtml}
                <span class="resume-session__tile-fallback${fallbackClass}" aria-hidden="true">${escapeHtml(initial)}</span>
                <span class="resume-session__tile-screen" aria-hidden="true">${tvLabelHtml}</span>
                <span class="resume-session__tile-name">${chanNumHtml}<span class="resume-session__tile-name-text">${marqueeInnerHtml(channelName)}</span></span>
            </span>
        </button>
    </li>`;
}

/**
 * @param {ResumeTile[]} tiles
 * @param {Map<string, string>} [posterMap]
 */
function renderList(tiles, posterMap = new Map()) {
    const listEl = el('resume-session-list');
    if (!listEl) return;

    /** @type {Map<string, Map<string, number>>} */
    const numbersByScope = new Map();
    const numbersForScope = (scope) => {
        const scopeKey = bindScopeCacheKey(scope);
        let map = numbersByScope.get(scopeKey);
        if (!map) {
            map = channelIndexForScope(scope || { mode: 'favorites' }).numberByKey;
            numbersByScope.set(scopeKey, map);
        }
        return map;
    };
    const resolveChanNum = (slotId, key) => {
        if (!key) return null;
        const scoped = numbersForScope(FavoritesRecents.getChanBindScope(slotId)).get(key);
        if (Number.isFinite(scoped)) return scoped;
        const allFavs = numbersForScope({ mode: 'favorites' }).get(key);
        return Number.isFinite(allFavs) ? allFavs : null;
    };

    listEl.innerHTML = tiles.map((tile) => {
        if (tile.kind === 'radio') return renderRadioTileHtml(tile);
        return renderTvTileHtml(tile, posterMap, resolveChanNum);
    }).join('');
    applyMarquee(listEl);
}

/**
 * @param {ResumeTile[]} tiles
 */
async function loadPosters(tiles) {
    const tvTiles = tiles.filter((t) => t.kind !== 'radio');
    if (!tvTiles.length) return new Map();

    const state = loadPlayerState();
    const mosaic = resolveSavedMosaicMap(state) || {};
    try {
        const cached = await fetchStoredFramesForMosaic(mosaic, MultiView.slots);
        const out = new Map();
        for (const tile of tvTiles) {
            const playerPoster = MultiView.slots[tile.slotId]?.player?.posterDataUrl || '';
            if (playerPoster) {
                out.set(tile.channelKey, playerPoster);
                continue;
            }
            const entry = mosaic[tile.slotId];
            const lookupKeys = collectFrameLookupKeys(entry, MultiView.slots[tile.slotId]?.player?.channel);
            const dataUrl = resolveStoredFrameDataUrl(
                tile.channelKey,
                lookupKeys,
                cached.posterMap,
                cached.frameMap
            );
            if (dataUrl) out.set(tile.channelKey, dataUrl);
        }
        return out;
    } catch {
        return new Map();
    }
}

function finishClose() {
    if (!open) return;
    open = false;
    hideModal();
    document.removeEventListener('keydown', onKeydown);
    if (resolveClose) {
        resolveClose();
        resolveClose = null;
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
        try {
            previousFocus.focus();
        } catch { /* ignore */ }
    }
    previousFocus = null;
}

function onKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    finishClose();
}

async function onListClick(e) {
    const radioBtn = e.target.closest?.('[data-resume-kind="radio"]');
    if (radioBtn) {
        finishClose();
        try {
            await MultiView.focusRadio();
        } catch { /* play errors surfaced by player */ }
        return;
    }

    const btn = e.target.closest?.('[data-slot-id]');
    if (!btn) return;
    const slotId = btn.getAttribute('data-slot-id');
    if (!slotId) return;
    finishClose();
    try {
        await MultiView.playExclusiveSlot(slotId);
    } catch { /* play errors surfaced by player */ }
}

async function onShortcutClick(e) {
    const btn = e.target.closest?.('[data-remote-action], [data-remote-nav]');
    if (!btn || !el('resume-session-shortcuts')?.contains(btn)) return;

    const action = btn.getAttribute('data-remote-action');
    const tab = btn.getAttribute('data-remote-nav');
    // Stash intent for app boot to apply AFTER RemoteModule.restoreOpenIfNeeded(),
    // which would otherwise force tab back to "remote".
    if (tab) pendingShortcut = { kind: 'tab', tab };
    else if (action) pendingShortcut = { kind: 'action', action };
    else pendingShortcut = null;
    finishClose();
}

function bindOnce() {
    if (bound) return;
    bound = true;
    modalEl()?.querySelectorAll('[data-resume-session-dismiss]').forEach((node) => {
        node.addEventListener('click', () => finishClose());
    });
    el('resume-session-list')?.addEventListener('click', onListClick);
    el('resume-session-shortcuts')?.addEventListener('click', onShortcutClick);
}

/**
 * Consume a welcome-shortcut destination chosen before the modal closed.
 * @returns {{ kind: 'tab', tab: string } | { kind: 'action', action: string } | null}
 */
export function takePendingShortcut() {
    const next = pendingShortcut;
    pendingShortcut = null;
    return next;
}

/** @returns {Promise<void>} */
export function maybeShow() {
    const tiles = collectSessionTiles();
    if (!tiles.length) return Promise.resolve();

    bindOnce();
    pendingShortcut = null;

    return new Promise((resolve) => {
        resolveClose = resolve;
        open = true;
        previousFocus = document.activeElement;
        renderList(tiles, new Map());
        showModal();
        dialogEl()?.focus();
        document.addEventListener('keydown', onKeydown);

        loadPosters(tiles).then((posterMap) => {
            if (!open) return;
            renderList(tiles, posterMap);
        }).catch(() => {});
    });
}

export const ResumeSessionModal = {
    maybeShow,
    collectSessionTiles,
    close: finishClose,
    takePendingShortcut
};
