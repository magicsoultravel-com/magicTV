/**
 * Unit tests for channel bind index + digit tune (navigateToChannelNumber).
 * Do not require a browser DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelIndex, navigateToChannelNumber, chanNumberAccentDigits, tvLabelAccentChars } from '../js/channelNav.js';
import { FavoritesRecents } from '../js/storage/favoritesRecents.js';
import { TvProviderRegistry } from '../js/tvProviders/registry.js';
import { MultiView } from '../js/multiView.js';

function stubMethod(obj, key, impl) {
    const prev = obj[key];
    obj[key] = impl;
    return () => {
        obj[key] = prev;
    };
}

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
