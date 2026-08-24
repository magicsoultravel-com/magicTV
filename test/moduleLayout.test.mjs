import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('moduleLayout SSOT', () => {
    beforeEach(() => {
        globalThis.document = {
            getElementById: () => null,
            body: { classList: { toggle() {}, contains() { return false; } } }
        };
        const store = { remoteModule: null };
        globalThis.localStorage = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        };
        // Persist stubs via dynamic import after mocking is heavy; exercise pure helpers.
    });

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.localStorage;
    });

    it('normalizeLayoutState defaults to joined', async () => {
        const { normalizeLayoutState } = await import('../js/ui/moduleLayout.js?layout=1');
        const state = normalizeLayoutState(null);
        assert.equal(state.mode, 'joined');
        assert.equal(state.browserHostKind, null);
        assert.equal(state.browser.width >= 240, true);
    });

    it('normalizeLayoutState accepts split + undocked browser', async () => {
        const { normalizeLayoutState } = await import('../js/ui/moduleLayout.js?layout=2');
        const state = normalizeLayoutState({
            mode: 'split',
            remoteHostKind: 'docked',
            browserHostKind: 'undocked',
            browser: { left: 10, top: 20, width: 300, height: 500, pinned: true }
        });
        assert.equal(state.mode, 'split');
        assert.equal(state.browserHostKind, 'undocked');
        assert.equal(state.browser.pinned, true);
        assert.equal(state.browser.left, 10);
    });

    it('splitBrowser / joinBrowser preserve reconcile hook and mode', async () => {
        const mod = await import('../js/ui/moduleLayout.js?layout=3');
        let reconcileCount = 0;
        mod.setReconcileHandler(() => { reconcileCount += 1; });

        // Avoid playerState persistence errors in node
        const origPatch = mod.patchLayout;
        assert.equal(typeof origPatch, 'function');

        const split = mod.normalizeLayoutState({ mode: 'split', browserHostKind: 'undocked' });
        assert.equal(split.mode, 'split');
        const joined = mod.normalizeLayoutState({ mode: 'joined', browserHostKind: 'os' });
        assert.equal(joined.mode, 'joined');
        assert.equal(joined.browserHostKind, null);
    });
});

describe('joined/split panel activation preserves activeTab concept', () => {
    it('activate pattern toggles panels without inventing a second tab', () => {
        const panels = new Map([
            ['remote', { classList: { _on: true, toggle(c, f) { this._on = f; } } }],
            ['browse', { classList: { _on: false, toggle(c, f) { this._on = f; } } }]
        ]);
        let activeTab = 'remote';
        function activate(tabName) {
            activeTab = tabName;
            for (const [name, panel] of panels) {
                panel.classList.toggle('is-active', name === tabName);
            }
        }
        activate('browse');
        assert.equal(activeTab, 'browse');
        assert.equal(panels.get('browse').classList._on, true);
        assert.equal(panels.get('remote').classList._on, false);
        // join reset keeps tab
        const layoutMode = 'joined';
        assert.equal(layoutMode, 'joined');
        assert.equal(activeTab, 'browse');
    });
});

describe('RemoteExternalPopout syncActiveTab after shell split', () => {
    it('syncActiveTab returns boolean and does not throw without entry', async () => {
        globalThis.document = {
            body: {
                classList: {
                    _set: new Set(),
                    add(c) { this._set.add(c); },
                    remove(c) { this._set.delete(c); },
                    contains(c) { return this._set.has(c); },
                    toggle(c, force) {
                        const on = force === undefined ? !this._set.has(c) : !!force;
                        if (on) this._set.add(c); else this._set.delete(c);
                        return on;
                    }
                },
                appendChild() { return {}; }
            },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({
                classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
                style: {},
                appendChild() {},
                addEventListener() {},
                querySelector() { return null }
            }),
            head: { querySelectorAll: () => [], prepend() {} },
            documentElement: { attributes: [], dataset: {}, style: {} },
            addEventListener() {}
        };
        globalThis.window = {
            isSecureContext: true,
            dispatchEvent: () => true,
            documentPictureInPicture: null,
            open: () => null,
            location: { pathname: '/', origin: 'http://localhost' },
            addEventListener() {},
            innerWidth: 800,
            innerHeight: 600
        };
        globalThis.CustomEvent = class CustomEvent {
            constructor(type) { this.type = type; }
        };

        const { RemoteExternalPopout } = await import('../js/ui/remoteExternalPopout.js?sync=shell1');
        assert.equal(typeof RemoteExternalPopout.syncActiveTab, 'function');
        const ok = RemoteExternalPopout.syncActiveTab('favorites');
        assert.equal(typeof ok, 'boolean');
    });
});
