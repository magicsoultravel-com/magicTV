/** Product priority countries — smoke tests and favorites prefetch ordering. */
export const PRIORITY_COUNTRIES = [
    'US', 'UK', 'IT', 'ES', 'SE', 'PE', 'MX', 'AR', 'CA', 'DE'
];

/** iptv-org countrycode → epg.pw feed file code */
export const EPG_PW_ALIASES = { UK: 'GB' };

/** Countries with a verified epg.pw XML feed (HEAD 200). */
export const EPG_PW_COUNTRIES = new Set([
    'AU', 'BR', 'CA', 'CN', 'FR', 'DE', 'HK', 'IN', 'ID', 'JP', 'MY', 'NZ',
    'PH', 'RU', 'SG', 'ZA', 'KR', 'ES', 'TW', 'TH', 'US', 'VN', 'GB'
]);

/**
 * @param {string} [countryCode]
 * @returns {string|null}
 */
export function epgPwFeedCode(countryCode) {
    if (!countryCode) return null;
    const cc = countryCode.toUpperCase();
    const mapped = EPG_PW_ALIASES[cc] || cc;
    return EPG_PW_COUNTRIES.has(mapped) ? mapped : null;
}

/**
 * @typedef {{ url: string, format: string, label: string, indexOnly?: boolean, inherit?: string }} RegionalFeedEntry
 */

/** Regional XMLTV feeds when epg.pw misses or has no feed. */
export const REGIONAL_FEEDS = {
    MX: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_MX1.xml.gz', format: 'GZIP', label: 'epgshare MX' }],
    AR: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz', format: 'GZIP', label: 'epgshare AR' }],
    PE: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_PE1.xml.gz', format: 'GZIP', label: 'epgshare PE' }],
    SE: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_SE1.xml.gz', format: 'GZIP', label: 'epgshare SE' }],
    IT: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz', format: 'GZIP', label: 'epgshare IT' }],
    ES: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz', format: 'GZIP', label: 'epgshare ES' }],
    DE: [{ url: 'https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz', format: 'GZIP', label: 'epgshare DE' }],
    UK: [{
        url: 'https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml',
        format: 'XML',
        label: 'Freeview EPG',
        indexOnly: true
    }],
    GB: [{ inherit: 'UK' }]
};

export const FAST_FEEDS = [
    { service: 'PlutoTV', url: 'https://i.mjh.nz/PlutoTV/all.xml', label: 'Pluto TV' },
    { service: 'SamsungTVPlus', url: 'https://i.mjh.nz/SamsungTVPlus/all.xml', label: 'Samsung TV+' },
    { service: 'Plex', url: 'https://i.mjh.nz/Plex/all.xml', label: 'Plex' },
    { service: 'Roku', url: 'https://i.mjh.nz/Roku/all.xml', label: 'Roku' }
];

/**
 * Resolve regional feed entries for a country (handles inherit).
 * @param {string} [countryCode]
 * @returns {RegionalFeedEntry[]}
 */
export function regionalFeedsFor(countryCode) {
    if (!countryCode) return [];
    const cc = countryCode.toUpperCase();
    const raw = REGIONAL_FEEDS[cc];
    if (!raw?.length) return [];
    /** @type {RegionalFeedEntry[]} */
    const out = [];
    for (const entry of raw) {
        if (entry.inherit) {
            out.push(...regionalFeedsFor(entry.inherit));
        } else if (entry.url) {
            out.push(entry);
        }
    }
    return out;
}
