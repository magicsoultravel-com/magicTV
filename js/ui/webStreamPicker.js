/**
 * Web Video picker — paste any page (or direct media) URL for one mosaic tile.
 *
 * Opened from the per-tile Web Video chrome button (slide-out of YouTube):
 *   WebStreamPicker.open({ slotId, play: (spec) => Promise<boolean> })
 *
 * Resolve ladder lives in webStreamResolver.js; the sniffer in
 * webStreamSniffer.js; the optional proxy in settingsStore.webStreamProxy*.
 */
import { el } from '../tvUtils.js';
import { SLOT_SCREEN_LABELS } from '../mosaic/constants.js';
import { SettingsStore } from '../storage/settingsStore.js';
import {
    WEBSTREAM_LABEL,
    classifyStreamUrl,
    hostLabel,
    normalizeProxyTemplate,
    parsePageUrl,
    sanitizeStreamUrl,
    webStreamStatusMessage
} from '../webstream/webStreamLinks.js';
import { buildPlaybackSpec, resolveWebStream } from '../webstream/webStreamResolver.js';
import {
    isShieldLevel,
    shieldSummary
} from '../webstream/webShield.js';
import {
    addWebStreamItem,
    listWebStreamItems,
    removeWebStreamItem
} from '../webstream/webStreamLibrary.js';
import {
    buildSnifferBookmarklet,
    onSniffReport,
    openSniffTarget,
    parseSniffText
} from '../webstream/webStreamSniffer.js';

let bound = false;
let openedSlotId = 'center';
/** @type {((spec: object) => any) | null} */
let playHandler = null;
let busy = false;
/** @type {Element | null} */
let previousFocus = null;
let currentPageUrl = '';
/** @type {string[]} */
let currentFrames = [];
/** @type {(() => void) | null} */
let stopSniffListener = null;

function modalEl() { return el('webstream-picker'); }
function dialogEl() { return el('webstream-picker-dialog'); }
function inputEl() { return el('webstream-picker-input'); }
function addBtn() { return el('webstream-picker-add'); }
function errorEl() { return el('webstream-picker-error'); }
function statusEl() { return el('webstream-picker-status'); }
function sourcesEl() { return el('webstream-picker-sources'); }
function embedWrapEl() { return el('webstream-picker-embed-wrap'); }
function embedBtn() { return el('webstream-picker-embed'); }
function listEl() { return el('webstream-picker-list'); }
function emptyEl() { return el('webstream-picker-empty'); }
function sniffEl() { return el('webstream-picker-sniff'); }
function sniffHintEl() { return el('webstream-picker-sniff-hint'); }
function sniffTextEl() { return el('webstream-picker-sniff-text'); }
function sniffLinkEl() { return el('webstream-picker-sniff-link'); }
function proxyEl() { return el('webstream-picker-proxy'); }
function proxyHintEl() { return el('webstream-picker-proxy-hint'); }
function proxyPlaybackEl() { return el('webstream-picker-proxy-playback'); }
function shieldEl() { return el('webstream-picker-shield'); }
function shieldHintEl() { return el('webstream-picker-shield-hint'); }

function setError(message) {
    const box = errorEl();
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('is-hidden', !message);
}

function setStatus(message) {
    const box = statusEl();
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('is-hidden', !message);
}

function setBusy(next) {
    busy = Boolean(next);
    const button = addBtn();
    if (button) {
        button.disabled = busy;
        button.textContent = busy ? 'Scanning…' : 'Play';
    }
}

function showPanel(node, visible) {
    if (!node) return;
    node.classList.toggle('is-hidden', !visible);
    if ('hidden' in node) node.hidden = !visible;
}

function titleForPage(pageUrl) {
    return hostLabel(pageUrl) || WEBSTREAM_LABEL;
}

function proxyState() {
    const proxyTemplate = SettingsStore.getWebStreamProxyTemplate();
    const useProxy = SettingsStore.getWebStreamProxyPlayback() && Boolean(proxyTemplate);
    return { proxyTemplate, useProxy };
}

function mediaSpecFor(candidate, pageUrl) {
    const { proxyTemplate, useProxy } = proxyState();
    const spec = buildPlaybackSpec(
        { pageUrl, url: candidate?.url || '', kind: candidate?.kind || '' },
        { proxyTemplate, useProxy, title: titleForPage(pageUrl) }
    );
    return spec ? { mode: 'media', ...spec } : null;
}

function shieldLevel() {
    const value = shieldEl()?.value;
    return isShieldLevel(value) ? value : SettingsStore.getWebStreamShield();
}

