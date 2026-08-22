/**
 * Legacy feed key helper — used by epgStore feed blob cache.
 * @param {string} url
 */
export function feedKey(url) {
    return url.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}
