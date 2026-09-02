/**
 * Random channel picker for the Magic Remote.
 * Picks any country and any visible channel, then verifies it can play via
 * the safe-loading staging buffer before swapping away from the current stream.
 */
import { TvProviderRegistry } from './tvProviders/registry.js';
import { HiddenChannels } from './storage/hiddenChannels.js';
import { channelKey } from './tvProviders/channelShape.js';
import { MultiView, SLOT_SCREEN_LABELS } from './multiView.js';
import { countryFlagEmoji } from './tvUtils.js';
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

async function pickRandomCandidate(currentKey, attemptedKeys, deps, providedCountries = null) {
    const countries = providedCountries || await deps.registry.getCountries();
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
        if (candidate) {
            return {
                candidate,
                countryCode: country.iso_3166_1,
                countryName: country.name || country.iso_3166_1
            };
        }
    }
    return null;
}

function channelLabel(candidate) {
    const flag = countryFlagEmoji(candidate?.countrycode || '');
    const name = candidate?.name || 'Unknown';
    return flag ? `${flag} ${name}` : name;
}

function slotLabel(slotId) {
    return SLOT_SCREEN_LABELS[slotId] || slotId;
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
        const pick = await pickRandomCandidate(currentKey, attemptedKeys, deps);
        if (!pick) {
            deps.showAppToast('No channels available');
            return false;
        }

        const { candidate } = pick;
        const key = channelKey(candidate);
        attemptedKeys.add(key);

        const label = channelLabel(candidate);
        const toast = `Tuning to ${label}… (${attempt + 1}/${maxAttempts})`;
        if (toast !== lastToast) {
            deps.showAppToast(toast);
            lastToast = toast;
        }

        const ok = await deps.multiView.playChannelSafe(id, candidate);
        if (ok) {
            deps.showAppToast(`Random channel playing: ${label}`);
            return true;
        }
    }

    deps.showAppToast('Could not find a working random channel');
    return false;
}

/**
 * Play a random channel on every enabled TV screen in parallel.
 * No screen is swapped until its own staging buffer confirms the pick is
 * playing. Uses a shared attempted-key set so the same channel is not picked
 * for multiple screens in the same shuffle.
 * @param {string[]} [slotIds] defaults to all enabled slots
 * @param {{ maxAttempts?: number, deps?: object }} [options]
 * @returns {Promise<number>} number of screens that successfully started
 */
export async function playRandomChannels(slotIds, options = {}) {
    const deps = {
        registry: TvProviderRegistry,
        hiddenChannels: HiddenChannels,
        multiView: MultiView,
        showAppToast,
        ...options.deps
    };

    let ids = (slotIds || []).filter(Boolean);
    if (!ids.length) {
        ids = Object.entries(deps.multiView.slots || {})
            .filter(([, slot]) => slot?.enabled)
            .map(([id]) => id);
    }
    if (!ids.length) return 0;

    const maxAttemptsPerSlot = Math.max(1, Math.min(10, options.maxAttempts || DEFAULT_MAX_ATTEMPTS));
    const countries = await deps.registry.getCountries();
    const attemptedKeys = new Set();

    const picks = [];
    for (const id of ids) {
        const player = deps.multiView.slots?.[id]?.player
            || (id === 'center' ? deps.multiView.getPrimary?.() : null);
        const currentKey = player?.channel ? channelKey(player.channel) : '';
        let pick = null;
        for (let attempt = 0; attempt < maxAttemptsPerSlot; attempt += 1) {
            pick = await pickRandomCandidate(currentKey, attemptedKeys, deps, countries);
            if (!pick) break;
            const key = channelKey(pick.candidate);
            attemptedKeys.add(key);
            break;
        }
        picks.push({ id, ...pick });
    }

    const results = await Promise.all(picks.map(async ({ id, candidate }) => {
        if (!candidate) {
            deps.showAppToast(`No random channel found for TV ${slotLabel(id)}`);
            return false;
        }

        const label = channelLabel(candidate);
        deps.showAppToast(`Tuning TV ${slotLabel(id)} to ${label}…`);
        const ok = await deps.multiView.playChannelSafe(id, candidate);
        if (ok) {
            deps.showAppToast(`TV ${slotLabel(id)} playing: ${label}`);
        }
        return ok;
    }));

    const successCount = results.filter(Boolean).length;
    if (successCount === 0) {
        deps.showAppToast('Could not find any working random channels');
    } else if (successCount < ids.length) {
        deps.showAppToast(`Random channels playing on ${successCount}/${ids.length} TVs`);
    }
    return successCount;
}
