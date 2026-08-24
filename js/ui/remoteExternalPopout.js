/** External-window popout for the live remote (Document PiP + popup fallback). */
import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { RemoteModule } from './remoteModule.js';
import { CARD_ICONS } from './icons.js';
import {
    shouldUseDocumentPipFor,
    requestPipWindow,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    unregisterPipWindow,
    windowNameForRemote,
    remotePopoutSize
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from '../appDocuments.js';
import { browserShellEl } from './moduleLayout.js';

const PLACEHOLDER_ID = 'remote-external-popout-placeholder';
const EXTERNAL_HOST_ID = 'remote-external-host';

/** @type {{
 *   placeholder: HTMLElement,
 *   win: Window,
 *   isPip: boolean,
 *   popDoc: Document,
 *   host: HTMLElement,
 *   onKey?: (e: KeyboardEvent) => void,
 *   closeWire?: { onCloseClick: (e: Event) => void, prevTitle: string, prevLabel: string | null }
 * } | null} */
let entry = null;

function catalogBody() {
    return el('tv-catalog-body');
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

function createPlaceholder(mountHost) {
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

    if (mountHost) {
        const rect = mountHost.getBoundingClientRect?.();
        if (rect?.width) placeholder.style.minWidth = `${Math.round(rect.width)}px`;
        if (rect?.height) placeholder.style.minHeight = `${Math.round(Math.max(rect.height, 120))}px`;
        mountHost.appendChild(placeholder);
    }

    return placeholder;
}

function prepPopoutDocument(popDoc) {
    if (!popDoc?.body) return null;
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'remote-popout-body';
    const host = popDoc.createElement('div');
    host.id = EXTERNAL_HOST_ID;
    host.className = 'remote-module__host';
    popDoc.body.appendChild(host);
    return host;
}

async function openPopoutWindow() {
    const { w, h } = remotePopoutSize();
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

function updateBodyClasses() {
    document.body.classList.add(
        'remote-external-popout-active',
        'remote-external-popout-active--unified',
        'remote-external-popout-active--full'
    );
}

function clearBodyClasses() {
    document.body.classList.remove(
        'remote-external-popout-active',
        'remote-external-popout-active--unified',
        'remote-external-popout-active--full',
        'remote-external-popout-active--solo'
    );
}

/** Keep catalog panels in sync (joined shell, split shells, and OS popout). */
function syncActiveTab(tabName) {
    ['remote', 'browse', 'favorites', 'recents', 'settings'].forEach((name) => {
        const panel = el(`${name}-panel`);
        if (panel) panel.classList.toggle('is-active', name === tabName);
    });
    return Boolean(catalogBody() || browserShellEl());
}

async function popOut() {
    const returnHost = RemoteModule.getInPageHost();
    if (!catalogBody() || !returnHost) return;

    const activeTab = detectActiveTab();
    const placeholder = createPlaceholder(returnHost);

    const opened = await openPopoutWindow();
    if (!opened?.win) {
        placeholder.remove();
        return;
    }

    const { win, isPip } = opened;
    const popDoc = win.document;
    const host = prepPopoutDocument(popDoc);
    if (!host) {
        placeholder.remove();
        return;
    }

    registerAppDocument(popDoc);
    RemoteModule.setExternalHost(host);
    RemoteModule.mountTo(host);

    updateBodyClasses();

    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        RemoteExternalPopout.popIn();
    };
    popDoc.addEventListener('keydown', onKey);
    const closeWire = wirePopoutChrome(popDoc);

    entry = {
        placeholder,
        win,
        isPip,
        popDoc,
        host,
        onKey,
        closeWire
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

function popIn() {
    if (!entry) return;

    const {
        placeholder,
        win,
        isPip,
        popDoc,
        onKey,
        closeWire
    } = entry;

    if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

    const closeBtn = popDoc?.getElementById('remote-module-close');
    if (closeBtn && closeWire?.onCloseClick) {
        closeBtn.removeEventListener('click', closeWire.onCloseClick, true);
        closeBtn.title = closeWire.prevTitle || 'Close';
        closeBtn.setAttribute('aria-label', closeWire.prevLabel || 'Close');
    }

    RemoteModule.returnFromExternal();

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
        return entry != null;
    },

    syncActiveTab,

    getPopoutWindow() {
        if (!entry?.win || entry.win.closed) return null;
        return entry.win;
    },

    getPopoutScrollEl() {
        return catalogBody()?.querySelector('.remote-module__scroll') ?? null;
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

    syncBodyClasses() {
        if (!entry) return;
        updateBodyClasses();
    },

    async popOut() {
        if (entry) return;
        if (!RemoteModule.isOpen()) {
            showAppToast('Open the remote first');
            return;
        }
        await popOut();
    },

    popIn() {
        popIn();
    },

    handleWindowClosed() {
        if (!entry) return;
        this.popIn();
    }
};
