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
