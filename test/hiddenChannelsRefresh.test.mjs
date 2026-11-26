/**
 * Hidden-Channels "Check if online" (settings tile refresh).
 *
 * Hidden/visited metadata stores only { key, name, logo, countrycode }, so the
 * check must re-resolve the stream URL through the provider registry and then
 * reuse the catalog preview pipeline (TileFrames) — a decoded frame means
 * online, the disconnect badge means offline.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

let resolveTileStream;
let checkTileOnline;
let watchFrameState;
let VERDICT_TOAST;
let hiddenSettingsTileHtml;

before(async () => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
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
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
    };
    globalThis.document = {
        getElementById: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        body: { classList: { contains: () => false } }
    };
    ({ resolveTileStream, checkTileOnline, watchFrameState, VERDICT_TOAST } = await import('../js/ui/tileStreamCheck.js'));
    ({ hiddenSettingsTileHtml } = await import('../js/ui/hiddenChannelsSettings.js'));
});

function makeTile({ key = 'iptv-org:bbc-one', logo = 'https://cdn.example/logo.png', state = 'waiting' } = {}) {
    const frame = { isConnected: true, dataset: { frameState: state }, querySelector: () => null };
    const btn = {
        disabled: false,
        added: [],
        removed: [],
        classList: {
            add(c) { btn.added.push(c); },
            remove(c) { btn.removed.push(c); }
        }
    };
    const tile = {
        dataset: { channel: key, logo },
        querySelector(sel) {
            if (sel === '.channel-tile__capture-frame') return frame;
            if (sel === '.channel-tile__refresh-btn') return btn;
            return null;
        }
    };
    return { tile, frame, btn };
}

function makeFrames({ onRefresh = () => {} } = {}) {
    const calls = { refreshFrame: [], setFrameState: [] };
    return {
        calls,
        frames: {
            async refreshFrame(frame) {
                calls.refreshFrame.push(frame);
                onRefresh(frame);
            },
            setFrameState(frame, state) {
                calls.setFrameState.push([frame, state]);
            }
        }
    };
}

/* ---- URL resolution ---- */

test('resolveTileStream keeps an existing stream URL without touching the catalog', async () => {
    let lookups = 0;
    const res = await resolveTileStream(
        { channeluuid: 'iptv-org:bbc-one', url_resolved: ' https://s.example/1.m3u8 ' },
        { resolve: async () => { lookups += 1; return null; } }
    );
    assert.equal(lookups, 0);
    assert.equal(res.url, 'https://s.example/1.m3u8');
});

test('resolveTileStream re-resolves meta-only refs through the provider', async () => {
    const seen = [];
    const res = await resolveTileStream(
        { providerId: 'iptv-org', channelId: 'bbc-one', channeluuid: 'iptv-org:bbc-one', name: 'BBC One', logo: '' },
        {
            resolve: async (ref) => {
                seen.push(ref);
                return {
                    providerId: 'iptv-org',
                    channelId: 'bbc-one',
                    name: 'BBC One HD',
                    logo: 'https://cdn.example/resolved.png',
                    url_resolved: 'https://s.example/2.m3u8'
                };
            }
        }
    );
    assert.deepEqual(seen, [{ providerId: 'iptv-org', channelId: 'bbc-one' }]);
    assert.equal(res.url, 'https://s.example/2.m3u8');
    assert.equal(res.channel.name, 'BBC One');
    assert.equal(res.channel.logo, 'https://cdn.example/resolved.png');
});

test('resolveTileStream returns null for unresolvable or stream-less refs', async () => {
    const meta = { providerId: 'iptv-org', channelId: 'gone', channeluuid: 'iptv-org:gone' };
    assert.equal(await resolveTileStream(meta, { resolve: async () => { throw new Error('nope'); } }), null);
    assert.equal(await resolveTileStream(meta, { resolve: async () => null }), null);
    assert.equal(await resolveTileStream(meta, { resolve: async () => ({ name: 'No URL' }) }), null);
    assert.equal(await resolveTileStream(null, { resolve: async () => null }), null);
});

