/**
 * Unit tests for per-slot previous-channel history stacks.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
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
        matchMedia: () => ({ matches: true })
    };
});

let pushSlotChannelHistory;
let popSlotChannelHistory;
let getSlotChannelHistory;
let hasSlotChannelHistory;
let trimAllSlotChannelHistory;
let SettingsStore;
let savePlayerState;

before(async () => {
    ({
        pushSlotChannelHistory,
        popSlotChannelHistory,
        getSlotChannelHistory,
        hasSlotChannelHistory,
        trimAllSlotChannelHistory
    } = await import('../js/mosaic/channelHistory.js'));
    SettingsStore = (await import('../js/storage/settingsStore.js')).SettingsStore;
    savePlayerState = (await import('../js/storage/playerState.js')).savePlayerState;
});

beforeEach(() => {
    store.clear();
    savePlayerState({ mosaicChannelHistory: {} });
    SettingsStore.setRecentsCap(5);
});

test('push skips same key and empty previous', () => {
    pushSlotChannelHistory('center', null, 'iptv-org:B');
    pushSlotChannelHistory('center', 'iptv-org:A', 'iptv-org:A');
    assert.equal(hasSlotChannelHistory('center'), false);
});

test('push stacks newest-first and dedupes to front', () => {
    pushSlotChannelHistory('center', 'iptv-org:A', 'iptv-org:B');
    pushSlotChannelHistory('center', 'iptv-org:B', 'iptv-org:C');
    pushSlotChannelHistory('center', 'iptv-org:A', 'iptv-org:D');
    assert.deepEqual(getSlotChannelHistory('center'), ['iptv-org:A', 'iptv-org:B']);
});

test('finite cap trims per-slot history', () => {
    SettingsStore.setRecentsCap(2);
    pushSlotChannelHistory('center', 'iptv-org:1', 'iptv-org:2');
    pushSlotChannelHistory('center', 'iptv-org:2', 'iptv-org:3');
    pushSlotChannelHistory('center', 'iptv-org:3', 'iptv-org:4');
    assert.deepEqual(getSlotChannelHistory('center'), ['iptv-org:3', 'iptv-org:2']);
});

test('unlimited cap does not trim slot history', () => {
    SettingsStore.setRecentsCap(-1);
    for (let i = 0; i < 8; i += 1) {
        pushSlotChannelHistory('center', `iptv-org:${i}`, `iptv-org:${i + 1}`);
    }
    assert.equal(getSlotChannelHistory('center').length, 8);
});

test('pop returns newest previous and removes it', () => {
    pushSlotChannelHistory('topLeft', 'iptv-org:A', 'iptv-org:B');
    pushSlotChannelHistory('topLeft', 'iptv-org:B', 'iptv-org:C');
    assert.equal(popSlotChannelHistory('topLeft'), 'iptv-org:B');
    assert.deepEqual(getSlotChannelHistory('topLeft'), ['iptv-org:A']);
    assert.equal(popSlotChannelHistory('topLeft'), 'iptv-org:A');
    assert.equal(popSlotChannelHistory('topLeft'), null);
});

test('slots keep independent stacks', () => {
    pushSlotChannelHistory('center', 'iptv-org:C1', 'iptv-org:C2');
    pushSlotChannelHistory('topLeft', 'iptv-org:L1', 'iptv-org:L2');
    assert.deepEqual(getSlotChannelHistory('center'), ['iptv-org:C1']);
    assert.deepEqual(getSlotChannelHistory('topLeft'), ['iptv-org:L1']);
});

test('lowering cap trims all slot stacks', () => {
    SettingsStore.setRecentsCap(10);
    pushSlotChannelHistory('center', 'iptv-org:1', 'iptv-org:2');
    pushSlotChannelHistory('center', 'iptv-org:2', 'iptv-org:3');
    pushSlotChannelHistory('center', 'iptv-org:3', 'iptv-org:4');
    SettingsStore.setRecentsCap(1);
    // setRecentsCap trims async via dynamic import — call trim directly to assert
    trimAllSlotChannelHistory();
    assert.deepEqual(getSlotChannelHistory('center'), ['iptv-org:3']);
});
