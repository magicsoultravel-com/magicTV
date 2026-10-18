/** YouTube pseudo-player: YT state → mosaic player fields, transport, audio, teardown. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTilePlayback } from '../js/player/pauseBuffer.js';
import { channelKey } from '../js/tvProviders/channelShape.js';
import {
    YOUTUBE_FRAME_HEIGHT,
    YOUTUBE_FRAME_WIDTH,
    captureYouTubeSwapState,
    createYouTubeChannel,
    createYouTubePlayer
} from '../js/youtube/youtubePlayer.js';

const ID = 'dQw4w9WgXcQ';

/** Minimal DOM node stub — just enough for the tile iframe wrapper. */
let docRef;
function makeElement(tag) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        dataset: {},
        style: {},
        children: [],
        parentElement: null,
        clientWidth: 1280,
        clientHeight: 720,
        classList: {
            add(name) {
                const parts = new Set(String(node.className).split(/\s+/).filter(Boolean));
                parts.add(name);
                node.className = [...parts].join(' ');
            },
            remove(name) {
                node.className = String(node.className)
                    .split(/\s+/)
                    .filter((part) => part && part !== name)
                    .join(' ');
            },
            toggle() {}
        },
        appendChild(child) {
            node.children.push(child);
            child.parentElement = node;
            return child;
        },
        replaceChildren(...nodes) {
            node.children = [];
            nodes.forEach((child) => node.appendChild(child));
        },
        remove() {
            if (node.parentElement) {
                node.parentElement.children = node.parentElement.children.filter((c) => c !== node);
            }
            node.parentElement = null;
        },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {}
    };
    node.ownerDocument = docRef;
    return node;
}

docRef = {
    createElement: (tag) => makeElement(tag),
    getElementById: () => null,
    head: null,
    body: null
};

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

class FakeYTPlayer {
    static instances = [];

    constructor(mount, options = {}) {
        this.mount = mount;
        this.options = options || {};
        this.commands = [];
        this.volume = 100;
        this.destroyed = false;
        this.iframe = makeElement('iframe');
        FakeYTPlayer.instances.push(this);
        this.options.events?.onReady?.();
    }

    getIframe() { return this.iframe; }
    playVideo() { this.commands.push('playVideo'); }
    pauseVideo() { this.commands.push('pauseVideo'); }
    mute() { this.commands.push('mute'); }
    unMute() { this.commands.push('unMute'); }
    setVolume(value) { this.commands.push(`volume:${value}`); this.volume = value; }
    seekTo(seconds) { this.commands.push(`seek:${seconds}`); }
    getDuration() { return 120; }
    getCurrentTime() { return 30; }
    getVideoLoadedFraction() { return 0.25; }
    destroy() { this.destroyed = true; }
}

const dispatched = [];

before(() => {
    globalThis.window = {
        YT: { Player: FakeYTPlayer },
        location: { origin: 'https://tv.local' },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent(event) {
            dispatched.push(event);
            return true;
        }
    };
});

beforeEach(() => {
    FakeYTPlayer.instances = [];
    dispatched.length = 0;
});

function mountPlayer({ id = 'center', muted = true, volume = 1, sharedVolume = 1 } = {}) {
    const player = createYouTubePlayer({
        id,
        videoId: ID,
        title: 'Test clip',
        muted,
        volume,
        getSharedVolume: () => sharedVolume,
        getLastVolume: () => 0.7
    });
    const surface = makeElement('div');
    player.mountVideo(surface);
    return { player, surface, api: FakeYTPlayer.instances.at(-1) };
}

test('channel stub maps to a youtube: mosaic key', () => {
    const channel = createYouTubeChannel(ID, 'Clip');
    assert.equal(channel.providerId, 'youtube');
    assert.equal(channel.channelId, ID);
    assert.equal(channelKey(channel), `youtube:${ID}`);
    assert.equal(channel.name, 'Clip');
    assert.equal(createYouTubeChannel('bad'), null);
});

test('adapter starts CUED/stopped with a poster and no <video>', () => {
    const { player } = mountPlayer();
    assert.equal(player.kind, 'youtube');
    assert.equal(player.videoId, ID);
    assert.equal(player.video, null);
    assert.equal(player.hls, null);
    assert.equal(player.stopped, true);
    assert.equal(player.playing, false);
    assert.equal(player.wantPlaying, false);
    assert.equal(channelKey(player.channel), `youtube:${ID}`);
    assert.match(player.posterDataUrl, /i\.ytimg\.com/);
});

