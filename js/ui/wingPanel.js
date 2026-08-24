/**
 * Wing panel SSOT — shared right-side wing for TV guide and joined-mode browser.
 * Modes: closed | guide | browser
 */
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { isSplit } from './moduleLayout.js';

/** @typedef {'closed'|'guide'|'browser'} WingMode */

/** @type {WingMode} */
let wingMode = 'closed';
let guideOpenPref = false;
/** @type {string|null} */
let activeTab = 'remote';

function syncBodyClasses() {
    const body = document.body;
    if (!body) return;

    const dockExpanded = wingMode !== 'closed';
    body.classList.toggle('remote-dock-expanded', dockExpanded);
    body.classList.toggle('remote-wing-open', wingMode === 'guide');
    body.classList.toggle('remote-wing-mode-guide', wingMode === 'guide');
    body.classList.toggle('remote-wing-mode-browser', wingMode === 'browser');
    body.classList.toggle('remote-guide-open', wingMode === 'guide');
}

function persistGuideOpen() {
    const state = loadPlayerState();
    savePlayerState({
        remoteModule: {
            ...(state.remoteModule || {}),
            guideOpen: guideOpenPref
        }
    });
}

function applyMode(mode, { silent = false } = {}) {
    const next = mode === 'guide' || mode === 'browser' ? mode : 'closed';
    if (wingMode === next) {
        syncBodyClasses();
        return next;
    }
    wingMode = next;
    syncBodyClasses();

    const panel = document.getElementById('guide-panel');
    if (panel) panel.setAttribute('aria-hidden', String(next !== 'guide'));

    if (!silent) {
        window.dispatchEvent(new CustomEvent('wing:mode_changed', {
            detail: { mode: next, open: next !== 'closed' }
        }));
    }
    return next;
}

function resolveModeForTab(tab) {
    activeTab = tab || 'remote';
    if (isSplit()) {
        return tab === 'remote' && guideOpenPref ? 'guide' : 'closed';
    }
    if (tab === 'remote') {
        return guideOpenPref ? 'guide' : 'closed';
    }
    return 'browser';
}

export const WingPanel = {
    init() {
        const saved = loadPlayerState().remoteModule || {};
        guideOpenPref = saved.guideOpen === true;
        wingMode = 'closed';
        syncBodyClasses();
    },

    /** @param {string} tab */
    syncForTab(tab) {
        activeTab = tab || 'remote';
        applyMode(resolveModeForTab(activeTab));
    },

    getMode() {
        return wingMode;
    },

    isOpen() {
        return wingMode !== 'closed';
    },

    isGuideMode() {
        return wingMode === 'guide';
    },

    isBrowserMode() {
        return wingMode === 'browser';
    },

    isGuidePreferred() {
        return guideOpenPref;
    },

    setGuideOpen(open, { silent = false } = {}) {
        guideOpenPref = open === true;
        persistGuideOpen();
        if (activeTab === 'remote') {
            applyMode(guideOpenPref ? 'guide' : 'closed', { silent });
        }
        if (!silent && guideOpenPref && wingMode === 'guide') {
            window.dispatchEvent(new CustomEvent('guide:visibility_changed', {
                detail: { visible: true }
            }));
        } else if (!silent && !guideOpenPref) {
            window.dispatchEvent(new CustomEvent('guide:visibility_changed', {
                detail: { visible: false }
            }));
        }
        return guideOpenPref;
    },

    toggleGuide() {
        return this.setGuideOpen(!guideOpenPref);
    }
};
