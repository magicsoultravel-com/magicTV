/**
 * Unit tests for channel bind index + digit tune (navigateToChannelNumber).
 * Do not require a browser DOM.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildChannelIndex,
    buildCountryChannelIndex,
    clearCountryChannelIndexCache,
    channelIndexForScope,
    peekCountryChannelIndex,
    resolveAdjacentChannelKey,
    navigateToChannelNumber,
    navigateChannel,
    chanNumberAccentDigits,
    tvLabelAccentChars,
    bindScopeCacheKey
} from '../js/channelNav.js';
import { FavoritesRecents } from '../js/storage/favoritesRecents.js';
import { TvProviderRegistry } from '../js/tvProviders/registry.js';
import { MultiView } from '../js/multiView.js';
import { normalizeChanBindScope } from '../js/storage/playerState.js';

function stubMethod(obj, key, impl) {
    const prev = obj[key];
    obj[key] = impl;
    return () => {
        obj[key] = prev;
    };
}

beforeEach(() => {
    clearCountryChannelIndexCache();
});

test('normalizeChanBindScope accepts country and uppercases code', () => {
    assert.deepEqual(
        normalizeChanBindScope({ mode: 'country', countryCode: 'gb' }, []),
        { mode: 'country', countryCode: 'GB' }
    );
    assert.deepEqual(
        normalizeChanBindScope({ mode: 'country', countryCode: '' }, []),
        { mode: 'favorites' }
    );
    assert.deepEqual(
        normalizeChanBindScope({ mode: 'country' }, []),
        { mode: 'favorites' }
    );
});

test('bindScopeCacheKey distinguishes country / folder / favorites', () => {
    assert.equal(bindScopeCacheKey({ mode: 'favorites' }), 'favorites');
    assert.equal(bindScopeCacheKey({ mode: 'folder', folderId: 'f1' }), 'folder:f1');
    assert.equal(bindScopeCacheKey({ mode: 'country', countryCode: 'PL' }), 'country:PL');
});

test('chanNumberAccentDigits prefers digit accents and avoids repeats within 2–3 digits', () => {
    assert.deepEqual(chanNumberAccentDigits(1), [{ digit: '1', accent: 1 }]);
    assert.deepEqual(chanNumberAccentDigits(2), [{ digit: '2', accent: 2 }]);
    assert.deepEqual(chanNumberAccentDigits(12), [
        { digit: '1', accent: 1 },
        { digit: '2', accent: 2 }
    ]);
    // Same preferred digit would collide — second digit shifts.
    assert.deepEqual(chanNumberAccentDigits(11), [
        { digit: '1', accent: 1 },
        { digit: '1', accent: 2 }
    ]);
    const three = chanNumberAccentDigits(111);
    assert.equal(three.length, 3);
    assert.deepEqual(new Set(three.map((p) => p.accent)), new Set([1, 2, 3]));
    const mixed = chanNumberAccentDigits(247);
    assert.deepEqual(new Set(mixed.map((p) => p.accent)).size, mixed.length);
});

test('tvLabelAccentChars colors T/V/# with unique rotated accents per screen', () => {
    const tv1 = tvLabelAccentChars(1);
    assert.deepEqual(tv1.map((p) => p.char), ['T', 'V', '1']);
    assert.deepEqual(new Set(tv1.map((p) => p.accent)), new Set([1, 2, 3]));
    const tv2 = tvLabelAccentChars(2);
    assert.deepEqual(tv2.map((p) => p.char), ['T', 'V', '2']);
    assert.notDeepEqual(tv1.map((p) => p.accent), tv2.map((p) => p.accent));
    assert.deepEqual(new Set(tv2.map((p) => p.accent)), new Set([1, 2, 3]));
});

test('buildChannelIndex assigns 1-based numbers from favorites root order', () => {
    const restoreFolders = stubMethod(FavoritesRecents, 'getFavoriteFolders', () => []);
    const restoreRoot = stubMethod(
        FavoritesRecents,
        'getFavoritesRootOrder',
        () => ['iptv-org:A.us', 'iptv-org:B.us', 'iptv-org:C.us']
    );
    try {
        const { keys, numberByKey } = buildChannelIndex({ mode: 'favorites' });
        assert.deepEqual(keys, ['iptv-org:A.us', 'iptv-org:B.us', 'iptv-org:C.us']);
        assert.equal(numberByKey.get('iptv-org:A.us'), 1);
        assert.equal(numberByKey.get('iptv-org:B.us'), 2);
        assert.equal(numberByKey.get('iptv-org:C.us'), 3);
    } finally {
        restoreFolders();
        restoreRoot();
    }
});

test('buildChannelIndex folder scope uses folder items only', () => {
    const restoreFolders = stubMethod(FavoritesRecents, 'getFavoriteFolder', (id) => (
        id === 'f1' ? { id: 'f1', items: ['iptv-org:X.us', 'iptv-org:Y.us'] } : null
    ));
    try {
        const { keys, numberByKey } = buildChannelIndex({ mode: 'folder', folderId: 'f1' });
        assert.deepEqual(keys, ['iptv-org:X.us', 'iptv-org:Y.us']);
        assert.equal(numberByKey.get('iptv-org:X.us'), 1);
        assert.equal(numberByKey.get('iptv-org:Y.us'), 2);
    } finally {
        restoreFolders();
    }
});

test('buildChannelIndex country scope is empty sync (use async index)', () => {
    const { keys } = buildChannelIndex({ mode: 'country', countryCode: 'PL' });
    assert.deepEqual(keys, []);
});

test('buildCountryChannelIndex numbers keys and peeks from cache', async () => {
    const restoreList = stubMethod(
        TvProviderRegistry,
        'listCountryChannelKeys',
        async (code) => {
            assert.equal(code, 'PL');
            return ['iptv-org:A.pl', 'iptv-org:B.pl'];
        }
    );
    const restoreStamp = stubMethod(TvProviderRegistry, 'getLastRefreshed', () => 1);
    try {
        assert.equal(peekCountryChannelIndex('PL'), null);
        const { keys, numberByKey } = await buildCountryChannelIndex('pl');
        assert.deepEqual(keys, ['iptv-org:A.pl', 'iptv-org:B.pl']);
        assert.equal(numberByKey.get('iptv-org:A.pl'), 1);
        assert.equal(peekCountryChannelIndex('PL')?.keys.length, 2);
        assert.equal(channelIndexForScope({ mode: 'country', countryCode: 'PL' }).keys[1], 'iptv-org:B.pl');
    } finally {
        restoreList();
        restoreStamp();
    }
});

test('resolveAdjacentChannelKey walks country cache', async () => {
    const restoreList = stubMethod(
        TvProviderRegistry,
        'listCountryChannelKeys',
        async () => ['iptv-org:A.pl', 'iptv-org:B.pl', 'iptv-org:C.pl']
    );
    const restoreStamp = stubMethod(TvProviderRegistry, 'getLastRefreshed', () => 2);

    try {
        await buildCountryChannelIndex('PL');
        const result = resolveAdjacentChannelKey({
            slotId: 'center',
            direction: 'up',
            bindScope: { mode: 'country', countryCode: 'PL' }
        });
        // No current key → startIdx -1 for up → first step lands on index 0
        assert.equal(result?.key, 'iptv-org:A.pl');
        assert.equal(result?.number, 1);
    } finally {
        restoreList();
        restoreStamp();
    }
});

test('navigateChannel uses country index', async () => {
    const restoreScope = stubMethod(
        FavoritesRecents,
        'getChanBindScope',
        () => ({ mode: 'country', countryCode: 'PL' })
    );
    const restoreList = stubMethod(
        TvProviderRegistry,
        'listCountryChannelKeys',
        async () => ['iptv-org:A.pl', 'iptv-org:B.pl']
    );
    const restoreStamp = stubMethod(TvProviderRegistry, 'getLastRefreshed', () => 3);
    const restoreGet = stubMethod(TvProviderRegistry, 'getChannel', async (parsed) => {
        if (parsed?.channelId === 'A.pl') {
            return { name: 'A', url_resolved: 'https://example.test/a.m3u8', id: 'A.pl' };
        }
        if (parsed?.channelId === 'B.pl') {
            return { name: 'B', url_resolved: 'https://example.test/b.m3u8', id: 'B.pl' };
        }
        return null;
    });
    const played = [];
    const restorePlay = stubMethod(MultiView, 'playOnSlot', async (slotId, channel) => {
        played.push({ slotId, channel });
    });

    try {
        const ok = await navigateChannel('center', 'up');
        assert.equal(ok, true);
        assert.equal(played.length, 1);
        assert.equal(played[0].channel.id, 'A.pl');
    } finally {
        restoreScope();
        restoreList();
        restoreStamp();
        restoreGet();
        restorePlay();
    }
});

test('navigateToChannelNumber rejects out-of-range and missing numbers', async () => {
    const toasts = [];
    const showToast = (msg) => {
        toasts.push(msg);
    };

    const restoreScope = stubMethod(
        FavoritesRecents,
        'getChanBindScope',
        () => ({ mode: 'favorites' })
    );
    const restoreFolders = stubMethod(FavoritesRecents, 'getFavoriteFolders', () => []);
    const restoreRoot = stubMethod(
        FavoritesRecents,
        'getFavoritesRootOrder',
        () => ['iptv-org:A.us']
    );

    try {
        assert.equal(await navigateToChannelNumber('center', 0, { showToast }), false);
        assert.equal(await navigateToChannelNumber('center', 10000, { showToast }), false);
        assert.equal(await navigateToChannelNumber('center', 2, { showToast }), false);
        assert.ok(toasts.some((t) => /Invalid channel number/.test(t)));
        assert.ok(toasts.some((t) => /No channel 2/.test(t)));
    } finally {
        restoreScope();
        restoreFolders();
        restoreRoot();
    }
});

test('navigateToChannelNumber plays bind-scope channel by number', async () => {
    const restoreScope = stubMethod(
        FavoritesRecents,
        'getChanBindScope',
        () => ({ mode: 'favorites' })
    );
    const restoreFolders = stubMethod(FavoritesRecents, 'getFavoriteFolders', () => []);
    const restoreRoot = stubMethod(
        FavoritesRecents,
        'getFavoritesRootOrder',
        () => ['iptv-org:A.us', 'iptv-org:B.us']
    );

    const channelB = { name: 'B', url_resolved: 'https://example.test/b.m3u8', id: 'B.us' };
    const restoreGet = stubMethod(TvProviderRegistry, 'getChannel', async (parsed) => {
        if (parsed?.channelId === 'B.us' && parsed?.providerId === 'iptv-org') return channelB;
        return null;
    });

    const played = [];
    const restorePlay = stubMethod(MultiView, 'playOnSlot', async (slotId, channel) => {
        played.push({ slotId, channel });
    });

    try {
        const ok = await navigateToChannelNumber('center', 2);
        assert.equal(ok, true);
        assert.equal(played.length, 1);
        assert.equal(played[0].slotId, 'center');
        assert.equal(played[0].channel, channelB);
    } finally {
        restoreScope();
        restoreFolders();
        restoreRoot();
        restoreGet();
        restorePlay();
    }
});

test('navigateToChannelNumber plays country-bound channel by number', async () => {
    const restoreScope = stubMethod(
        FavoritesRecents,
        'getChanBindScope',
        () => ({ mode: 'country', countryCode: 'PL' })
    );
    const restoreList = stubMethod(
        TvProviderRegistry,
        'listCountryChannelKeys',
        async () => ['iptv-org:A.pl', 'iptv-org:B.pl']
    );
    const restoreStamp = stubMethod(TvProviderRegistry, 'getLastRefreshed', () => 4);
    const channelB = { name: 'B', url_resolved: 'https://example.test/b.m3u8', id: 'B.pl' };
    const restoreGet = stubMethod(TvProviderRegistry, 'getChannel', async (parsed) => {
        if (parsed?.channelId === 'B.pl') return channelB;
        return null;
    });
    const played = [];
    const restorePlay = stubMethod(MultiView, 'playOnSlot', async (slotId, channel) => {
        played.push({ slotId, channel });
    });

    try {
        const ok = await navigateToChannelNumber('center', 2);
        assert.equal(ok, true);
        assert.equal(played[0].channel, channelB);
    } finally {
        restoreScope();
        restoreList();
        restoreStamp();
        restoreGet();
        restorePlay();
    }
});
