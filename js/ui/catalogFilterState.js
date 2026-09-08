/**
 * Per-tab catalog text-filter helpers for the shared #search-countries input.
 * Favorites/recents keep their own stored query; entering a tab restores it
 * into the input instead of clobbering state from whatever browse left behind.
 */

/** @param {string} tabName
 *  @param {{ favFilter?: string, recentsFilter?: string, countryFilter?: string, browseQuery?: string, browseCountry?: string | null }} appState */
export function catalogFilterValueForTab(tabName, appState = {}) {
    if (tabName === 'favorites') return String(appState.favFilter || '');
    if (tabName === 'recents') return String(appState.recentsFilter || '');
    if (tabName === 'browse') {
        return appState.browseCountry != null
            ? String(appState.browseQuery || '')
            : String(appState.countryFilter || '');
    }
    return '';
}

/**
 * Write the tab's stored filter into the shared search input.
 * Does not mutate favFilter/recentsFilter from the input value.
 * @param {{ value?: string } | null | undefined} searchEl
 * @param {string} tabName
 * @param {object} appState
 */
export function applyCatalogFilterInput(searchEl, tabName, appState) {
    if (!searchEl) return;
    searchEl.value = catalogFilterValueForTab(tabName, appState);
}
