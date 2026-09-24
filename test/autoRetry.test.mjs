/**
 * Auto-reconnect: interval honors settings, disable, reschedule, HLS fatal entry.
 */
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function makeVideoEl() {
    const classSet = new Set();
    return {
        tagName: 'VIDEO',
        className: '',
        classList: {
            _set: classSet,
            add(...names) { names.forEach((n) => classSet.add(n)); },
            remove(...names) { names.forEach((n) => classSet.delete(n)); },
            contains(n) { return classSet.has(n); }
        },
        muted: true,
        defaultMuted: true,
        playsInline: true,
        preload: 'auto',
        dataset: {},
        style: {},
        parentElement: null,
        videoWidth: 0,
        readyState: 0,
        paused: true,
        volume: 1,
        setAttribute() {},
        removeAttribute() {},
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        play() { return Promise.resolve(); },
        pause() {},
        load() {}
    };
}

function makeHolder() {
    const children = [];
    return {
        className: '',
        dataset: {},
        children,
        appendChild(child) {
            child.parentElement = this;
            children.push(child);
            return child;
        },
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}
    };
}

before(() => {
    globalThis.document = {
        body: { appendChild() {} },
        createElement: (tag) => (tag === 'video' ? makeVideoEl() : makeHolder()),
        visibilityState: 'visible',
        addEventListener: () => {}
    };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        matchMedia: () => ({ matches: false })
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
});

afterEach(() => {
    // No shared player — each test clears its own timers via _clearAutoRetry.
});

async function makeDisconnectedPlayer(overrides = {}) {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false,
        shouldBroadcast: () => false
    });
    player.init();
    player.channel = { name: 'Test', url_resolved: 'https://example.com/a.m3u8', providerId: 'test' };
    player.wantPlaying = true;
    player.stopped = false;
    player.playing = false;
    player.error = 'Stream unavailable';
    player.reattemptInterval = 10;
    player.reattempts = 5;
    Object.assign(player, overrides);
    return player;
}

test('disconnect schedules deadline exactly equal to reattemptInterval', async () => {
    const player = await makeDisconnectedPlayer({ reattemptInterval: 10 });
    const before = Date.now();
    player.emitState();
    assert.ok(player._autoRetryDeadlineAt > 0);
    const delay = player._autoRetryDeadlineAt - before;
    assert.ok(delay >= 10000 && delay <= 10050, `expected ~10000ms, got ${delay}`);
    player._clearAutoRetry({ full: true });
});

test('reattempts=0 disables auto-retry scheduling', async () => {
    const player = await makeDisconnectedPlayer({ reattempts: 0 });
    player.emitState();
    assert.equal(player._autoRetryDeadlineAt, 0);
    assert.equal(player._autoRetryTimer, null);
});

test('playing=true with error does not schedule (D/C requires !playing)', async () => {
    const player = await makeDisconnectedPlayer({ playing: true });
    player.emitState();
    assert.equal(player._autoRetryDeadlineAt, 0);
});

test('setReattemptInterval mid-countdown updates the deadline', async () => {
    const player = await makeDisconnectedPlayer({ reattemptInterval: 10 });
    const t0 = Date.now();
    player.emitState();
    assert.ok(player._autoRetryDeadlineAt > 0);
    const firstDelay = player._autoRetryDeadlineAt - t0;
    assert.ok(firstDelay >= 10000 && firstDelay <= 10050);

    const t1 = Date.now();
    player.setReattemptInterval(3);
    assert.equal(player.reattemptInterval, 3);
    assert.ok(player._autoRetryDeadlineAt > 0);
    const secondDelay = player._autoRetryDeadlineAt - t1;
    assert.ok(secondDelay >= 3000 && secondDelay <= 3050, `expected ~3000ms, got ${secondDelay}`);
    player._clearAutoRetry({ full: true });
});

