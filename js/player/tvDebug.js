/** Zero-cost when disabled — `?tv-debug=1` enables player pipeline logging. */
let enabled = null;

function isEnabled() {
    if (enabled !== null) return enabled;
    if (typeof window === 'undefined' || !window.location?.search) {
        enabled = false;
        return false;
    }
    enabled = new URLSearchParams(window.location.search).get('tv-debug') === '1';
    return enabled;
}

/**
 * @param {string} scope
 * @param {string} message
 * @param {object} [detail]
 */
export function tvDebug(scope, message, detail) {
    if (!isEnabled()) return;
    if (detail !== undefined) {
        console.debug(`[magicTV:${scope}]`, message, detail);
    } else {
        console.debug(`[magicTV:${scope}]`, message);
    }
}
