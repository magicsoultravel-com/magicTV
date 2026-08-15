import { IptvOrgTvProvider } from './iptvOrgTv.js';
import { PROVIDER_IPTV_ORG } from './channelShape.js';

const STATE_KEY = 'matrix_tv_state';

// Appearance settings defaults
const DEFAULT_TEXT_SIZE = 16;  // px
const DEFAULT_TILE_WIDTH = 180; // px
const TEXT_SIZE_OPTIONS = [12, 14, 16, 18];
const TILE_WIDTH_OPTIONS = [120, 150, 180, 220, 260];

const PROVIDERS = {
    [PROVIDER_IPTV_ORG]: IptvOrgTvProvider
};

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return {
            catalogProvider: raw.catalogProvider || PROVIDER_IPTV_ORG,
            hideOfflineChannels: raw.hideOfflineChannels !== false,
            textSize: TEXT_SIZE_OPTIONS.includes(raw.textSize) ? raw.textSize : DEFAULT_TEXT_SIZE,
            tileWidth: TILE_WIDTH_OPTIONS.includes(raw.tileWidth) ? raw.tileWidth : DEFAULT_TILE_WIDTH
        };
    } catch {
        return {
            catalogProvider: PROVIDER_IPTV_ORG,
            hideOfflineChannels: true,
            textSize: DEFAULT_TEXT_SIZE,
            tileWidth: DEFAULT_TILE_WIDTH
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

    // Appearance settings
    getTextSize() {
        return loadSettings().textSize;
    },

    setTextSize(value) {
        const newValue = Number.isFinite(value) ? value : DEFAULT_TEXT_SIZE;
        const clampedValue = TEXT_SIZE_OPTIONS.includes(newValue) ? newValue : DEFAULT_TEXT_SIZE;
        saveSettings({ textSize: clampedValue });
        return clampedValue;
    },

    getTextSizeOptions() {
        return TEXT_SIZE_OPTIONS;
    },

    getTileWidth() {
        return loadSettings().tileWidth;
    },

    setTileWidth(value) {
        const newValue = Number.isFinite(value) ? value : DEFAULT_TILE_WIDTH;
        const clampedValue = TILE_WIDTH_OPTIONS.includes(newValue) ? newValue : DEFAULT_TILE_WIDTH;
        saveSettings({ tileWidth: clampedValue });
        return clampedValue;
    },

    getTileWidthOptions() {
        return TILE_WIDTH_OPTIONS;
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

    getLastRefreshed() {
        return this.getActiveProvider().getLastRefreshed?.() || 0;
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
