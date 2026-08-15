/** Unit tests for js/tileFrames.js — state machine helpers and scheduler API. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    TileFrames,
    setFrameState,
    settleFrameCapture,
    isMostlyBlackImageData
} from '../js/tileFrames.js';
import { FrameCache } from '../js/storage/frameCache.js';

function el(tag = 'div') {
    const classSet = new Set();
    const node = {
        tag,
        attrs: Object.create(null),
        children: [],
        classList: {
            add: (c) => classSet.add(c),
            remove: (c) => classSet.delete(c),
            contains: (c) => classSet.has(c),
            toggle: (c, force) => {
                if (force === true) classSet.add(c);
                else if (force === false) classSet.delete(c);
                else if (classSet.has(c)) classSet.delete(c);
                else classSet.add(c);
            }
        },
        getAttribute(name) { return node.attrs[name] ?? null; },
        setAttribute(name, value) { node.attrs[name] = String(value); },
        removeAttribute(name) { delete node.attrs[name]; },
        addEventListener() {},
        decode: async () => {}
    };
    Object.defineProperty(node, 'src', {
        get() { return node.attrs.src || ''; },
        set(v) { node.attrs.src = v; },
        configurable: true
    });
    Object.defineProperty(node, 'complete', { get() { return true; }, configurable: true });
    Object.defineProperty(node, 'naturalWidth', { get() { return 56; }, configurable: true });
    Object.defineProperty(node, 'loading', {
        get() { return node.attrs.loading || ''; },
        set(v) { node.attrs.loading = v; },
        configurable: true
    });
    Object.defineProperty(node, 'title', {
        get() { return node.attrs.title || ''; },
        set(v) {
            if (v == null || v === '') delete node.attrs.title;
            else node.attrs.title = String(v);
        },
        configurable: true
    });
    return node;
}

function makeFrame({ url = 'https://example.test/live.m3u8', connected = true } = {}) {
    const img = el('img');
    img.classList.add('is-hidden');
    const letter = el('div');
    const waiting = el('span');
    const loading = el('span');
    loading.classList.add('is-hidden');
    const badge = el('span');
    badge.classList.add('is-hidden');
    const map = {
        '.channel-tile__logo-img': img,
        '.channel-tile__letter-avatar': letter,
        '.channel-tile__frame-waiting': waiting,
        '.channel-tile__frame-loading': loading,
        '.channel-tile__offline-badge': badge
    };
    const tile = {
        dataset: { url },
        closest() { return tile; }
    };
    const frame = {
        dataset: { frameState: 'waiting' },
        isConnected: connected,
        querySelector(sel) { return map[sel] || null; },
        closest(sel) {
            if (sel === '.channel-tile') return tile;
            return null;
        },
        _img: img,
        _letter: letter,
        _waiting: waiting,
        _loading: loading,
        _badge: badge
    };
    return frame;
}

test('isMostlyBlackImageData rejects near-black buffers', () => {
    const black = new Uint8ClampedArray(56 * 56 * 4);
    assert.equal(isMostlyBlackImageData(black), true);

    const bright = new Uint8ClampedArray(56 * 56 * 4);
    for (let i = 0; i < bright.length; i += 4) {
        bright[i] = 200;
        bright[i + 1] = 180;
        bright[i + 2] = 160;
        bright[i + 3] = 255;
    }
    assert.equal(isMostlyBlackImageData(bright), false);
    assert.equal(isMostlyBlackImageData(null), true);
});

test('setFrameState waiting shows hourglass and hides image', () => {
    const frame = makeFrame();
    setFrameState(frame, 'captured', 'data:image/jpeg;base64,abc');
    setFrameState(frame, 'waiting');
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame.dataset.captured, undefined);
    assert.equal(frame._waiting.classList.contains('is-hidden'), false);
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    assert.equal(frame._img.classList.contains('is-hidden'), true);
});

test('setFrameState loading shows spinner (not hourglass)', () => {
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    assert.equal(frame.dataset.frameState, 'loading');
    assert.equal(frame._loading.classList.contains('is-hidden'), false);
    assert.equal(frame._waiting.classList.contains('is-hidden'), true);
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('setFrameState offline shows disconnect badge with Unable to connect', () => {
    const frame = makeFrame();
    setFrameState(frame, 'offline');
    assert.equal(frame.dataset.frameState, 'offline');
    assert.equal(frame.dataset.captured, '1');
    assert.equal(frame._badge.classList.contains('is-hidden'), false);
    assert.equal(frame._badge.title, 'Unable to connect');
    assert.equal(frame._badge.getAttribute('aria-label'), 'Unable to connect');
    assert.equal(frame._letter.classList.contains('is-hidden'), true);
    assert.equal(frame._waiting.classList.contains('is-hidden'), true);
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
});

test('setFrameState captured paints src eagerly', () => {
    const frame = makeFrame();
    setFrameState(frame, 'captured', 'data:image/jpeg;base64,xyz');
    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame.dataset.captured, '1');
    assert.equal(frame._img.src, 'data:image/jpeg;base64,xyz');
    assert.equal(frame._img.classList.contains('is-hidden'), false);
    assert.equal(frame._waiting.classList.contains('is-hidden'), true);
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
});

test('playback busy lowers heavy concurrency limit (never to zero)', () => {
    TileFrames._resetForTests();
    assert.equal(TileFrames.MAX_HEAVY_IDLE, 3);
    assert.equal(TileFrames.MAX_HEAVY_BUSY, 2);
    TileFrames.setPlaybackBusy(false);
    assert.equal(TileFrames._state.playbackBusy, false);
    TileFrames.setPlaybackBusy(true);
    assert.equal(TileFrames._state.playbackBusy, true);
    TileFrames.setPlaybackBusy(false);
});

test('idle budgets are relaxed; busy budgets stay tighter', () => {
    assert.equal(TileFrames.CAPTURE_BUDGET_MS, 5000);
    assert.equal(TileFrames.MEDIA_READY_TIMEOUT, 3500);
    assert.equal(TileFrames.CAPTURE_BUDGET_BUSY_MS, 3500);
    assert.equal(TileFrames.MEDIA_READY_BUSY_MS, 2500);
    assert.ok(TileFrames.CAPTURE_BUDGET_BUSY_MS <= TileFrames.CAPTURE_BUDGET_MS);
});

test('observe enqueues only hotBudget tiles for heavy capture; rest stay waiting', () => {
    TileFrames._resetForTests();

    const PrevIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
        constructor() {}
        observe() {}
        unobserve() {}
        disconnect() {}
    };

    const frames = [];
    for (let i = 0; i < 40; i++) {
        frames.push(makeFrame({ url: `https://example.test/ch-${i}.m3u8` }));
    }
    // Zero panel size → DEFAULT_HOT_BUDGET (24); hold drain consumers.
    TileFrames._state.running = TileFrames.MAX_HEAVY_IDLE;
    const container = {
        closest() { return null; },
        clientHeight: 0,
        clientWidth: 0,
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return frames;
            return [];
        }
    };

    try {
        TileFrames.observe(container);
        const budget = TileFrames.DEFAULT_HOT_BUDGET;
        assert.equal(TileFrames._state.hot.length, budget);
        assert.equal(TileFrames._state.warm.length, 0, 'warm queue unused — below-fold not heavy-queued');
        assert.equal(TileFrames._state.pending.size, budget);
        for (let i = 0; i < budget; i++) {
            assert.equal(TileFrames._state.hot[i], frames[i], `hot[${i}] must be DOM frame ${i}`);
            assert.equal(TileFrames._state.pending.has(frames[i]), true);
        }
        for (let i = budget; i < 40; i++) {
            assert.equal(TileFrames._state.pending.has(frames[i]), false, `frame ${i} must not be pending`);
            assert.equal(frames[i].dataset.frameState, 'waiting');
            assert.equal(frames[i]._waiting.classList.contains('is-hidden'), false);
            assert.equal(frames[i]._loading.classList.contains('is-hidden'), true, `frame ${i} must not be loading`);
        }
    } finally {
        if (PrevIO === undefined) delete globalThis.IntersectionObserver;
        else globalThis.IntersectionObserver = PrevIO;
        TileFrames._resetForTests();
    }
});

test('deadline null capture settles offline not loading', () => {
    TileFrames._resetForTests();
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/deadline.m3u8', TileFrames._state.refreshEpoch, 'timeout');
    assert.equal(frame.dataset.frameState, 'offline');
    assert.notEqual(frame.dataset.frameState, 'loading');
    assert.equal(frame.dataset.frameFail, 'timeout');
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    assert.equal(frame._badge.classList.contains('is-hidden'), false);
});

test('settleFrameCapture records data-frame-fail reasons', () => {
    TileFrames._resetForTests();
    for (const reason of ['hls-lib', 'timeout', 'media', 'black']) {
        const frame = makeFrame({ url: `https://example.test/${reason}.m3u8` });
        setFrameState(frame, 'loading');
        settleFrameCapture(frame, null, `https://example.test/${reason}.m3u8`, TileFrames._state.refreshEpoch, reason);
        assert.equal(frame.dataset.frameState, 'offline');
        assert.equal(frame.dataset.frameFail, reason);
    }
    const ok = makeFrame({ url: 'https://example.test/ok.m3u8' });
    setFrameState(ok, 'loading');
    settleFrameCapture(ok, 'data:image/jpeg;base64,ok', 'https://example.test/ok.m3u8', TileFrames._state.refreshEpoch);
    assert.equal(ok.dataset.frameState, 'captured');
    assert.equal(ok.dataset.frameFail, undefined);
});

test('notePlayingVideo gates without usable video dimensions', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/playing-gate.m3u8';

    assert.equal(TileFrames.notePlayingVideo(url, null), false);
    assert.equal(TileFrames.notePlayingVideo(url, { videoWidth: 0, videoHeight: 0 }), false);
    assert.equal(TileFrames.notePlayingVideo('', { videoWidth: 640, videoHeight: 360 }), false);
    // Dimensions present but no document/canvas in Node — must not throw; returns false.
    assert.equal(
        TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 }),
        false
    );
    assert.equal(await FrameCache.getFrame(url), null);
});

test('live refresh key sticks until synced away', () => {
    TileFrames._resetForTests();
    TileFrames._state.liveRefreshKey = 'browse:US';
    assert.equal(TileFrames.isLiveRefreshActive('browse:US'), true);
    assert.equal(TileFrames.isLiveRefreshActive('favorites'), false);
    TileFrames.syncLiveRefresh('favorites');
    assert.equal(TileFrames.isLiveRefreshActive('browse:US'), false);
    assert.equal(TileFrames._state.liveRefreshKey, null);
});

test('successful FrameCache write survives without a connected tile', async () => {
    await FrameCache.clearFrames();
    const url = 'https://example.test/survive.m3u8';
    const dataUrl = 'data:image/jpeg;base64,survived';
    // Simulate capture finishing after tab switch: persist even if DOM gone.
    await FrameCache.setFrame(url, dataUrl);
    assert.equal(await FrameCache.getFrame(url), dataUrl);

    const frame = makeFrame({ url, connected: false });
    // Painting onto a disconnected frame is a no-op for the UI path;
    // cache is still the source of truth for the next observe().
    assert.equal(frame.isConnected, false);
    assert.equal(await FrameCache.getFrame(url), dataUrl);
});

test('refresh epoch increments so stale in-flight paints are ignored', () => {
    TileFrames._resetForTests();
    const before = TileFrames._state.refreshEpoch;
    TileFrames._state.refreshEpoch++;
    assert.equal(TileFrames._state.refreshEpoch, before + 1);
});

test('settleFrameCapture paints captured and never leaves loading', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/settle-ok.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'loading');
    assert.equal(frame.dataset.frameState, 'loading');

    const dataUrl = 'data:image/jpeg;base64,settled';
    settleFrameCapture(frame, dataUrl, url, TileFrames._state.refreshEpoch);

    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame.dataset.captured, '1');
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    assert.equal(frame._img.src, dataUrl);
    // IDB write is async — give the chain a tick.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await FrameCache.getFrame(url), dataUrl);
});

test('settleFrameCapture paints offline on null dataUrl (no stuck loading)', () => {
    TileFrames._resetForTests();
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/fail.m3u8', TileFrames._state.refreshEpoch);
    assert.equal(frame.dataset.frameState, 'offline');
    assert.equal(frame.dataset.captured, '1');
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    assert.equal(frame._badge.classList.contains('is-hidden'), false);
});

test('settleFrameCapture still writes IDB when tile is disconnected', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/gone.m3u8';
    const dataUrl = 'data:image/jpeg;base64,gone';
    const frame = makeFrame({ url, connected: false });
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, dataUrl, url, TileFrames._state.refreshEpoch);
    // Disconnected — UI stays whatever it was, but cache must persist.
    assert.notEqual(frame.dataset.frameState, 'captured');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await FrameCache.getFrame(url), dataUrl);
});

test('settleFrameCapture ignores stale epoch for UI but still caches', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/stale-epoch.m3u8';
    const dataUrl = 'data:image/jpeg;base64,stale';
    const frame = makeFrame({ url });
    setFrameState(frame, 'loading');
    const oldEpoch = TileFrames._state.refreshEpoch;
    TileFrames._state.refreshEpoch++;
    settleFrameCapture(frame, dataUrl, url, oldEpoch);
    assert.equal(frame.dataset.frameState, 'loading', 'stale epoch must not paint UI');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await FrameCache.getFrame(url), dataUrl);
});

test('observe eagerly enqueues even when IntersectionObserver never fires', async () => {
    TileFrames._resetForTests();
    await FrameCache.clearFrames();

    const PrevIO = globalThis.IntersectionObserver;
    // Silent observer: observe() is a no-op and never delivers callbacks.
    globalThis.IntersectionObserver = class {
        constructor() {}
        observe() {}
        unobserve() {}
        disconnect() {}
    };

    const url = 'https://example.test/eager-queue.m3u8';
    const frame = makeFrame({ url });
    // Minimal container that TileFrames.attachFrames can walk.
    const container = {
        closest() { return null; },
        clientHeight: 700,
        clientWidth: 900,
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    try {
        TileFrames.observe(container);
        // Eager path must have queued the frame without waiting on IO.
        assert.equal(TileFrames._state.pending.has(frame), true, 'frame must be pending');
        assert.ok(
            TileFrames._state.hot.includes(frame) || TileFrames._state.warm.includes(frame)
            || frame.dataset.frameState === 'loading'
            || frame.dataset.frameState === 'offline'
            || frame.dataset.frameState === 'captured',
            'frame must leave pure idle — queued or already draining'
        );
        // Drain starts capture asynchronously; give it a moment to flip waiting→loading.
        await new Promise((r) => setTimeout(r, 20));
        assert.notEqual(frame.dataset.frameState, undefined);
        assert.ok(
            ['waiting', 'loading', 'offline', 'captured'].includes(frame.dataset.frameState),
            `unexpected state ${frame.dataset.frameState}`
        );
        // Must not be stuck with no queue activity if still waiting — pending covers that.
        if (frame.dataset.frameState === 'waiting') {
            assert.equal(TileFrames._state.pending.has(frame), true);
        }
    } finally {
        if (PrevIO === undefined) delete globalThis.IntersectionObserver;
        else globalThis.IntersectionObserver = PrevIO;
        TileFrames._resetForTests();
    }
});

test('viewport intersect enqueues a below-fold waiting frame into hot', () => {
    TileFrames._resetForTests();
    TileFrames._state.running = TileFrames.MAX_HEAVY_IDLE; // hold drain
    const frame = makeFrame({ url: 'https://example.test/scroll-in.m3u8' });
    setFrameState(frame, 'waiting');
    assert.equal(TileFrames._state.pending.has(frame), false);

    TileFrames._onFrameVisibility(frame, true);
    assert.equal(TileFrames._state.pending.has(frame), true);
    assert.equal(TileFrames._state.hot[0], frame);
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    TileFrames._resetForTests();
});

test('viewport leave demotes waiting frame off hot without loading', () => {
    TileFrames._resetForTests();
    TileFrames._state.running = TileFrames.MAX_HEAVY_IDLE;
    const frame = makeFrame({ url: 'https://example.test/scroll-out.m3u8' });
    TileFrames._onFrameVisibility(frame, true);
    assert.equal(TileFrames._state.hot.includes(frame), true);
    assert.equal(TileFrames._state.pending.has(frame), true);

    TileFrames._onFrameVisibility(frame, false);
    assert.equal(TileFrames._state.hot.includes(frame), false);
    assert.equal(TileFrames._state.pending.has(frame), false);
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame._loading.classList.contains('is-hidden'), true);
    assert.equal(frame.dataset.captured, undefined);
    TileFrames._resetForTests();
});

test('viewport leave does not abort an in-flight loading capture', () => {
    TileFrames._resetForTests();
    const frame = makeFrame({ url: 'https://example.test/in-flight.m3u8' });
    TileFrames._state.pending.add(frame);
    setFrameState(frame, 'loading');
    TileFrames._onFrameVisibility(frame, false);
    assert.equal(frame.dataset.frameState, 'loading');
    assert.equal(TileFrames._state.pending.has(frame), true);
    TileFrames._resetForTests();
});
