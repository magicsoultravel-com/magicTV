/** YouTube picker overlay: open, library render, paste-to-play, close. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ID = 'dQw4w9WgXcQ';
const store = new Map();

function makeEl(tag = 'div') {
    const listeners = new Map();
    const node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        hidden: false,
        disabled: false,
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
    // Mirror dataset writes into data-* attributes, like the real DOM.
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
    'youtube-picker',
    'youtube-picker-dialog',
    'youtube-picker-title',
    'youtube-picker-form',
    'youtube-picker-input',
    'youtube-picker-add',
    'youtube-picker-error',
    'youtube-picker-list',
    'youtube-picker-empty'
];

let elements;

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    elements = new Map(ids.map((id) => [id, makeEl()]));
    elements.get('youtube-picker').hidden = true;
    globalThis.document = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => makeEl(tag)
    };
});

beforeEach(() => {
    store.clear();
    elements.get('youtube-picker-list').replaceChildren();
    elements.get('youtube-picker').hidden = true;
    elements.get('youtube-picker-input').value = '';
});

const { YouTubePicker } = await import('../js/ui/youtubePicker.js');

test('open shows the overlay and renders saved clips', () => {
    store.set('magictv_youtube_library_v1', JSON.stringify({
        clips: [{ videoId: ID, title: 'Saved clip', thumb: '', addedAt: 1 }]
    }));

    YouTubePicker.open({ slotId: 'center', start: () => true });

    assert.equal(elements.get('youtube-picker').hidden, false);
    assert.match(elements.get('youtube-picker-title').textContent, /TV 1/);
    const list = elements.get('youtube-picker-list');
    assert.equal(list.children.length, 1);
    assert.equal(elements.get('youtube-picker-empty').classList.contains('is-hidden'), true);

    // Clicking a clip hands the video id + metadata back and closes.
    let picked = null;
    YouTubePicker.open({ slotId: 'topLeft', start: (videoId, meta) => { picked = { videoId, meta }; } });
    const pickBtn = elements.get('youtube-picker-list').children[0].children[0];
    elements.get('youtube-picker-list').dispatch('click', {
        target: pickBtn,
        preventDefault() {}
    });
    assert.equal(elements.get('youtube-picker').hidden, true);
    assert.equal(picked.videoId, ID);
    assert.equal(picked.meta.title, 'Saved clip');
});

test('pasting a link saves it to the library and starts playback', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ title: 'Fresh clip', author_name: 'Someone' })
    });
    try {
        let started = null;
        YouTubePicker.open({
            slotId: 'center',
            start: (videoId, meta) => { started = { videoId, meta }; }
        });
        elements.get('youtube-picker-input').value = `https://youtu.be/${ID}`;
        elements.get('youtube-picker-form').dispatch('submit', { preventDefault() {} });
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.equal(started.videoId, ID);
        assert.equal(started.meta.title, 'Fresh clip');
        const library = loadYouTubeLibrary();
        assert.equal(library.clips.length, 1);
        assert.equal(library.clips[0].title, 'Fresh clip');
        assert.equal(elements.get('youtube-picker-list').children.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('invalid input shows an error and keeps the overlay open', () => {
    let started = false;
    YouTubePicker.open({ slotId: 'center', start: () => { started = true; } });
    elements.get('youtube-picker-input').value = 'https://vimeo.com/12345';
    elements.get('youtube-picker-form').dispatch('submit', { preventDefault() {} });

    assert.equal(started, false);
    assert.equal(elements.get('youtube-picker').hidden, false);
    const error = elements.get('youtube-picker-error');
    assert.equal(error.classList.contains('is-hidden'), false);
    assert.match(error.textContent, /youtube/i);
});

test('remove deletes a clip and a dismiss target closes the overlay', () => {
    store.set('magictv_youtube_library_v1', JSON.stringify({
        clips: [
            { videoId: ID, title: 'One', addedAt: 1 },
            { videoId: 'M7lc1UVf-VE', title: 'Two', addedAt: 2 }
        ]
    }));
    YouTubePicker.open({ slotId: 'center', start: () => true });
    const list = elements.get('youtube-picker-list');
    assert.equal(list.children.length, 2);

    const removeBtn = list.children[0].children[1];
    list.dispatch('click', { target: removeBtn, preventDefault() {} });
    assert.equal(loadYouTubeLibrary().clips.length, 1);

    const dismiss = makeEl('div');
    dismiss.dataset.youtubePickerDismiss = '';
    elements.get('youtube-picker').dispatch('click', { target: dismiss, preventDefault() {} });
    assert.equal(elements.get('youtube-picker').hidden, true);
});

test('empty library shows the empty hint', () => {
    YouTubePicker.open({ slotId: 'center', start: () => true });
    assert.equal(elements.get('youtube-picker-list').children.length, 0);
    assert.equal(elements.get('youtube-picker-empty').classList.contains('is-hidden'), false);
});

const { loadYouTubeLibrary } = await import('../js/youtube/youtubeLibrary.js');
