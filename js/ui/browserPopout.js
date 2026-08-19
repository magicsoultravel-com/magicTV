/** In-page split browser window for browse / favorites / recents tabs. */
import { el } from '../tvUtils.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';
import { browserEndActionsEl, startActionsEl } from './moduleActions.js';

const MIN_W = 520;
const MIN_H = 720;
const VIEW_PAD = 12;
const BROWSER_PANEL_IDS = ['browse-panel', 'favorites-panel', 'recents-panel'];
const CHANNEL_TABS = ['browse', 'favorites', 'recents'];

let open = false;
let bound = false;
/** @type {{ left: number, top: number, width: number, height: number, pointerId: number, mode: string, edge?: string, startX: number, startY: number, originLeft: number, originTop: number, originW: number, originH: number } | null} */
let gesture = null;

const anchors = {
    channelBar: { parent: null, next: null },
    catalogTools: { parent: null, next: null },
    browserEndActions: { parent: null, next: null },
    startActions: { parent: null, next: null },
    panels: /** @type {Record<string, { parent: Element | null, next: ChildNode | null }>} */ ({})
};

function moduleEl() {
    return el('browser-popout-module');
}

function dialogEl() {
    return el('browser-popout-dialog');
}

function hostEl() {
    return el('browser-popout-host');
}

function catalogBody() {
    return el('tv-catalog-body');
}

function scrollEl() {
    return catalogBody()?.querySelector('.remote-module__scroll') ?? null;
}

function footerEl() {
    return catalogBody()?.querySelector('.remote-module__footer') ?? null;
}

function restoreStartActionsHost() {
    const actions = startActionsEl();
    if (!actions) return;
    const host = document.querySelector('#remote-module-host')
        || document.querySelector('#remote-dock-host')
        || el('remote-module-staging');
    if (host && !host.contains(actions)) host.insertBefore(actions, catalogBody());
}

function restoreBrowserEndActionsHost() {
    const actions = browserEndActionsEl();
    if (!actions) return;
    const host = document.querySelector('#remote-module-host')
        || document.querySelector('#remote-dock-host')
        || el('remote-module-staging');
    if (host && !host.contains(actions)) {
        const body = catalogBody();
        if (body && body.parentElement === host) {
            host.insertBefore(actions, body);
        } else {
            host.appendChild(actions);
        }
    }
}

function viewportSize() {
    return {
        w: window.innerWidth || document.documentElement.clientWidth || 800,
        h: window.innerHeight || document.documentElement.clientHeight || 600
    };
}

function defaultGeometry() {
    const { w: vw, h: vh } = viewportSize();
    const width = MIN_W;
    const height = MIN_H;
    return {
        left: Math.round(Math.max(VIEW_PAD, vw - width - VIEW_PAD)),
        top: Math.round(Math.max(VIEW_PAD, vh - height - VIEW_PAD - 48)),
        width,
        height
    };
}

