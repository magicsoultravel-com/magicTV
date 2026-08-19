import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function installGlobals() {
    globalThis.window = {
        isSecureContext: true,
        documentPictureInPicture: {
            requestWindow: async () => ({
                closed: false,
                document: {
                    head: { prepend() {}, querySelectorAll: () => [] },
                    documentElement: { dataset: {} },
                    body: { className: '', innerHTML: '' }
                },
                addEventListener() {}
            })
        },
        location: { pathname: '/index.html', origin: 'http://localhost' }
    };
    globalThis.document = {
        head: { querySelectorAll: () => [], prepend() {} },
        documentElement: { attributes: [], dataset: {}, style: {} }
    };
}

describe('popoutWindows PiP occupancy', () => {
    beforeEach(() => {
        installGlobals();
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
    });

    it('starts unoccupied', async () => {
        const mod = await import('../js/ui/popoutWindows.js?pipOcc=1');
        assert.equal(mod.isPipOccupied(), false);
    });

    it('tracks a single active PiP window per tab', async () => {
        const mod = await import('../js/ui/popoutWindows.js?pipOcc=2');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'module', id: 'remote' });
        assert.equal(mod.isPipOccupied(), true);
        assert.deepEqual(mod.getActivePipOwner(), { type: 'module', id: 'remote' });
        mod.unregisterPipWindow(win);
        assert.equal(mod.isPipOccupied(), false);
    });

    it('requestPipWindow returns null when PiP is already occupied', async () => {
        const mod = await import('../js/ui/popoutWindows.js?pipOcc=3');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'module', id: 'other' });
        const next = await mod.requestPipWindow({
            width: 280,
            height: 640,
            owner: { type: 'module', id: 'remote' }
        });
        assert.equal(next, null);
    });
});

describe('popoutWindows auto mode', () => {
    beforeEach(() => {
        installGlobals();
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
    });

    it('shouldUseDocumentPipFor follows Document PiP support', async () => {
        const mod = await import('../js/ui/popoutWindows.js?auto=1');
        assert.equal(mod.shouldUseDocumentPipFor({ type: 'module', id: 'remote' }), true);
        delete globalThis.window.documentPictureInPicture;
        assert.equal(mod.shouldUseDocumentPipFor({ type: 'module', id: 'remote' }), false);
    });

    it('browserPopupFeatures builds expected feature string', async () => {
        const mod = await import('../js/ui/popoutWindows.js?auto=2');
        assert.equal(
            mod.browserPopupFeatures(280, 640),
            'popup=yes,width=280,height=640,menubar=no,toolbar=no,location=no,status=no'
        );
    });

    it('windowNameForRemote is stable', async () => {
        const mod = await import('../js/ui/popoutWindows.js?auto=3');
        assert.equal(mod.windowNameForRemote(), 'magictv-remote');
    });
});
