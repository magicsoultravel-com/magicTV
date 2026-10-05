export const PROVIDER_RADIO_BROWSER = 'radio-browser';
export const PROVIDER_IPTV_ORG = 'iptv-org';

/** Unwrap repeated provider prefixes: radio-browser:radio-browser:uuid → bare id + provider. */
function resolveStationId(rawId, fallbackProvider = PROVIDER_RADIO_BROWSER) {
    if (!rawId || typeof rawId !== 'string') {
        return { providerId: fallbackProvider, stationId: '' };
    }
    let providerId = fallbackProvider;
    let stationId = rawId;
    // Keep peeling provider: prefixes until the id no longer looks like a keyed ref
    for (let i = 0; i < 4 && stationId.includes(':'); i += 1) {
        const idx = stationId.indexOf(':');
        const maybeProvider = stationId.slice(0, idx);
        const rest = stationId.slice(idx + 1);
        if (maybeProvider === PROVIDER_RADIO_BROWSER || maybeProvider === PROVIDER_IPTV_ORG) {
            providerId = maybeProvider;
            stationId = rest;
            continue;
        }
        break;
    }
    return { providerId, stationId };
}

/** @param {{ providerId?: string, stationId?: string, stationuuid?: string }} station */
export function stationKey(station) {
    if (!station) return '';
    if (typeof station === 'string') {
        return migrateFavoriteRef(station);
    }
    const providerId = station.providerId || PROVIDER_RADIO_BROWSER;
    const rawId = station.stationId || station.stationuuid || '';
    const resolved = resolveStationId(rawId, providerId);
    if (!resolved.stationId) return '';
    return `${resolved.providerId}:${resolved.stationId}`;
}

/** @param {string} key */
export function parseStationKey(key) {
    if (!key) return null;
    const migrated = migrateFavoriteRef(key);
    const idx = migrated.indexOf(':');
    if (idx < 0) {
        return { providerId: PROVIDER_RADIO_BROWSER, stationId: migrated };
    }
    return {
        providerId: migrated.slice(0, idx),
        stationId: migrated.slice(idx + 1)
    };
}

/** Normalize any provider record to a common station shape. */
export function normalizeStation(raw, providerId = PROVIDER_RADIO_BROWSER) {
    if (!raw) return null;

    if (providerId === PROVIDER_IPTV_ORG) {
        const resolved = resolveStationId(raw.id || raw.stationId || '', PROVIDER_IPTV_ORG);
        const stationId = resolved.stationId;
        if (!stationId || !raw.url_resolved) return null;
        return {
            providerId: PROVIDER_IPTV_ORG,
            stationId,
            stationuuid: stationKey({ providerId: PROVIDER_IPTV_ORG, stationId }),
            name: raw.name || 'Unknown',
            url_resolved: raw.url_resolved,
            favicon: raw.logo || raw.favicon || '',
            countrycode: raw.country || raw.countrycode || '',
            tags: Array.isArray(raw.categories) ? raw.categories.join(', ') : (raw.tags || ''),
            lastcheckok: raw.url_resolved ? 1 : 0
        };
    }

    // Prefer bare stationId; unwrap compound stationuuid so re-normalize is idempotent
    const resolved = resolveStationId(
        raw.stationId || raw.stationuuid || '',
        PROVIDER_RADIO_BROWSER
    );
    const stationId = resolved.stationId;
    if (!stationId) return null;
    return {
        providerId: PROVIDER_RADIO_BROWSER,
        stationId,
        stationuuid: stationKey({ providerId: PROVIDER_RADIO_BROWSER, stationId }),
        name: raw.name || 'Unknown',
        url_resolved: raw.url_resolved || raw.url || '',
        favicon: raw.favicon || '',
        countrycode: raw.countrycode || '',
        tags: raw.tags || '',
        bitrate: raw.bitrate,
        lastcheckok: raw.lastcheckok
    };
}

/** @param {string|{ providerId?: string, stationId?: string }} ref */
export function migrateFavoriteRef(ref) {
    if (typeof ref === 'string') {
        const resolved = resolveStationId(
            ref.includes(':') ? ref : `${PROVIDER_RADIO_BROWSER}:${ref}`,
            PROVIDER_RADIO_BROWSER
        );
        if (!resolved.stationId) return '';
        return `${resolved.providerId}:${resolved.stationId}`;
    }
    return stationKey(ref);
}