/* ---- check flow ---- */

test('checkTileOnline puts the resolved URL on the tile before grabbing a frame', async () => {
    const { tile } = makeTile();
    const notify = [];
    let urlAtGrab = '';
    const { frames } = makeFrames({ onRefresh: () => { urlAtGrab = tile.dataset.url; } });

    const verdict = await checkTileOnline(
        { providerId: 'iptv-org', channelId: 'bbc-one', channeluuid: 'iptv-org:bbc-one', name: 'BBC One' },
        tile,
        {
            resolve: async () => ({ url_resolved: 'https://s.example/3.m3u8', logo: 'https://cdn.example/fresh.png' }),
            frames,
            watch: async () => 'online',
            notify: (m) => notify.push(m)
        }
    );

    assert.equal(urlAtGrab, 'https://s.example/3.m3u8');
    assert.equal(tile.dataset.logo, 'https://cdn.example/fresh.png');
    assert.equal(verdict, 'online');
    assert.deepEqual(notify, [VERDICT_TOAST.online]);
    assert.equal(tile.dataset.checking, undefined, 'in-flight flag cleared');
});

test('checkTileOnline reports offline when the capture paints the disconnect badge', async () => {
    const { tile } = makeTile();
    const notify = [];
    const { frames } = makeFrames();
    const verdict = await checkTileOnline(
        { url_resolved: 'https://s.example/dead.m3u8' },
        tile,
        { frames, watch: async () => 'offline', notify: (m) => notify.push(m) }
    );
    assert.equal(verdict, 'offline');
    assert.deepEqual(notify, [VERDICT_TOAST.offline]);
});

test('checkTileOnline reports "no picture" when the grab ends on the logo only', async () => {
    const { tile } = makeTile();
    const notify = [];
    const { frames } = makeFrames();
    const verdict = await checkTileOnline(
        { url_resolved: 'https://s.example/dead-with-logo.m3u8' },
        tile,
        { frames, watch: async () => 'nopicture', notify: (m) => notify.push(m) }
    );
    assert.equal(verdict, 'nopicture');
    assert.deepEqual(notify, [VERDICT_TOAST.nopicture]);
});

test('checkTileOnline maps soft timeouts to an honest "could not verify" verdict', async () => {
    const { tile } = makeTile();
    const notify = [];
    const { frames } = makeFrames();
    const verdict = await checkTileOnline(
        { url_resolved: 'https://s.example/slow.m3u8' },
        tile,
        { frames, watch: async () => 'waiting', notify: (m) => notify.push(m) }
    );
    assert.equal(verdict, 'unknown');
    assert.deepEqual(notify, [VERDICT_TOAST.unknown]);
});

test('checkTileOnline marks unresolvable refs offline without grabbing a frame', async () => {
    const { tile, frame } = makeTile({ key: 'iptv-org:gone' });
    const notify = [];
    const { frames, calls } = makeFrames();

    const verdict = await checkTileOnline(
        { providerId: 'iptv-org', channelId: 'gone', channeluuid: 'iptv-org:gone' },
        tile,
        { resolve: async () => null, frames, watch: async () => 'online', notify: (m) => notify.push(m) }
    );

    assert.equal(verdict, 'unresolved');
    assert.equal(calls.refreshFrame.length, 0);
    assert.deepEqual(calls.setFrameState, [[frame, 'offline']]);
    assert.deepEqual(notify, [VERDICT_TOAST.unresolved]);
});

test('checkTileOnline ignores a second click while a check is in flight', async () => {
    const { tile, btn } = makeTile();
    const { frames } = makeFrames();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const first = checkTileOnline(
        { url_resolved: 'https://s.example/4.m3u8' },
        tile,
        { frames, watch: () => gate, notify: () => {} }
    );
    await Promise.resolve();
    assert.equal(btn.disabled, true, 'button disabled while checking');
    assert.equal(tile.dataset.checking, '1');

    const second = await checkTileOnline(
        { url_resolved: 'https://s.example/4.m3u8' },
        tile,
        { frames, watch: async () => 'online', notify: () => {} }
    );
    assert.equal(second, 'pending');

    release('online');
    assert.equal(await first, 'online');
    assert.equal(btn.disabled, false, 'button re-enabled after checking');
    assert.equal(tile.dataset.checking, undefined);
});

