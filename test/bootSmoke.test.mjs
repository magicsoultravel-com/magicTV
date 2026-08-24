/**
 * Boot smoke test.
 *
 * Runs the app's real init() path in Node using a minimal DOM stub and a
 * mocked offline fetch. This exercises the actual wiring — boot guard,
 * element lookups, TvPlayer/TvPip init + video mount, settings sync,
 * and the countries render path — without a browser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const KNOWN_IDS = [
    'tv-settings-btn', 'back-btn', 'search-countries', 'refresh-btn',
    'player-slot', 'player-mosaic',
    'remote-panel', 'remote-panel-footer', 'remote-catalog-tools', 'remote-channel-bar', 'remote-channel-name', 'tv-catalog-body', 'remote-module-staging',
    'remote-shell', 'browser-shell', 'guide-panel', 'guide-screens',
    'remote-dock-tab', 'remote-dock-sheet', 'remote-dock-host',
    'remote-module', 'remote-module-dialog', 'remote-module-host',
    'browser-module', 'browser-module-dialog', 'browser-module-host',
    'browser-dock-tab', 'browser-dock-sheet', 'browser-dock-host',
    'browser-window-controls', 'browser-dock-toggle', 'browser-hide-toggle',
    'remote-shell-screens-footer', 'remote-panel-nav-group', 'browser-panel-nav-group', 'remote-panel-footer-nav-row',
    'remote-guide-toggle',
    'remote-external-popout-btn', 'remote-split-browser-btn', 'browser-split-browser-btn', 'browser-external-popout-btn',
    'remote-module-pin', 'remote-module-close', 'remote-back-btn',
    'player-tile-topLeft', 'player-tile-center', 'player-tile-topRight',
    'player-tile-bottomLeft', 'player-tile-bottomRight',
    'tv-playback-surface-topLeft', 'tv-playback-surface-center', 'tv-playback-surface-topRight',
    'tv-playback-surface-bottomLeft', 'tv-playback-surface-bottomRight',
    'volume-slider', 'volume-dial',
    'countries-container', 'channels-container',
    'favorites-grid', 'favorites-empty', 'recents-grid', 'recents-empty',
    'buffer-size-select',
    'swap-transition-select',
    'screen-top-left-toggle', 'screen-top-right-toggle',
    'screen-bottom-left-toggle', 'screen-bottom-right-toggle',
    'text-size-slider', 'text-size-value',
    'tile-width-slider', 'tile-width-value',
    'list-width-slider', 'list-width-value',
    'remote-texture-select',
    'catalog-layout-btn',
    'reset-appearance-btn', 'appearance-preview-tile',
    'mosaic-reset-btn', 'mosaic-mute-all-btn', 'mosaic-stop-all-btn',
    'remote-reset-btn', 'remote-mute-all-btn', 'remote-stop-all-btn', 'remote-play-btn', 'remote-mute-btn',
    'add-screen-btn', 'play-favorites-mosaic-btn', 'create-favorite-folder-btn',
    'preview-avatar', 'preview-name', 'preview-flag',
    'volume-pct',
    'active-tile-select',
    'visited-style-select',
    'non-visited-style-select',
    'recents-cap-input',
    'visited-channels-section',
    'visited-back-btn',
    'visited-countries-container',
    'visited-channels-container',
    'visited-channels-summary-count',
    'appearance-preview-list',
    'preview-list-avatar',
    'preview-list-name',
    'preview-list-flag',
    'resume-session-modal',
    'resume-session-dialog',
    'resume-session-list'
];
function makeEl(id = '') {
    const el = {
        id,
        dataset: {},
        style: {
            setProperty() {},
            removeProperty() {}
        },
        children: [],
        parentElement: null,
        _innerHTML: '',
        _ready: false,
        classList: {
            _set: new Set(),
            add(...cls) { cls.forEach((c) => this._set.add(c)); },
            remove(...cls) { cls.forEach((c) => this._set.delete(c)); },
            toggle(c, force) {
                const on = force === undefined ? !this._set.has(c) : !!force;
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            },
            contains(c) { return this._set.has(c); }
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
        removeChild() {},
        remove() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        load() {},
        play() { return Promise.resolve(); },
        pause() {}
    };
    Object.defineProperty(el, 'innerHTML', {
        get() { return this._innerHTML; },
        set(v) { this._innerHTML = String(v); el._ready = true; }
    });
    return el;
}

let countriesEl;
let countriesRendered = false;
let bootError = null;

function waitFor(fn, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        (function poll() {
            if (bootError) return reject(bootError);
            if (fn()) return resolve();
            if (Date.now() - started > timeout) return reject(new Error('timed out waiting for boot'));
            setTimeout(poll, 10);
        })();
    });
}

before(async () => {
    // --- minimal DOM stub ---
    const els = new Map(KNOWN_IDS.map((id) => [id, makeEl(id)]));
    countriesEl = els.get('countries-container');

    globalThis.document = {
        readyState: 'complete', // triggers init() synchronously at import
        body: makeEl('body'),
        head: makeEl('head'),
        documentElement: makeEl('html'),
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => els.get(id) || null,
        querySelectorAll: () => [],
        addEventListener: () => {}
    };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        matchMedia: () => ({ matches: true }),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (t) => clearTimeout(t)
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    globalThis.fetch = async () => {
        throw new Error('offline (mocked)');
    };

    // Surface any async init() failure instead of letting it vanish.
    const onRejection = (err) => { bootError = err; };
    process.on('unhandledRejection', onRejection);

    // Prevent noisy console.error from the expected offline country fetch.
    const origErr = console.error;
    console.error = () => {};
    try {
        await import('../js/app.js'); // init() starts on import
        await waitFor(() => countriesEl._ready);
    } finally {
        console.error = origErr;
        process.removeListener('unhandledRejection', onRejection);
    }
    if (bootError) throw bootError;
    countriesRendered = countriesEl._ready;
});

test('app boots, renders the countries container and reaches ready state', () => {
    assert.equal(countriesRendered, true, 'renderCountries must have written into #countries-container');
    assert.ok(
        countriesEl._innerHTML.includes('No countries found') ||
            countriesEl._innerHTML.length === 0,
        'offline boot shows a graceful empty state'
    );
});

test('boot did not throw after importing with DOM stubs', () => {
    // Reaching this assertion means the dynamic import + init() completed.
    assert.ok(true);
});