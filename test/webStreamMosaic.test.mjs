/**
 * Mosaic Web Video mixin: synthetic channel play, paused restore, embed mode,
 * detach-with-restore, persisted slot shape.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { webStreamMethods } from '../js/mosaic/webstream.js';
import { persistMethods } from '../js/mosaic/persist.js';
import { tileChromeMethods } from '../js/mosaic/tileChrome.js';
import { SettingsStore } from '../js/storage/settingsStore.js';
import { addWebStreamItem, loadWebStreamLibrary } from '../js/webstream/webStreamLibrary.js';
import { buildShieldAttributes } from '../js/webstream/webShield.js';

const store = new Map();

function makeNode(tag = 'div') {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        dataset: {},
        style: {},
        children: [],
        _byClass: new Map(),
        attrs: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute(name, value) { node.attrs[name] = String(value); },
        removeAttribute(name) { delete node.attrs[name]; },
        getAttribute(name) { return name in node.attrs ? node.attrs[name] : null; },
        appendChild(child) {
            node.children.push(child);
            child.parentElement = node;
            return child;
        },
        remove() {
            const parent = node.parentElement;
            if (!parent) return;
            parent.children = parent.children.filter((child) => child !== node);
        },
        addEventListener() {},
        querySelector(selector) {
            if (node._byClass.has(selector)) return node._byClass.get(selector);
            const cls = selector.startsWith('.') ? selector.slice(1) : '';
            for (const child of node.children) {
                const classes = String(child.className || '').split(/\s+/).filter(Boolean);
                if (cls && classes.includes(cls)) return child;
                if (!cls && child.tagName === selector.toUpperCase()) return child;
                const nested = child.querySelector?.(selector);
                if (nested) return nested;
            }
            return null;
        },
        setQuery(selector, value) {
            node._byClass.set(selector, value);
        }
    };
    return node;
}

let surfaces;

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i] ?? null
    };
    globalThis.document = {
        getElementById: (id) => surfaces.get(id) || null,
        querySelectorAll: () => [],
        createElement: (tag) => makeNode(tag),
        body: makeNode('body'),
        head: makeNode('head'),
        visibilityState: 'visible',
        addEventListener() {}
    };
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener() {},
        removeEventListener() {},
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: (id) => clearTimeout(id)
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    surfaces = new Map([['tv-playback-surface-center', makeNode('div')]]);
});

function fakeTvPlayer(id, channel = null) {
    return {
        id,
        channel,
        muted: id !== 'center',
        volume: 1,
        lastVolume: 1,
        playing: false,
        wantPlaying: false,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'idle',
        stopped: false,
        error: null,
        applyAudioToVideo() {},
        mountVideo() {},
        emitState() {},
        async stop() { this.stopped = true; }
    };
}

function makeCtx(initialChannel = null) {
    const ctx = {
        ...webStreamMethods,
        ...persistMethods,
        sharedVolume: 1,
        lastVolume: 0.9,
        slots: {
            center: { id: 'center', enabled: true, player: fakeTvPlayer('center', initialChannel) },
            topLeft: { id: 'topLeft', enabled: false, player: null }
        },
        rememberedSlotKeys: {},
        webStreamState: {},
        webStreamReturn: {},
        _wsIntent: {},
        playCalls: [],
        mounted: 0,
        persisted: 0,
        mountAll() { ctx.mounted += 1; },
        persistSlots() { ctx.persisted += 1; },
        scheduleRefreshTiles() {},
        syncMosaicChrome() {},
        syncStatusChrome() {},
        setSideEnabled(id, enabled) { ctx.slots[id].enabled = Boolean(enabled); },
        ensurePlayer(id) {
            if (!ctx.slots[id].player) ctx.slots[id].player = fakeTvPlayer(id);
            return ctx.slots[id].player;
        },
        async playOnSlot(id, channel, opts) {
            ctx.playCalls.push({ id, channel, opts });
            const player = ctx.ensurePlayer(id);
            player.channel = channel;
            return true;
        },
        getPrimary() { return ctx.slots.center.player; }
    };
    return ctx;
}

const TV_CHANNEL = { providerId: 'iptv-org', channelId: 'CNN.us', name: 'CNN', url_resolved: 'https://tv/cnn.m3u8' };

test('media mode installs a synthetic webstream channel without history', async () => {
    const ctx = makeCtx(TV_CHANNEL);
    const ok = await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/42',
        streamUrl: 'https://cdn.tv/master.m3u8',
        kind: 'hls',
        title: 'Site'
    });

    assert.equal(ok, true);
    assert.equal(ctx.playCalls.length, 1);
    const { channel, opts } = ctx.playCalls[0];
    assert.equal(channel.providerId, 'webstream');
    assert.equal(channel.url_resolved, 'https://cdn.tv/master.m3u8');
    assert.equal(channel.streamKind, 'hls');
    assert.equal(channel.name, 'Site');
    assert.equal(opts.skipHistory, true, 'webstream keys never enter history');
    assert.match(ctx.rememberedSlotKeys.center, /^webstream:ws_/);
    assert.equal(ctx.webStreamState.center.mode, 'media');
    assert.equal(ctx.webStreamReturn.center.channel, TV_CHANNEL, 'previous channel remembered');
    assert.equal(ctx.isWebStreamSlot('center'), true);
    assert.equal(ctx.hasWebStreamSlot(), true);
    assert.ok(ctx.persisted > 0);
});

test('paused restore keeps a stopped slate until the user presses play', async () => {
    const ctx = makeCtx();
    await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/7',
        streamUrl: 'https://cdn.tv/a.m3u8',
        kind: 'hls'
    }, { autoplay: false });

    assert.equal(ctx.playCalls.length, 0, 'nothing attaches on restore');
    const player = ctx.slots.center.player;
    assert.equal(player.channel.providerId, 'webstream');
    assert.equal(player.stopped, true);
    assert.equal(player.wantPlaying, false);
});

test('slot entry round-trips page, stream, kind and volume', async () => {
    const ctx = makeCtx();
    ctx.slots.center.player.volume = 0.35;
    ctx.slots.center.player.muted = false;
    await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/42',
        streamUrl: 'https://cdn.tv/master.m3u8',
        kind: 'hls',
        title: 'Site'
    });

    const entry = ctx.webStreamSlotEntry('center');
    assert.equal(entry.kind, 'webstream');
    assert.equal(entry.pageUrl, 'https://site.tv/watch/42');
    assert.equal(entry.streamUrl, 'https://cdn.tv/master.m3u8');
    assert.equal(entry.streamKind, 'hls');
    assert.equal(entry.mode, 'media');
    assert.equal(entry.name, 'Site');
    assert.equal(entry.shield, '', 'media mode never carries a page shield');
    assert.equal(entry.muted, false);
    assert.equal(entry.volume, 0.35);
    assert.equal(entry.url, '');
    assert.equal(ctx.webStreamSlotEntry('topLeft'), null);
});


test('detach restores the previous TV channel and drops Web Video state', async () => {
    const ctx = makeCtx(TV_CHANNEL);
    await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/42',
        streamUrl: 'https://cdn.tv/master.m3u8',
        kind: 'hls'
    });
    ctx.playCalls.length = 0;

    const had = await ctx.detachWebStreamMode('center', { silent: true });
    assert.equal(had, true);
    assert.equal(ctx.webStreamState.center, undefined);
    assert.equal(ctx.playCalls.length, 1, 'previous channel is tuned again');
    assert.equal(ctx.playCalls[0].channel, TV_CHANNEL);
    assert.equal(ctx.playCalls[0].opts.skipHistory, true);
    assert.equal(ctx.isWebStreamSlot('center'), false);
});

test('embed mode parks the player, keeps the page and mounts an iframe', async () => {
    const ctx = makeCtx();
    const surface = surfaces.get('tv-playback-surface-center');
    const ok = await ctx.playEmbeddedWebPage('center', {
        pageUrl: 'https://site.tv/watch/42',
        title: 'Site'
    });

    assert.equal(ok, true);
    assert.equal(ctx.playCalls.length, 0, 'embed never attaches a stream');
    const player = ctx.slots.center.player;
    assert.equal(player.channel.providerId, 'webstream');
    assert.equal(player.channel.url_resolved, '');
    assert.equal(player.stopped, true);

    const frame = surface.querySelector('.webstream-frame-wrap')?.querySelector('iframe');
    assert.ok(frame, 'iframe mounted inside the tile surface');
    assert.equal(frame.getAttribute('src'), 'https://site.tv/watch/42');

    const entry = ctx.webStreamSlotEntry('center');
    assert.equal(entry.mode, 'embed');
    assert.equal(entry.pageUrl, 'https://site.tv/watch/42');
    assert.equal(entry.streamUrl, '');
    assert.equal(entry.frameUrl, 'https://site.tv/watch/42');

    assert.equal(ctx.stopEmbeddedWebPage('center'), true);
    assert.equal(surface.querySelector('.webstream-frame-wrap'), null, 'stop removes the frame');
    assert.equal(ctx.webStreamState.center.pageUrl, 'https://site.tv/watch/42', 'page stays saved');

    assert.equal(ctx.resumeEmbeddedWebPage('center'), true);
    assert.ok(surface.querySelector('.webstream-frame-wrap'), 'play puts the frame back');
});

test('forget clears bookkeeping; missing surface never throws', async () => {
    const ctx = makeCtx(TV_CHANNEL);
    await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/42',
        streamUrl: 'https://cdn.tv/master.m3u8',
        kind: 'hls'
    });
    ctx.forgetWebStreamSlot('center');
    assert.deepEqual(ctx.webStreamState, {});
    assert.deepEqual(ctx.webStreamReturn, {});

    const orphan = makeCtx();
    const ok = await orphan.playWebStream('topLeft', {
        pageUrl: 'https://site.tv/x',
        streamUrl: 'https://cdn.tv/x.mp4',
        kind: 'video'
    });
    assert.equal(ok, true);
    assert.equal(orphan.slots.topLeft.enabled, true, 'side TV is enabled for Web Video');
});


test('swap moves Web Video state with the tile', () => {
    const ctx = makeCtx();
    ctx.webStreamState = {
        center: { pageUrl: 'https://a.tv/1', mode: 'embed', frameUrl: 'https://a.tv/1' },
        topLeft: { pageUrl: 'https://b.tv/2', mode: 'media', streamUrl: 'https://cdn/b.m3u8' }
    };
    ctx.webStreamReturn = { center: { channel: TV_CHANNEL, key: 'iptv-org:CNN.us', remembered: '' } };

    assert.equal(ctx.swapWebStreamSlots('topLeft'), true);
    assert.equal(ctx.webStreamState.center.pageUrl, 'https://b.tv/2');
    assert.equal(ctx.webStreamState.topLeft.pageUrl, 'https://a.tv/1');
    assert.equal(ctx.webStreamReturn.topLeft.channel, TV_CHANNEL);
    assert.equal(ctx.webStreamReturn.center, undefined);

    const empty = makeCtx();
    assert.equal(empty.swapWebStreamSlots('topLeft'), false, 'no Web Video involved → untouched');
});


test('re-resolve re-scans the saved page and plays the fresh stream', async () => {
    const ctx = makeCtx();
    ctx.webStreamState = {
        center: { pageUrl: 'https://site.tv/watch/1', mode: 'media', title: 'Site' }
    };
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => '<video src="https://cdn.tv/fresh/master.m3u8"></video>'
    });
    try {
        const ok = await ctx.reResolveWebStreamSlot('center', { silent: true });
        assert.equal(ok, true);
        assert.equal(ctx.playCalls.length, 1);
        assert.equal(ctx.playCalls[0].channel.url_resolved, 'https://cdn.tv/fresh/master.m3u8');
        assert.equal(ctx.webStreamState.center.pageUrl, 'https://site.tv/watch/1');
    } finally {
        globalThis.fetch = original;
    }
});

test('re-resolve without a saved page reports instead of guessing', async () => {
    const ctx = makeCtx();
    assert.equal(await ctx.reResolveWebStreamSlot('center', { silent: true }), false);
    assert.equal(ctx.playCalls.length, 0);
});


test('detach with nothing to restore clears the synthetic channel', async () => {
    const ctx = makeCtx();
    await ctx.playWebStream('center', {
        pageUrl: 'https://site.tv/watch/42',
        streamUrl: 'https://cdn.tv/master.m3u8',
        kind: 'hls'
    });
    assert.equal(ctx.isWebStreamSlot('center'), true);

    await ctx.detachWebStreamMode('center', { silent: true });
    assert.equal(ctx.slots.center.player.channel, null, 'tile returns to “Pick a channel”');
    assert.equal(ctx.isWebStreamSlot('center'), false);
    assert.equal(ctx.playCalls.length, 1, 'nothing else was tuned');
});

function frameFor() {
    const surface = surfaces.get('tv-playback-surface-center');
    return surface.querySelector('.webstream-frame-wrap')?.querySelector('iframe') || null;
}

test('embed uses the global shield level unless the page names one', async () => {
    SettingsStore.setWebStreamShield('strict');
    try {
        const ctx = makeCtx();
        await ctx.playEmbeddedWebPage('center', { pageUrl: 'https://site.tv/watch/9' });
        const frame = frameFor();
        assert.equal(ctx.webStreamState.center.shield, 'strict', 'global setting is the default');
        assert.equal(frame.getAttribute('sandbox'), buildShieldAttributes('strict').sandbox);
        assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');

        await ctx.playEmbeddedWebPage('center', {
            pageUrl: 'https://site.tv/watch/9',
            shield: 'off'
        });
        assert.equal(ctx.webStreamState.center.shield, 'off', 'a per-page level wins');
        assert.equal(frame.getAttribute('sandbox'), null);
        assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    } finally {
        SettingsStore.setWebStreamShield('basic');
    }
});

test('setWebStreamShield cycles the frame and remembers the saved page', async () => {
    const page = 'https://site.tv/watch/55';
    addWebStreamItem({ pageUrl: page, mode: 'embed', title: 'Site' });
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', { pageUrl: page });

    assert.equal(ctx.webStreamShieldFor('center'), 'basic');
    assert.equal(ctx.setWebStreamShield('center'), 'strict');
    assert.equal(ctx.webStreamState.center.shield, 'strict');
    const frame = frameFor();
    assert.equal(frame.getAttribute('sandbox'), buildShieldAttributes('strict').sandbox);
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    const saved = loadWebStreamLibrary().items.find((item) => item.pageUrl === page);
    assert.equal(saved.shield, 'strict', 'a per-page fix survives replay');
    assert.ok(ctx.persisted > 0, 'the slot is persisted');

    assert.equal(ctx.setWebStreamShield('center'), 'off');
    assert.equal(frame.getAttribute('sandbox'), null);
    assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');

    assert.equal(ctx.setWebStreamShield('center'), 'basic');
    assert.equal(ctx.webStreamShieldFor('center'), 'basic');
    assert.equal(frame.getAttribute('sandbox'), buildShieldAttributes('basic').sandbox);

    assert.equal(ctx.setWebStreamShield('center', 'basic'), 'basic', 'same level is a no-op');
    assert.equal(ctx.webStreamShieldFor('topLeft'), '');
    assert.equal(ctx.setWebStreamShield('topLeft'), '', 'media/empty tiles have no shield');
});

test('changing the shield on a stopped tile only stores it (no surprise reload)', async () => {
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', {
        pageUrl: 'https://site.tv/watch/88',
        shield: 'basic'
    });
    assert.equal(ctx.stopEmbeddedWebPage('center'), true);
    assert.equal(frameFor(), null, 'frame is gone after Stop');

    assert.equal(ctx.setWebStreamShield('center'), 'strict');
    assert.equal(ctx.webStreamState.center.shield, 'strict');
    assert.equal(frameFor(), null, 'a stopped tile stays stopped');

    assert.equal(ctx.resumeEmbeddedWebPage('center'), true);
    const frame = frameFor();
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer', '▶ mounts with the new level');
});

test('slot entry keeps the shield and restore replays it', async () => {
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', {
        pageUrl: 'https://site.tv/watch/77',
        title: 'Site',
        shield: 'strict'
    });
    const entry = ctx.webStreamSlotEntry('center');
    assert.equal(entry.mode, 'embed');
    assert.equal(entry.shield, 'strict');

    const restored = makeCtx();
    const count = await restored.restoreWebStreamSlots({ center: entry });
    assert.equal(count, 1);
    assert.equal(restored.webStreamState.center.shield, 'strict');
    assert.equal(frameFor().getAttribute('referrerpolicy'), 'no-referrer');
});

test('shield popout options pick an exact level; the glyph cycles', async () => {
    const calls = [];
    const ctx = {
        slots: {},
        webStreamMode: () => 'embed',
        // '' skips the toast (DOM-bound) — the level it receives is what matters.
        setWebStreamShield: (slotId, level = '') => {
            calls.push([slotId, level]);
            return '';
        }
    };

    await tileChromeMethods.handleTileAction.call(ctx, 'center', 'shield-off');
    await tileChromeMethods.handleTileAction.call(ctx, 'center', 'shield-basic');
    await tileChromeMethods.handleTileAction.call(ctx, 'center', 'shield-strict');
    await tileChromeMethods.handleTileAction.call(ctx, 'center', 'shield');

    assert.deepEqual(calls, [
        ['center', 'off'],
        ['center', 'basic'],
        ['center', 'strict'],
        ['center', '']  // the glyph leaves the level out → mixin cycles
    ]);
});

test('shield popout marks the live level and nothing else', () => {
    const makeBtn = (action) => {
        const classes = new Set();
        return {
            attrs: {},
            classList: {
                toggle(name, on) {
                    if (on) classes.add(name);
                    else classes.delete(name);
                }
            },
            has: (name) => classes.has(name),
            setAttribute(name, value) { this.attrs[name] = String(value); },
            getAttribute(name) {
                return name === 'data-tile-action' ? action : (this.attrs[name] ?? null);
            }
        };
    };

    const ctx = { webStreamMode: () => 'embed', webStreamShieldFor: () => 'strict' };
    const opts = {};
    for (const level of ['off', 'basic', 'strict']) {
        opts[level] = makeBtn(`shield-${level}`);
        tileChromeMethods.syncTileControlButton.call(ctx, opts[level], null, 'center', {
            intentPlaying: false,
            isMuted: false,
            target: 'local'
        });
    }

    assert.equal(opts.off.has('is-active'), false);
    assert.equal(opts.off.attrs['aria-pressed'], 'false');
    assert.equal(opts.basic.has('is-active'), false);
    assert.equal(opts.basic.attrs['aria-pressed'], 'false');
    assert.equal(opts.strict.has('is-active'), true);
    assert.equal(opts.strict.attrs['aria-pressed'], 'true');
});


/* ---------------------------------------------------------------- *
 * Mute on an embedded page: the tray flag always flips; the page's
 * own audio only follows when the page is same-origin.
 * ---------------------------------------------------------------- */

