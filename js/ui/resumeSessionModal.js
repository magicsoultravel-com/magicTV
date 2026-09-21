/**
 * Post-boot "Jump right back in..." session modal.
 * Lists saved mosaic tiles; user picks one to play or dismisses to browse manually.
 */
import { el } from '../tvUtils.js';
import { loadPlayerState } from '../storage/playerState.js';
import { resolveSavedMosaicMap } from '../mosaic/persist.js';
import { PLAY_FILL_ORDER, slotOutlineAccent, slotOutlineIntensity } from '../mosaic/constants.js';
import { fetchStoredFramesForMosaic, resolveStoredFrameDataUrl, collectFrameLookupKeys } from '../mosaic/frameLookup.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';
import { applyMarquee, marqueeInnerHtml } from './marquee.js';
import { tvLabelAccentChars, chanNumberAccentHtml, buildChannelIndex } from '../channelNav.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { RemoteModule } from './remoteModule.js';

let open = false;
/** @type {(() => void) | null} */
let resolveClose = null;
/** @type {Element | null} */
let previousFocus = null;
let bound = false;
/** @type {{ kind: 'tab', tab: string } | { kind: 'action', action: string } | null} */
let pendingShortcut = null;

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
 * @param {{ slotId: string, channelName: string, channelKey: string, isLastActive: boolean }[]} tiles
 * @param {Map<string, string>} [posterMap]
 */
function renderList(tiles, posterMap = new Map()) {
    const listEl = el('resume-session-list');
    if (!listEl) return;

    /** @type {Map<string, Map<string, number>>} */
    const numbersByScope = new Map();
    const numbersForScope = (scope) => {
        const scopeKey = scope?.mode === 'folder' ? `folder:${scope.folderId}` : 'favorites';
        let map = numbersByScope.get(scopeKey);
        if (!map) {
            map = buildChannelIndex(scope || { mode: 'favorites' }).numberByKey;
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

    listEl.innerHTML = tiles.map(({ slotId, channelName, channelKey, isLastActive }) => {
        const screenNum = SLOT_SCREEN_LABELS[slotId] || slotId;
        const accent = slotOutlineAccent(slotId);
        const intensity = slotOutlineIntensity(slotId);
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
            <button type="button" class="resume-session__tile" data-slot-id="${escapeHtml(slotId)}" data-outline-accent="${accent}" data-outline-intensity="${intensity}" aria-label="Play TV ${escapeHtml(screenNum)}: ${escapeHtml(channelName)}">
                <span class="resume-session__tile-frame">
                    ${posterHtml}
                    <span class="resume-session__tile-fallback${fallbackClass}" aria-hidden="true">${escapeHtml(initial)}</span>
                    <span class="resume-session__tile-screen" aria-hidden="true">${tvLabelHtml}</span>
                    <span class="resume-session__tile-name">${chanNumHtml}<span class="resume-session__tile-name-text">${marqueeInnerHtml(channelName)}</span></span>
                </span>
            </button>
        </li>`;
    }).join('');
    applyMarquee(listEl);
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
