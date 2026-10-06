import { RadioBrowserApi } from '../radioBrowserApi.js';
import { normalizeStation, PROVIDER_RADIO_BROWSER } from '../stationShape.js';

export const RadioBrowserProvider = {
    id: PROVIDER_RADIO_BROWSER,
    label: 'Radio Browser',

    async getCountries({ refresh = false, signal } = {}) {
        return RadioBrowserApi.getCountries({ refresh, signal });
    },

    async searchStations({
        countrycode = '',
        limit = 100,
        offset = 0,
        order = 'clickcount',
        reverse = true,
        refresh = false,
        hideOffline = true,
        signal
    } = {}) {
        const data = await RadioBrowserApi.searchStations({
            countrycode,
            limit,
            offset,
            order,
            reverse,
            refresh,
            hideOffline,
            signal
        });
        return (Array.isArray(data) ? data : [])
            .map((s) => normalizeStation(s, PROVIDER_RADIO_BROWSER))
            .filter(Boolean);
    },

    async getStationById(stationId, { refresh = false, signal } = {}) {
        const raw = await RadioBrowserApi.getStationByUuid(stationId, { refresh, signal });
        return normalizeStation(raw, PROVIDER_RADIO_BROWSER);
    },

    /** Age of IDB station cache entry in ms, or null if missing. */
    async getStationCacheAge(stationId) {
        const cachedAt = await RadioBrowserApi.getStationCachedAt(stationId);
        if (cachedAt == null) return null;
        return Date.now() - cachedAt;
    },

    async getStationsByIds(ids, opts = {}) {
        const results = await Promise.allSettled(
            ids.map((id) => this.getStationById(id, opts))
        );
        return results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value)
            .filter(Boolean);
    },

    reportClick(stationId) {
        return RadioBrowserApi.reportClick(stationId);
    },

    discoverMirrors() {
        return RadioBrowserApi.discoverServers();
    },

    async setMirror(hostname) {
        await RadioBrowserApi.setMirrorHost(hostname);
    },

    async invalidateCache() {
        await RadioBrowserApi.invalidateQueryCache();
    },

    async clearCache() {
        await RadioBrowserApi.clearCache();
    }
};
