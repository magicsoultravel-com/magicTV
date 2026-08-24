/**
 * Layout SSOT for catalog shells (Remote / Browser).
 * Catalog content (activeTab, lists) stays in appState — this only owns joined|split and hosts.
 */
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';

export const SHELL_REMOTE = 'remote';
export const SHELL_BROWSER = 'browser';

/** @typedef {'joined'|'split'} LayoutMode */
/** @typedef {'hidden'|'docked'|'undocked'|'os'} HostKind */

const DEFAULT_BROWSER_GEOM = Object.freeze({
    left: 300,
    top: 48,
    width: 320,
    height: 600
});

/** @type {{
 *   mode: LayoutMode,
 *   remoteHostKind: HostKind,
 *   browserHostKind: HostKind | null,
 *   browser: { left: number, top: number, width: number, height: number, pinned: boolean },
 * }} */
let layout = {
    mode: 'joined',
    remoteHostKind: 'hidden',
    browserHostKind: null,
    browser: { ...DEFAULT_BROWSER_GEOM, pinned: false }
};

/** @type {null | (() => void)} */
let reconcileFn = null;

function clampBrowserGeom(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const left = Number(src.left);
    const top = Number(src.top);
    const width = Number(src.width);
    const height = Number(src.height);
    return {
        left: Number.isFinite(left) ? left : DEFAULT_BROWSER_GEOM.left,
        top: Number.isFinite(top) ? top : DEFAULT_BROWSER_GEOM.top,
        width: Number.isFinite(width) && width >= 240 ? width : DEFAULT_BROWSER_GEOM.width,
        height: Number.isFinite(height) && height >= 320 ? height : DEFAULT_BROWSER_GEOM.height,
        pinned: src.pinned === true
    };
}

export function normalizeLayoutState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const mode = src.mode === 'split' ? 'split' : 'joined';
    const remoteHostKind = ['hidden', 'docked', 'undocked', 'os'].includes(src.remoteHostKind)
        ? src.remoteHostKind
        : 'hidden';
    let browserHostKind = src.browserHostKind;
    if (mode === 'joined') browserHostKind = null;
    else if (!['docked', 'undocked', 'os'].includes(browserHostKind)) browserHostKind = 'undocked';
    return {
        mode,
        remoteHostKind,
        browserHostKind,
        browser: clampBrowserGeom(src.browser)
    };
}

export function hydrateLayoutFromPlayerState() {
    const saved = loadPlayerState().remoteModule;
    if (!saved || typeof saved !== 'object') return getLayoutState();
    const next = normalizeLayoutState(saved.layout);
    // Legacy open/mode still drives remote host when layout omitted host kinds.
    if (!saved.layout) {
        if (saved.open === true) {
            next.remoteHostKind = saved.mode === 'undocked' ? 'undocked' : 'docked';
        } else {
            next.remoteHostKind = 'hidden';
        }
        next.mode = 'joined';
        next.browserHostKind = null;
    }
    layout = next;
    return getLayoutState();
}

export function getLayoutState() {
    return {
        mode: layout.mode,
        remoteHostKind: layout.remoteHostKind,
        browserHostKind: layout.browserHostKind,
        browser: { ...layout.browser }
    };
}

export function isSplit() {
    return layout.mode === 'split';
}

export function isJoined() {
    return layout.mode === 'joined';
}

export function setReconcileHandler(fn) {
    reconcileFn = typeof fn === 'function' ? fn : null;
}

export function reconcileLayout() {
    reconcileFn?.();
}

function persistLayoutSlice() {
    const prev = loadPlayerState().remoteModule || {};
    savePlayerState({
        remoteModule: {
            ...prev,
            layout: getLayoutState()
        }
    });
}

/**
 * @param {Partial<{ mode: LayoutMode, remoteHostKind: HostKind, browserHostKind: HostKind | null, browser: object }>} patch
 * @param {{ persist?: boolean, reconcile?: boolean }} [opts]
 */
export function patchLayout(patch = {}, { persist = true, reconcile = true } = {}) {
    if (patch.mode === 'joined' || patch.mode === 'split') layout.mode = patch.mode;
    if (patch.remoteHostKind != null) layout.remoteHostKind = patch.remoteHostKind;
    if (patch.browserHostKind !== undefined) layout.browserHostKind = patch.browserHostKind;
    if (patch.browser && typeof patch.browser === 'object') {
        layout.browser = clampBrowserGeom({ ...layout.browser, ...patch.browser });
    }
    if (layout.mode === 'joined') layout.browserHostKind = null;
    if (persist) persistLayoutSlice();
    if (reconcile) reconcileLayout();
    return getLayoutState();
}

/** Split Browser into its own in-page (or later OS) host; catalog tab state unchanged. */
export function splitBrowser({ hostKind = 'undocked' } = {}) {
    const kind = ['docked', 'undocked', 'os'].includes(hostKind) ? hostKind : 'undocked';
    return patchLayout({
        mode: 'split',
        browserHostKind: kind
    });
}

/** Rejoin Browser into the Remote window; preserves appState.activeTab. */
export function joinBrowser() {
    return patchLayout({
        mode: 'joined',
        browserHostKind: null
    });
}

export function remoteShellEl() {
    return typeof document !== 'undefined' ? document.getElementById('remote-shell') : null;
}

export function browserShellEl() {
    return typeof document !== 'undefined' ? document.getElementById('browser-shell') : null;
}

export function catalogRootEl() {
    return typeof document !== 'undefined' ? document.getElementById('tv-catalog-body') : null;
}

/** Apply joined/split classes on the catalog root (when present in a document). */
export function syncCatalogRootClasses(root = catalogRootEl()) {
    if (!root) return;
    root.classList.toggle('module-layout--joined', layout.mode === 'joined');
    root.classList.toggle('module-layout--split', layout.mode === 'split');
    root.dataset.layoutMode = layout.mode;
}
