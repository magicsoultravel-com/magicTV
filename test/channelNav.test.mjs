/**
 * Unit tests for channel bind index + digit tune (navigateToChannelNumber).
 * Do not require a browser DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelIndex, navigateToChannelNumber } from '../js/channelNav.js';
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
