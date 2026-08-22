/** Unit tests for js/tileFrames.js — fast dual-tier queue + live snap API. */
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

function makeFrame({
    url = 'https://example.test/live.m3u8',
    channel = '',
    logo = '',
    connected = true
} = {}) {
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
        dataset: { url, channel, logo },
        closest() { return tile; }
    };
    const frame = {
        dataset: { frameState: 'waiting' },
        isConnected: connected,
        classList: {
            contains: (c) => c === 'channel-tile__capture-frame'
        },
        querySelector(sel) { return map[sel] || null; },
        closest(sel) {
            if (sel === '.channel-tile') return tile;
            return null;
        },
        getBoundingClientRect() {
            return { top: 0, bottom: 40, left: 0, right: 160 };
        },
        _img: img,
        _letter: letter,
        _waiting: waiting,
        _loading: loading,
        _badge: badge
    };
    return frame;
}

function stubIO() {
    const PrevIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
        constructor() {}
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    return () => {
        if (PrevIO === undefined) delete globalThis.IntersectionObserver;
        else globalThis.IntersectionObserver = PrevIO;
    };
}

function holdDrain() {
    TileFrames._state.running = TileFrames.MAX_TOTAL;
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

test('setFrameState provisional paints logo without captured', () => {
    const frame = makeFrame({ logo: 'https://logo.test/a.png' });
    setFrameState(frame, 'provisional', 'https://logo.test/a.png');
    assert.equal(frame.dataset.frameState, 'provisional');
    assert.equal(frame.dataset.provisional, '1');
    assert.equal(frame.dataset.captured, undefined);
    assert.equal(frame._img.src, 'https://logo.test/a.png');
    assert.equal(frame._img.classList.contains('is-hidden'), false);
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
});

test('setFrameState captured paints src eagerly', () => {
    const frame = makeFrame();
    setFrameState(frame, 'captured', 'data:image/jpeg;base64,xyz');
    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame.dataset.captured, '1');
    assert.equal(frame._img.src, 'data:image/jpeg;base64,xyz');
    assert.equal(frame._waiting.classList.contains('is-hidden'), true);
});

test('dual-tier concurrency knobs match fast engine', () => {
    assert.equal(TileFrames.MAX_TOTAL, 8);
    assert.equal(TileFrames.MAX_CHEAP, 6);
    assert.equal(TileFrames.MAX_HEAVY, 4);
    assert.equal(TileFrames.MAX_HEAVY_BUSY, 2);
    assert.equal(TileFrames.CAPTURE_BUDGET_MS, 5500);
    assert.ok(TileFrames.CAPTURE_BUDGET_BUSY_MS <= TileFrames.CAPTURE_BUDGET_MS);
});

test('playback busy lowers heavy concurrency', () => {
    TileFrames._resetForTests();
    TileFrames.setPlaybackBusy(false);
    assert.equal(TileFrames._state.playbackBusy, false);
    TileFrames.setPlaybackBusy(true);
    assert.equal(TileFrames._state.playbackBusy, true);
    TileFrames.setPlaybackBusy(false);
});

test('observe enqueues hotBudget into hot and overflow into warm', () => {
    TileFrames._resetForTests();
    const restoreIO = stubIO();
    holdDrain();

    const frames = [];
    for (let i = 0; i < 40; i++) {
        frames.push(makeFrame({ url: `https://example.test/ch-${i}.m3u8` }));
    }
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
        assert.equal(TileFrames._state.warm.length, 40 - budget);
        assert.equal(TileFrames._state.pending.size, 40);
        for (let i = 0; i < budget; i++) {
            assert.equal(TileFrames._state.hot[i], frames[i]);
        }
        for (let i = budget; i < 40; i++) {
            assert.equal(TileFrames._state.warm.includes(frames[i]), true);
        }
    } finally {
        restoreIO();
        TileFrames._resetForTests();
    }
});

