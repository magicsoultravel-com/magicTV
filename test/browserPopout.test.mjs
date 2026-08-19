import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('BrowserPopout in-page state', () => {
    beforeEach(() => {
        globalThis.document = {
            body: { classList: { _set: new Set(), add() {}, remove() {}, contains: () => false, toggle() {} } },
            documentElement: { clientWidth: 800, clientHeight: 600 },
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
            createElement: () => ({ style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } }),
            addEventListener: () => {}
        };
        globalThis.window = {
            innerWidth: 800,
            innerHeight: 600,
            addEventListener: () => {},
            removeEventListener: () => {}
        };
    });

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.window;
    });

    it('starts closed', async () => {
        const { BrowserPopout } = await import('../js/ui/browserPopout.js?inpage=1');
        assert.equal(BrowserPopout.isOpen(), false);
    });
});

describe('BrowserExternalPopout state', () => {
    it('starts not popped out', async () => {
        const { BrowserExternalPopout } = await import('../js/ui/browserExternalPopout.js?ext=1');
        assert.equal(BrowserExternalPopout.isPoppedOut(), false);
    });
});
