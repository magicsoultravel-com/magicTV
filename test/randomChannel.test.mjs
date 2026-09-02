import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeChannel(id, country = 'US') {
    return {
        id,
        name: id,
        url_resolved: `https://example.com/${id}.m3u8`,
        countrycode: country,
        providerId: 'iptv-org'
    };
}

test('playRandomChannel succeeds on first working pick', async () => {
    const toasts = [];
    const safeCalls = [];
    const deps = {
        registry: {
            getCountries: async () => [
                { iso_3166_1: 'US', stationcount: 2 }
            ],
            searchChannels: async ({ countrycode }) => {
                if (countrycode !== 'US') return [];
                return [makeChannel('A.us'), makeChannel('B.us')];
            }
        },
        hiddenChannels: {
            filterVisible: (channels) => channels
        },
        multiView: {
            slots: { center: { player: { channel: null } } },
            getPrimary: () => null,
            playChannelSafe: async (_slot, ch) => {
                safeCalls.push(ch.id);
                return true;
            }
        },
        showAppToast: (msg) => { toasts.push(msg); }
    };

    const { playRandomChannel } = await import('../js/randomChannel.js');
    const result = await playRandomChannel('center', { deps });

    assert.equal(result, true);
    assert.equal(safeCalls.length, 1);
    assert.ok(toasts.some((m) => m.includes('Random channel playing')));
});

test('playRandomChannel retries failed picks until one plays', async () => {
    const safeCalls = [];
    const deps = {
        registry: {
            getCountries: async () => [
                { iso_3166_1: 'US', stationcount: 2 }
            ],
            searchChannels: async ({ countrycode }) => {
                if (countrycode !== 'US') return [];
                return [makeChannel('A.us'), makeChannel('B.us')];
            }
        },
        hiddenChannels: {
            filterVisible: (channels) => channels
        },
        multiView: {
            slots: { center: { player: { channel: null } } },
            getPrimary: () => null,
            playChannelSafe: async (_slot, ch) => {
                safeCalls.push(ch.id);
                return ch.id === 'B.us';
            }
        },
        showAppToast: () => {}
    };

    const { playRandomChannel } = await import('../js/randomChannel.js');
    const result = await playRandomChannel('center', { deps, maxAttempts: 3 });

    assert.equal(result, true);
    assert.ok(safeCalls.includes('B.us'));
    assert.ok(safeCalls.length <= 3);
});

test('playRandomChannel excludes the currently playing channel', async () => {
    const safeCalls = [];
    const current = makeChannel('A.us');
    const deps = {
        registry: {
            getCountries: async () => [
                { iso_3166_1: 'US', stationcount: 1 }
            ],
            searchChannels: async () => [current, makeChannel('B.us')]
        },
        hiddenChannels: {
            filterVisible: (channels) => channels
        },
        multiView: {
            slots: {
                center: {
                    player: {
                        channel: current
                    }
                }
            },
            getPrimary: () => null,
            playChannelSafe: async (_slot, ch) => {
                safeCalls.push(ch.id);
                return true;
            }
        },
        showAppToast: () => {}
    };

    const { playRandomChannel } = await import('../js/randomChannel.js');
    await playRandomChannel('center', { deps });

    assert.equal(safeCalls.includes('A.us'), false);
    assert.equal(safeCalls[0], 'B.us');
});

test('playRandomChannel returns false when all picks fail', async () => {
    const deps = {
        registry: {
            getCountries: async () => [
                { iso_3166_1: 'US', stationcount: 1 }
            ],
            searchChannels: async () => [makeChannel('A.us')]
        },
        hiddenChannels: {
            filterVisible: (channels) => channels
        },
        multiView: {
            slots: { center: { player: { channel: null } } },
            getPrimary: () => null,
            playChannelSafe: async () => false
        },
        showAppToast: () => {}
    };

    const { playRandomChannel } = await import('../js/randomChannel.js');
    const result = await playRandomChannel('center', { deps, maxAttempts: 2 });

    assert.equal(result, false);
});

test('playRandomChannel returns false when no channels are available', async () => {
    const deps = {
        registry: {
            getCountries: async () => [],
            searchChannels: async () => []
        },
        hiddenChannels: {
            filterVisible: (channels) => channels
        },
        multiView: {
            slots: { center: { player: { channel: null } } },
            getPrimary: () => null,
            playChannelSafe: async () => true
        },
        showAppToast: () => {}
    };

    const { playRandomChannel } = await import('../js/randomChannel.js');
    const result = await playRandomChannel('center', { deps });

    assert.equal(result, false);
});
