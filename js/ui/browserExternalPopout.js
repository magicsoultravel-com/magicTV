/** External OS window for browse / favorites / recents (icon-triggered). */
import { el, queryAllInApp } from '../tvUtils.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { RemoteModule } from './remoteModule.js';
import { RemoteExternalPopout } from './remoteExternalPopout.js';
import { BrowserPopout } from './browserPopout.js';
import { showAppToast } from './toast.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    shouldUseDocumentPipFor,
    requestPipWindow,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    unregisterPipWindow,
    windowNameForBrowser,
    browserPopoutSize,
    isPipOccupied
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from '../appDocuments.js';

const PLACEHOLDER_ID = 'browser-external-popout-placeholder';
const BROWSER_PANEL_IDS = ['browse-panel', 'favorites-panel', 'recents-panel'];
const CHANNEL_TABS = ['browse', 'favorites', 'recents'];

/** @type {{
 *   placeholder: HTMLElement,
 *   win: Window,
 *   isPip: boolean,
 *   popDoc: Document,
 *   shell: HTMLElement,
 *   onKey?: (e: KeyboardEvent) => void,
 *   onCloseClick?: (e: Event) => void,
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
    return entry?.shell?.querySelector('.browser-popout-module__scroll') ?? null;
}

/** Keep channel tabs in the external window; remote/settings stay in the main remote scroll. */
function syncActiveTab(tabName) {
    if (!entry) return false;

    const remoteScroll = scrollEl();
    const browserScroll = popoutScrollEl();

    if (CHANNEL_TABS.includes(tabName)) {
        browserScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');

        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el('remote-panel')?.classList.add('is-active');
        return true;
    }

    if (tabName === 'remote' || tabName === 'settings') {
        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');
        return true;
    }

    return false;
}

function detectActiveChannelTab() {
    for (const id of BROWSER_PANEL_IDS) {
        const panel = document.getElementById(id);
        if (panel?.classList.contains('is-active')) {
            return id.replace('-panel', '');
        }
    }
    return 'browse';
}

function footerEl() {
    return el('tv-catalog-body')?.querySelector('.remote-module__footer') ?? null;
}

function endActionsEl() {
    return queryAllInApp('.tv-module__actions--end')[0] ?? null;
}

function startActionsEl() {
    return queryAllInApp('.tv-module__actions--start')[0] ?? null;
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

function rememberAnchors() {
    const anchors = {
        channelBar: captureAnchor(el('remote-channel-bar')),
        catalogTools: captureAnchor(el('remote-catalog-tools')),
        endActions: captureAnchor(endActionsEl()),
        startActions: captureAnchor(startActionsEl()),
        panels: {}
    };
    BROWSER_PANEL_IDS.forEach((id) => {
        anchors.panels[id] = captureAnchor(el(id));
    });
    return anchors;
}

function createPlaceholder(scrollHost) {
    const placeholder = document.createElement('div');
    placeholder.id = PLACEHOLDER_ID;
    placeholder.className = 'browser-popout-placeholder is-popout-locked';
    placeholder.setAttribute('role', 'presentation');

    const overlay = document.createElement('div');
    overlay.className = 'note-popout-lock-overlay browser-popout-lock-overlay';
    overlay.innerHTML = `<button type="button" class="note-popout-lock-icon" title="Browser in popout — click to focus" aria-label="Browser in popout — click to focus">${CARD_ICONS.popout}</button>`;
    overlay.querySelector('.note-popout-lock-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        BrowserExternalPopout.openOrFocus();
    });
    placeholder.appendChild(overlay);

    const header = document.createElement('div');
    header.className = 'browser-popout-placeholder__header';
    header.innerHTML = `
        <span class="browser-popout-placeholder__title">channel browser</span>
        <span class="browser-popout-placeholder__spacer"></span>
        <div class="browser-popout-placeholder__actions">
            <button type="button" class="tv-module__action ui-icon-btn browser-popout-placeholder__focus" title="Focus popout window" aria-label="Focus popout window">${CARD_ICONS.popoutExit}</button>
            <button type="button" class="tv-module__action ui-icon-btn browser-popout-placeholder__popin" title="Pop in browser" aria-label="Pop in browser">${CARD_ICONS.popin}</button>
        </div>
    `;
    header.querySelector('.browser-popout-placeholder__focus')?.addEventListener('click', (e) => {
        e.stopPropagation();
        BrowserExternalPopout.openOrFocus();
    });
    header.querySelector('.browser-popout-placeholder__popin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        BrowserExternalPopout.popIn();
    });
    placeholder.appendChild(header);

    const bodySlot = document.createElement('div');
    bodySlot.className = 'browser-popout-placeholder__body';
    bodySlot.setAttribute('aria-hidden', 'true');
    placeholder.appendChild(bodySlot);

    scrollHost?.appendChild(placeholder);
    return placeholder;
}

