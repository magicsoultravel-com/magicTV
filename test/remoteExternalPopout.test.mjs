import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(tag = 'div', id = '') {
    const node = {
        id,
        tagName: tag.toUpperCase(),
        className: '',
        classList: {
            _set: new Set(),
            add(...cls) { cls.forEach((c) => this._set.add(c)); },
            remove(...cls) { cls.forEach((c) => this._set.delete(c)); },
            contains(c) { return this._set.has(c); },
            toggle(c, force) {
                const on = force === undefined ? !this._set.has(c) : !!force;
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            }
        },
        style: {},
        dataset: {},
        children: [],
        parentElement: null,
        nextSibling: null,
        attributes: {},
        appendChild(child) {
            child.parentElement = node;
            node.children.push(child);
            return child;
        },
        remove() {
            if (node.parentElement) {
                const idx = node.parentElement.children.indexOf(node);
                if (idx >= 0) node.parentElement.children.splice(idx, 1);
            }
            node.parentElement = null;
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { width: 280, height: 640 }; }
    };
    return node;
}

describe('RemoteExternalPopout state', () => {
    beforeEach(() => {
        const host = makeEl('div', 'remote-dock-host');
        const body = makeEl('div', 'tv-catalog-body');
        const start = makeEl('div');
        start.className = 'tv-module__actions tv-module__actions--start';
        const remoteEnd = makeEl('div');
        remoteEnd.className = 'tv-module__actions tv-module__actions--remote-end';
        const browserEnd = makeEl('div');
        browserEnd.className = 'tv-module__actions tv-module__actions--browser-end';
        host.appendChild(start);
        host.appendChild(remoteEnd);
        host.appendChild(browserEnd);
        host.appendChild(body);

        const els = new Map([
            ['tv-catalog-body', body],
            ['remote-dock-host', host],
            ['remote-external-popout-btn', makeEl('button', 'remote-external-popout-btn')]
        ]);

        globalThis.document = {
            body: {
                classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } },
                appendChild() { return {}; }
            },
            head: { querySelectorAll: () => [], prepend() {} },
            documentElement: { attributes: [], dataset: {}, style: {} },
            getElementById: (id) => els.get(id) || null,
            querySelector: () => null,
            querySelectorAll: (sel) => {
                if (sel.includes('actions--start')) return [start];
                if (sel.includes('actions--remote-end')) return [remoteEnd];
                if (sel.includes('actions--browser-end')) return [browserEnd];
                return [];
            },
            createElement: (tag) => makeEl(tag),
            addEventListener() {}
        };

        globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
        globalThis.window = {
            isSecureContext: true,
            dispatchEvent: () => true,
            documentPictureInPicture: null,
            open: () => null,
            location: { pathname: '/', origin: 'http://localhost' },
            addEventListener() {}
        };

        globalThis.CustomEvent = class CustomEvent {
            constructor(type) { this.type = type; }
        };
    });

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.CustomEvent;
    });

    it('starts not popped out', async () => {
        const { RemoteExternalPopout } = await import('../js/ui/remoteExternalPopout.js?state=1');
        assert.equal(RemoteExternalPopout.isPoppedOut(), false);
        assert.equal(RemoteExternalPopout.getPopoutWindow(), null);
    });
});

describe('appDocuments lookup', () => {
    it('getAppElementById searches registered popout documents', async () => {
        const { registerAppDocument, unregisterAppDocument, getAppElementById } = await import('../js/appDocuments.js?docs=1');
        const mainBtn = { id: 'remote-play-btn' };
        globalThis.document = { getElementById: (id) => (id === 'remote-play-btn' ? mainBtn : null) };

        const popDoc = {
            getElementById: (id) => (id === 'remote-mute-btn' ? { id: 'remote-mute-btn' } : null)
        };
        registerAppDocument(popDoc);
        assert.equal(getAppElementById('remote-play-btn'), mainBtn);
        assert.equal(getAppElementById('remote-mute-btn').id, 'remote-mute-btn');
        unregisterAppDocument(popDoc);
        assert.equal(getAppElementById('remote-mute-btn'), null);

        delete globalThis.document;
    });
});
