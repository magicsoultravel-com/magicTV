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

    it('shouldUseDocumentPipFor returns false for a different owner when PiP is occupied', async () => {
        const mod = await import('../js/ui/popoutWindows.js?pipOcc=4');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'module', id: 'remote' });
        assert.equal(mod.shouldUseDocumentPipFor({ type: 'module', id: 'browser' }), false);
    });

    it('remotePopoutSize uses popup dimensions when PiP is occupied by another owner', async () => {
        const mod = await import('../js/ui/popoutWindows.js?pipOcc=5');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'module', id: 'browser' });
        const { w, h } = mod.remotePopoutSize();
        assert.equal(w, mod.REMOTE_POPUP_W);
        assert.equal(h, mod.REMOTE_POPUP_H);
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

function createMockStyle(initial = []) {
    /** @type {{ name: string, value: string, priority: string }[]} */
    const props = initial.map(([name, value, priority = '']) => ({ name, value, priority }));

    const style = {
        setProperty(name, value, priority = '') {
            const existing = props.find((p) => p.name === name);
            if (existing) {
                existing.value = value;
                existing.priority = priority;
            } else {
                props.push({ name, value, priority });
            }
        },
        getPropertyValue(name) {
            return props.find((p) => p.name === name)?.value || '';
        },
        getPropertyPriority(name) {
            return props.find((p) => p.name === name)?.priority || '';
        }
    };

    Object.defineProperty(style, 'length', {
        get() { return props.length; },
        enumerable: true
    });

    return new Proxy(style, {
        get(target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                return props[Number(prop)]?.name;
            }
            return target[prop];
        }
    });
}

describe('copyThemeAttributes', () => {
    it('copies data attributes and inline CSS custom properties', async () => {
        const sourceDoc = {
            documentElement: {
                attributes: [
                    { name: 'data-theme', value: 'matrix' },
                    { name: 'data-font', value: 'system' },
                    { name: 'class', value: 'is-booting' }
                ],
                style: createMockStyle([
                    ['--tv-main-1', '#00ff00'],
                    ['--tv-bg', '#111111'],
                    ['font-size', '18px']
                ])
            }
        };
        const targetAttrs = [];
        const targetDoc = {
            documentElement: {
                attributes: targetAttrs,
                setAttribute(name, value) {
                    const existing = targetAttrs.find((a) => a.name === name);
                    if (existing) existing.value = value;
                    else targetAttrs.push({ name, value });
                },
                style: createMockStyle([])
            }
        };

        const mod = await import('../js/ui/popoutWindows.js?copyTheme=1');
        mod.copyThemeAttributes(sourceDoc, targetDoc);

        assert.equal(targetDoc.documentElement.style.getPropertyValue('--tv-main-1'), '#00ff00');
        assert.equal(targetDoc.documentElement.style.getPropertyValue('--tv-bg'), '#111111');
        assert.equal(targetDoc.documentElement.style.getPropertyValue('font-size'), '18px');
        assert.ok(targetAttrs.some((a) => a.name === 'data-theme' && a.value === 'matrix'));
        assert.ok(targetAttrs.some((a) => a.name === 'data-font' && a.value === 'system'));
        assert.ok(targetAttrs.some((a) => a.name === 'class' && a.value === 'is-booting'));
    });
});
