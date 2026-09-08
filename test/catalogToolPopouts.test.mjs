/**
 * Catalog tool popouts: portal open panels to document.body, restore on close.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    openCatalogToolPopout,
    closeCatalogToolPopout,
    isCatalogToolPopoutEventTarget
} from '../js/ui/catalogToolPopouts.js';

function fakeEl(tag = 'div') {
    const classSet = new Set();
    const el = {
        tagName: tag.toUpperCase(),
        parentNode: null,
        nextSibling: null,
        style: {},
        classList: {
            add(...names) { for (const n of names) classSet.add(n); },
            remove(...names) { for (const n of names) classSet.delete(n); },
            contains(n) { return classSet.has(n); }
        },
        closest(sel) {
            if (sel === '.is-catalog-tool-popout' && classSet.has('is-catalog-tool-popout')) return el;
            return null;
        }
    };
    return el;
}

test('open portals panel to body above the anchor; close restores home', () => {
    const home = fakeEl('div');
    const panel = fakeEl('select');
    const btn = fakeEl('button');
    home.appendChild = () => {};
    home.insertBefore = (node) => {
        node.parentNode = home;
    };
    // Simulate original home attachment
    panel.parentNode = home;
    panel.nextSibling = null;

    const appended = [];
    globalThis.document = {
        body: {
            appendChild(node) {
                appended.push(node);
                node.parentNode = this;
            }
        }
    };
    globalThis.window = { innerWidth: 800, innerHeight: 600 };

    btn.getBoundingClientRect = () => ({
        left: 100, top: 400, width: 40, height: 40, right: 140, bottom: 440
    });

    openCatalogToolPopout(panel, btn);
    assert.equal(appended[0], panel);
    assert.ok(panel.classList.contains('is-visible'));
    assert.ok(panel.classList.contains('is-catalog-tool-popout'));
    assert.equal(panel.style.position, 'fixed');
    assert.ok(Number(panel.style.bottom.replace('px', '')) > 0);

    let restored = false;
    home.appendChild = (node) => {
        restored = node === panel;
        node.parentNode = home;
    };
    closeCatalogToolPopout(panel);
    assert.equal(restored, true);
    assert.equal(panel.classList.contains('is-visible'), false);
    assert.equal(panel.classList.contains('is-catalog-tool-popout'), false);

    delete globalThis.document;
    delete globalThis.window;
});

test('isCatalogToolPopoutEventTarget recognizes portaled panels', () => {
    const panel = fakeEl('select');
    panel.classList.add('is-catalog-tool-popout');
    assert.equal(isCatalogToolPopoutEventTarget(panel), true);
    assert.equal(isCatalogToolPopoutEventTarget(null), false);
});
