import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('WingPanel.closeBrowserWing', () => {
    beforeEach(() => {
        const classList = {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            contains(c) { return this._set.has(c); },
            toggle(c, force) {
                const on = force === undefined ? !this._set.has(c) : !!force;
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            }
        };
        globalThis.document = {
            body: { classList },
            getElementById: () => null
        };
        globalThis.window = {
            dispatchEvent: () => true
        };
        globalThis.CustomEvent = class CustomEvent {
            constructor(type, init) {
                this.type = type;
                this.detail = init?.detail;
            }
        };
    });

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.CustomEvent;
    });

    it('drops remote-dock-expanded when leaving browser wing', async () => {
        const { WingPanel } = await import(`../js/ui/wingPanel.js?t=${Date.now()}`);
        WingPanel.init();
        WingPanel.syncForTab('browse');
        assert.equal(WingPanel.isBrowserMode(), true);
        assert.equal(document.body.classList.contains('remote-dock-expanded'), true);
        assert.equal(document.body.classList.contains('remote-wing-mode-browser'), true);

        WingPanel.closeBrowserWing({ silent: true });
        assert.equal(WingPanel.isBrowserMode(), false);
        assert.equal(WingPanel.getMode(), 'closed');
        assert.equal(document.body.classList.contains('remote-dock-expanded'), false);
        assert.equal(document.body.classList.contains('remote-wing-mode-browser'), false);
    });
});
