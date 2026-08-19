/** External-window popout for the live remote (Document PiP + popup fallback). */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { RemoteModule } from './remoteModule.js';
import { CARD_ICONS } from './icons.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { browserEndActionsEl, isBrowserSeparated, remoteEndActionsEl, startActionsEl } from './moduleActions.js';
import {
    shouldUseDocumentPipFor,
    requestPipWindow,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    unregisterPipWindow,
    windowNameForRemote,
    remotePopoutSize,
    browserPopoutSize
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from '../appDocuments.js';

const PLACEHOLDER_ID = 'remote-external-popout-placeholder';
const REMOTE_PANEL_IDS = ['remote-panel', 'settings-panel'];
const CHANNEL_TABS = ['browse', 'favorites', 'recents'];
const REMOTE_TABS = ['remote', 'settings'];

/** @type {{
 *   mode: 'unified' | 'split',
 *   placeholder: HTMLElement,
 *   win: Window,
 *   isPip: boolean,
 *   popDoc: Document,
 *   shell?: HTMLElement,
 *   onKey?: (e: KeyboardEvent) => void,
 *   closeWire?: { onCloseClick: (e: Event) => void, prevTitle: string, prevLabel: string | null },
 *   anchors: Record<string, { parent: Element | null, next: ChildNode | null }>
 * } | null} */
let entry = null;

function catalogBody() {
    return el('tv-catalog-body');
}

function scrollEl() {
    return catalogBody()?.querySelector('.remote-module__scroll') ?? null;
}

function popoutScrollEl() {
    if (entry?.mode === 'unified') {
        return catalogBody()?.querySelector('.remote-module__scroll') ?? null;
    }
    return entry?.shell?.querySelector('.remote-popout-module__scroll') ?? null;
}

function chromeEl() {
    return catalogBody()?.querySelector('.remote-module__chrome') ?? null;
}

function getActiveMountHost() {
    const body = catalogBody();
    if (!body) return null;
    return body.closest('#remote-module-host')
        || body.closest('#remote-dock-host')
        || el('remote-module-staging');
}

function captureAnchor(node) {
    if (!node?.parentElement) return { parent: null, next: null };
    return { parent: node.parentElement, next: node.nextSibling };
}

function restoreNode(node, anchor) {
    if (!node || !anchor?.parent) return;
    const { parent, next } = anchor;
    if (next && next.parentElement === parent) {
        parent.insertBefore(node, next);
    } else {
        parent.appendChild(node);
    }
}

function rememberSplitAnchors() {
    const anchors = {
        brand: captureAnchor(catalogBody()?.querySelector('.remote-module__brand')),
        remoteEndActions: captureAnchor(remoteEndActionsEl()),
        browserEndActions: captureAnchor(browserEndActionsEl()),
        startActions: captureAnchor(startActionsEl()),
        panels: {}
    };
    REMOTE_PANEL_IDS.forEach((id) => {
        anchors.panels[id] = captureAnchor(el(id));
    });
    return anchors;
}

function rememberUnifiedAnchors(host) {
    const body = catalogBody();
    return {
        body: captureAnchor(body),
        startActions: captureAnchor(startActionsEl()),
        browserEndActions: captureAnchor(browserEndActionsEl()),
        remoteEndActions: captureAnchor(remoteEndActionsEl()),
        host
    };
}

function detectActiveTab() {
    const body = catalogBody();
    if (!body) return 'remote';
    for (const panel of body.querySelectorAll('.tv-panel')) {
        if (panel.classList.contains('is-active') && panel.id) {
            return panel.id.replace('-panel', '');
        }
    }
    return 'remote';
}

function isBrowserTabActive() {
    for (const id of ['browse-panel', 'favorites-panel', 'recents-panel']) {
        const panel = el(id);
        if (panel?.classList.contains('is-active')) return true;
    }
    return false;
}

function createPlaceholder(mountHost, { onHost = false } = {}) {
    const placeholder = document.createElement('div');
    placeholder.id = PLACEHOLDER_ID;
    placeholder.className = 'remote-popout-placeholder is-popout-locked';
    placeholder.setAttribute('role', 'presentation');

    const overlay = document.createElement('div');
    overlay.className = 'note-popout-lock-overlay remote-popout-lock-overlay';
    overlay.innerHTML = `<button type="button" class="note-popout-lock-icon" title="Remote in popout — click to focus" aria-label="Remote in popout — click to focus">${CARD_ICONS.popout}</button>`;
    overlay.querySelector('.note-popout-lock-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        RemoteExternalPopout.openOrFocus();
    });
    placeholder.appendChild(overlay);

    const header = document.createElement('div');
    header.className = 'remote-popout-placeholder__header';
    header.innerHTML = `
        <span class="remote-popout-placeholder__title">magic remote</span>
        <span class="remote-popout-placeholder__spacer"></span>
        <div class="remote-popout-placeholder__actions">
            <button type="button" class="tv-module__action ui-icon-btn remote-popout-placeholder__focus" title="Focus popout window" aria-label="Focus popout window">${CARD_ICONS.popoutExit}</button>
            <button type="button" class="tv-module__action ui-icon-btn remote-popout-placeholder__popin" title="Pop in remote" aria-label="Pop in remote">${CARD_ICONS.popin}</button>
        </div>
    `;
    header.querySelector('.remote-popout-placeholder__focus')?.addEventListener('click', (e) => {
        e.stopPropagation();
        RemoteExternalPopout.openOrFocus();
    });
    header.querySelector('.remote-popout-placeholder__popin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        RemoteExternalPopout.popIn();
    });
    placeholder.appendChild(header);

    const bodySlot = document.createElement('div');
    bodySlot.className = 'remote-popout-placeholder__body';
    bodySlot.setAttribute('aria-hidden', 'true');
    placeholder.appendChild(bodySlot);

    if (onHost && mountHost) {
        const rect = mountHost.getBoundingClientRect?.();
        if (rect?.width) placeholder.style.minWidth = `${Math.round(rect.width)}px`;
        if (rect?.height) placeholder.style.minHeight = `${Math.round(Math.max(rect.height, 120))}px`;
    }

    mountHost?.appendChild(placeholder);
    return placeholder;
}