const FRAME_KEY = '.webstream-frame-wrap iframe';

/** Point `frameFor(surface)` at a stub so mute can run without a browser. */
function stubEmbedFrame(surface, doc = null) {
    const frame = makeNode('iframe');
    frame.contentDocument = doc;
    surface.setQuery(FRAME_KEY, frame);
    return frame;
}

test('embed mute reaches a same-origin page and reports a cross-origin one', async () => {
    const surface = surfaces.get('tv-playback-surface-center');
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', { pageUrl: 'https://site.tv/watch/7' });
    const frame = stubEmbedFrame(surface);
    try {
        ctx.slots.center.player.muted = true;
        assert.equal(ctx.syncEmbeddedPageMute('center'), false, 'cross-origin page is unreachable');
        assert.equal(frame.dataset.magictvMute, 'on', 'the wanted state is remembered');

        const clips = [{ muted: false }, { muted: false }];
        frame.contentDocument = { querySelectorAll: () => clips };
        assert.equal(ctx.syncEmbeddedPageMute('center'), true);
        assert.deepEqual(clips.map((clip) => clip.muted), [true, true]);

        ctx.slots.center.player.muted = false;
        assert.equal(ctx.syncEmbeddedPageMute('center'), true);
        assert.deepEqual(clips.map((clip) => clip.muted), [false, false]);
        assert.equal(frame.dataset.magictvMute, 'off');
    } finally {
        surface._byClass.delete(FRAME_KEY);
    }
});