function buildShell(popDoc) {
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'browser-popout-body';
    const shell = popDoc.createElement('div');
    shell.className = 'browser-popout-module__shell is-browser-popout-live';
    shell.innerHTML = `
        <header class="browser-popout-module__chrome"></header>
        <div class="browser-popout-module__scroll"></div>
        <footer class="browser-popout-module__footer"></footer>
    `;
    popDoc.body.appendChild(shell);
    return shell;
}

async function openPopoutWindow() {
    const { w, h } = browserPopoutSize();
    const owner = { type: 'module', id: 'browser' };
    const onPageHide = () => BrowserExternalPopout.handleWindowClosed();

    if (shouldUseDocumentPipFor(owner)) {
        if (isPipOccupied()) {
            showAppToast('Another popout window is already open');
            return null;
        }
        const pipWin = await requestPipWindow({ width: w, height: h, owner, onPageHide });
        if (!pipWin) {
            showAppToast('Could not open browser popout window');
            return null;
        }
        return { win: pipWin, isPip: true };
    }

    const win = openBrowserPopup('about:blank', windowNameForBrowser(), w, h);
    if (!win) return null;
    win.addEventListener('pagehide', onPageHide);
    prepareBlankPopoutDocument(win, 'browser-popout-body');
    return { win, isPip: false };
}

function wirePopoutClose(popDoc) {
    const closeBtn = popDoc.getElementById('browser-popout-close');
    if (!closeBtn) return null;
    const onCloseClick = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        BrowserExternalPopout.popIn();
    };
    closeBtn.addEventListener('click', onCloseClick, true);
    return onCloseClick;
}

