/**
 * YouTube picker overlay — paste-a-link + saved clip library for one mosaic tile.
 *
 * Opened from the per-tile YouTube chrome button:
 *   YouTubePicker.open({ slotId, start: (videoId, meta) => Promise<boolean> })
 */
import { el } from '../tvUtils.js';
import { normalizeYouTubeId, youtubeThumbUrl } from '../youtube/youtubeLinks.js';
import {
    addYouTubeClip,
    fetchYouTubeMeta,
    listYouTubeClips,
    removeYouTubeClip
} from '../youtube/youtubeLibrary.js';
import { SLOT_SCREEN_LABELS } from '../mosaic/constants.js';

let bound = false;
let openedSlotId = 'center';
/** @type {((videoId: string, meta: object | null) => any) | null} */
let startHandler = null;
let busy = false;
/** @type {Element | null} */
let previousFocus = null;

function modalEl() { return el('youtube-picker'); }
function dialogEl() { return el('youtube-picker-dialog'); }
function inputEl() { return el('youtube-picker-input'); }
function listEl() { return el('youtube-picker-list'); }
function emptyEl() { return el('youtube-picker-empty'); }
function errorEl() { return el('youtube-picker-error'); }
function addBtn() { return el('youtube-picker-add'); }

function setError(message) {
    const box = errorEl();
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('is-hidden', !message);
}

function show() {
    const modal = modalEl();
    if (!modal) return;
    try {
        previousFocus = typeof document !== 'undefined' ? document.activeElement : null;
    } catch {
        previousFocus = null;
    }
    modal.hidden = false;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const title = el('youtube-picker-title');
    if (title) {
        const label = SLOT_SCREEN_LABELS[openedSlotId] || 'this TV';
        title.textContent = `YouTube on TV ${label}`;
    }
    try {
        inputEl()?.focus?.();
    } catch { /* ignore */ }
}

function hide() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    startHandler = null;
    setError('');
    if (busy) {
        busy = false;
        const button = addBtn();
        if (button) button.disabled = false;
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus(); } catch { /* ignore */ }
    }
    previousFocus = null;
}

function clipButton(clip) {
    const item = document.createElement('li');
    item.className = 'youtube-picker__item';

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'youtube-picker__pick';
    pickBtn.dataset.youtubePick = clip.videoId;
    pickBtn.title = clip.title;

    const thumb = document.createElement('img');
    thumb.className = 'youtube-picker__thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.alt = '';
    thumb.src = clip.thumb || youtubeThumbUrl(clip.videoId);
    thumb.addEventListener('error', () => {
        thumb.src = youtubeThumbUrl(clip.videoId, 'hqdefault');
    }, { once: true });

    const clipTitle = document.createElement('span');
    clipTitle.className = 'youtube-picker__clip-title';
    clipTitle.textContent = clip.title;

    pickBtn.append(thumb, clipTitle);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'youtube-picker__remove';
    remove.dataset.youtubeRemove = clip.videoId;
    remove.title = 'Remove from library';
    remove.setAttribute('aria-label', `Remove ${clip.title} from library`);
    remove.textContent = '×';

    item.append(pickBtn, remove);
    return item;
}

function renderList() {
    const list = listEl();
    const empty = emptyEl();
    if (!list) return;
    const clips = listYouTubeClips();
    list.replaceChildren(...clips.map(clipButton));
    empty?.classList.toggle('is-hidden', clips.length > 0);
}

function metaFor(videoId) {
    return listYouTubeClips().find((clip) => clip.videoId === videoId) || null;
}

function pick(videoId, meta = null) {
    const id = normalizeYouTubeId(videoId);
    if (!id) {
        setError('That doesn’t look like a YouTube link or id');
        return;
    }
    const start = startHandler;
    hide();
    try {
        const result = start?.(id, meta || metaFor(id));
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* ignore */ }
}

async function submitInput(event) {
    event?.preventDefault?.();
    if (busy) return;
    const input = inputEl();
    const raw = input?.value?.trim() || '';
    const videoId = normalizeYouTubeId(raw);
    if (!videoId) {
        setError('Paste a youtube.com / youtu.be link or an 11-character id');
        return;
    }
    setError('');
    busy = true;
    const button = addBtn();
    if (button) button.disabled = true;
    try {
        let meta = metaFor(videoId);
        if (!meta) meta = await fetchYouTubeMeta(videoId);
        addYouTubeClip({
            videoId,
            title: meta?.title || '',
            thumb: meta?.thumb || '',
            author: meta?.author || ''
        });
        renderList();
        pick(videoId, meta);
    } finally {
        busy = false;
        if (button) button.disabled = false;
    }
}

function onListClick(event) {
    const remove = event.target?.closest?.('[data-youtube-remove]');
    if (remove) {
        event.preventDefault?.();
        removeYouTubeClip(remove.getAttribute('data-youtube-remove'));
        renderList();
        return;
    }
    const pickBtn = event.target?.closest?.('[data-youtube-pick]');
    if (pickBtn) {
        event.preventDefault?.();
        pick(pickBtn.getAttribute('data-youtube-pick'));
    }
}

function onKeyDown(event) {
    if (event?.key !== 'Escape') return;
    event.preventDefault?.();
    hide();
}

function bind() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    modalEl()?.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-youtube-picker-dismiss]')) {
            event.preventDefault?.();
            hide();
        }
    });
    el('youtube-picker-form')?.addEventListener('submit', submitInput);
    listEl()?.addEventListener('click', onListClick);
    dialogEl()?.addEventListener('keydown', onKeyDown);
}

export const YouTubePicker = {
    /**
     * @param {{ slotId?: string, start?: ((videoId: string, meta: object | null) => any) | null }} [options]
     */
    open({ slotId = 'center', start = null } = {}) {
        bind();
        openedSlotId = slotId;
        startHandler = start;
        const input = inputEl();
        if (input) input.value = '';
        setError('');
        renderList();
        show();
    },

    close: hide,

    isOpen() {
        const modal = modalEl();
        return Boolean(modal && !modal.hidden);
    },

    /** Test seam. */
    _pickForTest(videoId) {
        pick(videoId);
    }
};
