export const PROVIDER_IPTV_ORG = 'iptv-org';

/** @param {{ providerId?: string, channelId?: string }} channel */
export function channelKey(channel) {
    if (!channel) return '';
    if (typeof channel === 'string') {
        return channel.includes(':') ? channel : `${PROVIDER_IPTV_ORG}:${channel}`;
    }
    const providerId = channel.providerId || PROVIDER_IPTV_ORG;
    const channelId = channel.channelId || channel.id || '';
    return `${providerId}:${channelId}`;
}

/** @param {string} key */
export function parseChannelKey(key) {
    if (!key) return null;
    if (!key.includes(':')) {
        return { providerId: PROVIDER_IPTV_ORG, channelId: key };
    }
    const idx = key.indexOf(':');
    return {
        providerId: key.slice(0, idx),
        channelId: key.slice(idx + 1)
    };
}

/** Normalize iptv-org channel to common shape. */
export function normalizeChannel(raw, providerId = PROVIDER_IPTV_ORG) {
    if (!raw) return null;
    const channelId = raw.id || raw.channelId;
    if (!channelId || !raw.url_resolved) return null;
    return {
        providerId,
        channelId,
        channeluuid: channelKey({ providerId, channelId }),
        name: raw.name || 'Unknown',
        url_resolved: raw.url_resolved,
        logo: raw.logo || '',
        countrycode: raw.country || raw.countrycode || '',
        categories: Array.isArray(raw.categories) ? raw.categories : [],
        tags: Array.isArray(raw.categories) ? raw.categories.join(', ') : (raw.tags || ''),
        lastcheckok: raw.url_resolved ? 1 : 0
    };
}

/** @param {string|{ providerId?: string, channelId?: string }} ref */
export function migrateFavoriteRef(ref) {
    if (typeof ref === 'string') {
        if (ref.includes(':')) return ref;
        return `${PROVIDER_IPTV_ORG}:${ref}`;
    }
    return channelKey(ref);
}