function buildSplitShell(popDoc) {
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'remote-popout-body';
    const shell = popDoc.createElement('div');
    shell.className = 'remote-popout-module__shell is-remote-popout-live';
    shell.innerHTML = `
        <header class="remote-popout-module__chrome"></header>
        <div class="remote-popout-module__scroll"></div>
    `;
    popDoc.body.appendChild(shell);
    return shell;
}

function prepUnifiedDocument(popDoc) {
    if (!popDoc?.body) return;
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'remote-popout-body';
}

async function openPopoutWindow(unified) {
    const { w, h } = unified ? browserPopoutSize() : remotePopoutSize();
    const owner = { type: 'module', id: 'remote' };
    const onPageHide = () => RemoteExternalPopout.handleWindowClosed();

    if (shouldUseDocumentPipFor(owner)) {
        const pipWin = await requestPipWindow({ width: w, height: h, owner, onPageHide });
        if (!pipWin) {
            showAppToast('Could not open remote popout window');
            return null;
        }
        return { win: pipWin, isPip: true };
    }

    const name = windowNameForRemote();
    const win = openBrowserPopup('about:blank', name, w, h);
    if (!win) return null;
    win.addEventListener('pagehide', onPageHide);
    prepareBlankPopoutDocument(win, 'remote-popout-body');
    return { win, isPip: false };
}

function wirePopoutChrome(popDoc) {
    const closeBtn = popDoc.getElementById('remote-module-close');
    if (!closeBtn) return null;

    const prevTitle = closeBtn.title;
    const prevLabel = closeBtn.getAttribute('aria-label');
    closeBtn.title = 'Pop in remote';
    closeBtn.setAttribute('aria-label', 'Pop in remote');

    const onCloseClick = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        RemoteExternalPopout.popIn();
    };
    closeBtn.addEventListener('click', onCloseClick, true);

    return { onCloseClick, prevTitle, prevLabel };
}

function updateBodyClasses(mode) {
    document.body.classList.add('remote-external-popout-active');
    const browserSeparated = isBrowserSeparated();
    document.body.classList.toggle('remote-external-popout-active--unified', mode === 'unified');
    document.body.classList.toggle('remote-external-popout-active--full', mode === 'unified' || browserSeparated);
    document.body.classList.toggle('remote-external-popout-active--solo', mode === 'split' && !browserSeparated);
}

function clearBodyClasses() {
    document.body.classList.remove(
        'remote-external-popout-active',
        'remote-external-popout-active--unified',
        'remote-external-popout-active--full',
        'remote-external-popout-active--solo'
    );
}

