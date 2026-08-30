/**
 * Chan switch mode — Safe Loading player contract tests.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

function makeVideoEl() {
    return {
        className: '',
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