test('checkTileOnline stays quiet when the tile is unhidden mid-check', async () => {
    const { tile, frame } = makeTile();
    const notify = [];
    const { frames } = makeFrames();
    const verdict = await checkTileOnline(
        { url_resolved: 'https://s.example/5.m3u8' },
        tile,
        {
            frames,
            watch: async () => {
                frame.isConnected = false; // tile removed by the unhide handler
                return 'online';
            },
            notify: (m) => notify.push(m)
        }
    );
    assert.equal(verdict, 'unknown');
    assert.deepEqual(notify, []);
});

/* ---- frame verdict watcher ---- */

function fakeFrame(state, imgSrc = '') {
    return {
        dataset: { frameState: state },
        querySelector: () => ({ getAttribute: () => imgSrc })
    };
}

test('watchFrameState reads an already-settled frame without waiting', async () => {
    assert.equal(await watchFrameState(fakeFrame('captured', 'data:image/jpeg;base64,AAA'), { timeoutMs: 50 }), 'online');
    assert.equal(await watchFrameState(fakeFrame('offline'), { timeoutMs: 50 }), 'offline');
});

test('watchFrameState does not call a provisional-logo "captured" frame online', async () => {
    // frameUi keeps the logo as captured when a grab fails — no picture decoded.
    const verdict = await watchFrameState(fakeFrame('captured', 'https://cdn.example/logo.png'), { timeoutMs: 5 });
    assert.equal(verdict, 'nopicture');
});

test('watchFrameState resolves when the frame attribute flips, or times out', async () => {
    let observerInstance = null;
    class FakeObserver {
        constructor(cb) { this.cb = cb; observerInstance = this; }
        observe() {}
        disconnect() { this.disconnected = true; }
    }

    const frame = fakeFrame('waiting');
    const pending = watchFrameState(frame, { Observer: FakeObserver, timeoutMs: 80 });
    frame.dataset.frameState = 'captured';
    frame.querySelector = () => ({ getAttribute: () => 'data:image/png;base64,BBB' });
    observerInstance.cb();
    assert.equal(await pending, 'online');
    assert.equal(observerInstance.disconnected, true);

    const stuck = watchFrameState(fakeFrame('waiting'), { Observer: FakeObserver, timeoutMs: 5 });
    assert.equal(await stuck, 'unknown');
});

/* ---- settings tile markup ---- */

test('hidden TV tiles carry the refresh control and frame overlays', () => {
    const html = hiddenSettingsTileHtml({
        providerId: 'iptv-org',
        channelId: 'bbc-one',
        channeluuid: 'iptv-org:bbc-one',
        name: 'BBC One',
        logo: 'https://cdn.example/logo.png',
        countrycode: 'GB'
    });
    assert.match(html, /class="channel-tile__refresh-btn"/);
    assert.match(html, /aria-label="Check if online"/);
    assert.match(html, /data-logo="https:\/\/cdn\.example\/logo\.png"/);
    assert.match(html, /channel-tile__frame-waiting/);
    assert.match(html, /channel-tile__frame-loading is-hidden/);
    assert.match(html, /channel-tile__offline-badge is-hidden/);
});

test('radio tiles keep the plain frame — no HLS preview pipeline', () => {
    const body = globalThis.document.body;
    body.classList.contains = (c) => c === 'catalog-mode-radio';
    try {
        const html = hiddenSettingsTileHtml({ channeluuid: 'radio-browser:uuid-1', name: 'Jazz FM', logo: '' });
        assert.ok(!html.includes('channel-tile__refresh-btn'), 'no refresh button for radio');
        assert.ok(!html.includes('channel-tile__offline-badge'), 'no capture overlays for radio');
        assert.match(html, /Show station/);
    } finally {
        body.classList.contains = () => false;
    }
});
