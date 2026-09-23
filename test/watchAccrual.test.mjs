/**
 * Unit tests for watch-time accrual (chunked flush, hidden+playing, cast, session).
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {}
    };
    globalThis.window = {
        addEventListener() {},
        dispatchEvent() { return true; }
    };
});

let WatchStats;
let createWatchAccrualControllers;
let WATCH_ACCRUAL_FLUSH_CAP_SEC;

before(async () => {
    WatchStats = await import('../js/storage/watchStats.js');
    ({ createWatchAccrualControllers, WATCH_ACCRUAL_FLUSH_CAP_SEC } = await import('../js/player/watchAccrual.js'));
});

/** Controllers created in a test — cleared so cast intervals cannot hang the runner. */
const liveCtrls = [];

beforeEach(() => {
    store.clear();
    WatchStats.clearWatchStats();
    globalThis.document.visibilityState = 'visible';
});

afterEach(() => {
    while (liveCtrls.length) {
        try { liveCtrls.pop().clearCastTick(); } catch { /* ignore */ }
    }
});

function makePlayer(overrides = {}) {
    return {
        channel: {
            providerId: 'iptv-org',
            channelId: 'CNN.us',
            name: 'CNN',
            logo: '',
            countrycode: 'US'
        },
        playing: true,
        wantPlaying: true,
        loading: false,
        loadPhase: 'idle',
        error: null,
        pausePhase: 'idle',
        stopped: false,
        posterDataUrl: null,
        _freezePressure: false,
        watchAccrueKey: null,
        watchAccrueStartedAt: null,
        watchAccrueMediaAt: NaN,
        watchSessionSeconds: 0,
        watchSessionKey: null,
        video: { paused: false, currentTime: 10 },
        ...overrides
    };
}

function makeCtrl(player, { isCastWatching = () => false } = {}) {
    const ctrl = createWatchAccrualControllers({
        getPlayer: () => player,
        shouldRecordRecents: () => true,
        isCastWatching
    });
    liveCtrls.push(ctrl);
    return ctrl;
}

test('overdue open window credits full time via chunked flush', () => {
    const player = makePlayer();
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    assert.ok(player.watchAccrueStartedAt);

    player.watchAccrueStartedAt = Date.now() - 95000;
    player.watchAccrueMediaAt = NaN;
    ctrl.flushWatchAccrual();

    const top = WatchStats.getTopWatched(1);
    assert.equal(top.length, 1);
    assert.ok(Math.abs(top[0].seconds - 95) < 1.5, `got ${top[0].seconds}`);
    assert.ok(player.watchSessionSeconds >= 94);
});

test('hidden document still accrues when video is playing', () => {
    const player = makePlayer();
    globalThis.document.visibilityState = 'hidden';
    player.video.paused = false;
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    assert.equal(player.watchAccrueKey, 'iptv-org:CNN.us');
    assert.ok(player.watchAccrueStartedAt);

    player.watchAccrueStartedAt = Date.now() - 8000;
    player.watchAccrueMediaAt = NaN;
    ctrl.flushWatchAccrual();
    assert.ok(WatchStats.getWatchSeconds('iptv-org:CNN.us') >= 7);
});

test('hidden document does not accrue when video is paused', () => {
    const player = makePlayer({ video: { paused: true, currentTime: 10 } });
    globalThis.document.visibilityState = 'hidden';
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    assert.equal(player.watchAccrueStartedAt, null);
});

test('cast watching accrues while local player is paused', () => {
    const player = makePlayer({
        playing: false,
        wantPlaying: false,
        video: { paused: true, currentTime: 0 }
    });
    let casting = true;
    const ctrl = makeCtrl(player, { isCastWatching: () => casting });
    ctrl.syncWatchAccrual();
    assert.ok(player.watchAccrueStartedAt);

    player.watchAccrueStartedAt = Date.now() - 12000;
    ctrl.flushWatchAccrual();
    assert.ok(WatchStats.getWatchSeconds('iptv-org:CNN.us') >= 11);

    casting = false;
    ctrl.clearCastTick();
});

test('freeze pressure stops accrual', () => {
    const player = makePlayer({ _freezePressure: true });
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    assert.equal(player.watchAccrueStartedAt, null);
});

test('session resets on channel key change; lifetime keeps accumulating', () => {
    const player = makePlayer();
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    player.watchAccrueStartedAt = Date.now() - 20000;
    player.watchAccrueMediaAt = NaN;
    ctrl.flushWatchAccrual();
    assert.ok(player.watchSessionSeconds >= 19);

    player.channel = {
        providerId: 'iptv-org',
        channelId: 'BBC.uk',
        name: 'BBC',
        logo: '',
        countrycode: 'GB'
    };
    player.playing = true;
    player.wantPlaying = true;
    player.video.paused = false;
    ctrl.syncWatchAccrual();
    assert.equal(player.watchSessionSeconds, 0);
    assert.equal(player.watchAccrueKey, 'iptv-org:BBC.uk');
    assert.ok(WatchStats.getWatchSeconds('iptv-org:CNN.us') >= 19);
});

test('periodic sync banks at cap without dropping remainder on next flush', () => {
    const player = makePlayer();
    const ctrl = makeCtrl(player);
    ctrl.syncWatchAccrual();
    player.watchAccrueStartedAt = Date.now() - (WATCH_ACCRUAL_FLUSH_CAP_SEC + 5) * 1000;
    player.watchAccrueMediaAt = NaN;
    ctrl.syncWatchAccrual();
    assert.ok(WatchStats.getWatchSeconds('iptv-org:CNN.us') >= 34);
    assert.ok(player.watchAccrueStartedAt);
});
