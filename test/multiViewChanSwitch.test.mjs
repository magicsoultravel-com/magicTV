/**
 * MultiView channel-switch orchestration — Classic vs Safe Loading.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

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
    globalThis.document = {
        getElementById: () => null,
        body: { appendChild() {} },
        createElement: () => ({
            className: '',
            classList: { add() {}, remove() {} },
            setAttribute() {},
            appendChild() {},
            remove() {}
        }),
        visibilityState: 'visible',
        addEventListener: () => {},
        removeEventListener: () => {}
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});

let realSyncSettingsToggles;
let MultiView;
let SettingsStore;

beforeEach(async () => {
    store.clear();

    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
    MultiView = (await import('../js/multiView.js')).MultiView;

    if (!realSyncSettingsToggles) {
        realSyncSettingsToggles = MultiView.syncSettingsToggles.bind(MultiView);
    }
    MultiView.syncSettingsToggles = realSyncSettingsToggles;

    MultiView.statusSlotId = 'center';
    MultiView.slotsHydrated = true;
    MultiView.swapBusy = false;
});

function makeChannel(name = 'Next') {
    return {
        name,
        url_resolved: `https://example.com/${name.toLowerCase()}.m3u8`,
        providerId: 'test'
    };
}

function stubDocument() {
    const toastChildren = [];
    const toastHost = {
        id: 'app-toast-host',
        className: 'app-toast-host',
        childElementCount: 0,
        setAttribute() {},
        appendChild(child) {
            toastChildren.push(child);
            this.childElementCount = toastChildren.length;
            return child;
        },
        remove() {}
    };
    return {
        getElementById: () => null,
        body: {
            appendChild(el) {
                if (el?.id === 'app-toast-host') return el;
                return el;
            }
        },
        createElement: (tag) => {
            if (tag === 'div') {
                return {
                    className: '',
                    classList: { add() {}, remove() {} },
                    textContent: '',
                    setAttribute() {},
                    remove() {},
                    appendChild() {}
                };
            }
            return { classList: { add() {}, remove() {} } };
        },
        visibilityState: 'visible',
        addEventListener: () => {}
    };
}

function stubPlayOnSlotDeps(player) {
    MultiView.setStatusSlot = () => {};
    MultiView.mountAll = () => {};
    MultiView.ensurePlayer = () => player;
    MultiView.persistSlots = () => {};
    MultiView.scheduleRefreshTiles = () => {};
    MultiView.syncSettingsToggles = () => {};
    MultiView.syncStatusChrome = () => {};
    MultiView.getPrimary = () => null;
    globalThis.document = stubDocument();
}

test('playOnSlot routes to safe loading when chanSwitchMode is safeLoading', async () => {
    SettingsStore.setChanSwitchMode('safeLoading');
    let safeCalled = false;
    const orig = MultiView.playOnSlotSafeLoading;
    MultiView.playOnSlotSafeLoading = async () => { safeCalled = true; };
    stubPlayOnSlotDeps({ mountVideo() {} });

    try {
        await MultiView.playOnSlot('center', makeChannel());
        assert.equal(safeCalled, true);
    } finally {
        MultiView.playOnSlotSafeLoading = orig;
    }
});

test('safe loading does not assign player.channel before commit', async () => {
    SettingsStore.setChanSwitchMode('safeLoading');
    const oldChannel = makeChannel('Old');
    const newChannel = makeChannel('New');
    let channelBeforeCommit = null;

    const player = {
        switchGeneration: 0,
        channel: oldChannel,
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        startPrepareChannel: async () => {},
        isPrepareReady: () => true,
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        emitState: () => {},
        commitPreparedChannel: async () => {
            channelBeforeCommit = player.channel;
            player.channel = newChannel;
            return true;
        }
    };

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handlers) => {
        await handlers.onCommit();
    };
    stubPlayOnSlotDeps(player);

    try {
        await MultiView.playOnSlotSafeLoading(
            'center',
            newChannel,
            player,
            newChannel,
            'test:New'
        );
        assert.equal(channelBeforeCommit, oldChannel);
        assert.equal(player.channel, newChannel);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('safe loading aborts without transition when prepare is not ready', async () => {
    let aborted = false;
    let transitionCalled = false;
    let cancelCalled = false;
    const oldChannel = makeChannel('Old');
    const player = {
        switchGeneration: 0,
        channel: oldChannel,
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        startPrepareChannel: async () => {},
        isPrepareReadyWithFrame: () => false,
        cancelPrepare: () => { cancelCalled = true; },
        _abortSwitchIntent: () => { aborted = true; },
        emitState: () => {},
        commitPreparedChannel: async () => {
            throw new Error('commit should not run');
        }
    };
    stubPlayOnSlotDeps(player);

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async () => {
        transitionCalled = true;
    };

    try {
        await MultiView.playOnSlotSafeLoading(
            'center',
            makeChannel('Dead'),
            player,
            makeChannel('Dead'),
            'test:Dead'
        );

        assert.equal(transitionCalled, false);
        assert.equal(cancelCalled, true);
        assert.equal(aborted, true);
        assert.equal(player.channel, oldChannel);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('safe loading calls commitPreparedChannel with allowFallback false', async () => {
    const newChannel = makeChannel('New');
    let commitOpts = null;
    const player = {
        switchGeneration: 0,
        channel: makeChannel('Old'),
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        startPrepareChannel: async () => {},
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        emitState: () => {},
        commitPreparedChannel: async (_ch, _gen, opts) => {
            commitOpts = opts;
            return true;
        }
    };

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handlers) => {
        await handlers.onCommit();
    };
    stubPlayOnSlotDeps(player);

    try {
        await MultiView.playOnSlotSafeLoading(
            'center',
            newChannel,
            player,
            newChannel,
            'test:New'
        );
        assert.deepEqual(commitOpts, { allowFallback: false });
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('safe loading cold start skips warm-up and plays directly', async () => {
    SettingsStore.setChanSwitchMode('safeLoading');
    let prepareCalled = false;
    let commitCalled = false;
    let playChannelCalled = false;
    const player = {
        switchGeneration: 0,
        channel: null,
        playing: false,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        startPrepareChannel: async () => { prepareCalled = true; return true; },
        isPrepareReady: () => true,
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        _abortSwitchIntent: () => {},
        emitState: () => {},
        commitPreparedChannel: async () => { commitCalled = true; return true; },
        playChannel: async () => { playChannelCalled = true; },
        mountVideo: () => {}
    };
    stubPlayOnSlotDeps(player);

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handler) => {
        await handler();
    };

    try {
        await MultiView.playOnSlot('center', makeChannel('First'));
        assert.equal(playChannelCalled, true);
        assert.equal(prepareCalled, false);
        assert.equal(commitCalled, false);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('classic mash guard skips stale switch callback', async () => {
    SettingsStore.setChanSwitchMode('classic');
    let commitCalled = false;
    let playChannelCalled = false;
    const player = {
        switchGeneration: 0,
        channel: makeChannel('Old'),
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        error: null,
        emitState: () => {},
        startPrepareChannel: () => Promise.resolve(true),
        isPrepareReady: () => true,
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        _abortSwitchIntent: () => {},
        commitPreparedChannel: async () => { commitCalled = true; return true; },
        playChannel: async () => { playChannelCalled = true; },
        mountVideo: () => {}
    };
    stubPlayOnSlotDeps(player);

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handler) => {
        // A newer pick lands mid-transition — the stale one must bail
        // without committing or playing the superseded channel.
        player.switchGeneration += 1;
        await handler();
    };

    try {
        await MultiView.playOnSlot('center', makeChannel('New'));
        assert.equal(commitCalled, false);
        assert.equal(playChannelCalled, false);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('classic calls playChannel on cold switch', async () => {
    SettingsStore.setChanSwitchMode('classic');
    const newChannel = makeChannel('Classic');
    let playChannelCalled = false;
    let commitCalled = false;

    const player = {
        switchGeneration: 0,
        channel: makeChannel('Old'),
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        error: null,
        emitState: () => {},
        startPrepareChannel: () => Promise.resolve(true),
        isPrepareReady: () => false,
        cancelPrepare: () => {},
        _abortSwitchIntent: () => {},
        commitPreparedChannel: async () => {
            commitCalled = true;
            return true;
        },
        playChannel: async () => { playChannelCalled = true; },
        mountVideo: () => {}
    };

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handler) => {
        await handler();
    };
    stubPlayOnSlotDeps(player);

    try {
        await MultiView.playOnSlot('center', newChannel);
        assert.equal(playChannelCalled, true);
        assert.equal(commitCalled, false);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('classic uses commit fast path when buffer is ready', async () => {
    SettingsStore.setChanSwitchMode('classic');
    const newChannel = makeChannel('Fast');
    let commitCalled = false;
    let playChannelCalled = false;

    const player = {
        switchGeneration: 0,
        channel: makeChannel('Old'),
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        error: null,
        emitState: () => {},
        startPrepareChannel: () => Promise.resolve(true),
        isPrepareReady: () => true,
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        _abortSwitchIntent: () => {},
        commitPreparedChannel: async () => {
            commitCalled = true;
            return true;
        },
        playChannel: async () => { playChannelCalled = true; },
        mountVideo: () => {}
    };

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handler) => {
        await handler();
    };
    stubPlayOnSlotDeps(player);

    try {
        await MultiView.playOnSlot('center', newChannel);
        assert.equal(commitCalled, true);
        assert.equal(playChannelCalled, false);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('classic falls back to playChannel when commit fails', async () => {
    SettingsStore.setChanSwitchMode('classic');
    let aborted = false;
    let playChannelCalled = false;

    const player = {
        switchGeneration: 0,
        channel: makeChannel('Old'),
        playing: true,
        loading: false,
        pausePhase: 'idle',
        _suppressErrorToast: false,
        error: null,
        emitState: () => {},
        startPrepareChannel: () => Promise.resolve(true),
        isPrepareReady: () => true,
        isPrepareReadyWithFrame: () => true,
        cancelPrepare: () => {},
        _abortSwitchIntent: () => { aborted = true; },
        commitPreparedChannel: async () => false,
        playChannel: async () => { playChannelCalled = true; },
        mountVideo: () => {}
    };

    const origTransition = MultiView.withChannelSwitchTransition;
    MultiView.withChannelSwitchTransition = async (_id, handler) => {
        await handler();
    };
    stubPlayOnSlotDeps(player);

    try {
        await MultiView.playOnSlot('center', makeChannel('Fallback'));
        assert.equal(aborted, true);
        assert.equal(playChannelCalled, true);
    } finally {
        MultiView.withChannelSwitchTransition = origTransition;
    }
});

test('playOnSlot cancels slot prefetch for classic mode at switch start', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
        path.join(process.cwd(), 'js/multiView.js'),
        'utf8'
    );
    assert.match(src, /cancelSlotPrefetch\(id\)/);
    // Safe loading defers prefetch cancel until after prepare consumes the target.
    const safeIdx = src.indexOf('async playOnSlotSafeLoading');
    const safeBlock = src.slice(safeIdx, safeIdx + 2500);
    assert.match(safeBlock, /cancelSlotPrefetch\(id\)/);
});

test('classic and safe loading both skip in-animation when buffer is ready', async () => {
    const cases = [];

    async function exerciseSafe() {
        const player = {
            switchGeneration: 0,
            channel: makeChannel('Old'),
            playing: true,
            loading: false,
            pausePhase: 'idle',
            _suppressErrorToast: false,
            startPrepareChannel: async () => {},
            isPrepareReadyWithFrame: () => true,
            cancelPrepare: () => {},
            _abortSwitchIntent: () => {},
            emitState: () => {},
            commitPreparedChannel: async () => true
        };
        const origTransition = MultiView.withChannelSwitchTransition;
        MultiView.withChannelSwitchTransition = async (_id, _handlers, opts) => {
            cases.push({ mode: 'safe', skipIn: opts.skipIn });
        };
        stubPlayOnSlotDeps(player);
        try {
            await MultiView.playOnSlotSafeLoading(
                'center',
                makeChannel('New'),
                player,
                makeChannel('New'),
                'test:New'
            );
        } finally {
            MultiView.withChannelSwitchTransition = origTransition;
        }
    }

    await exerciseSafe();

    assert.equal(cases.length, 1);
    assert.equal(cases[0].skipIn, true);
});

test('syncSettingsToggles syncs chan-switch-mode select', async () => {
    SettingsStore.setChanSwitchMode('safeLoading');
    const modeSelect = { value: 'classic' };
    globalThis.document = {
        getElementById: (id) => {
            if (id === 'chan-switch-mode-select') return modeSelect;
            return null;
        }
    };
    MultiView.syncScreenControls = () => {};

    MultiView.syncSettingsToggles();

    assert.equal(modeSelect.value, 'safeLoading');
});
