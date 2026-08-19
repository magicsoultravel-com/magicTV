/** External-window popout for the live remote (Document PiP + popup fallback). */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { RemoteModule } from './remoteModule.js';
import { BrowserPopout } from './browserPopout.js';
import { CARD_ICONS } from './icons.js';
import { browserEndActionsEl, isBrowserSeparated, remoteEndActionsEl, startActionsEl } from './moduleActions.js';
import {
    shouldUseDocumentPipFor,
    requestPipWindow,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    unregisterPipWindow,
    windowNameForRemote,
    remotePopoutSize,
    isPipOccupied
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from '../appDocuments.js';

const PLACEHOLDER_ID = 'remote-external-popout-placeholder';

/** @type {{
 *   placeholder: HTMLElement,
 *   win: Window,
 *   isPip: boolean,
 *   popDoc: Document,
 *   onKey?: (e: KeyboardEvent) => void,
 *   onCloseClick?: (e: Event) => void,
 *   anchors: {
 *     body: { parent: Element | null, next: ChildNode | null },
 *     startActions: { parent: Element | null, next: ChildNode | null },
 *     browserEndActions: { parent: Element | null, next: ChildNode | null },
 *     remoteEndActions: { parent: Element | null, next: ChildNode | null },
 *     host: Element | null
 *   }
 * } | null} */
let entry = null;

function catalogBody() {
    return el('tv-catalog-body');
}

function startActionsElLocal() {
    return startActionsEl();
}

function remoteEndActionsElLocal() {
    return remoteEndActionsEl();
}

function browserEndActionsElLocal() {
    return browserEndActionsEl();
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

function getActiveMountHost() {
    const body = catalogBody();
    if (!body) return null;
    return body.closest('#remote-module-host')
        || body.closest('#remote-dock-host')
        || el('remote-module-staging');
}

function createPlaceholder(host) {
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

    if (host) {
        const rect = host.getBoundingClientRect?.();
        if (rect?.width) placeholder.style.minWidth = `${Math.round(rect.width)}px`;
        if (rect?.height) placeholder.style.minHeight = `${Math.round(Math.max(rect.height, 120))}px`;
    }

    return placeholder;
}

async function openPopoutWindow() {
    const { w, h } = remotePopoutSize();
    const owner = { type: 'module', id: 'remote' };
    const onPageHide = () => RemoteExternalPopout.handleWindowClosed();

    if (shouldUseDocumentPipFor(owner)) {
        if (isPipOccupied()) {
            showAppToast('Another popout window is already open');
            return null;
        }
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

function prepPopoutDocument(popDoc) {
    if (!popDoc?.body) return;
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'remote-popout-body';
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

    return {
        onCloseClick,
        prevTitle,
        prevLabel
    };
}

function hideInPageRemoteChrome() {
    document.body.classList.add('remote-external-popout-active');
}

function showInPageRemoteChrome() {
    document.body.classList.remove('remote-external-popout-active');
}

export const RemoteExternalPopout = {
    isPoppedOut() {
        return entry != null;
    },

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
        const btn = el('remote-external-popout-btn');
        if (!btn) return;
        const remoteOpen = RemoteModule.isOpen();
        btn.classList.toggle('is-hidden', !remoteOpen);
        const popped = this.isPoppedOut();
        btn.innerHTML = popped ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
        btn.classList.toggle('is-active', popped);
        btn.setAttribute('aria-pressed', String(popped));
        const label = popped ? 'Pop in remote' : 'Pop out remote';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    async popOut() {
        if (entry) return;
        if (!RemoteModule.isOpen()) {
            showAppToast('Open the remote first');
            return;
        }
        if (BrowserPopout.isOpen()) BrowserPopout.close();

        const body = catalogBody();
        const startActions = startActionsElLocal();
        const remoteEndActions = remoteEndActionsElLocal();
        const browserEndActions = browserEndActionsElLocal();
        const host = getActiveMountHost();
        if (!body || !host) return;

        const anchors = {
            body: captureAnchor(body),
            startActions: captureAnchor(startActions),
            browserEndActions: captureAnchor(browserEndActions),
            remoteEndActions: captureAnchor(remoteEndActions),
            host
        };

        const placeholder = createPlaceholder(host);
        host.appendChild(placeholder);

        const opened = await openPopoutWindow();
        if (!opened?.win) {
            placeholder.remove();
            return;
        }

        const { win, isPip } = opened;
        const popDoc = win.document;
        prepPopoutDocument(popDoc);
        registerAppDocument(popDoc);

        if (startActions && !isBrowserSeparated()) popDoc.body.appendChild(startActions);
        if (browserEndActions && !isBrowserSeparated()) popDoc.body.appendChild(browserEndActions);
        if (remoteEndActions) popDoc.body.appendChild(remoteEndActions);
        popDoc.body.appendChild(body);
        body.classList.add('is-remote-popout-live');

        hideInPageRemoteChrome();

        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            this.popIn();
        };
        popDoc.addEventListener('keydown', onKey);

        const closeWire = wirePopoutChrome(popDoc);

        entry = {
            placeholder,
            win,
            isPip,
            popDoc,
            onKey,
            onCloseClick: closeWire?.onCloseClick,
            anchors,
            closeWire
        };

        try {
            win.focus();
        } catch {
            /* ignore */
        }

        this.syncBtn();
        window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
    },

    popIn() {
        if (!entry) return;
        const {
            placeholder,
            win,
            isPip,
            popDoc,
            onKey,
            onCloseClick,
            anchors,
            closeWire
        } = entry;

        if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

        const body = catalogBody();
        const startActions = startActionsElLocal();
        const remoteEndActions = remoteEndActionsElLocal();
        const browserEndActions = browserEndActionsElLocal();

        if (body) body.classList.remove('is-remote-popout-live');

        restoreNode(startActions, anchors.startActions);
        restoreNode(browserEndActions, anchors.browserEndActions);
        restoreNode(remoteEndActions, anchors.remoteEndActions);
        restoreNode(body, anchors.body);

        const closeBtn = popDoc?.getElementById('remote-module-close');
        if (closeBtn && onCloseClick) {
            closeBtn.removeEventListener('click', onCloseClick, true);
            if (closeWire) {
                closeBtn.title = closeWire.prevTitle || 'Close';
                closeBtn.setAttribute('aria-label', closeWire.prevLabel || 'Close');
            }
        }

        placeholder.remove();
        showInPageRemoteChrome();

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
        window.dispatchEvent(new CustomEvent('remote:external_popout_changed'));
    },

    handleWindowClosed() {
        if (!entry) return;
        this.popIn();
    }
};
