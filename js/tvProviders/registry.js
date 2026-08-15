import { IptvOrgTvProvider } from './iptvOrgTv.js';
import { PROVIDER_IPTV_ORG } from './channelShape.js';

const STATE_KEY = 'matrix_tv_state';

const PROVIDERS = {
    [PROVIDER_IPTV_ORG]: IptvOrgTvProvider
};

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return {
            catalogProvider: raw.catalogProvider || PROVIDER_IPTV_ORG,
            hideOfflineChannels: raw.hideOfflineChannels !== false
        };
    } catch {
        return {
            catalogProvider: PROVIDER_IPTV_ORG,
            hideOfflineChannels: true
        };
    }
}

function saveSettings(patch) {
    const current = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    const next = { ...current, ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}

export const TvProviderRegistry = {
    listProviders() {
        return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }));
    },

    getSettings() {
        return loadSettings();
    },

    saveSettings(patch) {
        return saveSettings(patch);
    },

    getActiveProviderId() {
        return loadSettings().catalogProvider;
    },

    getProvider(id) {
        return PROVIDERS[id || loadSettings().catalogProvider] || IptvOrgTvProvider;
    },

    getActiveProvider() {
        return this.getProvider(this.getActiveProviderId());
    },

    async setActiveProvider(providerId) {
        if (!PROVIDERS[providerId]) return;
        const prev = loadSettings().catalogProvider;
        saveSettings({ catalogProvider: providerId });
        if (prev !== providerId) {
            await this.getProvider(prev).invalidateCache?.();
        }
    },

    getHideOffline() {
        return loadSettings().hideOfflineChannels;
    },

    setHideOffline(value) {
        saveSettings({ hideOfflineChannels: !!value });
    },

    async getCountries(opts = {}) {
        return this.getActiveProvider().getCountries(opts);
    },

    async searchChannels(opts = {}) {
        const settings = loadSettings();
        return this.getActiveProvider().searchChannels({
            ...opts,
            hideOffline: opts.hideOffline ?? settings.hideOfflineChannels
        });
    },

    async getChannel(ref, opts = {}) {
        const providerId = ref?.providerId || loadSettings().catalogProvider;
        const channelId = ref?.channelId || ref;
        return this.getProvider(providerId).getChannelById(channelId, opts);
    },

    async getChannelsByRefs(refs, opts = {}) {
        const byProvider = new Map();
        refs.forEach((key) => {
            const parsed = typeof key === 'string' && key.includes(':')
                ? { providerId: key.slice(0, key.indexOf(':')), channelId: key.slice(key.indexOf(':') + 1) }
                : { providerId: PROVIDER_IPTV_ORG, channelId: key };
            if (!byProvider.has(parsed.providerId)) byProvider.set(parsed.providerId, []);
            byProvider.get(parsed.providerId).push(parsed.channelId);
        });

        const results = [];
        for (const [providerId, ids] of byProvider) {
            const provider = this.getProvider(providerId);
            const channels = await provider.getChannelsByIds(ids, opts);
            results.push(...channels);
        }
        return results;
    },

    async refreshCatalog() {
        const provider = this.getActiveProvider();
        await provider.invalidateCache?.();
        return provider.getCountries({ refresh: true });
    },

    async clearActiveCache() {
        await this.getActiveProvider().clearCache?.();
    },

    async clearAllCaches() {
        await Promise.all(Object.values(PROVIDERS).map((p) => p.clearCache?.()));
    }
};
