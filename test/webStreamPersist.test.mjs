/** Web Video persistence: slot normalization, quota compaction, persistSlots. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

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
    globalThis.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
});

beforeEach(() => store.clear());

const { savePlayerState, loadPlayerState } = await import('../js/storage/playerState.js');
const { compactNonEssentialPersistedState } = await import('../js/storage/persistedState.js');
const { persistMethods } = await import('../js/mosaic/persist.js');
const { webStreamMethods } = await import('../js/mosaic/webstream.js');
const { webstreamChannel, webstreamKey } = await import('../js/webstream/webStreamLinks.js');

const PAGE = 'https://site.tv/watch/42';
const STREAM = 'https://cdn.tv/master.m3u8';

test('mosaicSlots keep Web Video pages/streams and never a TV url', () => {
    savePlayerState({
        mosaicSlots: {
            center: {
                kind: 'webstream',
                pageUrl: PAGE,
                streamUrl: STREAM,
                streamKind: 'hls',
                mode: 'media',
                name: 'Site',
                muted: false,
                volume: 0.5,
                url: 'https://should-be-dropped/x.mp4'
            },
            topLeft: { kind: 'webstream', pageUrl: 'nonsense' },
            topRight: { key: 'iptv-org:CNN.us', name: 'CNN', muted: true, volume: 1 }
        }
    });

    const slots = loadPlayerState().mosaicSlots;
    assert.equal(slots.center.kind, 'webstream');
    assert.equal(slots.center.pageUrl, PAGE);
    assert.equal(slots.center.streamUrl, STREAM);
    assert.equal(slots.center.streamKind, 'hls');
    assert.equal(slots.center.mode, 'media');
    assert.equal(slots.center.name, 'Site');
    assert.equal(slots.center.muted, false);
    assert.equal(slots.center.volume, 0.5);
    assert.equal(slots.center.url, '');
    assert.equal(slots.center.key, webstreamKey(PAGE, STREAM));
    assert.match(slots.center.channelId, /^ws_/);
    assert.equal(slots.topLeft, undefined, 'entries without page/stream are dropped');
    assert.equal(slots.topRight.kind, undefined);
});

test('embed entries keep their frame URL and drop the stream URL', () => {
    savePlayerState({
        mosaicSlots: {
            center: {
                kind: 'webstream',
                pageUrl: PAGE,
                streamUrl: STREAM,
                mode: 'embed',
                frameUrl: 'https://player.tv/embed/42',
                shield: 'strict',
                name: 'Player'
            }
        }
    });
    const center = loadPlayerState().mosaicSlots.center;
    assert.equal(center.mode, 'embed');
    assert.equal(center.streamUrl, '', 'no stream is attached in embed mode');
    assert.equal(center.frameUrl, 'https://player.tv/embed/42');
    assert.equal(center.pageUrl, PAGE);
    assert.equal(center.shield, 'strict', 'the page shield survives a restart');
});

test('embed shield junk is dropped and media tiles never claim one', () => {
    savePlayerState({
        mosaicSlots: {
            center: { kind: 'webstream', pageUrl: PAGE, mode: 'embed', shield: 'maximum' },
            topLeft: { kind: 'webstream', pageUrl: PAGE, streamUrl: STREAM, mode: 'media', shield: 'strict' }
        }
    });
    const slots = loadPlayerState().mosaicSlots;
    assert.equal(slots.center.shield, '');
    assert.equal(slots.topLeft.shield, '', 'media tiles have no page shield');
});

test('quota compaction preserves Web Video identity but drops posters', () => {
    const compacted = compactNonEssentialPersistedState({
        mosaicSlots: {
            center: {
                kind: 'webstream',
                key: webstreamKey(PAGE, STREAM),
                pageUrl: PAGE,
                streamUrl: STREAM,
                streamKind: 'hls',
                mode: 'media',
                name: 'Site',
                muted: true,
                volume: 1,
                url: 'data:image/jpeg;base64,AAAA'
            }
        },
        mosaicPlacement: { center: { x: 0, y: 0, w: 1, h: 1, z: 1 } }
    });
    const entry = compacted.mosaicSlots.center;
    assert.equal(entry.kind, 'webstream');
    assert.equal(entry.pageUrl, PAGE);
    assert.equal(entry.streamUrl, STREAM);
    assert.equal(entry.streamKind, 'hls');
    assert.equal(entry.mode, 'media');
    assert.equal(entry.url, '');
});

test('persistSlots writes the Web Video entry and never touches lastChannelKey', () => {
    savePlayerState({ lastChannelKey: 'iptv-org:CNN.us', lastChannelName: 'CNN' });
    const channel = webstreamChannel({ pageUrl: PAGE, streamUrl: STREAM, kind: 'hls', name: 'Site' });
    const player = {
        channel,
        muted: false,
        volume: 0.7,
        playing: true,
        stopped: false,
        pausePhase: 'idle',
        loading: false,
        loadPhase: 'idle'
    };
    const ctx = {
        ...persistMethods,
        ...webStreamMethods,
        slotsHydrated: true,
        slots: {
            center: { id: 'center', enabled: true, player },
            topLeft: { id: 'topLeft', enabled: false, player: null },
            topRight: { id: 'topRight', enabled: false, player: null },
            bottomLeft: { id: 'bottomLeft', enabled: false, player: null },
            bottomRight: { id: 'bottomRight', enabled: false, player: null },
            bottomCenter: { id: 'bottomCenter', enabled: false, player: null },
            topCenter: { id: 'topCenter', enabled: false, player: null },
            midLeft: { id: 'midLeft', enabled: false, player: null },
            midRight: { id: 'midRight', enabled: false, player: null }
        },
        rememberedSlotKeys: {},
        webStreamState: {
            center: { pageUrl: PAGE, streamUrl: STREAM, kind: 'hls', mode: 'media', title: 'Site' }
        },
        webStreamReturn: {},
        _wsIntent: {},
        getPrimary() { return player; }
    };

    ctx.persistSlots();

    const state = loadPlayerState();
    assert.equal(state.lastChannelKey, 'iptv-org:CNN.us', 'webstream tiles must not claim last channel');
    const entry = state.mosaicSlots.center;
    assert.equal(entry.kind, 'webstream');
    assert.equal(entry.pageUrl, PAGE);
    assert.equal(entry.streamUrl, STREAM);
    assert.equal(entry.muted, false);
    assert.equal(entry.volume, 0.7);
});

