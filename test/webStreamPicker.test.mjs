/** Web Video picker overlay: paste → resolve → play, sniff fallback, library. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

function makeEl(tag = 'div') {
    const listeners = new Map();
    const node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        hidden: false,
        disabled: false,
        checked: false,
        open: false,
        value: '',
        textContent: '',
        title: '',
        type: '',
        dataset: {},
        style: {},
        children: [],
        parentElement: null,
        attrs: {},
        classList: {
            _set: new Set(),
            add(...names) { names.forEach((n) => this._set.add(n)); },
            remove(...names) { names.forEach((n) => this._set.delete(n)); },
            toggle(name, force) {
                const on = force === undefined ? !this._set.has(name) : Boolean(force);
                if (on) this._set.add(name);
                else this._set.delete(name);
                return on;
            },
            contains(name) { return this._set.has(name); }
        },
        setAttribute(name, value) { node.attrs[name] = String(value); },
        removeAttribute(name) { delete node.attrs[name]; },
        getAttribute(name) { return name in node.attrs ? node.attrs[name] : null; },
        appendChild(child) {
            node.children.push(child);
            child.parentElement = node;
            return child;
        },
        append(...children) { children.forEach((child) => node.appendChild(child)); },
        replaceChildren(...children) {
            node.children = [];
            children.forEach((child) => node.appendChild(child));
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener() {},
        dispatch(type, event = {}) {
            (listeners.get(type) || []).forEach((fn) => fn(event));
        },
        focus() {},
        closest(selector) {
            const key = selector.replace(/^\[|\]$/g, '');
            if (key.startsWith('data-')) {
                const prop = key
                    .slice('data-'.length)
                    .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                return node.dataset[prop] != null ? node : null;
            }
            return node.id === key.replace(/^#/, '') ? node : null;
        }
    };
    node.dataset = new Proxy({}, {
        set(target, prop, value) {
            target[prop] = value;
            const attr = `data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            node.attrs[attr] = String(value);
            return true;
        },
        get(target, prop) { return target[prop]; }
    });
    return node;
}

const ids = [
    'webstream-picker',
    'webstream-picker-dialog',
    'webstream-picker-title',
    'webstream-picker-form',
    'webstream-picker-input',
    'webstream-picker-add',
    'webstream-picker-error',
    'webstream-picker-status',
    'webstream-picker-sources',
    'webstream-picker-embed-wrap',
    'webstream-picker-embed',
    'webstream-picker-list',
    'webstream-picker-empty',
    'webstream-picker-sniff',
    'webstream-picker-sniff-hint',
    'webstream-picker-sniff-text',
    'webstream-picker-sniff-link',
    'webstream-picker-sniff-open',
    'webstream-picker-sniff-copy',
    'webstream-picker-sniff-apply',
    'webstream-picker-proxy',
    'webstream-picker-proxy-hint',
    'webstream-picker-proxy-playback',
    'webstream-picker-proxy-save',
    'webstream-picker-shield',
    'webstream-picker-shield-hint'
];

let elements;

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i] ?? null
    };
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
        open: () => null
    };
    Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: async () => {} } },
        configurable: true
    });

    elements = new Map(ids.map((id) => [id, makeEl()]));
    elements.get('webstream-picker-error').classList.add('is-hidden');
    elements.get('webstream-picker-status').classList.add('is-hidden');
    elements.get('webstream-picker-sources').classList.add('is-hidden');
    elements.get('webstream-picker-embed-wrap').classList.add('is-hidden');

    globalThis.document = {
        getElementById: (id) => elements.get(id) || null,
        querySelectorAll: () => [],
        createElement: (tag) => makeEl(tag),
        body: makeEl('body'),
        head: makeEl('head'),
        activeElement: null,
        visibilityState: 'visible',
        addEventListener() {}
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});

beforeEach(() => {
    store.clear();
    for (const node of elements.values()) {
        node.children = [];
        node.value = '';
        node.textContent = '';
        node.open = false;
        node.hidden = false;
        node.checked = false;
        node.classList._set.clear();
    }
    elements.get('webstream-picker').hidden = true;
    elements.get('webstream-picker').classList.add('is-hidden');
});

const { WebStreamPicker } = await import('../js/ui/webStreamPicker.js');
const { SettingsStore } = await import('../js/storage/settingsStore.js');
const { loadWebStreamLibrary } = await import('../js/webstream/webStreamLibrary.js');
const {
    addWebStreamItem,
    setWebStreamItemShield
} = await import('../js/webstream/webStreamLibrary.js');

function openWithSpy() {
    const calls = [];
    WebStreamPicker.open({
        slotId: 'topLeft',
        play: (spec) => { calls.push(spec); return Promise.resolve(true); }
    });
    return calls;
}

function stubFetch(html) {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => html });
    return () => { globalThis.fetch = original; };
}

test('open wires the slot label, proxy fields and library', () => {
    SettingsStore.setWebStreamProxyTemplate('https://proxy.tv/?url={url}');
    SettingsStore.setWebStreamProxyPlayback(true);
    openWithSpy();

    assert.equal(elements.get('webstream-picker').hidden, false);
    assert.match(elements.get('webstream-picker-title').textContent, /TV 2/, 'topLeft is TV 2');
    assert.equal(elements.get('webstream-picker-proxy').value, 'https://proxy.tv/?url={url}');
    assert.equal(elements.get('webstream-picker-proxy-playback').checked, true);
    assert.match(elements.get('webstream-picker-sniff-link').getAttribute('href'), /^javascript:/);
    assert.equal(WebStreamPicker.isOpen(), true);
});

test('pasting a direct media URL plays immediately and saves it', async () => {
    const calls = openWithSpy();
    await WebStreamPicker._submitForTest('https://cdn.tv/live/master.m3u8');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'media');
    assert.equal(calls[0].streamUrl, 'https://cdn.tv/live/master.m3u8');
    assert.equal(calls[0].kind, 'hls');
    assert.equal(elements.get('webstream-picker').hidden, true);

    const library = loadWebStreamLibrary().items;
    assert.equal(library.length, 1);
    assert.equal(library[0].streamUrl, 'https://cdn.tv/live/master.m3u8');
});


test('a page is scraped and the best stream is played', async () => {
    const restore = stubFetch('<video src="https://cdn.tv/found.m3u8"></video>');
    try {
        const calls = openWithSpy();
        await WebStreamPicker._submitForTest('site.tv/watch/42');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].streamUrl, 'https://cdn.tv/found.m3u8');
        assert.equal(calls[0].pageUrl, 'https://site.tv/watch/42');
        const library = loadWebStreamLibrary().items;
        assert.equal(library[0].pageUrl, 'https://site.tv/watch/42');
    } finally {
        restore();
    }
});

test('blocked pages expose the sniff panel, embed option and message', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
        const calls = openWithSpy();
        await WebStreamPicker._submitForTest('https://site.tv/watch/42');

        assert.equal(calls.length, 0, 'nothing is played yet');
        assert.equal(elements.get('webstream-picker').hidden, false);
        assert.equal(elements.get('webstream-picker-sniff').open, true);
        assert.equal(elements.get('webstream-picker-embed-wrap').classList.contains('is-hidden'), false);
        assert.match(elements.get('webstream-picker-status').textContent, /sniffer/i);
    } finally {
        globalThis.fetch = original;
    }
});

test('a sniff report lists candidates and clicking one plays it', async () => {
    const calls = openWithSpy();
    WebStreamPicker._sniffForTest({
        pageUrl: 'https://site.tv/watch/42',
        title: 'Clip',
        candidates: [
            { url: 'https://cdn.tv/a.m3u8', kind: 'hls' },
            { url: 'https://cdn.tv/b.mp4', kind: 'video' }
        ]
    });

    const sources = elements.get('webstream-picker-sources');
    assert.equal(sources.children.length, 2);
    assert.equal(sources.classList.contains('is-hidden'), false);
    assert.match(elements.get('webstream-picker-status').textContent, /2 media URLs/);

    const firstBtn = sources.children[0].children[0];
    sources.dispatch('click', { target: firstBtn, preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].streamUrl, 'https://cdn.tv/a.m3u8');
    assert.equal(calls[0].pageUrl, 'https://site.tv/watch/42');
});

test('embed button plays the page in iframe mode', async () => {
    const calls = openWithSpy();
    elements.get('webstream-picker-input').value = 'https://site.tv/watch/42';
    WebStreamPicker._sniffForTest({
        pageUrl: 'https://site.tv/watch/42',
        candidates: [{ url: 'https://cdn.tv/a.mp4', kind: 'video' }]
    });
    elements.get('webstream-picker-embed').dispatch('click', { preventDefault() {} });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'embed');
    assert.equal(calls[0].pageUrl, 'https://site.tv/watch/42');
    assert.equal(calls[0].frameUrl, 'https://site.tv/watch/42');
});

test('invalid input shows an error and keeps the overlay open', async () => {
    const calls = openWithSpy();
    await WebStreamPicker._submitForTest('nonsense');

    assert.equal(calls.length, 0);
    assert.equal(elements.get('webstream-picker').hidden, false);
    assert.equal(elements.get('webstream-picker-error').classList.contains('is-hidden'), false);
    assert.match(elements.get('webstream-picker-error').textContent, /Paste/i);
});


test('saved entries are listed, replayable and removable', () => {
    const calls = openWithSpy();
    WebStreamPicker._sniffForTest({
        pageUrl: 'https://site.tv/watch/42',
        candidates: [{ url: 'https://cdn.tv/a.m3u8', kind: 'hls' }]
    });
    const sourceBtn = elements.get('webstream-picker-sources').children[0].children[0];
    elements.get('webstream-picker-sources').dispatch('click', { target: sourceBtn, preventDefault() {} });
    assert.equal(loadWebStreamLibrary().items.length, 1);

    calls.length = 0;
    WebStreamPicker.open({ slotId: 'center', play: (spec) => { calls.push(spec); return true; } });
    const list = elements.get('webstream-picker-list');
    assert.equal(list.children.length, 1);

    // Pick: replays the saved stream without another page scan.
    list.dispatch('click', { target: list.children[0].children[0], preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].streamUrl, 'https://cdn.tv/a.m3u8');

    WebStreamPicker.open({ slotId: 'center', play: () => {} });
    list.dispatch('click', { target: list.children[0].children[1], preventDefault() {} });
    assert.equal(loadWebStreamLibrary().items.length, 0);
});

test('proxy templates are validated; valid ones drive playback URLs', async () => {
    openWithSpy();
    const proxyInput = elements.get('webstream-picker-proxy');
    proxyInput.value = 'https://proxy.tv/no-token';
    elements.get('webstream-picker-proxy-save').dispatch('click', { preventDefault() {} });
    assert.equal(SettingsStore.getWebStreamProxyTemplate(), '');
    assert.match(elements.get('webstream-picker-proxy-hint').textContent, /token/i);

    proxyInput.value = 'https://proxy.tv/?url={url}';
    elements.get('webstream-picker-proxy-save').dispatch('click', { preventDefault() {} });
    assert.equal(SettingsStore.getWebStreamProxyTemplate(), 'https://proxy.tv/?url={url}');
    assert.match(elements.get('webstream-picker-proxy-hint').textContent, /Saved/i);

    SettingsStore.setWebStreamProxyPlayback(true);
    const calls = [];
    WebStreamPicker.open({ slotId: 'center', play: (spec) => { calls.push(spec); return true; } });
    await WebStreamPicker._submitForTest('https://cdn.tv/a.m3u8');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].streamUrl, 'https://proxy.tv/?url=https://cdn.tv/a.m3u8');
    assert.equal(calls[0].kind, 'hls');
    assert.equal(calls[0].proxied, true);
});

test('page shield select seeds from the setting and ships with the embed spec', () => {
    const calls = openWithSpy();
    const select = elements.get('webstream-picker-shield');
    assert.equal(select.value, 'basic', 'global default is Basic');
    assert.match(elements.get('webstream-picker-shield-hint').textContent, /pop-up/i);

    select.value = 'strict';
    select.dispatch('change', { target: select });
    assert.equal(SettingsStore.getWebStreamShield(), 'strict');
    assert.match(elements.get('webstream-picker-shield-hint').textContent, /forms|referrer/i);

    WebStreamPicker._sniffForTest({
        pageUrl: 'https://site.tv/watch/42',
        candidates: [{ url: 'https://cdn.tv/a.mp4', kind: 'video' }]
    });
    elements.get('webstream-picker-embed').dispatch('click', { preventDefault() {} });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'embed');
    assert.equal(calls[0].shield, 'strict');
    assert.equal(loadWebStreamLibrary().items[0].shield, 'strict', 'saved with the page');
});

test('a saved embed page replays with its own shield level', () => {
    addWebStreamItem({
        pageUrl: 'https://site.tv/watch/8',
        mode: 'embed',
        title: 'Site',
        shield: 'off'
    });
    const calls = openWithSpy();
    const list = elements.get('webstream-picker-list');
    list.dispatch('click', { target: list.children[0].children[0], preventDefault() {} });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'embed');
    assert.equal(calls[0].shield, 'off', 'per-page override beats the global level');
});

test('setWebStreamItemShield updates in place and ignores unknown pages', () => {
    addWebStreamItem({ pageUrl: 'https://a.tv/1', mode: 'embed' });
    addWebStreamItem({ pageUrl: 'https://b.tv/2', mode: 'embed' });
    const order = loadWebStreamLibrary().items.map((item) => item.pageUrl);

    assert.equal(setWebStreamItemShield({ pageUrl: 'https://a.tv/1' }, 'strict'), true);
    const items = loadWebStreamLibrary().items;
    assert.deepEqual(items.map((item) => item.pageUrl), order, 'library order is untouched');
    assert.equal(items.find((item) => item.pageUrl === 'https://a.tv/1').shield, 'strict');
    assert.equal(items.find((item) => item.pageUrl === 'https://b.tv/2').shield, '');

    assert.equal(setWebStreamItemShield({ pageUrl: 'https://a.tv/1' }, 'strict'), false, 'no rewrite');
    assert.equal(setWebStreamItemShield({ pageUrl: 'https://missing.tv/x' }, 'off'), false);
});

