/**
 * Returning-user boot regression test.
 *
 * A returning user with a saved session (mosaic slot + last channel) triggers
 * the catalog lookups that previously ran BEFORE the boot cover was removed.
 * If the catalog network stalls, init() used to hang forever on the noise /
 * stripes screen. With the fix, the boot cover clears first and the restore
 * degrades to stubs via the catalog timeout.
 *
 * Mirrors bootSmoke's DOM stub but pre-seeds session data and a fetch that
 * never resolves (no headers, no bytes — a stalled CDN connection).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setCatalogFetchTimeoutMs } from '../js/tvProviders/iptvOrgTv.js';

const KNOWN_IDS = [
    'settings-panel', 'back-btn', 'search-countries', 'remote-dock-side-btn',
    'player-slot', 'player-mosaic',
    'remote-panel', 'remote-panel-footer', 'remote-catalog-tools', 'remote-channel-bar', 'remote-channel-name', 'tv-catalog-body', 'remote-module-staging',
    'remote-shell', 'browser-shell', 'guide-panel', 'guide-screens',
    'remote-dock-tab', 'remote-dock-sheet', 'remote-dock-host',
    'remote-module', 'remote-module-dialog', 'remote-module-host',
    'browser-module', 'browser-module-dialog', 'browser-module-host',
    'browser-dock-tab', 'browser-dock-sheet', 'browser-dock-host',
    'browser-dock-toggle', 'browser-collapse-header-btn', 'browser-refresh-btn',
    'remote-shell-screens-footer', 'remote-panel-nav-group', 'browser-panel-nav-group', 'remote-panel-footer-nav-row',
    'remote-guide-toggle',
    'remote-external-popout-btn', 'remote-split-browser-btn', 'remote-dock-toggle', 'browser-split-browser-btn', 'browser-external-popout-btn',
    'remote-module-pin', 'remote-collapse-header-btn', 'remote-back-btn',
    'player-tile-topLeft', 'player-tile-center', 'player-tile-topRight',
    'player-tile-bottomLeft', 'player-tile-bottomRight', 'player-tile-bottomCenter',
    'tv-playback-surface-topLeft', 'tv-playback-surface-center', 'tv-playback-surface-topRight',
    'tv-playback-surface-bottomLeft', 'tv-playback-surface-bottomRight', 'tv-playback-surface-bottomCenter',
    'volume-slider', 'volume-dial',
    'tv-volume-slider', 'tv-volume-dial', 'tv-volume-pct',
    'countries-container', 'channels-container',
    'favorites-grid', 'favorites-empty', 'recents-grid', 'recents-empty',
    'buffer-size-select',
    'chan-switch-mode-select',
    'swap-transition-select',
    'text-size-slider', 'text-size-value',
    'tile-width-slider', 'tile-width-value',
    'list-width-slider', 'list-width-value',
    'remote-module-opacity-slider', 'remote-module-opacity-value',
    'remote-texture-select',
    'catalog-layout-btn',
    'reset-appearance-btn', 'appearance-preview-tile',
    'mosaic-reset-btn', 'mosaic-mute-all-btn', 'mosaic-play-all-btn', 'mosaic-stop-all-btn',
    'remote-layout-picker-btn', 'remote-layout-picker-popout', 'remote-layout-picker-wrap',
    'remote-panel-mosaic-group', 'remote-power-btn', 'remote-fav-btn', 'remote-volume-split', 'remote-mute-vol-pct', 'remote-mute-all-vol-pct',
    'remote-digit-0', 'remote-digit-1', 'remote-digit-2', 'remote-digit-3', 'remote-digit-4',
    'remote-digit-5', 'remote-digit-6', 'remote-digit-7', 'remote-digit-8', 'remote-digit-9',
    'remote-mute-all-btn', 'remote-play-all-btn', 'remote-stop-all-btn', 'remote-play-btn', 'remote-mute-btn',
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
    'resume-session-list',
    // The boot cover itself — used to assert it gets removed.
    'boot-screen'
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
        _removed: false,
        hidden: false,
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
        remove() { el._removed = true; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        focus() {},
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

let bootCleared = false;
let countriesRendered = false;
let bootError = null;

function waitFor(fn, timeout = 5000) {
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
    setCatalogFetchTimeoutMs(80);

    const els = new Map(KNOWN_IDS.map((id) => [id, makeEl(id)]));
    const bootEl = els.get('boot-screen');
    const countriesEl = els.get('countries-container');

    globalThis.document = {
        readyState: 'complete',
        body: makeEl('body'),
        head: makeEl('head'),
        documentElement: makeEl('html'),
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => els.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
    };
    globalThis.document.documentElement.classList.add('is-booting');
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
    // Returning user: seed a saved last channel + mosaic slot so restore hits catalog.
    globalThis.localStorage.setItem('matrix_tv_state', JSON.stringify({
        lastChannel: 'BBC:us',
        lastName: 'BBC',
        lastCountry: 'us',
        mosaicSlots: {
            center: { channelKey: 'BBC:us', enabled: true }
        }
    }));
    // Stalled CDN: accepted connection, no bytes.
    globalThis.fetch = () => new Promise(() => {});
    globalThis.indexedDB = undefined;

    const onRejection = (err) => { bootError = err; };
    process.on('unhandledRejection', onRejection);

    const origErr = console.error;
    console.error = () => {};
    try {
        await import('../js/app.js');
        await waitFor(() => bootEl._removed || !document.documentElement.classList.contains('is-booting'));
        bootCleared = bootEl._removed || !document.documentElement.classList.contains('is-booting');
        await waitFor(() => countriesEl._ready, 8000);
        countriesRendered = countriesEl._ready;
    } finally {
        console.error = origErr;
        process.removeListener('unhandledRejection', onRejection);
    }
    if (bootError) throw bootError;
});

test('returning-user boot clears the cover even when the catalog network stalls', () => {
    assert.equal(bootCleared, true, 'boot cover must clear before catalog restore finishes');
});

test('returning-user boot still reaches a ready countries container after catalog timeout', () => {
    assert.equal(countriesRendered, true, 'countries container should render after degraded catalog');
});
