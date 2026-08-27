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
        insertAdjacentHTML(_position, html) {
            for (const action of html.matchAll(/data-screen-action="([^"]+)"/g)) {
                const child = makeEl('button');
                child.dataset.screenAction = action[1];
                child.classList.add('tv-controls__screen-action');
                child.innerHTML = '';
                node.appendChild(child);
            }
        },
        querySelector(sel) {
            if (sel === '#add-screen-btn') {
                return node.children.find((c) => c.id === 'add-screen-btn') || null;
            }
            if (sel === '.tv-controls__screen-btn') {
                return node.children.find((c) => c.classList.contains('tv-controls__screen-btn')) || null;
            }
            const actionMatch = sel.match(/\[data-screen-action="([^"]+)"\]/);
            if (actionMatch) {
                return node.children.find((c) => c.dataset?.screenAction === actionMatch[1]) || null;
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
            const actionMatch = sel.match(/\[data-screen-action="([^"]+)"\]/);
            if (actionMatch) {
                return node.children.filter((c) => c.dataset?.screenAction === actionMatch[1]);
            }
            return [];
        },
        closest(sel) {
            if (sel === '.tv-controls__screen-btn' && node.classList.contains('tv-controls__screen-btn')) return node;
            if (sel === '.tv-controls__screens' && node.className?.includes('tv-controls__screens')) return node;
            if (sel === '[data-screen-action]' && node.dataset?.screenAction) return node;
            if (sel === '.tv-controls__screen-remove' && node.classList?.contains('tv-controls__screen-remove')) return node;
            return node.parentElement?.closest?.(sel) || null;
        },
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
    const channelBar = makeEl('div', 'remote-channel-bar');
    channelBar.classList.add('is-hidden');
    const channelName = makeEl('span', 'remote-channel-name');
    const channelFlag = makeEl('span', 'remote-channel-flag');
    channelBar.appendChild(channelName);
    channelBar.appendChild(channelFlag);

    const els = new Map([
        ['player-mosaic', mosaic],
        ['remote-panel-footer', footer],
        ['tv-catalog-body', catalogBody],
        ['remote-dock-host', dockHost],
        ['remote-dock-sheet', dockSheet],
        ['remote-dock-tab', dockTab],
        ['remote-module-staging', staging],
        ['remote-channel-bar', channelBar],
        ['remote-channel-name', channelName],
        ['remote-channel-flag', channelFlag]
    ]);
    for (const tile of Object.values(tiles)) {
        els.set(tile.id, tile);
    }

    const highlightedTiles = [];

    const doc = {
        body: { classList: makeClassList(), dataset: {}, appendChild() {} },
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

    return { doc, mosaic, tiles, screenBtns, strip, channelBar, channelName, channelFlag };
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

test('screen strip hydrates mute play stop mini controls', async () => {
    const { hydrateScreenBtnActions, syncScreenBtnActions } = await import('../js/ui/screenStripControls.js');
    const btn = makeScreenBtn('topLeft');
    hydrateScreenBtnActions(btn);
    assert.equal(btn.dataset.actionsHydrated, '1');
    assert.ok(btn.querySelector('[data-screen-action="mute"]'));
    assert.ok(btn.querySelector('[data-screen-action="play"]'));
    assert.ok(btn.querySelector('[data-screen-action="stop"]'));

    const player = makePlayer('A');
    player.muted = true;
    syncScreenBtnActions(btn, player, { intentPlaying: false, isMuted: true });
    assert.ok(btn.querySelector('[data-screen-action="mute"]').classList.contains('is-muted'));
});

test('screen strip mute action toggles slot without removing screen', async () => {
    const { doc, screenBtns } = buildDom();
    globalThis.document = doc;

    const player = makePlayer('A');
    player.muted = true;
    player.toggleMute = function toggleMute() {
        this.muted = !this.muted;
    };
    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topLeft.player = player;

    MultiView.syncScreenControls();
    assert.ok(screenBtns.topLeft.querySelector('[data-screen-action="mute"]'));

    await MultiView.handleTileAction('topLeft', 'mute');
    assert.equal(player.muted, false);
    assert.equal(MultiView.slots.topLeft.enabled, true);
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

test('setStatusSlot clears strip hover so only one tile stays lit', () => {
    const { doc, tiles } = buildDom();
    globalThis.document = doc;

    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;
    MultiView.slots.center.player = MultiView.slots.center.player || makePlayer('Main');

    MultiView.setScreenStripHover('topLeft');
    assert.ok(tiles.topLeft.classList.contains('is-screen-strip-hover'));

    MultiView.setStatusSlot('topRight');
    assert.equal(MultiView.statusSlotId, 'topRight');
    assert.equal(MultiView.screenStripHoverSlotId, null);
    assert.equal(tiles.topLeft.classList.contains('is-screen-strip-hover'), false);
    assert.ok(tiles.topRight.classList.contains('is-channel-picker-target'));
    assert.equal(tiles.topLeft.classList.contains('is-channel-picker-target'), false);
    assert.equal(tiles.center.classList.contains('is-channel-picker-target'), false);
});

test('retarget with remote open keeps a single channel-picker target', async () => {
    const { doc, tiles } = buildDom();
    globalThis.document = doc;

    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topRight.enabled = true;
    MultiView.slots.topLeft.player = makePlayer('A');
    MultiView.slots.topRight.player = makePlayer('B');
    MultiView.slots.center.player = MultiView.slots.center.player || makePlayer('Main');

    RemoteModule.init({ switchTab: () => {} });
    RemoteModule.open({ slotId: 'topLeft', mode: 'docked', focusClose: false });
    assert.ok(tiles.topLeft.classList.contains('is-channel-picker-target'));

    MultiView.setScreenStripHover('topRight');
    RemoteModule.retarget('topRight');

    assert.equal(RemoteModule.getTargetSlotId(), 'topRight');
    assert.equal(MultiView.statusSlotId, 'topRight');
    assert.equal(MultiView.screenStripHoverSlotId, null);
    assert.ok(tiles.topRight.classList.contains('is-channel-picker-target'));
    assert.equal(tiles.topLeft.classList.contains('is-channel-picker-target'), false);
    assert.equal(tiles.center.classList.contains('is-channel-picker-target'), false);

    RemoteModule.close();
    await new Promise((r) => setTimeout(r, 50));
});

test('remote channel bar labels the focused TV without falling back to center', async () => {
    const { doc, channelBar, channelName } = buildDom();
    globalThis.document = doc;

    MultiView.slots.center.player = makePlayer('CenterCh');
    MultiView.slots.center.player.channel.countrycode = 'US';
    MultiView.slots.topLeft.enabled = true;
    MultiView.slots.topLeft.player = makePlayer('CornerCh');
    MultiView.slots.topLeft.player.channel.countrycode = 'GB';

    const { syncRemoteChannelBar } = await import('../js/ui/remotePanel.js');

    MultiView.statusSlotId = 'topLeft';
    syncRemoteChannelBar();
    assert.equal(channelName.textContent, 'TV 2 · CornerCh');
    assert.equal(channelBar.classList.contains('is-hidden'), false);

    MultiView.statusSlotId = 'topRight';
    MultiView.slots.topRight.enabled = true;
    MultiView.slots.topRight.player = makePlayer('Emptyish');
    MultiView.slots.topRight.player.channel = null;
    syncRemoteChannelBar();
    // Focused TV has no channel — do not show center's name under TV 3.
    assert.equal(channelName.textContent, '');
    assert.ok(channelBar.classList.contains('is-hidden'));
});
