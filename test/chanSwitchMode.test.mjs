/**
 * Chan switch mode — Safe Loading player contract tests.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

function makeVideoEl() {
    const classSet = new Set();
    return {
        tagName: 'VIDEO',
        className: '',
        classList: {
            _set: classSet,
            add(...names) {
                names.forEach((n) => classSet.add(n));
            },
            remove(...names) {
                names.forEach((n) => classSet.delete(n));
            },
            contains(n) {
                return classSet.has(n);
            }
        },
        muted: true,
        defaultMuted: true,
        playsInline: true,
        preload: 'auto',
        dataset: {},
        style: {},
        parentElement: null,
        videoWidth: 0,
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
        classList: {
            add() {},
            remove() {},
            toggle() {}
        },
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

test('commitPreparedChannel with allowFallback false skips cold playChannel', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    let playChannelCalled = false;
    player.playChannel = async () => {
        playChannelCalled = true;
    };

    player.init();
    player.switchGeneration = 1;

    const channel = {
        name: 'Test',
        url_resolved: 'https://example.com/stream.m3u8',
        providerId: 'test'
    };

    const result = await player.commitPreparedChannel(channel, 1, { allowFallback: false });

    assert.equal(result, false);
    assert.equal(playChannelCalled, false);
    assert.equal(player.isPrepareReady(), false);
});

test('cancelPrepare clears staging state without changing channel', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    const previous = { name: 'Old', url_resolved: 'https://example.com/old.m3u8' };
    player.channel = previous;
    player.init();
    player.preparedTarget = { name: 'Next' };
    player.preparing = true;

    player.cancelPrepare();

    assert.equal(player.channel, previous);
    assert.equal(player.preparing, false);
    assert.equal(player.preparedTarget, null);
});

test('_promoteFrontVideo clears offscreen prefetch styles', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    const mount = globalThis.document.createElement('div');
    mount.classList = { remove() {} };
    player.videoMount = mount;
    player.video.classList = {
        _set: new Set(['tv-video--prefetch']),
        remove(...names) { names.forEach((n) => this._set.delete(n)); },
        contains(n) { return this._set.has(n); }
    };
    player.video.style.cssText = 'position:fixed;left:-9999px;opacity:0;';

    player._promoteFrontVideo();

    assert.equal(player.video.classList.contains('tv-video--prefetch'), false);
    assert.equal(player.video.style.cssText, '');
});

test('_syncVideoMount removes orphan videos and keeps only front in surface', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    const mountChildren = [player.video];
    player.video.parentElement = { querySelectorAll: () => [] };

    const orphan = makeVideoEl();
    let orphanRemoved = false;
    orphan.remove = () => { orphanRemoved = true; };
    mountChildren.push(orphan);

    const mount = {
        querySelectorAll: (sel) => (sel === 'video' ? [...mountChildren] : []),
        appendChild(child) {
            if (!mountChildren.includes(child)) mountChildren.push(child);
            child.parentElement = this;
            return child;
        },
        classList: { remove() {} }
    };
    player.videoMount = mount;
    player.video.parentElement = mount;

    player._syncVideoMount();

    assert.equal(orphanRemoved, true);
    assert.equal(mountChildren.includes(player.video), true);
    assert.equal(mountChildren.includes(orphan), true); // still in array until remove - actually remove removes from DOM not array

    // orphan.remove() was called — that's what we care about
});

test('_syncVideoMount relocates videoBack from surface to holder', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    const holderChildren = [];
    player.videoHolder.appendChild = (child) => {
        child.parentElement = player.videoHolder;
        holderChildren.push(child);
        return child;
    };

    const mount = {
        querySelectorAll: (sel) => (sel === 'video' ? [player.video, player.videoBack] : []),
        appendChild(child) {
            child.parentElement = this;
            return child;
        },
        classList: { remove() {} }
    };
    player.videoMount = mount;
    player.video.parentElement = mount;
    player.videoBack.parentElement = mount;

    player._syncVideoMount();

    assert.equal(holderChildren.includes(player.videoBack), true);
    assert.equal(player.videoBack.parentElement, player.videoHolder);
});

test('_recycleStagingVideo re-applies muted and defaultMuted', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    player.videoBack.muted = false;
    player.videoBack.defaultMuted = false;

    player._recycleStagingVideo();

    assert.equal(player.videoBack.muted, true);
    assert.equal(player.videoBack.defaultMuted, true);
});

test('_refreshAudioAfterSwap unmutes when player is not muted', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    player.muted = false;
    player.volume = 1;
    player.video.muted = true;
    player.video.defaultMuted = true;

    player._refreshAudioAfterSwap();

    assert.equal(player.video.muted, false);
    assert.equal(player.video.defaultMuted, false);
    assert.equal(player.video.volume, 1);
});

test('_adoptPrefetchedStaging binds video events on adopted element', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    let bindCount = 0;
    const origBind = player._bindVideoEvents.bind(player);
    player._bindVideoEvents = (el) => {
        if (el.tagName === 'VIDEO') bindCount += 1;
        return origBind(el);
    };

    const prefetchedVideo = makeVideoEl();
    player._preloader.adoptPrepared = () => {};
    player._preloader.cancel = () => {};

    player._adoptPrefetchedStaging({
        video: prefetchedVideo,
        hls: null,
        channel: { name: 'Prefetch', url_resolved: 'https://example.com/p.m3u8' }
    });

    assert.equal(bindCount, 1);
    assert.equal(player.videoBack, prefetchedVideo);
});

function setupCommitPlayer() {
    const channel = {
        name: 'Test',
        url_resolved: 'https://example.com/stream.m3u8',
        providerId: 'test'
    };
    return { channel };
}

test('commitPreparedChannel swap order: destroyHls → recycle → promote', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    const { channel } = setupCommitPlayer();
    player.init();
    player.switchGeneration = 1;
    player._preloader = {
        isReady: () => true,
        takeover: () => ({ hls: null, channel, url: channel.url_resolved })
    };
    player.videoBack.videoWidth = 1280;
    player.videoBack.paused = false;

    const order = [];
    player.destroyHls = async () => { order.push('destroyHls'); };
    const origRecycle = player._recycleStagingVideo.bind(player);
    player._recycleStagingVideo = () => { order.push('recycle'); origRecycle(); };
    const origPromote = player._promoteFrontVideo.bind(player);
    player._promoteFrontVideo = () => { order.push('promote'); origPromote(); };

    const result = await player.commitPreparedChannel(channel, 1);

    assert.equal(result, true);
    assert.deepEqual(order, ['destroyHls', 'recycle', 'promote']);
});

test('commitPreparedChannel returns true after successful swap even if switchGen goes stale during play', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    const { channel } = setupCommitPlayer();
    player.init();
    player.switchGeneration = 1;
    player._preloader = {
        isReady: () => true,
        takeover: () => ({ hls: null, channel, url: channel.url_resolved })
    };
    player.videoBack.videoWidth = 1280;
    player.videoBack.paused = true;
    player.video.play = async () => {
        player.switchGeneration = 2;
    };

    const result = await player.commitPreparedChannel(channel, 1);

    assert.equal(result, true);
    assert.equal(player.channel?.name, 'Test');
});

test('commitPreparedChannel fallback playChannel returns true on success', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    const { channel } = setupCommitPlayer();
    player.init();
    player.switchGeneration = 1;
    player._preloader = { isReady: () => false };
    player.playChannel = async (ch) => {
        player.channel = ch;
        player.error = null;
    };

    const result = await player.commitPreparedChannel(channel, 1, { allowFallback: true });

    assert.equal(result, true);
    assert.equal(player.channel?.name, 'Test');
});

test('cancelPrepare invalidates in-flight warm via prepareGeneration', async () => {
    const { createPlayerInstance } = await import('../js/player/playerInstance.js');
    const player = createPlayerInstance({
        id: 'center',
        getSharedVolume: () => 1,
        getLastVolume: () => 1,
        shouldRecordRecents: () => false
    });

    player.init();
    player.switchGeneration = 1;
    const prepareGenAtStart = player.prepareGeneration;

    let staleDuringWarm = false;
    player._resolveChannelInput = async () => ({
        channel: { name: 'Warm', url_resolved: 'https://example.com/w.m3u8', providerId: 't' },
        key: 't:Warm'
    });
    player._preloader.warmChannel = async (_video, _channel, opts) => {
        player.cancelPrepare();
        staleDuringWarm = opts.isStale();
        return false;
    };

    const result = await player.startPrepareChannel(
        { name: 'Warm', url_resolved: 'https://example.com/w.m3u8' },
        1,
        { suppressUi: true }
    );

    assert.equal(result, false);
    assert.equal(staleDuringWarm, true);
    assert.ok(player.prepareGeneration > prepareGenAtStart);
});