function clampGeometry({ left, top, width, height }) {
    const { w: vw, h: vh } = viewportSize();
    let w = Math.max(MIN_W, Math.min(width, vw - VIEW_PAD * 2));
    let h = Math.max(MIN_H, Math.min(height, vh - VIEW_PAD * 2));
    let x = Math.min(Math.max(VIEW_PAD, left), vw - VIEW_PAD - Math.min(w, 80));
    let y = Math.min(Math.max(VIEW_PAD, top), vh - VIEW_PAD - 40);
    if (x + w > vw - VIEW_PAD) w = Math.max(MIN_W, vw - VIEW_PAD - x);
    if (y + h > vh - VIEW_PAD) h = Math.max(MIN_H, vh - VIEW_PAD - y);
    return { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

function applyGeometry(geom) {
    const dialog = dialogEl();
    if (!dialog) return;
    const next = clampGeometry(geom);
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
}

function getSavedState() {
    return loadPlayerState().browserPopout || null;
}

function persistState(extra = {}) {
    const dialog = dialogEl();
    const payload = { open, ...extra };
    if (dialog) {
        const rect = dialog.getBoundingClientRect();
        payload.left = Math.round(rect.left);
        payload.top = Math.round(rect.top);
        payload.width = Math.round(rect.width);
        payload.height = Math.round(rect.height);
    }
    const prev = getSavedState() || {};
    savePlayerState({
        browserPopout: {
            ...prev,
            ...payload
        }
    });
}

function popoutScrollEl() {
    return document.querySelector('.browser-popout-module__scroll');
}

/** Keep channel tabs in the split window; remote/settings stay in the remote scroll. */
function syncActiveTab(tabName) {
    if (!open) return false;

    const remoteScroll = scrollEl();
    const browserScroll = popoutScrollEl();

    if (CHANNEL_TABS.includes(tabName)) {
        browserScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');

        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el('remote-panel')?.classList.add('is-active');

        persistState({ lastTab: tabName });
        return true;
    }

    if (tabName === 'remote' || tabName === 'settings') {
        remoteScroll?.querySelectorAll('.tv-panel').forEach((p) => p.classList.remove('is-active'));
        el(`${tabName}-panel`)?.classList.add('is-active');
        return true;
    }

    return false;
}

function rememberNode(node, key, panelId) {
    if (!node?.parentElement) return;
    const entry = panelId
        ? (anchors.panels[panelId] ||= { parent: null, next: null })
        : anchors[key];
    if (!entry.parent) {
        entry.parent = node.parentElement;
        entry.next = node.nextSibling;
    }
}

function restoreNode(node, key, panelId) {
    const entry = panelId ? anchors.panels[panelId] : anchors[key];
    if (!node || !entry?.parent) return;
    if (entry.next && entry.next.parentElement === entry.parent) {
        entry.parent.insertBefore(node, entry.next);
    } else {
        entry.parent.appendChild(node);
    }
}

function ensurePopoutShell() {
    const host = hostEl();
    if (!host || host.querySelector('.browser-popout-module__shell')) return;
    host.innerHTML = `<div class="browser-popout-module__shell">
        <header class="browser-popout-module__chrome"></header>
        <div class="browser-popout-module__scroll"></div>
        <footer class="browser-popout-module__footer"></footer>
    </div>`;
}

function mountToPopout() {
    ensurePopoutShell();
    const host = hostEl();
    const shell = host?.querySelector('.browser-popout-module__shell');
    if (!shell) return;

    const chrome = shell.querySelector('.browser-popout-module__chrome');
    const popScroll = shell.querySelector('.browser-popout-module__scroll');
    const popFooter = shell.querySelector('.browser-popout-module__footer');
    const channelBar = el('remote-channel-bar');
    const tools = el('remote-catalog-tools');
    const scroll = scrollEl();
    const actions = browserEndActionsEl();
    const startActions = startActionsEl();

    if (channelBar && chrome) {
        rememberNode(channelBar, 'channelBar');
        chrome.appendChild(channelBar);
    }

    BROWSER_PANEL_IDS.forEach((id) => {
        const panel = el(id);
        if (panel && popScroll) {
            rememberNode(panel, 'panels', id);
            popScroll.appendChild(panel);
        }
    });

    if (tools && popFooter) {
        rememberNode(tools, 'catalogTools');
        popFooter.appendChild(tools);
        tools.classList.add('is-visible');
    }

    if (actions && host) {
        rememberNode(actions, 'browserEndActions');
        host.appendChild(actions);
    }

    if (startActions && host) {
        rememberNode(startActions, 'startActions');
        host.appendChild(startActions);
    }

    if (scroll) {
        scroll.classList.add('is-browser-popout-empty');
    }
    catalogBody()?.classList.add('is-browser-split-active');
}

function restoreFromPopout() {
    const channelBar = el('remote-channel-bar');
    const tools = el('remote-catalog-tools');
    const actions = browserEndActionsEl();
    const startActions = startActionsEl();
    const scroll = scrollEl();
    const chromeHeader = catalogBody()?.querySelector('.remote-module__chrome');

    if (channelBar && chromeHeader) {
        restoreNode(channelBar, 'channelBar');
        if (!chromeHeader.contains(channelBar)) {
            chromeHeader.appendChild(channelBar);
        }
    }

    BROWSER_PANEL_IDS.forEach((id) => {
        const panel = el(id);
        if (panel && scroll) {
            restoreNode(panel, 'panels', id);
            if (!scroll.contains(panel)) scroll.appendChild(panel);
        }
    });

    if (tools && footerEl()) {
        restoreNode(tools, 'catalogTools');
        if (!footerEl()?.contains(tools)) footerEl()?.prepend(tools);
    }

    if (actions) {
        restoreNode(actions, 'browserEndActions');
        restoreBrowserEndActionsHost();
    }

    if (startActions) {
        restoreNode(startActions, 'startActions');
        restoreStartActionsHost();
    }

    scroll?.classList.remove('is-browser-popout-empty');
    catalogBody()?.classList.remove('is-browser-split-active');
    Object.keys(anchors.panels).forEach((k) => delete anchors.panels[k]);
    anchors.channelBar = { parent: null, next: null };
    anchors.catalogTools = { parent: null, next: null };
    anchors.browserEndActions = { parent: null, next: null };
    anchors.startActions = { parent: null, next: null };
}

function syncPopoutChrome() {
    const popoutClose = el('browser-popout-close');
    const remoteClose = el('remote-module-close');
    const remotePin = el('remote-module-pin');
    if (popoutClose) popoutClose.classList.toggle('is-hidden', !open);
    if (remoteClose) remoteClose.classList.toggle('is-hidden', open);
    if (remotePin) remotePin.classList.toggle('is-hidden', open);
}

function updateBodyClasses() {
    document.body.classList.toggle('browser-popout-open', open);
}

function syncPopoutBtn() {
    /* External icon state is owned by BrowserExternalPopout.syncBtn */
}

function restoreGeometry() {
    const saved = getSavedState();
    const geom = defaultGeometry();
    applyGeometry({
        left: Number.isFinite(saved?.left) ? saved.left : geom.left,
        top: Number.isFinite(saved?.top) ? saved.top : geom.top,
        width: Number.isFinite(saved?.width) ? saved.width : geom.width,
        height: Number.isFinite(saved?.height) ? saved.height : geom.height
    });
}

function focusDialog() {
    const dialog = dialogEl();
    if (!dialog) return;
    dialog.focus({ preventScroll: true });
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.mode === 'drag') {
        applyGeometry({
            left: gesture.originLeft + dx,
            top: gesture.originTop + dy,
            width: gesture.originW,
            height: gesture.originH
        });
        return;
    }
    const edge = gesture.edge || '';
    let { originLeft: left, originTop: top, originW: width, originH: height } = gesture;
    if (edge.includes('e')) width = gesture.originW + dx;
    if (edge.includes('s')) height = gesture.originH + dy;
    if (edge.includes('w')) { width = gesture.originW - dx; left = gesture.originLeft + dx; }
    if (edge.includes('n')) { height = gesture.originH - dy; top = gesture.originTop + dy; }
    applyGeometry({ left, top, width, height });
}

function endGesture() {
    gesture = null;
    dialogEl()?.classList.remove('is-dragging');
    persistState();
}

function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    endGesture();
}