test('embed mute re-applies after the page loads its own player', async () => {
    const surface = surfaces.get('tv-playback-surface-center');
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', { pageUrl: 'https://site.tv/watch/8' });
    const listeners = [];
    const frame = stubEmbedFrame(surface);
    frame.addEventListener = (type, fn) => { if (type === 'load') listeners.push(fn); };
    try {
        ctx.slots.center.player.muted = true;
        assert.equal(ctx.syncEmbeddedPageMute('center'), false, 'nothing to mute yet');
        const clips = [{ muted: false }];
        frame.contentDocument = { querySelectorAll: () => clips };
        listeners.forEach((fn) => fn());
        assert.equal(clips[0].muted, true, 'the load hook mutes media that arrives late');
    } finally {
        surface._byClass.delete(FRAME_KEY);
    }
});

test('a muted page tile comes back muted when the frame is mounted again', async () => {
    const surface = surfaces.get('tv-playback-surface-center');
    const ctx = makeCtx();
    await ctx.playEmbeddedWebPage('center', { pageUrl: 'https://site.tv/watch/11' });
    const clips = [{ muted: false }];
    const frame = stubEmbedFrame(surface, { querySelectorAll: () => clips });
    try {
        ctx.slots.center.player.muted = true;
        assert.equal(ctx.mountWebStreamFrame('center'), true);
        assert.equal(clips[0].muted, true, '▶ / reload re-applies the tile mute');
        assert.equal(frame.dataset.magictvMute, 'on');
    } finally {
        surface._byClass.delete(FRAME_KEY);
    }
});