test('viewport leave demotes waiting frame from hot to warm', () => {
    TileFrames._resetForTests();
    holdDrain();
    const frame = makeFrame({ url: 'https://example.test/scroll-out.m3u8' });
    TileFrames._onFrameVisibility(frame, true);
    assert.equal(TileFrames._state.hot.includes(frame), true);

    TileFrames._onFrameVisibility(frame, false);
    assert.equal(TileFrames._state.hot.includes(frame), false);
    assert.equal(TileFrames._state.warm.includes(frame), true);
    assert.equal(TileFrames._state.pending.has(frame), true);
    assert.equal(frame.dataset.frameState, 'waiting');
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

test('viewport intersect enqueues a below-fold waiting frame into hot', () => {
    TileFrames._resetForTests();
    holdDrain();
    const frame = makeFrame({ url: 'https://example.test/scroll-in.m3u8' });
    setFrameState(frame, 'waiting');
    TileFrames._onFrameVisibility(frame, true);
    assert.equal(TileFrames._state.pending.has(frame), true);
    assert.equal(TileFrames._state.hot[0], frame);
    TileFrames._resetForTests();
});

test('settleFrameCapture leaves waiting on soft fail without provisional', () => {
    TileFrames._resetForTests();
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/fail.m3u8', TileFrames._state.refreshEpoch, 'timeout');
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame.dataset.frameFail, 'timeout');
    assert.equal(frame.dataset.captured, undefined);
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('settleFrameCapture leaves waiting on black soft fail', () => {
    TileFrames._resetForTests();
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/black.m3u8', TileFrames._state.refreshEpoch, 'black');
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame.dataset.frameFail, 'black');
    assert.equal(frame.dataset.captured, undefined);
});

test('settleFrameCapture paints offline only on hard fail without provisional', () => {
    TileFrames._resetForTests();
    const frame = makeFrame();
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/fail.m3u8', TileFrames._state.refreshEpoch, 'media');
    assert.equal(frame.dataset.frameState, 'offline');
    assert.equal(frame.dataset.frameFail, 'media');
    assert.equal(frame._badge.classList.contains('is-hidden'), false);
});

test('settleFrameCapture does not demote captured to offline on late hard fail', () => {
    TileFrames._resetForTests();
    const url = 'https://example.test/late-fail.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'captured', 'data:image/jpeg;base64,good');
    settleFrameCapture(frame, null, url, TileFrames._state.refreshEpoch, 'media');
    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame._img.src, 'data:image/jpeg;base64,good');
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('settleFrameCapture skips offline when live snap owns the URL', () => {
    TileFrames._resetForTests();
    const url = 'https://example.test/playing-protect.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'loading');
    // Simulate in-flight live snap for this stream.
    TileFrames._liveSnapByUrl.set(url, {
        noted: false,
        inFlight: true,
        gen: 1,
        retries: 0,
        retryTimer: null
    });
    settleFrameCapture(frame, null, url, TileFrames._state.refreshEpoch, 'media');
    assert.equal(frame.dataset.frameState, 'waiting');
    assert.equal(frame.dataset.captured, undefined);
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('settleFrameCapture keeps provisional logo instead of offline', () => {
    TileFrames._resetForTests();
    const frame = makeFrame({ logo: 'https://logo.test/keep.png' });
    setFrameState(frame, 'provisional', 'https://logo.test/keep.png');
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/fail.m3u8', TileFrames._state.refreshEpoch, 'timeout');
    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame._img.src, 'https://logo.test/keep.png');
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('settleFrameCapture keeps provisional logo on hard fail too', () => {
    TileFrames._resetForTests();
    const frame = makeFrame({ logo: 'https://logo.test/keep.png' });
    setFrameState(frame, 'provisional', 'https://logo.test/keep.png');
    setFrameState(frame, 'loading');
    settleFrameCapture(frame, null, 'https://example.test/fail.m3u8', TileFrames._state.refreshEpoch, 'media');
    assert.equal(frame.dataset.frameState, 'captured');
    assert.equal(frame._badge.classList.contains('is-hidden'), true);
});

test('settleFrameCapture paints captured and writes cache', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/settle-ok.m3u8';
    const frame = makeFrame({ url, channel: 'iptv-org:settle' });
    setFrameState(frame, 'loading');
    const dataUrl = 'data:image/jpeg;base64,settled';
    settleFrameCapture(frame, dataUrl, url, TileFrames._state.refreshEpoch, null, 'iptv-org:settle');
    assert.equal(frame.dataset.frameState, 'captured');
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(await FrameCache.getFrame(url), dataUrl);
    assert.equal(await FrameCache.getFrame('iptv-org:settle'), dataUrl);
    await FrameCache.clearFrames();
});

test('settleFrameCapture ignores stale epoch for UI and cache', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/stale-epoch.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'loading');
    const oldEpoch = TileFrames._state.refreshEpoch;
    TileFrames._state.refreshEpoch++;
    settleFrameCapture(frame, 'data:image/jpeg;base64,stale', url, oldEpoch);
    assert.equal(frame.dataset.frameState, 'loading');
    await new Promise((r) => setTimeout(r, 15));
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

test('refresh with viewKey clears cache, paints provisional, and requeues', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const restoreIO = stubIO();
    holdDrain();

    const url = 'https://example.test/refresh.m3u8';
    const chKey = 'iptv-org:refresh';
    const logo = 'https://logo.test/r.png';
    await FrameCache.setFrame(url, 'data:image/jpeg;base64,old');
    await FrameCache.setFrame(chKey, 'data:image/jpeg;base64,old');

    const frame = makeFrame({ url, channel: chKey, logo });
    setFrameState(frame, 'captured', 'data:image/jpeg;base64,old');
    const container = {
        closest() { return null; },
        clientHeight: 0,
        clientWidth: 0,
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    try {
        await TileFrames.refresh(container, { viewKey: 'browse:US' });
        assert.equal(TileFrames.isLiveRefreshActive('browse:US'), true);
        assert.equal(await FrameCache.getFrame(url), null);
        assert.equal(await FrameCache.getFrame(chKey), null);
        assert.equal(frame.dataset.provisional, '1');
        assert.equal(frame._img.src, logo);
        assert.equal(TileFrames._state.pending.has(frame), true);
        assert.ok(
            TileFrames._state.hot.includes(frame) || TileFrames._state.warm.includes(frame)
        );
    } finally {
        restoreIO();
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('refreshFrame clears one tile cache and force-requeues without bumping epoch', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    holdDrain();

    const url = 'https://example.test/one-tile.m3u8';
    const chKey = 'iptv-org:one-tile';
    const otherUrl = 'https://example.test/other-tile.m3u8';
    await FrameCache.setFrame(url, 'data:image/jpeg;base64,old');
    await FrameCache.setFrame(otherUrl, 'data:image/jpeg;base64,keep');

    const frame = makeFrame({ url, channel: chKey, logo: 'https://logo.test/one.png' });
    const other = makeFrame({ url: otherUrl });
    setFrameState(frame, 'offline');
    setFrameState(other, 'captured', 'data:image/jpeg;base64,keep');
    const epoch = TileFrames._state.refreshEpoch;

    try {
        await TileFrames.refreshFrame(frame);
        assert.equal(TileFrames._state.refreshEpoch, epoch);
        assert.equal(await FrameCache.getFrame(url), null);
        assert.equal(await FrameCache.getFrame(otherUrl), 'data:image/jpeg;base64,keep');
        assert.equal(other.dataset.frameState, 'captured');
        assert.equal(frame.dataset.captured, undefined);
        assert.equal(TileFrames._state.pending.has(frame), true);
        assert.equal(TileFrames._state.hot[0], frame);
        assert.equal(TileFrames._state.forceHeavy.has(frame), true);
    } finally {
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('observe primes from FrameCache and queues uncached tiles', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const restoreIO = stubIO();
    holdDrain();

    const cachedUrl = 'https://example.test/cached.m3u8';
    const freshUrl = 'https://example.test/fresh.m3u8';
    const dataUrl = 'data:image/jpeg;base64,cached';
    await FrameCache.setFrame(cachedUrl, dataUrl);

    const cached = makeFrame({ url: cachedUrl });
    const fresh = makeFrame({ url: freshUrl });
    const container = {
        closest() { return null; },
        clientHeight: 0,
        clientWidth: 0,
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [cached, fresh];
            return [];
        }
    };

    try {
        TileFrames.observe(container);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(cached.dataset.frameState, 'captured');
        assert.equal(cached._img.src, dataUrl);
        assert.equal(TileFrames._state.pending.has(fresh), true);
        assert.ok(
            ['waiting', 'provisional', 'loading'].includes(fresh.dataset.frameState)
        );
    } finally {
        restoreIO();
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('observe primes skeleton tiles from channel-key cache without stream URL', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const restoreIO = stubIO();
    holdDrain();

    const chKey = 'iptv-org:skeleton.ch';
    const dataUrl = 'data:image/jpeg;base64,skeleton';
    await FrameCache.setFrame(chKey, dataUrl);

    const frame = makeFrame({ url: '', channel: chKey });
    const container = {
        closest() { return null; },
        clientHeight: 0,
        clientWidth: 0,
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    try {
        TileFrames.observe(container);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(frame.dataset.frameState, 'captured');
        assert.equal(frame._img.src, dataUrl);
    } finally {
        restoreIO();
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('notePlayingVideo gates without url, video, or document', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    const url = 'https://example.test/playing-gate.m3u8';

    assert.equal(TileFrames.notePlayingVideo(url, null), false);
    assert.equal(TileFrames.notePlayingVideo('', { videoWidth: 640, videoHeight: 360 }), false);
    assert.equal(
        TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 }),
        false
    );
    assert.equal(await FrameCache.getFrame(url), null);
});

test('notePlayingVideo waits, paints matching tiles, and caches', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/live-snap.m3u8';
    const dataUrl = 'data:image/jpeg;base64,livesnap';
    const frame = makeFrame({ url });
    const other = makeFrame({ url: 'https://example.test/other.m3u8' });
    setFrameState(frame, 'waiting');
    setFrameState(other, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame, other];
            return [];
        }
    };

    TileFrames._setLiveTileSnapForTests(async () => ({ dataUrl, fail: null }));

    try {
        const ok = await TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 });
        assert.equal(ok, true);
        assert.equal(frame.dataset.frameState, 'captured');
        assert.equal(frame._img.src, dataUrl);
        assert.equal(other.dataset.frameState, 'waiting');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await FrameCache.getFrame(url), dataUrl);
        assert.equal(TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 }), false);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('notePlayingVideo leaves waiting tiles alone when snap stays null', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    TileFrames._setLiveSnapRetryForTests({ ms: 60_000, max: 0 });

    const url = 'https://example.test/live-null.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };
    TileFrames._setLiveTileSnapForTests(async () => ({ dataUrl: null, fail: 'black' }));

    try {
        const ok = await TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 });
        assert.equal(ok, false);
        assert.equal(frame.dataset.frameState, 'waiting');
        assert.equal(await FrameCache.getFrame(url), null);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
    }
});

test('notePlayingVideo retries until snap succeeds', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    TileFrames._setLiveSnapRetryForTests({ ms: 5, max: 8 });

    const url = 'https://example.test/live-retry.m3u8';
    const dataUrl = 'data:image/jpeg;base64,retryok';
    const frame = makeFrame({ url });
    setFrameState(frame, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    let calls = 0;
    TileFrames._setLiveTileSnapForTests(async () => {
        calls += 1;
        if (calls < 2) return { dataUrl: null, fail: 'black' };
        return { dataUrl, fail: null };
    });

    try {
        assert.equal(await TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 }), false);
        assert.equal(frame.dataset.frameState, 'waiting');
        await new Promise((r) => setTimeout(r, 40));
        assert.ok(calls >= 2);
        assert.equal(frame.dataset.frameState, 'captured');
        assert.equal(frame._img.src, dataUrl);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('armLiveSnap cancels pending live-snap retry', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    TileFrames._setLiveSnapRetryForTests({ ms: 30, max: 8 });

    const url = 'https://example.test/live-cancel-retry.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    let calls = 0;
    TileFrames._setLiveTileSnapForTests(async () => {
        calls += 1;
        return { dataUrl: null, fail: 'black' };
    });

    try {
        await TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 });
        assert.equal(calls, 1);
        TileFrames.armLiveSnap(url);
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(calls, 1, 'retry must not fire after armLiveSnap');
        assert.equal(frame.dataset.frameState, 'waiting');
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
    }
});

test('notePlayingVideo clears offline D/C when snap stays null', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();
    TileFrames._setLiveSnapRetryForTests({ ms: 60_000, max: 0 });

    const url = 'https://example.test/live-clear-dc.m3u8';
    const frame = makeFrame({ url });
    setFrameState(frame, 'offline');
    assert.equal(frame.dataset.captured, '1');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };
    TileFrames._setLiveTileSnapForTests(async () => ({ dataUrl: null, fail: 'black' }));

    try {
        const ok = await TileFrames.notePlayingVideo(url, { videoWidth: 640, videoHeight: 360 });
        assert.equal(ok, false);
        assert.equal(frame.dataset.frameState, 'waiting');
        assert.equal(frame.dataset.captured, undefined);
        assert.equal(frame._badge.classList.contains('is-hidden'), true);
        assert.equal(await FrameCache.getFrame(url), null);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
    }
});

