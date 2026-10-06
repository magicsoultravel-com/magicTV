/**
 * Rapid successive playStation calls — only the last generation wins;
 * prior provider fetches are aborted and must not clobber player state.
 */
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
    const m = new Map();
    return {
        getItem(k) { return m.has(k) ? m.get(k) : null; },
        setItem(k, v) { m.set(k, String(v)); },
        removeItem(k) { m.delete(k); },
        clear() { m.clear(); }
    };
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.indexedDB = undefined;

if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
}

const listeners = new Map();
globalThis.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
};
globalThis.removeEventListener = (type, fn) => {
    listeners.get(type)?.delete(fn);
};
globalThis.dispatchEvent = (event) => {
    const set = listeners.get(event?.type);
    if (set) for (const fn of set) fn(event);
    return true;
};
globalThis.window = globalThis;

class FakeAudio {
    constructor() {
        this.src = '';
        this.paused = true;
        this.volume = 1;
        this.muted = false;
        this.preload = 'none';
        this._listeners = new Map();
    }

    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(fn);
    }

    removeAttribute(name) {
        if (name === 'src') this.src = '';
    }

    load() {}

    play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }
}

globalThis.Audio = FakeAudio;

const { RadioPlayer } = await import('../js/radio/radioPlayer.js');
const { RadioProviderRegistry } = await import('../js/radio/radioProviders/registry.js');

let originalGet;

before(() => {
    originalGet = RadioProviderRegistry.get.bind(RadioProviderRegistry);
});

afterEach(() => {
    RadioProviderRegistry.get = originalGet;
    RadioPlayer.stop();
    RadioPlayer.station = null;
    RadioPlayer.audio = null;
    RadioPlayer.playGeneration = 0;
    RadioPlayer._playAbort = null;
    RadioPlayer._streamRetryKey = null;
});

function stationFor(id, url) {
    return {
        providerId: 'radio-browser',
        stationId: id,
        stationuuid: `radio-browser:${id}`,
        name: `Station ${id}`,
        url_resolved: url,
        favicon: '',
        countrycode: 'US',
        lastcheckok: 1
    };
}

test('rapid playStation calls: only last generation plays; prior fetches aborted', async () => {
    const started = [];
    const completed = [];
    const aborted = [];

    RadioProviderRegistry.get = () => ({
        id: 'radio-browser',
        async getStationById(stationId, { signal } = {}) {
            started.push(stationId);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    completed.push(stationId);
                    resolve(stationFor(stationId, `https://stream.example/${stationId}.mp3`));
                }, 40);
                const onAbort = () => {
                    clearTimeout(timer);
                    aborted.push(stationId);
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    reject(err);
                };
                if (signal?.aborted) onAbort();
                else signal?.addEventListener('abort', onAbort, { once: true });
            });
        },
        reportClick() {},
        async getStationCacheAge() { return null; }
    });

    RadioPlayer.init();

    const p1 = RadioPlayer.playStation('radio-browser:a');
    const p2 = RadioPlayer.playStation('radio-browser:b');
    const p3 = RadioPlayer.playStation('radio-browser:c');

    await Promise.allSettled([p1, p2, p3]);

    assert.deepEqual(started, ['a', 'b', 'c'], 'all three resolves started');
    assert.ok(aborted.includes('a') && aborted.includes('b'), 'earlier fetches aborted');
    assert.ok(!aborted.includes('c'), 'last fetch not aborted');
    assert.deepEqual(completed, ['c'], 'only last fetch completed');
    assert.equal(RadioPlayer.station?.stationId, 'c');
    assert.equal(RadioPlayer.streamUrl, 'https://stream.example/c.mp3');
    assert.equal(RadioPlayer.playing, true);
    assert.equal(RadioPlayer.error, null);
});

test('playStation with url_resolved object skips provider fetch', async () => {
    let fetches = 0;
    RadioProviderRegistry.get = () => ({
        id: 'radio-browser',
        async getStationById() {
            fetches += 1;
            throw new Error('should not fetch');
        },
        reportClick() {},
        async getStationCacheAge() { return null; }
    });

    RadioPlayer.init();
    const station = stationFor('direct', 'https://stream.example/direct.mp3');
    await RadioPlayer.playStation(station);

    assert.equal(fetches, 0);
    assert.equal(RadioPlayer.streamUrl, 'https://stream.example/direct.mp3');
    assert.equal(RadioPlayer.playing, true);
});
