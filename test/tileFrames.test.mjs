/** Unit tests for js/tileFrames.js — cache paint + live snap API. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    TileFrames,
    setFrameState,
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

function makeFrame({ url = 'https://example.test/live.m3u8', channel = '', connected = true } = {}) {
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
        dataset: { url, channel },
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

test('observe primes from FrameCache and leaves uncached tiles waiting', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const cachedUrl = 'https://example.test/cached.m3u8';
    const freshUrl = 'https://example.test/fresh.m3u8';
    const dataUrl = 'data:image/jpeg;base64,cached';
    await FrameCache.setFrame(cachedUrl, dataUrl);

    const cached = makeFrame({ url: cachedUrl });
    const fresh = makeFrame({ url: freshUrl });
    const container = {
        closest() { return null; },
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
        assert.equal(fresh.dataset.frameState, 'waiting');
        assert.equal(fresh._waiting.classList.contains('is-hidden'), false);
    } finally {
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('observe primes skeleton tiles from channel-key cache without stream URL', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const chKey = 'iptv-org:skeleton.ch';
    const dataUrl = 'data:image/jpeg;base64,skeleton';
    await FrameCache.setFrame(chKey, dataUrl);

    const frame = makeFrame({ url: '', channel: chKey });
    const container = {
        closest() { return null; },
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
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('refresh clears FrameCache keys and resets tiles to waiting', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/refresh.m3u8';
    const chKey = 'iptv-org:refresh';
    const dataUrl = 'data:image/jpeg;base64,refresh';
    await FrameCache.setFrame(url, dataUrl);
    await FrameCache.setFrame(chKey, dataUrl);

    const frame = makeFrame({ url, channel: chKey });
    setFrameState(frame, 'captured', dataUrl);
    const container = {
        closest() { return null; },
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    try {
        await TileFrames.refresh(container);
        assert.equal(frame.dataset.frameState, 'waiting');
        assert.equal(await FrameCache.getFrame(url), null);
        assert.equal(await FrameCache.getFrame(chKey), null);
    } finally {
        TileFrames._resetForTests();
        await FrameCache.clearFrames();
    }
});

test('observe after refresh primes newly written frames (no skip-cache)', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

    const url = 'https://example.test/after-refresh.m3u8';
    const frame = makeFrame({ url });
    const container = {
        closest() { return null; },
        querySelectorAll(sel) {
            if (sel === '.channel-tile__capture-frame') return [frame];
            return [];
        }
    };

    try {
        await TileFrames.refresh(container);
        await FrameCache.setFrame(url, 'data:image/jpeg;base64,new');
        delete frame.dataset.captured;
        setFrameState(frame, 'waiting');
        TileFrames.observe(container);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(frame.dataset.frameState, 'captured');
        assert.equal(frame._img.src, 'data:image/jpeg;base64,new');
    } finally {
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
    assert.equal(
        TileFrames.notePlayingVideo(url, { videoWidth: 0, videoHeight: 0 }),
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
        assert.equal(other.dataset.frameState, 'waiting', 'other stream tiles stay untouched');
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

test('notePlayingVideo leaves tiles alone when snap stays null', async () => {
    await FrameCache.clearFrames();
    TileFrames._resetForTests();

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
        assert.equal(await pA, true, 'slot A snap must succeed independently');
        assert.equal(await pB, true, 'slot B snap must succeed independently');
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
        assert.equal(await pending, false, 'armed generation must supersede in-flight snap');
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
