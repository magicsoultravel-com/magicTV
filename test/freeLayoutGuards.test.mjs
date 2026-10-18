import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freeLayoutMethods } from '../js/mosaic/freeLayout.js';

const read = (url) => readFileSync(url, 'utf8');

/**
 * Regression: pressing the chan-rocker bind button must not start a tile drag /
 * pointer capture. Capturing the pointer retargets the follow-up `click` to the
 * tile, so the delegated bind-menu toggle on the mosaic never sees the button
 * and the bind options menu never opens.
 */
function makeTarget(chainHits) {
    const tile = {
        classList: { contains: () => false, add() {}, remove() {} },
        style: {},
        captured: [],
        setPointerCapture(id) { this.captured.push(id); },
        releasePointerCapture() {},
        getAttribute: (name) => (name === 'data-slot' ? 'center' : null)
    };
    const target = {
        closest(sel) {
            if (!chainHits.includes(sel)) return null;
            return sel === '.tv-player-tile' ? tile : {};
        }
    };
    return { target, tile };
}

test('pointerdown on the chan rocker bind button does not start a tile drag', () => {
    const origDoc = globalThis.document;
    const origWin = globalThis.window;
    globalThis.document = { getElementById: (id) => (id === 'player-mosaic' ? { dataset: {} } : null) };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    try {
        const { target, tile } = makeTarget([
            '.tv-player-tile__chan-rocker',
            '.tv-player-tile__chan-bind-wrap',
            '.tv-player-tile'
        ]);
        const prevented = [];
        const ctx = { swapBusy: false, slots: { center: { enabled: true } }, dragSession: null };

        freeLayoutMethods.onTilePointerDown.call(ctx, {
            button: 0,
            pointerId: 7,
            clientX: 10,
            clientY: 10,
            target,
            preventDefault: () => prevented.push(true)
        });

        assert.equal(prevented.length, 0, 'chan-rocker press must not preventDefault');
        assert.equal(ctx.dragSession, null, 'chan-rocker press must not open a drag session');
        assert.equal(tile.captured.length, 0, 'tile must not capture the pointer for the chan rocker');

        // Sanity: the same press on bare tile chrome still starts a drag session.
        const { target: bodyTarget, tile: bodyTile } = makeTarget(['.tv-player-tile']);
        freeLayoutMethods.onTilePointerDown.call(ctx, {
            button: 0,
            pointerId: 8,
            clientX: 10,
            clientY: 10,
            target: bodyTarget,
            preventDefault: () => {}
        });
        assert.ok(ctx.dragSession, 'plain tile-body press still starts a drag session');
        assert.equal(bodyTile.captured.length, 1);
    } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
    }
});

test('pointerdown on the chrome grab handle starts a tile drag', () => {
    // A YouTube tile's cross-origin iframe swallows the tile-body pointerdown,
    // so the embed tile is dragged from the grab handle in its hover chrome.
    // That press must bypass the chrome guard without becoming a tile control.
    const origDoc = globalThis.document;
    const origWin = globalThis.window;
    globalThis.document = { getElementById: (id) => (id === 'player-mosaic' ? { dataset: {} } : null) };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    try {
        const ctx = { swapBusy: false, slots: { center: { enabled: true } }, dragSession: null };
        const prevented = [];

        const { target, tile } = makeTarget([
            '[data-tile-drag-handle]',
            '.tv-player-tile__hover',
            '.tv-player-tile'
        ]);
        freeLayoutMethods.onTilePointerDown.call(ctx, {
            button: 0,
            pointerId: 9,
            clientX: 20,
            clientY: 20,
            target,
            preventDefault: () => prevented.push(true)
        });

        assert.equal(prevented.length, 1, 'grab-handle press must preventDefault');
        assert.ok(ctx.dragSession, 'grab-handle press opens a drag session');
        assert.equal(ctx.dragSession.mode, 'drag');
        assert.equal(ctx.dragSession.slotId, 'center');
        assert.equal(ctx.dragSession.dragged, false, 'drag starts only past DRAG_THRESHOLD_PX');
        assert.equal(tile.captured.length, 1, 'the tile captures the pointer');

        // The rest of the chrome still ignores presses, so buttons stay clickable.
        ctx.dragSession = null;
        const { target: chromeTarget } = makeTarget(['.tv-player-tile__hover', '.tv-player-tile']);
        freeLayoutMethods.onTilePointerDown.call(ctx, {
            button: 0,
            pointerId: 10,
            clientX: 20,
            clientY: 20,
            target: chromeTarget,
            preventDefault: () => prevented.push(true)
        });
        assert.equal(prevented.length, 1, 'plain chrome press must not preventDefault');
        assert.equal(ctx.dragSession, null, 'plain chrome press must not open a drag session');
    } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
    }
});

test('tile chan-bind menu override out-specifies the shared .chan-bind-menu base', () => {
    // tv-landing.css imports remote.css (shared .chan-bind-menu base) AFTER
    // player.css, so the tile placement rule must win by specificity, not order.
    const landing = read(new URL('../css/tv-landing.css', import.meta.url));
    const playerIdx = landing.indexOf('@import "./components/player.css"');
    const remoteIdx = landing.indexOf('@import "./components/remote.css"');
    assert.ok(playerIdx !== -1 && remoteIdx !== -1 && playerIdx < remoteIdx,
        'expected import order: player.css before remote.css');

    const player = read(new URL('../css/components/player.css', import.meta.url));
    const match = player.match(/\.chan-bind-menu\.tv-player-tile__chan-bind-menu\s*\{([^}]*)\}/);
    assert.ok(match, 'tile override must double up .chan-bind-menu to out-specify the base');
    const body = match[1];
    for (const decl of [
        'position: absolute',
        'top: 50%',
        'bottom: auto',
        'right: calc(100% + 0.35rem)',
        'left: auto',
        'transform: translateY(-50%)'
    ]) {
        assert.ok(body.includes(decl), `tile override must include ${decl}`);
    }
});
