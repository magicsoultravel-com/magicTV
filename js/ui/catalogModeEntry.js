/**
 * Entry-point ownership for shared browser catalog mode (tv | radio).
 * TV surfaces always open TV catalog; only Radio Browse opens radio.
 */

export const BROWSER_TABS = Object.freeze(['browse', 'favorites', 'recents', 'settings']);

/** @typedef {'remote-shell' | 'browser-shell' | 'chrome-tile' | 'radio-module' | 'welcome'} CatalogEntrySource */

/**
 * Which catalog mode an entry point should open.
 * @param {CatalogEntrySource} source
 * @returns {'tv' | 'radio' | 'keep'}
 */
export function catalogModeForEntry(source) {
    if (source === 'radio-module') return 'radio';
    if (source === 'browser-shell') return 'keep';
    // remote-shell, chrome-tile, welcome → always TV
    return 'tv';
}

export function isBrowserCatalogTab(tab) {
    return BROWSER_TABS.includes(tab);
}

/**
 * Pure decision table behind `RemoteModule.revealCatalog()`: what has to move
 * before a catalog entry point may paint its panels.
 *
 * A catalog can be "open" and still be invisible — a collapsed docked sheet, the
 * mini keypad pad, or a hidden split Browser pane. Painting into any of those
 * makes a Browse click look like a no-op, so every entry reveals first.
 *
 * @param {{
 *   mode?: 'hidden' | 'docked' | 'undocked',
 *   miniFloating?: boolean,
 *   sheetExpanded?: boolean,
 *   split?: boolean,
 *   browserHostKind?: 'docked' | 'undocked' | 'hidden' | 'os' | null
 * }} state
 * @returns {{
 *   exitMini: boolean,
 *   open: boolean,
 *   expandSheet: boolean,
 *   revealBrowser: 'docked' | 'undocked' | null
 * }}
 */
export function catalogEntryReveal({
    mode = 'hidden',
    miniFloating = false,
    sheetExpanded = false,
    split = false,
    browserHostKind = null
} = {}) {
    const exitMini = miniFloating === true;
    // Mini always floats: leaving it restores an expanded float, never a sheet.
    const open = !exitMini && mode !== 'docked' && mode !== 'undocked';
    const expandSheet = !exitMini && mode === 'docked' && sheetExpanded !== true;

    let revealBrowser = null;
    if (split === true) {
        const kind = browserHostKind || 'undocked';
        // Only a hidden (or OS-popped) Browser pane swallows the paint; docked and
        // undocked panes are on screen already. Restoring as a float keeps the
        // saved `layout.browser` geometry.
        if (kind === 'hidden' || kind === 'os') revealBrowser = 'undocked';
    }

    return { exitMini, open, expandSheet, revealBrowser };
}