test('setReattempts(0) mid-countdown cancels the timer', async () => {
    const player = await makeDisconnectedPlayer({ reattemptInterval: 10, reattempts: 5 });
    player.emitState();
    assert.ok(player._autoRetryDeadlineAt > 0);
    player.setReattempts(0);
    assert.equal(player._autoRetryDeadlineAt, 0);
    assert.equal(player._autoRetryTimer, null);
});

test('switchGeneration mismatch re-emits and can reschedule', async () => {
    const player = await makeDisconnectedPlayer({ reattemptInterval: 5 });
    player.emitState();
    assert.ok(player._autoRetryDeadlineAt > 0);
    const switchAtSchedule = player._autoRetrySwitchGen;
    // Simulate a user channel pick bumping switchGeneration before the timer fires.
    player.switchGeneration = (player.switchGeneration || 0) + 1;
    assert.notEqual(player.switchGeneration, switchAtSchedule);

    player._fireAutoRetry();
    // After mismatch: emitState should re-arm a countdown for the still-dead slot.
    assert.ok(player._autoRetryDeadlineAt > 0);
    assert.equal(player._autoRetryAttemptsUsed, 0);
    player._clearAutoRetry({ full: true });
});

test('HLS fatal clears playing so auto-retry can schedule', async () => {
    const { bindHlsPlaybackHandlers } = await import('../js/player/hlsAttach.js');
    const handlers = new Map();
    const Events = {
        MANIFEST_PARSED: 'MANIFEST_PARSED',
        LEVEL_SWITCHED: 'LEVEL_SWITCHED',
        FRAG_LOADED: 'FRAG_LOADED',
        ERROR: 'ERROR',
        BUFFER_DEPTH_UPDATE: 'BUFFER_DEPTH_UPDATE'
    };
    const hls = {
        Events,
        constructor: { Events, ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' } },
        on(evt, fn) { handlers.set(evt, fn); },
        startLoad() {},
        recoverMediaError() {}
    };
    const ctx = {
        playGeneration: 1,
        hls,
        video: { videoHeight: 0 },
        playing: true,
        loading: true,
        loadPhase: 'buffering',
        healing: true,
        error: null,
        errorCount: 0,
        _clearFreezeTicker() {},
        emitState() {}
    };
    bindHlsPlaybackHandlers(ctx, hls, 1);
    const onError = handlers.get(Events.ERROR);
    assert.ok(typeof onError === 'function');
    onError(null, { fatal: true });
    assert.equal(ctx.playing, false);
    assert.equal(ctx.loading, false);
    assert.equal(ctx.loadPhase, 'idle');
    assert.equal(ctx.healing, false);
    assert.equal(ctx.error, 'Stream unavailable');
});

test('HLS non-fatal escalate clears playing even when still marked playing', async () => {
    const { bindHlsPlaybackHandlers } = await import('../js/player/hlsAttach.js');
    const handlers = new Map();
    const Events = {
        MANIFEST_PARSED: 'MANIFEST_PARSED',
        LEVEL_SWITCHED: 'LEVEL_SWITCHED',
        FRAG_LOADED: 'FRAG_LOADED',
        ERROR: 'ERROR',
        BUFFER_DEPTH_UPDATE: 'BUFFER_DEPTH_UPDATE'
    };
    const hls = {
        Events,
        constructor: { Events, ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' } },
        on(evt, fn) { handlers.set(evt, fn); },
        startLoad() {},
        recoverMediaError() {}
    };
    const ctx = {
        playGeneration: 1,
        hls,
        video: { videoHeight: 0 },
        playing: true,
        loading: false,
        loadPhase: 'idle',
        healing: false,
        error: null,
        _hlsNonFatalRestarts: 7,
        _lastHlsNetworkRestartAt: 0,
        _clearFreezeTicker() {},
        emitState() {}
    };
    bindHlsPlaybackHandlers(ctx, hls, 1);
    const onError = handlers.get(Events.ERROR);
    onError(null, { fatal: false, type: 'networkError' });
    assert.equal(ctx.playing, false);
    assert.equal(ctx.error, 'Stream unavailable');
    assert.ok(ctx._hlsNonFatalRestarts >= 8);
});