function renderShieldHint() {
    const hint = shieldHintEl();
    const level = shieldLevel();
    if (hint) {
        hint.textContent = `${shieldSummary(level)} Saved with the page.`;
    }
    return level;
}

function embedSpecFor(frameUrl, pageUrl, shield = '') {
    const level = isShieldLevel(shield) ? shield : shieldLevel();
    return {
        mode: 'embed',
        pageUrl: pageUrl || '',
        frameUrl: frameUrl || pageUrl || '',
        title: titleForPage(pageUrl || frameUrl),
        shield: level
    };
}

function rememberItem(spec) {
    addWebStreamItem({
        pageUrl: spec.pageUrl || '',
        streamUrl: spec.streamUrl || '',
        kind: spec.kind || '',
        title: spec.title || '',
        mode: spec.mode === 'embed' ? 'embed' : 'media',
        shield: spec.mode === 'embed' && isShieldLevel(spec.shield) ? spec.shield : ''
    });
}

function startSpec(spec) {
    if (!spec) return;
    rememberItem(spec);
    const play = playHandler;
    hide();
    try {
        const result = play?.(spec);
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* ignore */ }
}

function candidateRow(candidate) {
    const item = document.createElement('li');
    item.className = 'webstream-picker__source';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webstream-picker__source-btn';
    button.dataset.webstreamUrl = candidate.url;
    button.dataset.webstreamKind = candidate.kind || '';
    button.title = candidate.url;

    const tag = document.createElement('span');
    tag.className = 'webstream-picker__source-kind';
    tag.textContent = candidate.kind === 'hls' ? 'HLS' : 'VIDEO';

    const url = document.createElement('span');
    url.className = 'webstream-picker__source-url';
    url.textContent = candidate.url.length > 110
        ? `${candidate.url.slice(0, 107)}…`
        : candidate.url;

    button.append(tag, url);
    item.appendChild(button);
    return item;
}

function renderCandidates(candidates) {
    const list = sourcesEl();
    if (!list) return;
    const rows = Array.isArray(candidates) ? candidates : [];
    list.replaceChildren(...rows.map(candidateRow));
    showPanel(list, rows.length > 0);
}

function showEmbedOption(visible) {
    showPanel(embedWrapEl(), visible);
}

