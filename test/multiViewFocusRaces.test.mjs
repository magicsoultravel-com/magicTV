/**
 * End-to-end-ish regressions for multi-TV focus + channel entry races.
 * Covers: digit commit pin, tile focus during swapBusy, channel-switch busy scope.
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freeLayoutMethods } from '../js/mosaic/freeLayout.js';
import { FavoritesRecents } from '../js/storage/favoritesRecents.js';
import { TvProviderRegistry } from '../js/tvProviders/registry.js';

const store = new Map();

function stubMethod(obj, key, impl) {
    const prev = obj[key];
    obj[key] = impl;
    return () => {
        obj[key] = prev;
    };
}

function makeClassList() {
    const set = new Set();
    return {
        add(...cls) { cls.forEach((c) => set.add(c)); },
        remove(...cls) { cls.forEach((c) => set.delete(c)); },
        contains(c) { return set.has(c); },
        toggle(c, force) {
            const on = force === undefined ? !set.has(c) : !!force;
            if (on) set.add(c); else set.delete(c);
            return on;
        }
    };
}

function makeEl(tag = 'div', id = '') {
    const attrs = {};
    const node = {
        id,
        tagName: tag.toUpperCase(),
        className: '',
        classList: makeClassList(),
        style: { setProperty() {}, getPropertyValue: () => '' },
        dataset: {},
        attributes: attrs,
        children: [],
        parentElement: null,
        hidden: false,
        textContent: '',
        appendChild(child) {
            child.parentElement = node;
            node.children.push(child);
            return child;
        },
        setAttribute(k, v) { attrs[k] = v; },
        getAttribute(k) { return attrs[k] ?? null; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; }
    };
    return node;
}

let MultiView;
let RemoteModule;
let RemotePanel;
let SettingsStore;

before(async () => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.window = {
        innerWidth: 1280,
        innerHeight: 800,
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false })
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

    MultiView = (await import('../js/multiView.js')).MultiView;
    RemoteModule = (await import('../js/ui/remoteModule.js')).RemoteModule;
    RemotePanel = (await import('../js/ui/remotePanel.js')).RemotePanel;
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
});

beforeEach(() => {
    store.clear();
    SettingsStore.setRemoteIdleFadeEnabled(false);
    MultiView.statusSlotId = 'center';
    MultiView.swapBusy = false;
    MultiView._channelSwitchBusy = new Set();
    for (const id of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'bottomCenter']) {
        MultiView.slots[id].enabled = false;
        MultiView.slots[id].player = null;
    }
    MultiView.slotsHydrated = true;
});

afterEach(async () => {
    if (RemoteModule.isOpen()) RemoteModule.close();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.document = undefined;
});

test('digit entry commits to the TV focused when typing started, not live focus', async () => {
    const channelBar = makeEl('div', 'remote-channel-bar');
    channelBar.classList.add('is-hidden');
    const channelName = makeEl('span', 'remote-channel-name');
    const channelFlag = makeEl('span', 'remote-channel-flag');
    channelBar.appendChild(channelName);
    channelBar.appendChild(channelFlag);
    const els = new Map([
        ['remote-channel-bar', channelBar],
        ['remote-channel-name', channelName],
        ['remote-channel-flag', channelFlag]
    ]);
    globalThis.document = {
        body: { classList: makeClassList(), dataset: {}, appendChild() {} },
        addEventListener() {},
        removeEventListener() {},
        getElementById: (id) => els.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => []
    };

    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;
    MultiView.statusSlotId = 'topLeft';

    const restoreScope = stubMethod(FavoritesRecents, 'getChanBindScope', () => ({ mode: 'favorites' }));
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
        // Start digits on TV 2 (topLeft), then focus TV 3 before the 4th digit commits.
        await RemotePanel.handleRemoteAction('digit-0');
        await RemotePanel.handleRemoteAction('digit-0');
        await RemotePanel.handleRemoteAction('digit-0');
        MultiView.setStatusSlot('topRight');
        await RemotePanel.handleRemoteAction('digit-2');
        // Max-length commit is fire-and-forget inside appendDigit.
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(played.length, 1);
        assert.equal(played[0].slotId, 'topLeft');
        assert.equal(played[0].channel, channelB);
        assert.equal(MultiView.statusSlotId, 'topRight');
    } finally {
        restoreScope();
        restoreFolders();
        restoreRoot();
        restoreGet();
        restorePlay();
    }
});

test('tile pointerdown during swapBusy still focuses the clicked screen', () => {
    const origDoc = globalThis.document;
    const origWin = globalThis.window;
    globalThis.document = {
        getElementById: (id) => (id === 'player-mosaic' ? { dataset: {} } : null)
    };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };

    const focused = [];
    const tile = {
        classList: { contains: () => false, add() {}, remove() {} },
        style: {},
        getAttribute: (name) => (name === 'data-slot' ? 'topRight' : null)
    };
    const target = {
        closest(sel) {
            if (sel === '.tv-player-tile') return tile;
            return null;
        }
    };
    const ctx = {
        swapBusy: true,
        slots: { topRight: { enabled: true }, center: { enabled: true } },
        dragSession: null,
        maybeRetargetChannelPicker(slotId) { focused.push(slotId); }
    };

    try {
        freeLayoutMethods.onTilePointerDown.call(ctx, {
            button: 0,
            pointerId: 1,
            clientX: 10,
            clientY: 10,
            target,
            preventDefault() {}
        });
        assert.deepEqual(focused, ['topRight']);
        assert.equal(ctx.dragSession, null);
    } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
    }
});

test('channel-switch transition does not flip global swapBusy', async () => {
    globalThis.document = {
        getElementById: () => null,
        body: { classList: makeClassList(), dataset: {}, appendChild() {} },
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
    MultiView.swapBusy = false;
    MultiView._channelSwitchBusy = new Set();

    let mid = false;
    const p = MultiView.withChannelSwitchTransition('topLeft', async () => {
        mid = true;
        assert.equal(MultiView.swapBusy, false, 'mosaic swap lock must stay free during channel switch');
        assert.ok(MultiView._channelSwitchBusy.has('topLeft'));
        // A second screen can still take exclusive channel animation.
        assert.equal(MultiView._channelSwitchBusy.has('topRight'), false);
    });
    await p;
    assert.equal(mid, true);
    assert.equal(MultiView.swapBusy, false);
    assert.equal(MultiView._channelSwitchBusy.has('topLeft'), false);
});

test('startPlayback finally pins busy-clear to the captured play slot', () => {
    const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
    const fn = src.match(/function startPlayback\(channel\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'expected startPlayback in app.js');
    assert.match(fn[0], /const slotId = MultiView\.statusSlotId/);
    assert.match(fn[0], /ensurePlayer\?\.?\(slotId\)/);
    assert.equal(
        /getStatusPlayer/.test(fn[0]),
        false,
        'must not clear busy from live focus (getStatusPlayer)'
    );
});
