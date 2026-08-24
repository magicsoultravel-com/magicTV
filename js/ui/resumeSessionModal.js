/**
 * Post-boot "Jump right back in..." session modal.
 * Lists saved mosaic tiles; user picks one to play or dismisses to browse manually.
 */
import { el } from '../tvUtils.js';
import { loadPlayerState } from '../storage/playerState.js';
import { resolveSavedMosaicMap } from '../mosaic/persist.js';
import { PLAY_FILL_ORDER } from '../mosaic/constants.js';
import { fetchStoredFramesForMosaic, resolveStoredFrameDataUrl, collectFrameLookupKeys } from '../mosaic/frameLookup.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';

let open = false;
/** @type {(() => void) | null} */
let resolveClose = null;
/** @type {Element | null} */
let previousFocus = null;
let bound = false;

/**
 * @returns {{ slotId: string, channelName: string, channelKey: string, isLastActive: boolean }[]}
 */
export function collectSessionTiles() {
    const state = loadPlayerState();
    const mosaic = resolveSavedMosaicMap(state);
    if (!mosaic) return [];

    const lastActive = state.remoteModule?.targetSlotId || 'center';

    return PLAY_FILL_ORDER
        .filter((slotId) => mosaic[slotId]?.key)
        .map((slotId) => ({
            slotId,
            channelName: mosaic[slotId].name || 'Last channel',
            channelKey: mosaic[slotId].key,
            isLastActive: slotId === lastActive
        }));
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
 * @param {{ slotId: string, channelName: string, channelKey: string, isLastActive: boolean }[]} tiles
 * @param {Map<string, string>} [posterMap]
 */
function renderList(tiles, posterMap = new Map()) {
    const countEl = el('resume-session-count');
    const listEl = el('resume-session-list');
    if (!listEl) return;

    const count = tiles.length;
    if (countEl) {
        countEl.textContent = count === 1 ? '1 channel' : `${count} channels`;
    }

    listEl.innerHTML = tiles.map(({ slotId, channelName, channelKey, isLastActive }) => {
        const screenNum = SLOT_SCREEN_LABELS[slotId] || slotId;
        const activeClass = isLastActive ? ' is-last-active' : '';
        const playerPoster = MultiView.slots[slotId]?.player?.posterDataUrl || '';
        const cachedPoster = posterMap.get(channelKey) || '';
        const poster = playerPoster || cachedPoster;
        const initial = channelInitial(channelName);
        const posterHtml = poster
            ? `<img class="resume-session__tile-poster" src="${escapeHtml(poster)}" alt="" decoding="async">`
            : `<img class="resume-session__tile-poster is-hidden" alt="" decoding="async">`;
        const fallbackClass = poster ? ' is-hidden' : '';
        return `<li class="resume-session__item${activeClass}">
            <button type="button" class="resume-session__tile" data-slot-id="${escapeHtml(slotId)}" aria-label="Play TV ${escapeHtml(screenNum)}: ${escapeHtml(channelName)}">
                <span class="resume-session__tile-frame">
                    ${posterHtml}
                    <span class="resume-session__tile-fallback${fallbackClass}" aria-hidden="true">${escapeHtml(initial)}</span>
                    <span class="resume-session__tile-screen">TV ${escapeHtml(screenNum)}</span>
                    <span class="resume-session__tile-name">${escapeHtml(channelName)}</span>
                </span>
            </button>
        </li>`;
    }).join('');
}

async function loadPosters(tiles) {
    const state = loadPlayerState();
    const mosaic = resolveSavedMosaicMap(state) || {};
    try {
        const cached = await fetchStoredFramesForMosaic(mosaic, MultiView.slots);
        const out = new Map();
        for (const tile of tiles) {
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
    const btn = e.target.closest?.('[data-slot-id]');
    if (!btn) return;
    const slotId = btn.getAttribute('data-slot-id');
    if (!slotId) return;
    finishClose();
    try {
        await MultiView.playExclusiveSlot(slotId);
    } catch { /* play errors surfaced by player */ }
}

function bindOnce() {
    if (bound) return;
    bound = true;
    modalEl()?.querySelectorAll('[data-resume-session-dismiss]').forEach((node) => {
        node.addEventListener('click', () => finishClose());
    });
    el('resume-session-list')?.addEventListener('click', onListClick);
}

/** @returns {Promise<void>} */
export function maybeShow() {
    const tiles = collectSessionTiles();
    if (!tiles.length) return Promise.resolve();

    bindOnce();

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

export const ResumeSessionModal = { maybeShow, collectSessionTiles, close: finishClose };
