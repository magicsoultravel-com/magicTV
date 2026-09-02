/**
 * Mosaic save/restore boot path — restoreSlots wiring and slotsHydrated timing.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

function stubDocument() {
    return {
        getElementById: () => null,
        querySelectorAll: () => [],
        body: {
            appendChild() {},
            dataset: {},
            classList: { toggle() {}, add() {}, remove() {} }
        },
        createElement: (tag) => ({
            tagName: tag.toUpperCase(),
            className: '',
            classList: { add() {}, remove() {}, toggle() {} },
            dataset: {},
            style: {},
            setAttribute() {},
            appendChild() {},
            remove() {},
            addEventListener() {},
            removeEventListener() {},
            play: () => Promise.resolve(),
            pause() {},
            load() {}
        }),
        visibilityState: 'visible',
        addEventListener: () => {}
    };
}

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
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false }),
        setTimeout: (fn, _ms) => setTimeout(fn, 0),
        clearTimeout: (id) => clearTimeout(id)
    };
    globalThis.document = stubDocument();
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});

let MultiView;
let savePlayerState;
let ChanBindPicker;

beforeEach(async () => {
    store.clear();
    globalThis.document = stubDocument();
    const mod = await import('../js/multiView.js');
    MultiView = mod.MultiView;
    MultiView.initialized = false;
    MultiView._deferFullRestore = false;
    MultiView.slotsHydrated = false;
    MultiView.slots = {
        topLeft: { id: 'topLeft', enabled: false, player: null },
        center: { id: 'center', enabled: true, player: null },
        topRight: { id: 'topRight', enabled: false, player: null },
        bottomLeft: { id: 'bottomLeft', enabled: false, player: null },
        bottomRight: { id: 'bottomRight', enabled: false, player: null },
        bottomCenter: { id: 'bottomCenter', enabled: false, player: null }
    };
    savePlayerState = (await import('../js/storage/playerState.js')).savePlayerState;
    ChanBindPicker = (await import('../js/ui/chanBindPicker.js')).ChanBindPicker;
    ChanBindPicker.wireTileBindMenus = () => {};
    MultiView.bindUi = () => {};
    MultiView.bindPlacementChrome = () => {};
});

test('init with _deferFullRestore leaves slotsHydrated false until hydrate', async () => {
    MultiView._deferFullRestore = true;
    MultiView.init();
    assert.equal(MultiView.slotsHydrated, false);
});

test('hydrateMosaicFromSaved applies stubs when no saved mosaic', async () => {
    let stubsCalled = false;
    const orig = MultiView.applySavedSlotStubs;
    MultiView.applySavedSlotStubs = () => { stubsCalled = true; };
    MultiView.restoreSlots = async () => false;

    try {
        const restored = await MultiView.hydrateMosaicFromSaved();
        assert.equal(restored, false);
        assert.equal(stubsCalled, true);
        assert.equal(MultiView.slotsHydrated, true);
    } finally {
        MultiView.applySavedSlotStubs = orig;
    }
});

test('hydrateMosaicFromSaved calls restoreSlots when mosaic saved', async () => {
    savePlayerState({
        mosaicSlots: {
            center: {
                key: 'iptv-org:Test',
                name: 'Test',
                muted: true,
                volume: 1,
                url: 'https://example.com/test.m3u8'
            }
        }
    });

    let restoreCalled = false;
    const origRestore = MultiView.restoreSlots;
    MultiView.restoreSlots = async () => {
        restoreCalled = true;
        MultiView.slotsHydrated = true;
        return true;
    };

    try {
        const restored = await MultiView.hydrateMosaicFromSaved();
        assert.equal(restored, true);
        assert.equal(restoreCalled, true);
    } finally {
        MultiView.restoreSlots = origRestore;
    }
});

test('applySavedSlotStubs does not run during deferred init', async () => {
    let stubsCalled = false;
    const orig = MultiView.applySavedSlotStubs;
    MultiView.applySavedSlotStubs = () => { stubsCalled = true; };
    MultiView._deferFullRestore = true;

    try {
        MultiView.init();
        assert.equal(stubsCalled, false);
    } finally {
        MultiView.applySavedSlotStubs = orig;
    }
});
test('restoreSlots restores saved slots as STOPPED (no stream attach)', async () => {
    savePlayerState({
        mosaicSlots: {
            center: { key: 'iptv-org:Test', name: 'Test', muted: true, volume: 0.6 }
        }
    });

    const emitted = [];
    const makePlayer = (id) => ({
        id,
        video: null,
        videoBack: null,
        videoHolder: null,
        muted: true,
        volume: 1,
        lastVolume: 1,
        channel: null,
        stopped: false,
        wantPlaying: false,
        playing: false,
        pausePhase: 'idle',
        loading: false,
        loadPhase: 'idle',
        error: null,
        applyAudioToVideo() {},
        mountVideo() {},
        emitState() { emitted.push(id); }
    });
    const centerPlayer = makePlayer('center');

    const ctx = {
        slots: {
            topLeft: { id: 'topLeft', enabled: false, player: null },
            center: { id: 'center', enabled: true, player: centerPlayer },
            topRight: { id: 'topRight', enabled: false, player: null },
            bottomLeft: { id: 'bottomLeft', enabled: false, player: null },
            bottomRight: { id: 'bottomRight', enabled: false, player: null },
            bottomCenter: { id: 'bottomCenter', enabled: false, player: null }
        },
        slotsHydrated: false,
        rememberedSlotKeys: {},
        ensurePlayer: (id) => {
            ctx.slots[id].player = ctx.slots[id].player || makePlayer(id);
            return ctx.slots[id].player;
        },
        setSideEnabled() {},
        syncLayout() {},
        mountAll() {},
        syncSettingsToggles() {},
        refreshTiles() {},
        scheduleRefreshTiles() {},
        persistSlots() {},
        getPrimary: () => ctx.slots.center.player,
        hasCustomPlacement: () => false,
        applyFreeLayout() {}
    };

    const { TvProviderRegistry } = await import('../js/tvProviders/registry.js');
    const { persistMethods } = await import('../js/mosaic/persist.js');
    const origGetChannel = TvProviderRegistry.getChannel;
    TvProviderRegistry.getChannel = async () => ({
        url_resolved: 'https://cdn.example/live.m3u8',
        name: 'Resolved Test',
        providerId: 'iptv-org',
        channelId: 'Test',
        countrycode: 'us'
    });

    try {
        const restored = await persistMethods.restoreSlots.call(ctx);

        assert.equal(restored, true);
        assert.equal(ctx.rememberedSlotKeys.center, 'iptv-org:Test');
        // Stopped contract: nothing attached, nothing buffering, error cleared.
        assert.equal(centerPlayer.stopped, true);
        assert.equal(centerPlayer.wantPlaying, false);
        assert.equal(centerPlayer.playing, false);
        assert.equal(centerPlayer.loading, false);
        assert.equal(centerPlayer.loadPhase, 'idle');
        assert.equal(centerPlayer.pausePhase, 'idle');
        assert.equal(centerPlayer.error, null);
        // Channel resolved on restore so ▶ has a URL to attach fresh.
        assert.equal(centerPlayer.channel.url_resolved, 'https://cdn.example/live.m3u8');
        assert.equal(centerPlayer.channel.name, 'Resolved Test');
        assert.equal(emitted.includes('center'), true);
        assert.equal(ctx.slotsHydrated, true);
    } finally {
        TvProviderRegistry.getChannel = origGetChannel;
    }
});
