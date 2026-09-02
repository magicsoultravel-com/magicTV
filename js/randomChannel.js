/**
 * Random channel picker for the Magic Remote.
 * Picks any country and any visible channel, then verifies it can play via
 * the safe-loading staging buffer before swapping away from the current stream.
 */
import { TvProviderRegistry } from './tvProviders/registry.js';
import { HiddenChannels } from './storage/hiddenChannels.js';
import { channelKey } from './tvProviders/channelShape.js';
import { MultiView } from './multiView.js';
import { showAppToast } from './ui/toast.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const COUNTRY_SAMPLE_LIMIT = 100;
const COUNTRY_PICK_ATTEMPTS = 3;

function randomInt(n) {
    return Math.floor(Math.random() * n);
}

function pickWeightedCountry(countries) {
    const total = countries.reduce((sum, c) => sum + (c.stationcount || 0), 0);
    if (!total) return null;
    let pick = Math.random() * total;
    for (const c of countries) {
        pick -= (c.stationcount || 0);
        if (pick <= 0) return c;
    }
    return countries[countries.length - 1] || null;
}

async function fetchCountryChannelSample(countryCode, registry, hiddenChannels) {
    if (!countryCode) return [];
    const channels = await registry.searchChannels({
        countrycode: countryCode,
        limit: COUNTRY_SAMPLE_LIMIT
    });
    return hiddenChannels.filterVisible(channels);
}

function pickRandomChannel(channels, { excludeKey = '', attemptedKeys = new Set() } = {}) {
    const candidates = channels.filter((ch) => {
        const key = channelKey(ch);
        return key && key !== excludeKey && !attemptedKeys.has(key);
    });
    if (!candidates.length) return null;
    return candidates[randomInt(candidates.length)];
}

async function pickRandomCandidate(currentKey, attemptedKeys, deps) {
    const countries = await deps.registry.getCountries();
    if (!countries?.length) return null;

    let attempts = 0;
    while (attempts < COUNTRY_PICK_ATTEMPTS) {
        attempts += 1;
        const country = pickWeightedCountry(countries);
        if (!country?.iso_3166_1) continue;
        const channels = await fetchCountryChannelSample(
            country.iso_3166_1,
            deps.registry,
            deps.hiddenChannels
        );
        const candidate = pickRandomChannel(channels, {
            excludeKey: currentKey,
            attemptedKeys
        });
        if (candidate) return candidate;
    }
    return null;
}

/**
 * Play a random channel from any country on the given slot.
 * Keeps the current stream playing until the new channel is confirmed on the
 * safe-loading staging buffer. Retries a few times if the first picks fail.
 * @param {string} slotId
 * @param {{ maxAttempts?: number, deps?: object }} [options]
 * @returns {Promise<boolean>} true if a channel was successfully started
 */
export async function playRandomChannel(slotId, options = {}) {
    const deps = {
        registry: TvProviderRegistry,
        hiddenChannels: HiddenChannels,
        multiView: MultiView,
        showAppToast,
        ...options.deps
    };

    const id = slotId || 'center';
    const maxAttempts = Math.max(1, Math.min(10, options.maxAttempts || DEFAULT_MAX_ATTEMPTS));
    const player = deps.multiView.slots?.[id]?.player
        || (id === 'center' ? deps.multiView.getPrimary?.() : null);
    const currentKey = player?.channel ? channelKey(player.channel) : '';

    const attemptedKeys = new Set();
    let lastToast = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = await pickRandomCandidate(currentKey, attemptedKeys, deps);
        if (!candidate) {
            deps.showAppToast('No channels available');
            return false;
        }

        const key = channelKey(candidate);
        attemptedKeys.add(key);

        const toast = `Tuning to random channel… (${attempt + 1}/${maxAttempts})`;
        if (toast !== lastToast) {
            deps.showAppToast(toast);
            lastToast = toast;
        }

        const ok = await deps.multiView.playChannelSafe(id, candidate);
        if (ok) {
            deps.showAppToast('Random channel playing');
            return true;
        }
    }

    deps.showAppToast('Could not find a working random channel');
    return false;
}