/** Route tabs to the correct scroll depending on unified vs split popout. */
function syncActiveTab(tabName) {
    if (!entry) return false;

    if (entry.mode === 'unified') {
        catalogBody()?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');
        return true;
    }

    const mainScroll = scrollEl();
    const remoteScroll = popoutScrollEl();

    if (REMOTE_TABS.includes(tabName)) {
        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');
        return true;
    }

    if (CHANNEL_TABS.includes(tabName)) {
        mainScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');

        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el('remote-panel')?.classList.add('is-active');
        return true;
    }

    return false;
}

async function popOutUnified() {
    const body = catalogBody();
    const host = getActiveMountHost();
    if (!body || !host) return;

    const activeTab = detectActiveTab();
    const anchors = rememberUnifiedAnchors(host);
    const placeholder = createPlaceholder(host, { onHost: true });

    const opened = await openPopoutWindow(true);
    if (!opened?.win) {
        placeholder.remove();
        return;
    }

    const { win, isPip } = opened;
    const popDoc = win.document;
    prepUnifiedDocument(popDoc);
    registerAppDocument(popDoc);

    const startActions = startActionsEl();
    const browserEndActions = browserEndActionsEl();
    const remoteEndActions = remoteEndActionsEl();

    if (startActions) popDoc.body.appendChild(startActions);
    if (browserEndActions) popDoc.body.appendChild(browserEndActions);
    if (remoteEndActions) popDoc.body.appendChild(remoteEndActions);
    popDoc.body.appendChild(body);
    body.classList.add('is-remote-popout-live');

    updateBodyClasses('unified');

    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        RemoteExternalPopout.popIn();
    };
    popDoc.addEventListener('keydown', onKey);
    const closeWire = wirePopoutChrome(popDoc);

    entry = {
        mode: 'unified',
        placeholder,
        win,
        isPip,
        popDoc,
        onKey,
        closeWire,
        anchors
    };

    syncActiveTab(activeTab);

    try {
        win.focus();
    } catch {
        /* ignore */
    }

    RemoteExternalPopout.syncBtn();
    window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
}

async function popOutSplit() {
    const scroll = scrollEl();
    if (!scroll) return;

    const activeTab = detectActiveTab();
    const anchors = rememberSplitAnchors();
    const placeholder = createPlaceholder(scroll);

    const opened = await openPopoutWindow(false);
    if (!opened?.win) {
        placeholder.remove();
        return;
    }

    const { win, isPip } = opened;
    const popDoc = win.document;
    registerAppDocument(popDoc);
    const shell = buildSplitShell(popDoc);
    const popChrome = shell.querySelector('.remote-popout-module__chrome');
    const popScroll = shell.querySelector('.remote-popout-module__scroll');

    const brand = catalogBody()?.querySelector('.remote-module__brand');
    const remoteEndActions = remoteEndActionsEl();

    if (brand && popChrome) popChrome.appendChild(brand);
    REMOTE_PANEL_IDS.forEach((id) => {
        const panel = el(id);
        if (panel && popScroll) popScroll.appendChild(panel);
    });
    if (remoteEndActions) popDoc.body.appendChild(remoteEndActions);

    scroll.classList.add('is-remote-popout-empty');
    updateBodyClasses('split');

    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        RemoteExternalPopout.popIn();
    };
    popDoc.addEventListener('keydown', onKey);
    const closeWire = wirePopoutChrome(popDoc);

    entry = {
        mode: 'split',
        placeholder,
        win,
        isPip,
        popDoc,
        shell,
        onKey,
        closeWire,
        anchors
    };

    syncActiveTab(activeTab);

    try {
        win.focus();
    } catch {
        /* ignore */
    }

    RemoteExternalPopout.syncBtn();
    window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
}

