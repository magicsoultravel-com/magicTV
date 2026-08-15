import { IptvOrgTvProvider } from './iptvOrgTv.js';
import { PROVIDER_IPTV_ORG } from './channelShape.js';

const STATE_KEY = 'matrix_tv_state';

// Appearance settings defaults
const DEFAULT_TEXT_SIZE = 16;  // root px (scales rem-based UI relatively)
const DEFAULT_TILE_WIDTH = 180; // px
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 18;
const TILE_WIDTH_MIN = 100;
const TILE_WIDTH_MAX = 300;
const TILE_WIDTH_STEP = 10;

function clampTextSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TEXT_SIZE;
    return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)));
}

function clampTileWidth(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TILE_WIDTH;
    const rounded = Math.round(n / TILE_WIDTH_STEP) * TILE_WIDTH_STEP;
    return Math.min(TILE_WIDTH_MAX, Math.max(TILE_WIDTH_MIN, rounded));
}

const PROVIDERS = {
    [PROVIDER_IPTV_ORG]: IptvOrgTvProvider
};

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return {
            catalogProvider: raw.catalogProvider || PROVIDER_IPTV_ORG,
            textSize: raw.textSize != null ? clampTextSize(raw.textSize) : DEFAULT_TEXT_SIZE,
            tileWidth: raw.tileWidth != null ? clampTileWidth(raw.tileWidth) : DEFAULT_TILE_WIDTH
        };
    } catch {
        return {
            catalogProvider: PROVIDER_IPTV_ORG,
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
        // Offline health is not available from the iptv-org catalog shape we use;
        // channels without a stream URL are already dropped during normalize.
        return true;
    },

    setHideOffline() {
        // No-op: kept for API compatibility with older callers/tests.
    },

    // Appearance settings
    getTextSize() {
        return loadSettings().textSize;
    },

    setTextSize(value) {
        const clampedValue = clampTextSize(value);
        saveSettings({ textSize: clampedValue });
        return clampedValue;
    },

    getTextSizeOptions() {
        return Array.from(
            { length: TEXT_SIZE_MAX - TEXT_SIZE_MIN + 1 },
            (_, i) => TEXT_SIZE_MIN + i
        );
    },

    getTileWidth() {
        return loadSettings().tileWidth;
    },

    setTileWidth(value) {
        const clampedValue = clampTileWidth(value);
        saveSettings({ tileWidth: clampedValue });
        return clampedValue;
    },

    getTileWidthOptions() {
        return Array.from(
            { length: (TILE_WIDTH_MAX - TILE_WIDTH_MIN) / TILE_WIDTH_STEP + 1 },
            (_, i) => TILE_WIDTH_MIN + i * TILE_WIDTH_STEP
        );
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