test('mounting builds the contain-fit frame and wires the IFrame API', () => {
    const { player, surface, api } = mountPlayer();
    assert.ok(api, 'YT.Player was constructed');
    assert.equal(api.options.videoId, ID);
    assert.equal(api.options.playerVars.enablejsapi, 1);
    assert.equal(api.options.playerVars.iv_load_policy, 3);
    assert.equal(api.iframe.className.includes('yt-frame-iframe'), true);
    assert.equal(player.videoHolder.className.includes('yt-frame-wrap'), true);
    const wrap = surface.children[0];
    assert.equal(wrap.className.includes('yt-frame-wrap'), true);
    // 1280x720 surface → the whole 16:9 player renders at native size (no
    // magnifying scale, so YouTube's own chrome stays 1:1).
    assert.equal(player._frameEl.style.transform, 'translate(-50%, -50%)');
    assert.equal(player._frameEl.style.width, '1280px');
    assert.equal(player._frameEl.style.height, '720px');
});

test('non-16:9 surfaces letterbox the player instead of cropping it', () => {
    const player = createYouTubePlayer({ id: 'topRight', videoId: ID });
    const surface = makeElement('div');
    surface.clientWidth = 600;
    surface.clientHeight = 600;
    player.mountVideo(surface);
    // min(600, 600 * 16/9) = 600 wide → 337.5 high, centered vertically.
    assert.equal(player._frameEl.style.width, '600px');
    assert.equal(player._frameEl.style.height, '338px');
    assert.equal(player._frameEl.style.transform, 'translate(-50%, -50%)');
});

test('tiny tiles keep the API box and scale the whole player down', () => {
    const player = createYouTubePlayer({ id: 'bottomLeft', videoId: ID });
    const surface = makeElement('div');
    surface.clientWidth = 320;
    surface.clientHeight = 180;
    player.mountVideo(surface);
    assert.equal(player._frameEl.style.width, `${YOUTUBE_FRAME_WIDTH}px`);
    assert.equal(player._frameEl.style.height, `${YOUTUBE_FRAME_HEIGHT}px`);
    assert.match(player._frameEl.style.transform, /translate\(-50%, -50%\) scale\(0\.5\)/);
});

test('captureYouTubeSwapState carries clip, playhead and transport', () => {
    const { player } = mountPlayer({ muted: false, volume: 0.4 });
    player._handleApiState(YT_STATE.PLAYING);
    player.watchSessionSeconds = 95;

    const state = captureYouTubeSwapState(player);
    assert.deepEqual(state, {
        videoId: ID,
        title: 'Test clip',
        startAt: 30,
        muted: false,
        volume: 0.4,
        autoplay: true,
        watchSessionSeconds: 95
    });

    // A cued/stopped embed must stay paused when rebuilt elsewhere.
    const { player: cued } = mountPlayer({ id: 'topLeft' });
    assert.equal(captureYouTubeSwapState(cued).autoplay, false);
    assert.equal(captureYouTubeSwapState(cued).muted, true);
    assert.equal(captureYouTubeSwapState(null).videoId, '');
});

test('YT PLAYING/BUFFERING/PAUSED/CUED/ENDED map onto mosaic fields', () => {
    const { player } = mountPlayer();

    player._handleApiState(YT_STATE.PLAYING);
    assert.equal(player.playing, true);
    assert.equal(player.wantPlaying, true);
    assert.equal(player.loading, false);
    assert.equal(player.loadPhase, 'idle');
    assert.equal(player.pausePhase, 'idle');
    assert.equal(player.stopped, false);

    player._handleApiState(YT_STATE.BUFFERING);
    assert.equal(player.playing, false);
    assert.equal(player.loading, true);
    assert.equal(player.loadPhase, 'buffering');
    assert.equal(player.wantPlaying, true, 'buffer keeps the play intent');

    player._handleApiState(YT_STATE.PLAYING);
    player._handleApiState(YT_STATE.PAUSED);
    assert.equal(player.playing, false);
    assert.equal(player.wantPlaying, false);
    assert.equal(player.pausePhase, 'paused');
    assert.equal(player.stopped, false);

    player._handleApiState(YT_STATE.CUED);
    assert.equal(player.stopped, true);
    assert.equal(player.pausePhase, 'idle');

    player._handleApiState(YT_STATE.PLAYING);
    player._handleApiState(YT_STATE.ENDED);
    assert.equal(player.stopped, true);
    assert.equal(player.ended, true);
    assert.equal(player.playing, false);
});