function popInUnified() {
    const {
        placeholder,
        win,
        isPip,
        popDoc,
        onKey,
        closeWire,
        anchors
    } = entry;

    if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

    const body = catalogBody();
    const startActions = startActionsEl();
    const remoteEndActions = remoteEndActionsEl();
    const browserEndActions = browserEndActionsEl();

    if (body) body.classList.remove('is-remote-popout-live');

    restoreNode(startActions, anchors.startActions);
    restoreNode(browserEndActions, anchors.browserEndActions);
    restoreNode(remoteEndActions, anchors.remoteEndActions);
    restoreNode(body, anchors.body);

    const closeBtn = popDoc?.getElementById('remote-module-close');
    if (closeBtn && closeWire?.onCloseClick) {
        closeBtn.removeEventListener('click', closeWire.onCloseClick, true);
        closeBtn.title = closeWire.prevTitle || 'Close';
        closeBtn.setAttribute('aria-label', closeWire.prevLabel || 'Close');
    }

    placeholder.remove();
    clearBodyClasses();

    entry = null;

    if (popDoc && popDoc !== document) unregisterAppDocument(popDoc);
    if (win && isPip) unregisterPipWindow(win);
    if (win && !win.closed) {
        try {
            win.close();
        } catch {
            /* ignore */
        }
    }

    RemoteExternalPopout.syncBtn();
    window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
}

function popInSplit() {
    const {
        placeholder,
        win,
        isPip,
        popDoc,
        onKey,
        closeWire,
        anchors
    } = entry;

    if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

    const brand = popDoc?.querySelector('.remote-module__brand');
    const remoteEndActions = remoteEndActionsEl();
    const scroll = scrollEl();
    const mainChrome = chromeEl();

    restoreNode(brand, anchors.brand);
    if (brand && mainChrome && !mainChrome.contains(brand)) {
        mainChrome.prepend(brand);
    }

    REMOTE_PANEL_IDS.forEach((id) => {
        const panel = el(id);
        if (panel && scroll) {
            restoreNode(panel, anchors.panels[id]);
            if (!scroll.contains(panel)) scroll.appendChild(panel);
        }
    });

    restoreNode(remoteEndActions, anchors.remoteEndActions);

    const closeBtn = popDoc?.getElementById('remote-module-close');
    if (closeBtn && closeWire?.onCloseClick) {
        closeBtn.removeEventListener('click', closeWire.onCloseClick, true);
        closeBtn.title = closeWire.prevTitle || 'Close';
        closeBtn.setAttribute('aria-label', closeWire.prevLabel || 'Close');
    }

    scroll?.classList.remove('is-remote-popout-empty');
    placeholder.remove();
    clearBodyClasses();

    entry = null;

    if (popDoc && popDoc !== document) unregisterAppDocument(popDoc);
    if (win && isPip) unregisterPipWindow(win);
    if (win && !win.closed) {
        try {
            win.close();
        } catch {
            /* ignore */
        }
    }

    RemoteExternalPopout.syncBtn();
    window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
}

export const RemoteExternalPopout = {
    isPoppedOut() {
        return entry != null;
    },

    isUnifiedPopout() {
        return entry?.mode === 'unified';
    },

    syncActiveTab,

    getPopoutWindow() {
        if (!entry?.win || entry.win.closed) return null;
        return entry.win;
    },

    getPopoutScrollEl: popoutScrollEl,

    openOrFocus() {
        const win = this.getPopoutWindow();
        if (!win) return null;
        try {
            win.focus();
        } catch {
            /* ignore */
        }
        return win;
    },

    syncBtn() {
        const btn = el('remote-external-popout-btn');
        if (!btn) return;
        const remoteOpen = RemoteModule.isOpen();
        const separate = SettingsStore.getBrowserPopoutPreferOpen();
        const onBrowserTab = isBrowserTabActive();
        // When the browser is its own module, the remote pop-out control only
        // belongs to the remote view; otherwise it is the single shared control.
        const visible = remoteOpen && !(separate && onBrowserTab);
        btn.classList.toggle('is-hidden', !visible);
        const popped = this.isPoppedOut();
        btn.innerHTML = popped ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
        btn.classList.toggle('is-active', popped);
        btn.setAttribute('aria-pressed', String(popped));
        const label = popped ? 'Pop in remote' : 'Pop out remote';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    syncBodyClasses() {
        if (!entry) return;
        updateBodyClasses(entry.mode);
    },

    async popOut() {
        if (entry) return;
        if (!RemoteModule.isOpen()) {
            showAppToast('Open the remote first');
            return;
        }

        if (isBrowserSeparated()) {
            await popOutSplit();
        } else {
            await popOutUnified();
        }
    },

    popIn() {
        if (!entry) return;
        if (entry.mode === 'unified') {
            popInUnified();
        } else {
            popInSplit();
        }
    },

    handleWindowClosed() {
        if (!entry) return;
        this.popIn();
    }
};