function itemRow(item) {
    const row = document.createElement('li');
    row.className = 'webstream-picker__item';

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'webstream-picker__pick';
    pick.dataset.webstreamPick = item.pageUrl || item.streamUrl;
    pick.dataset.webstreamMode = item.mode;
    pick.title = item.streamUrl || item.pageUrl;

    const name = document.createElement('span');
    name.className = 'webstream-picker__item-title';
    name.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'webstream-picker__item-meta';
    meta.textContent = [
        item.host,
        item.mode === 'embed' ? 'embed' : (item.kind === 'hls' ? 'HLS' : 'video')
    ].filter(Boolean).join(' · ');

    pick.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'webstream-picker__remove';
    remove.dataset.webstreamRemove = item.pageUrl || item.streamUrl;
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove ${item.title}`);
    remove.textContent = '×';

    row.append(pick, remove);
    return row;
}

function renderLibrary() {
    const list = listEl();
    if (!list) return;
    const items = listWebStreamItems();
    list.replaceChildren(...items.map(itemRow));
    showPanel(emptyEl(), items.length === 0);
}

function setSniffHint(message) {
    const hint = sniffHintEl();
    if (hint) hint.textContent = message || '';
}

function openSniffPanel(open) {
    const panel = sniffEl();
    if (panel && 'open' in panel) panel.open = Boolean(open);
}

/**
 * Show a resolver result: play immediately when resolved, otherwise list the
 * candidates / embed option / sniffer instructions.
 * @param {Awaited<ReturnType<typeof resolveWebStream>>} result
 */
function applyResolution(result) {
    if (!result) return;
    currentPageUrl = result.pageUrl || currentPageUrl;
    currentFrames = Array.isArray(result.frames) ? result.frames.slice() : [];

    if (result.status === 'resolved') {
        const spec = mediaSpecFor({ url: result.url, kind: result.kind }, result.pageUrl);
        if (spec) {
            startSpec(spec);
            return;
        }
    }

    renderCandidates(result.candidates || []);
    showEmbedOption(Boolean(currentFrames.length || currentPageUrl));
    setError(result.status === 'drm' || result.status === 'unsupported' ? result.message : '');
    setStatus(result.message || '');

    if (result.status === 'needs-sniff' || result.status === 'blocked') {
        openSniffPanel(true);
        setSniffHint(result.message || '');
    }
}

async function submitInput(event) {
    event?.preventDefault?.();
    if (busy) return;
    const raw = inputEl()?.value?.trim() || '';
    if (!raw) {
        setError('Paste a page URL or a direct .m3u8 / .mp4 link');
        return;
    }

    setError('');
    setStatus('');
    renderCandidates([]);
    showEmbedOption(false);

    // Rung 0 — direct media link, no page scan needed.
    const directKind = classifyStreamUrl(raw);
    if (directKind) {
        currentPageUrl = '';
        currentFrames = [];
        startSpec(mediaSpecFor({ url: sanitizeStreamUrl(raw), kind: directKind }, ''));
        return;
    }

    const pageUrl = parsePageUrl(raw);
    if (!pageUrl) {
        setError(webStreamStatusMessage('invalid'));
        return;
    }

    currentPageUrl = pageUrl;
    currentFrames = [];
    setBusy(true);
    setStatus('Scanning the page…');
    try {
        const { proxyTemplate } = proxyState();
        const result = await resolveWebStream(pageUrl, { proxyTemplate });
        applyResolution(result);
    } finally {
        setBusy(false);
        if (statusEl()?.textContent === 'Scanning the page…') setStatus('');
    }
}

/**
 * Apply a sniffer report (live `postMessage` or the clipboard fallback).
 * @param {{ pageUrl?: string, title?: string, candidates?: { url: string, kind: string }[] } | null} report
 */
function applySniffReport(report) {
    const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
    if (!candidates.length) return;
    if (report.pageUrl) currentPageUrl = parsePageUrl(report.pageUrl) || currentPageUrl;
    renderCandidates(candidates);
    showEmbedOption(Boolean(currentPageUrl));
    setError('');
    setStatus(`Found ${candidates.length} media URL${candidates.length === 1 ? '' : 's'} — pick one to play.`);
    if (report.title) setSniffHint(`From “${report.title}”.`);
}

function applyPastedSniff() {
    const text = sniffTextEl()?.value || '';
    const candidates = parseSniffText(text);
    if (!candidates.length) {
        setSniffHint('No .m3u8 / .mp4 URL found in that text.');
        return;
    }
    applySniffReport({ pageUrl: currentPageUrl, candidates });
    setSniffHint(`Using ${candidates.length} pasted URL${candidates.length === 1 ? '' : 's'}.`);
}

function openSniffTargetPage() {
    if (!currentPageUrl) {
        setError('Paste the page URL first');
        return;
    }
    const opened = openSniffTarget(currentPageUrl);
    setSniffHint(opened
        ? 'Press play on that page, click the magicTV Sniff bookmark there, then come back here.'
        : 'The popup was blocked — allow popups, or use the paste box below.');
}

function copySniffer() {
    const code = buildSnifferBookmarklet();
    try {
        const result = globalThis.navigator?.clipboard?.writeText?.(code);
        if (result && typeof result.catch === 'function') result.catch(() => {});
        setSniffHint('Sniffer copied — paste it as a bookmark URL on your bookmarks bar.');
    } catch {
        setSniffHint('Copy blocked — drag the magicTV Sniff link to your bookmarks bar instead.');
    }
}

function saveProxy() {
    const raw = proxyEl()?.value || '';
    const hint = proxyHintEl();
    if (!raw.trim()) {
        SettingsStore.setWebStreamProxyTemplate('');
        if (hint) hint.textContent = 'Proxy cleared.';
        return;
    }
    const normalized = normalizeProxyTemplate(raw);
    if (!normalized) {
        if (hint) hint.textContent = 'Needs http(s) and a {url} or {url_encoded} token.';
        return;
    }
    SettingsStore.setWebStreamProxyTemplate(normalized);
    const input = proxyEl();
    if (input) input.value = normalized;
    if (hint) hint.textContent = 'Saved. Page scans and (optionally) playback now use this proxy.';
}

function onSourcesClick(event) {
    const button = event.target?.closest?.('[data-webstream-url]');
    if (!button) return;
    event.preventDefault?.();
    const url = button.getAttribute('data-webstream-url');
    const kind = button.getAttribute('data-webstream-kind') || classifyStreamUrl(url);
    startSpec(mediaSpecFor({ url, kind }, currentPageUrl));
}

function onLibraryClick(event) {
    const remove = event.target?.closest?.('[data-webstream-remove]');
    if (remove) {
        event.preventDefault?.();
        const value = remove.getAttribute('data-webstream-remove');
        removeWebStreamItem({ pageUrl: value, streamUrl: value });
        renderLibrary();
        return;
    }
    const pick = event.target?.closest?.('[data-webstream-pick]');
    if (!pick) return;
    event.preventDefault?.();
    const value = pick.getAttribute('data-webstream-pick');
    const item = listWebStreamItems().find((entry) => (entry.pageUrl || entry.streamUrl) === value);
    if (!item) return;
    if (item.mode === 'embed') {
        // A saved page keeps its own shield level; otherwise the global one wins.
        startSpec(embedSpecFor(item.pageUrl, item.pageUrl, item.shield));
        return;
    }
    if (item.streamUrl && classifyStreamUrl(item.streamUrl)) {
        startSpec(mediaSpecFor({ url: item.streamUrl, kind: item.kind }, item.pageUrl));
        return;
    }
    // Stale entry without a saved stream — resolve the page again.
    const input = inputEl();
    if (input) input.value = item.pageUrl;
    void submitInput();
}

function onEmbedClick(event) {
    event?.preventDefault?.();
    startSpec(embedSpecFor(currentFrames[0] || '', currentPageUrl));
}

function onShieldChange(event) {
    SettingsStore.setWebStreamShield(event?.target?.value);
    renderShieldHint();
}

function onProxyPlaybackChange(event) {
    SettingsStore.setWebStreamProxyPlayback(event?.target?.checked === true);
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
    const title = el('webstream-picker-title');
    if (title) {
        const label = SLOT_SCREEN_LABELS[openedSlotId] || 'this TV';
        title.textContent = `Web Video on TV ${label}`;
    }
    const unsubscribe = stopSniffListener;
    if (unsubscribe) unsubscribe();
    stopSniffListener = onSniffReport(applySniffReport);
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
    playHandler = null;
    if (stopSniffListener) {
        stopSniffListener();
        stopSniffListener = null;
    }
    setError('');
    setStatus('');
    if (busy) setBusy(false);
    if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus(); } catch { /* ignore */ }
    }
    previousFocus = null;
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
        if (event.target?.closest?.('[data-webstream-picker-dismiss]')) {
            event.preventDefault?.();
            hide();
        }
    });
    el('webstream-picker-form')?.addEventListener('submit', submitInput);
    listEl()?.addEventListener('click', onLibraryClick);
    sourcesEl()?.addEventListener('click', onSourcesClick);
    embedBtn()?.addEventListener('click', onEmbedClick);
    el('webstream-picker-sniff-open')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        openSniffTargetPage();
    });
    el('webstream-picker-sniff-copy')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        copySniffer();
    });
    el('webstream-picker-sniff-apply')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        applyPastedSniff();
    });
    el('webstream-picker-proxy-save')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        saveProxy();
    });
    proxyPlaybackEl()?.addEventListener('change', onProxyPlaybackChange);
    shieldEl()?.addEventListener('change', onShieldChange);
    dialogEl()?.addEventListener('keydown', onKeyDown);
}

export const WebStreamPicker = {
    /**
     * @param {{ slotId?: string, play?: ((spec: object) => any) | null }} [options]
     */
    open({ slotId = 'center', play = null } = {}) {
        bind();
        openedSlotId = slotId;
        playHandler = play;
        currentPageUrl = '';
        currentFrames = [];

        const input = inputEl();
        if (input) input.value = '';
        const sniffText = sniffTextEl();
        if (sniffText) sniffText.value = '';
        openSniffPanel(false);
        setSniffHint('');

        const proxy = proxyEl();
        if (proxy) proxy.value = SettingsStore.getWebStreamProxyTemplate();
        const proxyHint = proxyHintEl();
        if (proxyHint) proxyHint.textContent = '';
        const proxyPlayback = proxyPlaybackEl();
        if (proxyPlayback) proxyPlayback.checked = SettingsStore.getWebStreamProxyPlayback();
        const shield = shieldEl();
        if (shield) shield.value = SettingsStore.getWebStreamShield();
        renderShieldHint();

        const sniffLink = sniffLinkEl();
        if (sniffLink) {
            sniffLink.setAttribute('href', buildSnifferBookmarklet());
            sniffLink.setAttribute('title', 'Drag me to your bookmarks bar');
        }

        renderCandidates([]);
        showEmbedOption(false);
        setError('');
        setStatus('');
        setBusy(false);
        renderLibrary();

        show();
    },

    close: hide,

    isOpen() {
        const modal = modalEl();
        return Boolean(modal && !modal.hidden);
    },

    /** Test seam — feed a URL through the normal submit path. */
    _submitForTest(value) {
        const input = inputEl();
        if (input) input.value = value;
        return submitInput();
    },

    /** Test seam — apply a sniffer report without a real popup. */
    _sniffForTest(report) {
        applySniffReport(report);
    }
};
