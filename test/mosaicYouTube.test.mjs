/**
 * Mosaic YouTube-mode lifecycle: enter / one-live-tile / detach / restore /
 * persisted entry shape. Uses a stub MultiView context (no DOM mount).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeMethods } from '../js/mosaic/youtube.js';
import { persistMethods } from '../js/mosaic/persist.js';
import { swapMethods } from '../js/mosaic/swap.js';
import { channelKey } from '../js/tvProviders/channelShape.js';

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'M7lc1UVf-VE';
const store = new Map();

function stubDocument() {
    return {
        getElementById: () => null,
        querySelectorAll: () => [],
        createElement: () => ({
            className: '',
            classList: { add() {}, remove() {}, toggle() {} },
            dataset: {},
            style: {},
            setAttribute() {},
            appendChild() {},
            remove() {},
            addEventListener() {}
        }),
        body: { appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } },
        head: { appendChild() {} },
        visibilityState: 'visible',
        addEventListener() {}
    };
}

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i] ?? null
    };
    globalThis.document = stubDocument();
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener() {},
        removeEventListener() {},
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: (id) => clearTimeout(id)
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
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
        destroyed: false,
        applyAudioToVideo() {},
        mountVideo() {},
        emitState() {},
        async stop() { this.stopped = true; },
        async dispose() { this.destroyed = true; }
    };
}

function makeCtx() {
    const ctx = {
        ...youtubeMethods,
        sharedVolume: 1,
        lastVolume: 0.9,
        slots: {
            center: { id: 'center', enabled: true, player: null },
            topLeft: { id: 'topLeft', enabled: false, player: null }
        },
        rememberedSlotKeys: {},
        youtubeReturn: {},
        _ytPendingReturn: {},
        _ytLiveSlotId: null,
        // Test seam: related lookups never leave the process in unit tests.
        _ytRelatedFetcher: async () => ({ items: [] }),
        mounted: 0,
        persisted: 0,
        restoreCalls: [],
        mountAll() { ctx.mounted += 1; },
        relocateOwnedSlotVideos() {},
        persistSlots() { ctx.persisted += 1; },
        scheduleRefreshTiles() {},
        syncMosaicChrome() {},
        syncStatusChrome() {},
        setSideEnabled(id, enabled) {
            if (!ctx.slots[id]) return;
            if (!enabled) {
                // Mirror MultiView: disabling a tile releases YouTube mode.
                ctx.detachYouTubeModeSync(id);
                ctx.forgetYouTubeSlot(id);
            }
            ctx.slots[id].enabled = Boolean(enabled);
        },
        ensurePlayer(id) {
            const player = fakeTvPlayer(id);
            ctx.slots[id].player = player;
            return player;
        },
        playOnSlot(id, channel) {
            ctx.restoreCalls.push({ id, channel });
            ctx.slots[id].player = fakeTvPlayer(id, channel);
            return Promise.resolve(true);
        },
        getPrimary() {
            return ctx.slots.center.player;
        }
    };
    return ctx;
}

test('enterYouTubeMode replaces the TV player and remembers the channel', async () => {
    const ctx = makeCtx();
    const tv = fakeTvPlayer('center', { providerId: 'iptv-org', channelId: 'CNN.us', name: 'CNN' });
    ctx.slots.center.player = tv;

    const ok = await ctx.enterYouTubeMode('center', ID_A, { title: 'Clip A' });
    assert.equal(ok, true);
    assert.equal(tv.destroyed, true, 'old TV player was torn down');
    assert.equal(ctx.slots.center.player.kind, 'youtube');
    assert.equal(ctx.slots.center.player.videoId, ID_A);
    assert.equal(channelKey(ctx.slots.center.player.channel), `youtube:${ID_A}`);
    assert.equal(ctx.slots.center.player.channel.name, 'Clip A');
    assert.equal(ctx._ytLiveSlotId, 'center');
    assert.equal(ctx.youtubeReturn.center.channel.channelId, 'CNN.us');
    assert.ok(ctx.persisted > 0 && ctx.mounted > 0);
    assert.equal(ctx.slots.center.player.wantPlaying, true, 'autoplay by default');
});

test('only one tile runs YouTube — the previous tile is detached', async () => {
    const ctx = makeCtx();
    ctx.slots.topLeft.enabled = true;
    ctx.slots.topLeft.player = fakeTvPlayer('topLeft', { providerId: 'iptv-org', channelId: 'BBC.uk' });

    await ctx.enterYouTubeMode('topLeft', ID_A);
    assert.equal(ctx._ytLiveSlotId, 'topLeft');

    const ok = await ctx.enterYouTubeMode('center', ID_B);
    assert.equal(ok, true);
    assert.equal(ctx.slots.topLeft.player, null, 'previous YouTube tile released');
    assert.equal(ctx._ytLiveSlotId, 'center');
    assert.equal(ctx._ytPendingReturn.topLeft.channel.channelId, 'BBC.uk');
});

test('detachYouTubeModeSync releases the embed without restoring TV', async () => {
    const ctx = makeCtx();
    await ctx.enterYouTubeMode('center', ID_A);
    const adapter = ctx.slots.center.player;

    assert.equal(ctx.detachYouTubeModeSync('center'), true);
    assert.equal(adapter.videoHolder, null);
    assert.equal(ctx.slots.center.player, null);
    assert.equal(ctx._ytLiveSlotId, null);
    assert.equal(ctx.restoreCalls.length, 0, 'hook path never restores here');
    assert.equal(ctx.detachYouTubeModeSync('center'), false, 'idempotent');
});

test('turning YouTube off restores the previous TV channel', async () => {
    const ctx = makeCtx();
    const cnn = { providerId: 'iptv-org', channelId: 'CNN.us', name: 'CNN' };
    ctx.slots.center.player = fakeTvPlayer('center', cnn);

    await ctx.enterYouTubeMode('center', ID_A);
    const detached = await ctx.detachYouTubeMode('center', { silent: true });

    assert.equal(detached, true);
    assert.equal(ctx.restoreCalls.length, 1);
    assert.equal(ctx.restoreCalls[0].id, 'center');
    assert.equal(ctx.restoreCalls[0].channel.channelId, 'CNN.us');
    assert.deepEqual(ctx.youtubeReturn, {});
});

test('a remembered stub channel comes back as a stopped TV tile', async () => {
    const ctx = makeCtx();
    ctx.slots.center.player = fakeTvPlayer('center');
    ctx.rememberedSlotKeys.center = 'iptv-org:STUB.us';

    await ctx.enterYouTubeMode('center', ID_A);
    assert.equal(ctx.rememberedSlotKeys.center, undefined, 'YT tile is not a remembered channel');

    await ctx.detachYouTubeMode('center', { silent: true });
    const restored = ctx.slots.center.player;
    assert.equal(restored.kind, undefined);
    assert.equal(restored.channel.channelId, 'STUB.us');
    assert.equal(restored.stopped, true);
    assert.equal(ctx.rememberedSlotKeys.center, 'iptv-org:STUB.us');
});

test('restoreYouTubeSlots mounts the first saved tile as a paused placeholder', async () => {
    const ctx = makeCtx();
    const restored = await ctx.restoreYouTubeSlots({
        center: { kind: 'youtube', key: `youtube:${ID_A}`, videoId: ID_A, name: 'Saved' },
        topLeft: { kind: 'youtube', key: `youtube:${ID_B}`, videoId: ID_B }
    });

    assert.equal(restored, true);
    assert.equal(ctx.slots.center.player.kind, 'youtube');
    assert.equal(ctx.slots.center.player.videoId, ID_A);
    assert.equal(ctx.slots.center.player.wantPlaying, false, 'restore never autoplays');
    assert.equal(ctx.slots.topLeft.player, null, 'only one live YouTube tile');
});

test('restoreYouTubeSlots ignores non-YouTube and malformed entries', async () => {
    const ctx = makeCtx();
    const restored = await ctx.restoreYouTubeSlots({
        center: { key: 'iptv-org:CNN.us' },
        topLeft: { kind: 'youtube', videoId: 'bad' }
    });
    assert.equal(restored, false);
    assert.equal(ctx.slots.center.player, null);
    assert.equal(ctx.slots.topLeft.player, null);
});

test('youTubeSlotEntry persists kind + videoId + volume', async () => {
    const ctx = makeCtx();
    ctx.slots.center.player = fakeTvPlayer('center', { providerId: 'iptv-org', channelId: 'CNN.us' });
    await ctx.enterYouTubeMode('center', ID_A, { title: 'Clip', autoplay: false });
    ctx.slots.center.player.muted = false;
    ctx.slots.center.player.volume = 0.4;

    const entry = ctx.youTubeSlotEntry('center');
    assert.equal(entry.kind, 'youtube');
    assert.equal(entry.key, `youtube:${ID_A}`);
    assert.equal(entry.videoId, ID_A);
    assert.equal(entry.name, 'Clip');
    assert.equal(entry.muted, false);
    assert.equal(entry.volume, 0.4);
    assert.match(entry.url, /i\.ytimg\.com/);

    ctx.slots.topLeft.player = fakeTvPlayer('topLeft');
    assert.equal(ctx.youTubeSlotEntry('topLeft'), null);
});

test('invalid ids are refused and YouTube guards report involvement', async () => {
    const ctx = makeCtx();
    assert.equal(await ctx.enterYouTubeMode('center', 'nope', { silent: true }), false);
    assert.equal(ctx.slots.center.player, null);

    ctx.slots.topLeft.enabled = true;
    await ctx.enterYouTubeMode('topLeft', ID_A);
    assert.equal(ctx.isYouTubeSlot('topLeft'), true);
    assert.equal(ctx.hasYouTubeSlot(), true);
    assert.equal(ctx.involvesYouTubeSlot('center', 'topLeft'), true);
    assert.equal(ctx.involvesYouTubeSlot('center'), false);
    assert.deepEqual(ctx.youtubeSlotIds(), ['topLeft']);

    ctx.setSideEnabled('topLeft', false);
    ctx.forgetYouTubeSlot('topLeft');
    assert.equal(ctx.hasYouTubeSlot(), false);
});


test('a TV tune on the tile drops YouTube return state (prepareSlotForPlay order)', async () => {
    const ctx = makeCtx();
    ctx.slots.center.player = fakeTvPlayer('center', { providerId: 'iptv-org', channelId: 'CNN.us' });
    await ctx.enterYouTubeMode('center', ID_A);

    // prepareSlotForPlay(): detach then forget, then the new channel takes over.
    if (ctx.detachYouTubeModeSync('center')) ctx.forgetYouTubeSlot('center');

    assert.equal(ctx.slots.center.player, null);
    assert.deepEqual(ctx.youtubeReturn, {});
    assert.deepEqual(ctx._ytPendingReturn, {});

    // Re-entering later never resurrects the old TV channel.
    await ctx.enterYouTubeMode('center', ID_B);
    assert.equal(ctx.youtubeReturn.center, undefined);
    await ctx.detachYouTubeMode('center', { silent: true });
    assert.equal(ctx.restoreCalls.length, 0, 'no stale channel to restore');
});


test('persistSlots writes a YouTube entry instead of a channel key', async () => {
    store.clear();
    const ctx = makeCtx();
    Object.assign(ctx, persistMethods);
    ctx.slotsHydrated = true;
    ctx.slots.center.player = fakeTvPlayer('center', {
        providerId: 'iptv-org',
        channelId: 'CNN.us',
        name: 'CNN'
    });

    await ctx.enterYouTubeMode('center', ID_A, { title: 'Clip', autoplay: false });
    ctx.persistSlots();

    const raw = JSON.parse(store.get('magictv_persisted_state') || '{}');
    assert.equal(raw.mosaicSlots.center.kind, 'youtube');
    assert.equal(raw.mosaicSlots.center.videoId, ID_A);
    assert.equal(raw.mosaicSlots.center.key, `youtube:${ID_A}`);
    assert.equal(raw.mosaicSlots.center.name, 'Clip');
    assert.equal(raw.lastChannelKey, undefined, 'YouTube primary never becomes lastChannelKey');
});

test('detaching YouTube mode restores the TV entry through persistSlots', async () => {
    store.clear();
    const ctx = makeCtx();
    Object.assign(ctx, persistMethods);
    ctx.slotsHydrated = true;
    ctx.slots.center.player = fakeTvPlayer('center', {
        providerId: 'iptv-org',
        channelId: 'CNN.us',
        name: 'CNN'
    });

    await ctx.enterYouTubeMode('center', ID_A, { autoplay: false });
    await ctx.detachYouTubeMode('center', { silent: true });
    ctx.persistSlots();

    const raw = JSON.parse(store.get('magictv_persisted_state') || '{}');
    assert.equal(raw.mosaicSlots.center.kind, undefined);
    assert.equal(raw.mosaicSlots.center.key, 'iptv-org:CNN.us');
});

test('swapping a YouTube main with a corner re-creates the embed on the corner', async () => {
    store.clear();
    const ctx = makeCtx();
    const cnn = { providerId: 'iptv-org', channelId: 'CNN.us', name: 'CNN' };
    const fox = { providerId: 'iptv-org', channelId: 'FOX.us', name: 'FOX' };
    ctx.slots.center.player = fakeTvPlayer('center', cnn);
    ctx.slots.topLeft.enabled = true;
    const cornerTv = fakeTvPlayer('topLeft', fox);
    cornerTv.playing = true;
    ctx.slots.topLeft.player = cornerTv;

    await ctx.enterYouTubeMode('center', ID_A, { title: 'Clip A', autoplay: false });
    const embed = ctx.slots.center.player;
    embed.getSeekInfo = () => ({ current: 73.6 });
    embed.wantPlaying = true;

    const ok = ctx.commitSwapWithYouTube('topLeft', 'center');
    assert.equal(ok, true);

    // The embed is rebuilt on the vacated corner with the same transport.
    assert.equal(embed._destroyed, true, 'old embed torn down');
    const rebuilt = ctx.slots.topLeft.player;
    assert.equal(rebuilt.kind, 'youtube');
    assert.equal(rebuilt.videoId, ID_A);
    assert.equal(rebuilt.startAt, 73, 'playhead carried (whole seconds)');
    assert.equal(rebuilt.wantPlaying, true, 'play intent carried');
    assert.equal(ctx._ytLiveSlotId, 'topLeft');

    // The TV stream simply moved across — same player object, new slot id.
    assert.equal(ctx.slots.center.player, cornerTv);
    assert.equal(cornerTv.id, 'center');
    assert.equal(cornerTv.channel, fox);
    assert.equal(ctx.rememberedSlotKeys.center, channelKey(fox), 'TV key follows the player');
    assert.equal(ctx.rememberedSlotKeys.topLeft, undefined, 'YouTube tile owns no TV key');
    assert.ok(ctx.persisted > 0, 'swap persisted');

    // Swap back: the embed returns to main, the TV stream returns to the corner.
    const okBack = ctx.commitSwapWithYouTube('topLeft', 'topLeft');
    assert.equal(okBack, true);
    assert.equal(ctx.slots.center.player.kind, 'youtube');
    assert.equal(ctx.slots.center.player.videoId, ID_A);
    assert.equal(ctx.slots.topLeft.player, cornerTv);
    assert.equal(cornerTv.id, 'topLeft');
    assert.equal(ctx._ytLiveSlotId, 'center');
});

test('the displaced TV channel follows the embed across a swap', async () => {
    store.clear();
    const ctx = makeCtx();
    const cnn = { providerId: 'iptv-org', channelId: 'CNN.us', name: 'CNN' };
    const fox = { providerId: 'iptv-org', channelId: 'FOX.us', name: 'FOX' };
    ctx.slots.center.player = fakeTvPlayer('center', cnn);
    ctx.slots.topLeft.enabled = true;
    ctx.slots.topLeft.player = fakeTvPlayer('topLeft', fox);

    await ctx.enterYouTubeMode('center', ID_A, { autoplay: false });
    assert.equal(ctx.youtubeReturn.center.channel.channelId, 'CNN.us');

    ctx.commitSwapWithYouTube('topLeft', 'center');
    assert.equal(ctx.youtubeReturn.topLeft?.channel?.channelId, 'CNN.us');
    assert.equal(ctx.youtubeReturn.center, undefined);

    // Leaving YouTube on the corner restores the channel YouTube displaced.
    await ctx.detachYouTubeMode('topLeft', { silent: true });
    assert.deepEqual(ctx.restoreCalls.at(-1), { id: 'topLeft', channel: cnn });
});

test('swapWithCenter reaches commitSwap for a YouTube tile instead of refusing', async () => {
    store.clear();
    const ctx = makeCtx();
    Object.assign(ctx, swapMethods);
    ctx.hasCustomPlacement = () => false;
    ctx.slots.center.player = fakeTvPlayer('center', {
        providerId: 'iptv-org',
        channelId: 'CNN.us',
        name: 'CNN'
    });
    ctx.slots.topLeft.enabled = true;
    ctx.slots.topLeft.player = fakeTvPlayer('topLeft', {
        providerId: 'iptv-org',
        channelId: 'FOX.us',
        name: 'FOX'
    });
    await ctx.enterYouTubeMode('topLeft', ID_A, { autoplay: false });

    const commits = [];
    ctx.commitSwap = (sideId) => commits.push(sideId);
    // Whichever transition the (random) setting resolves to, all paths end in commitSwap.
    ctx.animateSwap = async (sideId) => { ctx.commitSwap(sideId); };
    ctx.animateSwapWipe = async (sideId) => { ctx.commitSwap(sideId); };
    ctx.animateSwapPowerStyle = async (sideId) => { ctx.commitSwap(sideId); };

    const ok = await ctx.swapWithCenter('topLeft');
    assert.equal(ok, true);
    assert.deepEqual(commits, ['topLeft'], 'swap was not blocked by YouTube mode');
});

test('prev / next steps the local queue and appends related at the tail', async () => {
    store.clear();
    const { addYouTubeClip } = await import('../js/youtube/youtubeLibrary.js');
    addYouTubeClip({ videoId: ID_B, title: 'Library B', author: 'Channel B' });

    const ctx = makeCtx();
    const relatedId = 'kJQP7kiw5Fk';
    ctx._ytRelatedFetcher = async () => ({
        items: [{ videoId: relatedId, title: 'Related D', author: 'Channel D' }]
    });

    await ctx.enterYouTubeMode('center', ID_B, { title: 'Clip B' });
    // Prefetch is fire-and-forget; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = ctx.youtubeQueueState('center');
    assert.deepEqual(state.items.map((item) => item.videoId), [ID_B, relatedId]);
    assert.equal(state.index, 0);
    assert.equal(state.hasPrev, false);
    assert.equal(state.hasNext, true);

    // Append while the cursor sits at the tail keeps both the order and index.
    assert.equal(ctx.toggleYouTubeQueueTray('center', true), true);
    assert.equal(ctx.youtubeQueueState('center').open, true);

    const player = ctx.slots.center.player;
    const mutedBefore = player.muted;
    const volumeBefore = player.volume;

    assert.equal(await ctx.stepYouTubeQueue('center', 1), true);
    assert.equal(player.videoId, relatedId);
    assert.equal(player.muted, mutedBefore, 'mute state carries across the swap');
    assert.equal(player.volume, volumeBefore, 'volume carries across the swap');

    const after = ctx.youtubeQueueState('center');
    assert.equal(after.index, 1);
    assert.equal(after.hasPrev, true);
    assert.equal(after.hasNext, false);
    assert.deepEqual(after.items.map((item) => item.videoId), [ID_B, relatedId], 'index never shifts');

    assert.equal(ctx.toggleYouTubeQueueTray('center', false), false);
    assert.equal(ctx.youtubeQueueState('center').open, false);

    assert.equal(await ctx.stepYouTubeQueue('center', -1), true);
    assert.equal(ctx.slots.center.player.videoId, ID_B);
    assert.equal(await ctx.stepYouTubeQueue('center', -1), false, 'head of the queue stops');
});

test('jumping to a tray entry starts that clip and collapses the tray', async () => {
    store.clear();
    const { addYouTubeClip } = await import('../js/youtube/youtubeLibrary.js');
    addYouTubeClip({ videoId: ID_B, title: 'Library B' });
    const ctx = makeCtx();
    ctx._ytRelatedFetcher = async () => ({
        items: [{ videoId: 'kJQP7kiw5Fk', title: 'Related D', author: 'Channel D' }]
    });
    await ctx.enterYouTubeMode('center', ID_B, { title: 'Clip B' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A related clip lands at index 1; the tray jump uses the same path.
    const state = ctx.youtubeQueueState('center');
    assert.equal(state.items.length, 2);
    assert.equal(state.items[1].videoId, 'kJQP7kiw5Fk');
    ctx.toggleYouTubeQueueTray('center', true);
    assert.equal(ctx.playYouTubeQueueIndex('center', 1), true);
    assert.equal(ctx.slots.center.player.videoId, 'kJQP7kiw5Fk');
    assert.equal(ctx.youtubeQueueState('center').open, false);
});

test('a finished clip auto-plays the next queue entry once', async () => {
    store.clear();
    const { addYouTubeClip } = await import('../js/youtube/youtubeLibrary.js');
    addYouTubeClip({ videoId: ID_A, title: 'Library A' });

    const ctx = makeCtx();
    await ctx.enterYouTubeMode('center', ID_B, { title: 'Clip B' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const player = ctx.slots.center.player;
    // The adapter fires onEnded → the mosaic hops to the next entry.
    player.ended = true;
    ctx._ytMaybeAutoAdvance('center', player);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = ctx.youtubeQueueState('center');
    assert.equal(state.index, 1);
    assert.equal(ctx.slots.center.player.videoId, state.items[1].videoId);
});

test('auto-advance respects the setting', async () => {
    store.clear();
    const { SettingsStore } = await import('../js/storage/settingsStore.js');
    const { addYouTubeClip } = await import('../js/youtube/youtubeLibrary.js');
    addYouTubeClip({ videoId: ID_B, title: 'Library B' });

    SettingsStore.setYouTubeQueueAutoAdvance(false);
    try {
        const ctx = makeCtx();
        await ctx.enterYouTubeMode('center', ID_B, { title: 'Clip B' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const player = ctx.slots.center.player;
        player.ended = true;
        ctx._ytMaybeAutoAdvance('center', player);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(player.videoId, ID_B, 'stayed on the finished clip');
        assert.equal(ctx.youtubeQueueState('center').index, 0);
    } finally {
        SettingsStore.setYouTubeQueueAutoAdvance(true);
    }
});