export const BrowserExternalPopout = {
    isPoppedOut() {
        return entry != null;
    },

    syncActiveTab,

    getPopoutWindow() {
        if (!entry?.win || entry.win.closed) return null;
        return entry.win;
    },

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
        const btn = el('browser-popout-btn');
        if (!btn) return;
        const popped = this.isPoppedOut();
        btn.classList.toggle('is-active', popped);
        btn.setAttribute('aria-pressed', String(popped));
        if (popped) {
            btn.innerHTML = ACTION_ICONS.pictureInPictureExit;
            btn.title = 'Pop in external browser';
            btn.setAttribute('aria-label', 'Pop in external browser');
        } else {
            btn.innerHTML = BROWSER_EXTERNAL_ICON;
            btn.title = 'Pop out browser to OS window';
            btn.setAttribute('aria-label', 'Pop out browser to OS window');
        }
    },

    async popOut() {
        if (entry) return;
        if (!RemoteModule.isOpen()) {
            showAppToast('Open the remote first');
            return;
        }
        if (RemoteExternalPopout.isPoppedOut()) {
            showAppToast('Pop the remote back in first');
            return;
        }
        if (BrowserPopout.isOpen()) {
            showAppToast('Close the split browser window first');
            return;
        }

        const scroll = scrollEl();
        if (!scroll) return;

        const activeBrowserTab = detectActiveChannelTab();
        const anchors = rememberAnchors();
        const placeholder = createPlaceholder(scroll);

        const opened = await openPopoutWindow();
        if (!opened?.win) {
            placeholder.remove();
            return;
        }

        const { win, isPip } = opened;
        const popDoc = win.document;
        registerAppDocument(popDoc);
        const shell = buildShell(popDoc);
        const chrome = shell.querySelector('.browser-popout-module__chrome');
        const popScroll = shell.querySelector('.browser-popout-module__scroll');
        const popFooter = shell.querySelector('.browser-popout-module__footer');

        const channelBar = el('remote-channel-bar');
        const tools = el('remote-catalog-tools');
        const startActions = startActionsEl();
        const endActions = endActionsEl();

        if (channelBar && chrome) chrome.appendChild(channelBar);
        BROWSER_PANEL_IDS.forEach((id) => {
            const panel = el(id);
            if (panel && popScroll) popScroll.appendChild(panel);
        });
        if (tools && popFooter) {
            popFooter.appendChild(tools);
            tools.classList.add('is-visible');
        }
        if (startActions) popDoc.body.appendChild(startActions);
        if (endActions) popDoc.body.appendChild(endActions);

        scroll.classList.add('is-browser-popout-empty');
        catalogBody()?.classList.add('is-browser-split-active');
        document.body.classList.add('browser-external-popout-active');

        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            this.popIn();
        };
        popDoc.addEventListener('keydown', onKey);
        const onCloseClick = wirePopoutClose(popDoc);

        entry = { placeholder, win, isPip, popDoc, shell, onKey, onCloseClick, anchors };

        syncActiveTab(activeBrowserTab);

        try {
            win.focus();
        } catch {
            /* ignore */
        }

        this.syncBtn();
        window.dispatchEvent(new CustomEvent('browser:external_popout_changed'));
    },

    popIn() {
        if (!entry) return;
        const { placeholder, win, isPip, popDoc, onKey, onCloseClick, anchors } = entry;

        if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);
        const closeBtn = popDoc?.getElementById('browser-popout-close');
        if (closeBtn && onCloseClick) closeBtn.removeEventListener('click', onCloseClick, true);

        const channelBar = el('remote-channel-bar');
        const tools = el('remote-catalog-tools');
        const startActions = startActionsEl();
        const endActions = endActionsEl();
        const scroll = scrollEl();
        const chromeHeader = el('tv-catalog-body')?.querySelector('.remote-module__chrome');

        restoreNode(channelBar, anchors.channelBar);
        if (channelBar && chromeHeader && !chromeHeader.contains(channelBar)) {
            chromeHeader.appendChild(channelBar);
        }

        BROWSER_PANEL_IDS.forEach((id) => {
            const panel = el(id);
            if (panel && scroll) {
                restoreNode(panel, anchors.panels[id]);
                if (!scroll.contains(panel)) scroll.appendChild(panel);
            }
        });

        if (tools && footerEl()) {
            restoreNode(tools, anchors.catalogTools);
            if (!footerEl()?.contains(tools)) footerEl()?.prepend(tools);
        }

        restoreNode(startActions, anchors.startActions);
        restoreNode(endActions, anchors.endActions);

        scroll?.classList.remove('is-browser-popout-empty');
        catalogBody()?.classList.remove('is-browser-split-active');
        placeholder.remove();
        document.body.classList.remove('browser-external-popout-active');

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

        this.syncBtn();
        window.dispatchEvent(new CustomEvent('browser:external_popout_changed'));
    },

    handleWindowClosed() {
        if (!entry) return;
        this.popIn();
    },

    handleIconClick() {
        if (this.isPoppedOut()) {
            this.popIn();
            return;
        }
        if (this.getPopoutWindow()) {
            this.openOrFocus();
            return;
        }
        this.popOut();
    }
};

export const BROWSER_EXTERNAL_ICON = ACTION_ICONS.pictureInPicture;