test('embed mute ignores media-mode tiles and missing frames', () => {
    const ctx = makeCtx();
    ctx.webStreamState = {
        center: { pageUrl: 'https://a.tv/1', mode: 'media', frameUrl: 'https://a.tv/1' }
    };
    assert.equal(ctx.syncEmbeddedPageMute('center'), false, 'media mode has no page audio');

    ctx.webStreamState.center.mode = 'embed';
    assert.equal(ctx.syncEmbeddedPageMute('center'), false, 'no iframe → nothing to sync');
    assert.equal(ctx.syncEmbeddedPageMute('topLeft'), false, 'an empty slot is harmless');
});

test('Mute all / Mute other TVs sweep every embedded page', () => {
    const ctx = makeCtx();
    ctx.webStreamState = {
        center: { pageUrl: 'https://a.tv/1', mode: 'embed', frameUrl: 'https://a.tv/1' },
        topLeft: { pageUrl: 'https://b.tv/2', mode: 'embed', frameUrl: 'https://b.tv/2' }
    };
    const calls = [];
    ctx.syncEmbeddedPageMute = (slotId) => { calls.push(slotId); return true; };

    ctx.syncEmbeddedPageMutes();
    assert.deepEqual(calls, ['center', 'topLeft'], 'both page tiles are re-applied');

    ctx.webStreamState.topLeft.mode = 'media';
    calls.length = 0;
    ctx.syncEmbeddedPageMutes();
    assert.deepEqual(calls, ['center'], 'media-mode tiles have no page audio');
});