function beginGesture(e, modeName, edge = '') {
    if (e.button != null && e.button !== 0) return;
    const dialog = dialogEl();
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    gesture = {
        mode: modeName,
        edge,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        originW: rect.width,
        originH: rect.height
    };
    if (modeName === 'drag') dialog.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    e.preventDefault();
}

function bindOnce() {
    if (bound) return;
    bound = true;

    const dialog = dialogEl();
    dialog?.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('button, input, select, textarea, a, .channel-tile, .country-tile, [data-browser-popout-resize]')) return;
        beginGesture(e, 'drag');
    });

    moduleEl()?.querySelectorAll('[data-browser-popout-resize]').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginGesture(e, 'resize', handle.getAttribute('data-browser-popout-resize') || '');
        });
    });

    el('browser-popout-close')?.addEventListener('click', () => {
        BrowserPopout.close();
    });

    window.addEventListener('resize', () => {
        if (open) applyGeometry(dialogEl()?.getBoundingClientRect() ?? defaultGeometry());
    });
}

export const BrowserPopout = {
    init({ activeTab } = {}) {
        bindOnce();
        const saved = getSavedState();
        syncPopoutChrome();
        if (saved?.open && SettingsStore.getBrowserPopoutPreferOpen()) {
            const tab = CHANNEL_TABS.includes(activeTab)
                ? activeTab
                : (CHANNEL_TABS.includes(saved.lastTab) ? saved.lastTab : 'browse');
            this.open({ browserTab: tab, persist: false });
            return tab;
        }
        return null;
    },

    isOpen() {
        return open;
    },

    syncActiveTab,

    open({ browserTab = null, persist = true } = {}) {
        if (open) {
            if (browserTab) syncActiveTab(browserTab);
            focusDialog();
            return;
        }
        if (document.body.classList.contains('browser-external-popout-active')) {
            showAppToast('Pop in external browser first');
            return;
        }
        bindOnce();
        open = true;
        const modal = moduleEl();
        if (modal) {
            modal.hidden = false;
            modal.classList.remove('is-hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
        restoreGeometry();
        mountToPopout();
        const saved = getSavedState();
        const tab = browserTab
            || (CHANNEL_TABS.includes(saved?.lastTab) ? saved.lastTab : 'browse');
        syncActiveTab(tab);
        updateBodyClasses();
        syncPopoutChrome();
        focusDialog();
        if (persist) persistState({ open: true, lastTab: tab });
    },

    close({ persist = true } = {}) {
        if (!open) return;
        const lastTab = getSavedState()?.lastTab || null;
        open = false;
        restoreFromPopout();
        const modal = moduleEl();
        if (modal) {
            modal.hidden = true;
            modal.classList.add('is-hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        updateBodyClasses();
        syncPopoutChrome();
        if (persist) persistState({ open: false });
        window.dispatchEvent(new CustomEvent('browser:split_closed', { detail: { lastTab } }));
    },

    syncPopoutChrome,
    syncPopoutBtn
};

export const BROWSER_POPOUT_ICON = CARD_ICONS.popout;