test('notePlayingVideo snaps different URLs independently (mosaic slots)', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const urlA = 'https://example.test/gen-a.m3u8';
    const urlB = 'https://example.test/gen-b.m3u8';
    const frameA = makeFrame({ url: urlA, channel: 'iptv-org:a' });
    const frameB = makeFrame({ url: urlB, channel: 'iptv-org:b' });
    setFrameState(frameA, 'waiting');
    setFrameState(frameB, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frameA, frameB];
            return [];
        }
    };

    let releaseA;
    const holdA = new Promise((resolve) => { releaseA = resolve; });

    TileFrames._setLiveTileSnapForTests(async (video) => {
        if (video?._id === 'A') {
            await holdA;
            return { dataUrl: 'data:image/jpeg;base64,aaa', fail: null };
        }
        return { dataUrl: 'data:image/jpeg;base64,bbb', fail: null };
    });

    try {
        const pA = TileFrames.notePlayingVideo(urlA, { videoWidth: 640, videoHeight: 360, _id: 'A' }, 'iptv-org:a');
        const pB = TileFrames.notePlayingVideo(urlB, { videoWidth: 640, videoHeight: 360, _id: 'B' }, 'iptv-org:b');
        releaseA();
        assert.equal(await pA, true);
        assert.equal(await pB, true);
        assert.equal(frameA.dataset.frameState, 'captured');
        assert.equal(frameB.dataset.frameState, 'captured');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await FrameCache.getFrame(urlA), 'data:image/jpeg;base64,aaa');
        assert.equal(await FrameCache.getFrame(urlB), 'data:image/jpeg;base64,bbb');
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('armLiveSnap allows re-snap of same URL', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/arm-replay.m3u8';
    const frame = makeFrame({ url });
    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    let n = 0;
    TileFrames._setLiveTileSnapForTests(async () => {
        n += 1;
        return { dataUrl: `data:image/jpeg;base64,arm${n}`, fail: null };
    });

    try {
        assert.equal(await TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 }), true);
        assert.equal(frame._img.src, 'data:image/jpeg;base64,arm1');
        assert.equal(TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 }), false);

        TileFrames.armLiveSnap(url);
        assert.equal(await TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 }), true);
        assert.equal(frame._img.src, 'data:image/jpeg;base64,arm2');
        assert.equal(n, 2);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await FrameCache.getFrame(url), 'data:image/jpeg;base64,arm2');
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('armLiveSnap cancels in-flight notePlayingVideo wait', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/arm-cancel.m3u8';
    const frame = makeFrame({ url });
    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let cancelled = false;

    TileFrames._setLiveTileSnapForTests(async (_video, _budget, isCancelled) => {
        await hold;
        cancelled = isCancelled?.() === true;
        return { dataUrl: 'data:image/jpeg;base64,stale', fail: null };
    });

    try {
        const pending = TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 });
        TileFrames.armLiveSnap(url);
        release();
        assert.equal(await pending, false);
        assert.equal(cancelled, true);
        assert.equal(frame.dataset.frameState, 'waiting');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await FrameCache.getFrame(url), null);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('notePlayingVideo stores under channel key for reload priming', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/played.m3u8';
    const chKey = 'iptv-org:played.ch';
    const dataUrl = 'data:image/jpeg;base64,played';
    const frame = makeFrame({ url, channel: chKey });

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };
    TileFrames._setLiveTileSnapForTests(async () => ({ dataUrl, fail: null }));

    try {
        assert.equal(await TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 }, chKey), true);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await FrameCache.getFrame(url), dataUrl);
        assert.equal(await FrameCache.getFrame(chKey), dataUrl);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('notePlayingVideo paints skeleton tile matched by data-channel only', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/skel-paint.m3u8';
    const chKey = 'iptv-org:skel.paint';
    const dataUrl = 'data:image/jpeg;base64,skelpaint';
    const frame = makeFrame({ url: '', channel: chKey });
    setFrameState(frame, 'waiting');

    const PrevDoc = globalThis.document;
    globalThis.document = {
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };
    TileFrames._setLiveTileSnapForTests(async () => ({ dataUrl, fail: null }));

    try {
        assert.equal(await TileFrames.notePlayingVideo(url, { videoWidth: 1, videoHeight: 1 }, chKey), true);
        assert.equal(frame.dataset.frameState, 'captured');
        assert.equal(frame._img.src, dataUrl);
    } finally {
        if (PrevDoc === undefined) delete globalThis.document;
        else globalThis.document = PrevDoc;
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('successful FrameCache write survives without a connected tile', async () => {
    await FrameCache.clearFrames();
    const url = 'https://example.test/survive.m3u8';
    const dataUrl = 'data:image/jpeg;base64,survived';
    await FrameCache.setFrame(url, dataUrl);
    assert.equal(await FrameCache.getFrame(url), dataUrl);
    const frame = makeFrame({ url, connected: false });
    assert.equal(frame.isConnected, false);
    assert.equal(await FrameCache.getFrame(url), dataUrl);
});

test('refresh epoch increments', () => {
    TileFrames._resetForTests();
    const before = TileFrames._state.refreshEpoch;
    TileFrames._state.refreshEpoch++;
    assert.equal(TileFrames._state.refreshEpoch, before + 1);
});