test('classifyTilePlayback reads YouTube tiles like a real player', () => {
    const { player } = mountPlayer();
    const classify = () => classifyTilePlayback({
        hasChannel: Boolean(player.channel),
        playing: player.playing,
        posterDataUrl: player.posterDataUrl,
        pausePhase: player.pausePhase,
        stopped: player.stopped,
        loading: player.loading,
        loadPhase: player.loadPhase,
        wantPlaying: player.wantPlaying,
        error: player.error
    });

    assert.equal(classify().uiStopped, true);

    player._handleApiState(YT_STATE.PLAYING);
    assert.equal(classify().uiPlaying, true);

    player._handleApiState(YT_STATE.PAUSED);
    assert.equal(classify().uiPaused, true);

    player._handleApiState(YT_STATE.BUFFERING);
    player.wantPlaying = true;
    assert.equal(classify().uiLoading, true);

    player._handleApiState(YT_STATE.PLAYING);
    player._fail('Video not found');
    assert.equal(classify().uiDisconnected, true);
});

test('transport actions drive the IFrame API', () => {
    const { player, api } = mountPlayer();

    player.resume();
    assert.equal(player.wantPlaying, true);
    assert.equal(player.loading, true);
    assert.ok(api.commands.includes('playVideo'));

    player._handleApiState(YT_STATE.PLAYING);
    player.pause();
    assert.equal(player.wantPlaying, false);
    assert.equal(player.pausePhase, 'paused');
    assert.ok(api.commands.includes('pauseVideo'));

    player.toggle();
    assert.equal(player.wantPlaying, true, 'toggle resumes from pause');

    player._handleApiState(YT_STATE.PLAYING);
    player.toggle();
    assert.equal(player.wantPlaying, false, 'toggle pauses while playing');
});

test('stop() returns to the stopped slate and can clear the channel', async () => {
    const { player, api } = mountPlayer();
    player._handleApiState(YT_STATE.PLAYING);

    await player.stop();
    assert.equal(player.stopped, true);
    assert.equal(player.playing, false);
    assert.equal(player.pausePhase, 'idle');
    assert.ok(player.channel, 'plain stop keeps the tile identity');
    assert.ok(api.commands.includes('pauseVideo'));

    await player.stop({ clearChannel: true });
    assert.equal(player.channel, null);
});

test('seek/buffer readouts come from the IFrame API', () => {
    const { player } = mountPlayer();
    const seek = player.getSeekInfo();
    assert.deepEqual(seek, {
        current: 30,
        bufferedStart: 0,
        bufferedEnd: 120,
        isLive: false,
        progress: 25,
        behindLive: null
    });
    assert.deepEqual(player.getBufferInfo(), { buffered: 30, duration: 120 });
    assert.equal(player.getClock(), '0:30');
    assert.deepEqual(player.getQualityLevels(), []);
});

test('destroy tears down the iframe and API instance', () => {
    const { player, surface, api } = mountPlayer();
    const wrap = surface.children[0];
    player.destroy();

    assert.equal(api.destroyed, true);
    assert.equal(wrap.parentElement, null);
    assert.equal(player.videoHolder, null);
    assert.equal(player.videoMount, null);

    // Late API callbacks after teardown must not resurrect state.
    player._handleApiState(YT_STATE.PLAYING);
    assert.equal(player.playing, false);
    player.mountVideo(surface);
    assert.equal(player.videoHolder, null);
});

test('emitState broadcasts tv:state_changed for the center tile only', () => {
    const { player } = mountPlayer({ id: 'center' });
    player._handleApiState(YT_STATE.PLAYING);

    const event = dispatched.filter((e) => e.type === 'tv:state_changed').at(-1);
    assert.ok(event, 'center tile dispatched player state');
    assert.equal(event.detail.kind, 'youtube');
    assert.equal(event.detail.slotId, 'center');
    assert.equal(event.detail.playing, true);
    assert.equal(channelKey(event.detail.channel), `youtube:${ID}`);
    assert.equal(event.detail.seekInfo.progress, 25);

    dispatched.length = 0;
    const corner = mountPlayer({ id: 'topLeft' }).player;
    corner._handleApiState(YT_STATE.PLAYING);
    assert.equal(dispatched.length, 0, 'corner tiles stay silent');
});

test('volume math honours master x slot gain and mute flags', () => {
    const { player, api } = mountPlayer({ muted: false, volume: 0.5, sharedVolume: 0.5 });
    player.setVolume(0.5);
    assert.equal(player.volume, 0.5);
    assert.equal(player.muted, false);
    assert.ok(api.commands.includes('unMute'));
    assert.ok(api.commands.includes('volume:25'));

    player.mute();
    assert.equal(player.muted, true);
    assert.ok(api.commands.includes('mute'));

    player.unmute();
    assert.equal(player.muted, false);

    player.setVolume(0);
    assert.equal(player.volume, 0);
    assert.equal(player.muted, false);
    player.unmute();
    assert.equal(player.volume, 0.7, 'falls back to the shared last volume');
});
