import { IptvOrgTvProvider } from './iptvOrgTv.js';
import { PROVIDER_IPTV_ORG } from './channelShape.js';
import { readPersistedState, patchPersistedState } from '../storage/persistedState.js';

const PROVIDERS = {
    [PROVIDER_IPTV_ORG]: IptvOrgTvProvider
};

function loadSettings() {
    try {
        const raw = readPersistedState();
        return {
            catalogProvider: raw.catalogProvider || PROVIDER_IPTV_ORG
        };
    } catch {
        return {
            catalogProvider: PROVIDER_IPTV_ORG
        };
    }
}

function saveSettings(patch) {
    return patchPersistedState(patch);
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

    async getCountries(opts = {}) {
        return this.getActiveProvider().getCountries(opts);
    },

    async searchChannels(opts = {}) {
        return this.getActiveProvider().searchChannels(opts);
    },

    getLastRefreshed() {
        return this.getActiveProvider().getLastRefreshed?.() || 0;
    },

    getCategoryNameMap() {
        return this.getActiveProvider().getCategoryNameMap?.() || new Map();
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
