/**
 * Remote "all" keys — shared sync helpers for the full remote's mosaic keys
 * (#remote-play-all-btn / -stop-all-btn / -mute-all-btn) and the mini floating
 * remote's hover fly-outs (-mini copies). Runs against a tiny document stub.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_ALL_SVG, PAUSE_ALL_SVG } from '../js/ui/tileHoverControls.js';
import {
    remoteAllKeys,
    applyMuteAllTo,
    syncMuteAllKeys,
    syncPlayAllKeys,
    syncStopAllKeys,
    setMuteAllPct
} from '../js/ui/remoteAllKeys.js';

const registry = new Map();
const realDocument = globalThis.document;

globalThis.document = {
    querySelectorAll: (selector) => registry.get(selector) || []
};

after(() => {
    registry.clear();
    globalThis.document = realDocument;
});

function fakeButton() {
    const attrs = new Map();
    const classes = new Set();
    const wave = { style: { opacity: '1' } };
    const slash = {
        attrs: new Map(),
        setAttribute(kind, value) { this.attrs.set(kind, value); },
        getAttribute(kind) { return this.attrs.has(kind) ? this.attrs.get(kind) : null; }
    };
    return {
        title: '',
        innerHTML: 'initial',
        wave,
        slash,
        setAttribute(kind, value) { attrs.set(kind, value); },
        getAttribute(kind) { return attrs.has(kind) ? attrs.get(kind) : null; },
        classList: {
            toggle(name, force) {
                if (force) classes.add(name);
                else classes.delete(name);
            },
            contains(name) { return classes.has(name); }
        },
        querySelector(selector) {
            if (selector.includes('wave')) return wave;
            if (selector.includes('slash')) return slash;
            return null;
        }
    };
}

function stub(kind, ...buttons) {
    registry.set(`[data-remote-all="${kind}"]`, buttons);
    return buttons;
}

test('remoteAllKeys selects only the requested action kind', () => {
    const play = stub('play', fakeButton());
    stub('stop', fakeButton());
    assert.deepEqual(remoteAllKeys('play'), play);
    assert.deepEqual(remoteAllKeys(''), []);
    assert.deepEqual(remoteAllKeys(undefined), []);
});

test('syncPlayAllKeys morphs one key between Play all and Pause all', () => {
    const [full, mini] = stub('play', fakeButton(), fakeButton());

    syncPlayAllKeys(false);
    for (const btn of [full, mini]) {
        assert.equal(btn.title, 'Play all');
        assert.equal(btn.getAttribute('aria-label'), 'Play all');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');
        assert.equal(btn.innerHTML, PLAY_ALL_SVG);
    }

    syncPlayAllKeys(true);
    for (const btn of [full, mini]) {
        assert.equal(btn.title, 'Pause all');
        assert.equal(btn.getAttribute('aria-label'), 'Pause all');
        assert.equal(btn.getAttribute('aria-pressed'), 'true');
        assert.equal(btn.innerHTML, PAUSE_ALL_SVG);
    }
});

test('syncStopAllKeys hides and disables Stop all until something plays', () => {
    const [full, mini] = stub('stop', fakeButton(), fakeButton());

    syncStopAllKeys(false);
    for (const btn of [full, mini]) {
        assert.ok(btn.classList.contains('is-hidden'), 'hidden when nothing plays');
        assert.equal(btn.getAttribute('aria-disabled'), 'true');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');
        assert.equal(btn.title, 'Stop all');
    }

    syncStopAllKeys(true);
    for (const btn of [full, mini]) {
        assert.ok(!btn.classList.contains('is-hidden'), 'shown while playing');
        assert.equal(btn.getAttribute('aria-disabled'), 'false');
        assert.equal(btn.getAttribute('aria-pressed'), 'true');
    }
});

test('syncMuteAllKeys flips label and wave/slash glyph', () => {
    const [full, mini] = stub('mute', fakeButton(), fakeButton());

    syncMuteAllKeys(true);
    for (const btn of [full, mini]) {
        assert.equal(btn.title, 'Unmute all');
        assert.equal(btn.getAttribute('aria-label'), 'Unmute all');
        assert.equal(btn.getAttribute('aria-pressed'), 'true');
        assert.equal(btn.wave.style.opacity, '0');
        assert.equal(btn.slash.getAttribute('opacity'), '1');
    }

    syncMuteAllKeys(false);
    for (const btn of [full, mini]) {
        assert.equal(btn.title, 'Mute all');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');
        assert.equal(btn.wave.style.opacity, '1');
        assert.equal(btn.slash.getAttribute('opacity'), '0');
    }
});

test('applyMuteAllTo drives tile-chrome popout keys too', () => {
    const tileBtn = fakeButton();
    applyMuteAllTo(tileBtn, true);
    assert.equal(tileBtn.title, 'Unmute all');
    assert.equal(tileBtn.slash.getAttribute('opacity'), '1');
    applyMuteAllTo(tileBtn, false);
    assert.equal(tileBtn.title, 'Mute all');
    assert.equal(tileBtn.wave.style.opacity, '1');
});

test('setMuteAllPct writes the master % into every mute-all key', () => {
    const full = { textContent: '' };
    const mini = { textContent: '' };
    registry.set('[data-remote-all-pct="mute"]', [full, mini]);

    setMuteAllPct(85);
    assert.equal(full.textContent, '85');
    assert.equal(mini.textContent, '85');

    setMuteAllPct(84.6);
    assert.equal(full.textContent, '85');
    assert.equal(mini.textContent, '85');

    setMuteAllPct(undefined);
    assert.equal(full.textContent, '0');
});
