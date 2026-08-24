/**
 * Regression tests for multiscreen strip / tile sync when disabling a slot.
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

function makePlayer(name = 'Test') {
    return {
        channel: { providerId: 'iptv-org', channelId: name, name },
        muted: true,
        playing: false,
        stop: async () => {},
        emitState() {},
        applyAudioToVideo() {}
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
        nextSibling: null,
        hidden: false,
        appendChild(child) {
            child.parentElement = node;
            node.children.push(child);
            return child;
        },
        setAttribute(k, v) { attrs[k] = v; },
        getAttribute(k) { return attrs[k] ?? null; },
        addEventListener() {},
        removeEventListener() {},
        querySelector(sel) {
            if (sel === '#add-screen-btn') {
                return node.children.find((c) => c.id === 'add-screen-btn') || null;
            }
            if (sel === '.tv-controls__screen-btn') {
                return node.children.find((c) => c.classList.contains('tv-controls__screen-btn')) || null;
            }
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '.tv-controls__screen-btn') {
                return node.children.filter((c) => c.classList.contains('tv-controls__screen-btn'));
            }
            if (sel === '[data-tile-action="browse"]') return [];
            if (sel === '.tv-player-tile.is-channel-picker-target') {
                return node.ownerDocument?.highlightedTiles || [];
            }
            return [];
        },
        closest() { return null; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 280, height: 640 }; }
    };
    return node;
}

function makeScreenBtn(slotId) {
    const btn = makeEl('button');
    btn.classList.add('tv-controls__screen-btn');
    btn.dataset.screenSlot = slotId;
    return btn;
}

function makeTile(slotId, hidden = false) {
    const tile = makeEl('div', `player-tile-${slotId}`);
    tile.setAttribute('data-slot', slotId);
    if (hidden) tile.classList.add('is-hidden');
    return tile;
}

function buildDom() {
    const mosaic = makeEl('div', 'player-mosaic');
    mosaic.classList.add('has-corners');

    const tiles = {
        center: makeTile('center'),
        topLeft: makeTile('topLeft'),
        topRight: makeTile('topRight'),
        bottomLeft: makeTile('bottomLeft'),
        bottomRight: makeTile('bottomRight')
    };
    Object.values(tiles).forEach((tile) => mosaic.appendChild(tile));

    const strip = makeEl('div');
    strip.className = 'remote-panel__screens tv-controls__screens';
    const screenBtns = {};
    for (const slotId of ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
        const btn = makeScreenBtn(slotId);
        screenBtns[slotId] = btn;
        strip.appendChild(btn);
    }
    const addBtn = makeEl('button', 'add-screen-btn');
    strip.appendChild(addBtn);

    const footer = makeEl('footer', 'remote-panel-footer');
    footer.appendChild(strip);

    const catalogBody = makeEl('div', 'tv-catalog-body');
    const dockHost = makeEl('div', 'remote-dock-host');
    const dockSheet = makeEl('div', 'remote-dock-sheet');
    const dockTab = makeEl('button', 'remote-dock-tab');
    const staging = makeEl('div', 'remote-module-staging');

    const els = new Map([
        ['player-mosaic', mosaic],
        ['remote-panel-footer', footer],
        ['tv-catalog-body', catalogBody],
        ['remote-dock-host', dockHost],
        ['remote-dock-sheet', dockSheet],
        ['remote-dock-tab', dockTab],
        ['remote-module-staging', staging]
    ]);
    for (const tile of Object.values(tiles)) {
        els.set(tile.id, tile);
    }

    const highlightedTiles = [];

    const doc = {
        body: { classList: makeClassList(), appendChild() {} },
        head: { querySelectorAll: () => [], prepend() {} },
        documentElement: { attributes: [], dataset: {}, style: { setProperty() {} } },
        highlightedTiles,
        addEventListener() {},
        removeEventListener() {},
        getElementById: (id) => els.get(id) || null,
        querySelector: (sel) => {
            if (sel === '#remote-panel-footer .tv-controls__screens') return strip;
            if (sel === '.tv-controls__screens') return strip;
            if (sel === '#remote-dock-host') return dockHost;
            if (sel === '#remote-module-staging') return staging;
            if (sel === '#remote-module-host') return null;
            if (sel === '.tv-player-tile.is-channel-picker-target') return highlightedTiles[0] || null;
            return null;
        },
        querySelectorAll: (sel) => {
            if (sel === '.tv-controls__screens') return [strip];
            if (sel === '.tv-player-tile.is-channel-picker-target') {
                return highlightedTiles.filter((t) => t.classList.contains('is-channel-picker-target'));
            }
            if (sel === '[data-tile-action="browse"]') return [];
            return [];
        }
    };

    doc.querySelectorAll = (sel) => {
        if (sel === '.tv-controls__screens') return [strip];
        if (sel === '.tv-player-tile.is-channel-picker-target') {
            return Object.values(tiles).filter((t) => t.classList.contains('is-channel-picker-target'));
        }
        if (sel === '[data-tile-action="browse"]') return [];
        return [];
    };

    return { doc, mosaic, tiles, screenBtns, strip };
}

let MultiView;
let RemoteModule;
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
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
});

beforeEach(() => {
    store.clear();
    SettingsStore.setRemoteIdleFadeEnabled(false);
    MultiView.rememberedSlotKeys = {};
    MultiView.statusSlotId = 'center';
    MultiView.screenStripHoverSlotId = null;
    for (const id of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
        MultiView.slots[id].enabled = false;
        MultiView.slots[id].player = null;
    }
    MultiView.slotsHydrated = true;
});

afterEach(async () => {
    if (RemoteModule.isOpen())     RemoteModule.close();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.document = undefined;
});

test('screen strip hover highlights matching mosaic tile on the page', () => {
    const { doc, tiles } = buildDom();
    globalThis.document = doc;

    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;

    MultiView.setScreenStripHover('topLeft');
    assert.ok(tiles.topLeft.classList.contains('is-screen-strip-hover'));
    assert.equal(tiles.center.classList.contains('is-screen-strip-hover'), false);
    assert.equal(tiles.topRight.classList.contains('is-screen-strip-hover'), false);

    MultiView.setScreenStripHover('topRight');
    assert.equal(tiles.topLeft.classList.contains('is-screen-strip-hover'), false);
    assert.ok(tiles.topRight.classList.contains('is-screen-strip-hover'));

    MultiView.clearScreenStripHover();
    assert.equal(tiles.topRight.classList.contains('is-screen-strip-hover'), false);
});

test('disabling targeted screen reconciles remote target and strip highlight', async () => {
    const { doc, tiles, screenBtns } = buildDom();
    globalThis.document = doc;

    SettingsStore.setScreenTopLeft(true);
    SettingsStore.setScreenTopRight(true);
    SettingsStore.setScreenBottomLeft(true);
    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;
    MultiView.slots.bottomLeft.enabled = true;
    MultiView.slots.topLeft.player = makePlayer('A');
    MultiView.slots.topRight.player = makePlayer('B');
    MultiView.slots.bottomLeft.player = makePlayer('C');
    if (!MultiView.slots.center.player) {
        MultiView.slots.center.player = makePlayer('Main');
    }
    MultiView.rememberedSlotKeys.topLeft = 'iptv-org:A';

    RemoteModule.init({ switchTab: () => {} });
    RemoteModule.open({ slotId: 'topLeft', mode: 'docked', focusClose: false });
    assert.equal(RemoteModule.getTargetSlotId(), 'topLeft');

    MultiView.setSideEnabled('topLeft', false);
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(MultiView.slots.topLeft.enabled, false);
    assert.equal(MultiView.rememberedSlotKeys.topLeft, undefined);
    assert.equal(RemoteModule.getTargetSlotId(), 'center');
    assert.equal(MultiView.statusSlotId, 'center');
    assert.ok(tiles.topLeft.classList.contains('is-hidden'));
    assert.ok(tiles.center.classList.contains('is-channel-picker-target'));
    assert.ok(screenBtns.center.classList.contains('is-active'));
    assert.equal(screenBtns.topLeft.hidden, true);

    RemoteModule.close();
    await new Promise((r) => setTimeout(r, 50));
});

test('syncTargetHighlight falls back when stored target tile is hidden', async () => {
    const { doc, tiles } = buildDom();
    globalThis.document = doc;

    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;
    MultiView.slots.topLeft.player = makePlayer('A');
    MultiView.slots.topRight.player = makePlayer('B');
    if (!MultiView.slots.center.player) {
        MultiView.slots.center.player = makePlayer('Main');
    }
    MultiView.statusSlotId = 'center';

    RemoteModule.init({ switchTab: () => {} });
    RemoteModule.open({ slotId: 'topLeft', mode: 'docked', focusClose: false });
    assert.equal(RemoteModule.getTargetSlotId(), 'topLeft');

    tiles.topLeft.classList.add('is-hidden');
    MultiView.slots.topLeft.enabled = false;
    MultiView.statusSlotId = 'center';

    RemoteModule.syncTargetHighlight();

    assert.equal(RemoteModule.getTargetSlotId(), 'center');
    assert.ok(tiles.center.classList.contains('is-channel-picker-target'));
    assert.equal(tiles.topLeft.classList.contains('is-channel-picker-target'), false);

    RemoteModule.close();
    await new Promise((r) => setTimeout(r, 50));
});
