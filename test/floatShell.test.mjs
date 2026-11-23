import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFloatGestures } from '../js/ui/floatShell.js';

/** Minimal fake `window` that lets a test dispatch pointer events by hand. */
function makeWindow() {
    const handlers = new Map();
    return {
        addEventListener(type, fn) {
            if (!handlers.has(type)) handlers.set(type, new Set());
            handlers.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            handlers.get(type)?.delete(fn);
        },
        dispatch(type, event) {
            for (const fn of [...(handlers.get(type) || [])]) fn(event);
        },
        count(type) {
            return handlers.get(type)?.size || 0;
        }
    };
}

/** Fake element with just the classList surface the shell touches. */
function makeEl() {
    const classes = new Set();
    return {
        classes,
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name)
        },
        querySelectorAll: () => []
    };
}

function withWindow(fn) {
    const origWindow = globalThis.window;
    const win = makeWindow();
    globalThis.window = win;
    try {
        return fn(win);
    } finally {
        globalThis.window = origWindow;
    }
}

function pointer(type, { pointerId = 1, x = 0, y = 0 } = {}) {
    return { type, pointerId, clientX: x, clientY: y, button: 0, preventDefault() {} };
}

test('a drag only moves the window and never touches its size', () => {
    withWindow((win) => {
        const module = makeEl();
        const dialog = makeEl();
        const painted = { left: 100, top: 100, width: 520, height: 560 };
        const applied = [];
        let commits = 0;

        const shell = createFloatGestures({
            getModule: () => module,
            getDialog: () => dialog,
            dragHandleSelector: '[data-drag]',
            resolveModel: () => ({
                kind: 'free',
                minW: 260,
                minH: 420,
                getIntent: () => ({ width: 520, height: 560 }),
                setIntent() {
                    throw new Error('a drag must never write a size');
                }
            }),
            getPaintedBox: () => ({ ...painted }),
            apply: (box) => applied.push(box),
            commit: () => { commits += 1; }
        });

        assert.equal(shell.begin(pointer('pointerdown', { x: 100, y: 100 }), 'drag'), true);
        assert.equal(dialog.classList.contains('is-dragging'), true);

        win.dispatch('pointermove', pointer('pointermove', { x: 160, y: 130 }));
        assert.deepEqual(applied, [{ left: 160, top: 130 }], 'drag forwards a position only');

        win.dispatch('pointerup', pointer('pointerup', { x: 160, y: 130 }));
        assert.equal(commits, 1);
        assert.equal(shell.isActive(), false);
        assert.equal(dialog.classList.contains('is-dragging'), false);
        assert.equal(win.count('pointermove'), 0, 'listeners are released on pointerup');
    });
});

test('a corner resize follows the pointer 1:1 when the frame is not capped', () => {
    withWindow((win) => {
        const applied = [];
        let intent = 1;
        const shell = createFloatGestures({
            getModule: makeEl,
            getDialog: makeEl,
            dragHandleSelector: '[data-drag]',
            resolveModel: () => ({
                kind: 'uniform',
                baseW: 260,
                baseH: 560,
                minScale: 0.5,
                maxScale: 3,
                getIntent: () => intent,
                setIntent: (next) => { intent = next; },
                getPainted: () => intent
            }),
            getPaintedBox: () => ({ left: 100, top: 100, width: 260, height: 560 }),
            apply: (box) => applied.push(box)
        });

        assert.equal(shell.begin(pointer('pointerdown', { x: 360, y: 660 }), 'resize', 'se'), true);
        win.dispatch('pointermove', pointer('pointermove', { x: 386, y: 716 }));

        const dist = (w, h) => Math.hypot(w, h);
        const expected = dist(286, 616) / dist(260, 560);
        assert.ok(Math.abs(intent - expected) < 1e-9, `intent ${intent} should be ${expected}`);
        assert.equal(applied.length, 1);
        assert.equal(applied[0].left, 100, 'the anchored corner stays put');
        assert.equal(applied[0].top, 100);
    });
});

test('resizing a host-capped window scales the intent instead of ratcheting it smaller', () => {
    withWindow((win) => {
        let intent = 1.2; // what the user picked on a big screen
        const paintedScale = 0.5; // what a small host actually fit
        const applied = [];
        const shell = createFloatGestures({
            getModule: makeEl,
            getDialog: makeEl,
            dragHandleSelector: '[data-drag]',
            resolveModel: () => ({
                kind: 'uniform',
                baseW: 260,
                baseH: 560,
                minScale: 0.5,
                maxScale: 3,
                getIntent: () => intent,
                setIntent: (next) => { intent = next; },
                getPainted: () => paintedScale
            }),
            getPaintedBox: () => ({
                left: 100,
                top: 100,
                width: Math.round(260 * paintedScale),
                height: Math.round(560 * paintedScale)
            }),
            apply: (box) => applied.push(box)
        });

        assert.equal(shell.begin(pointer('pointerdown'), 'resize', 'se'), true);
        // Pull the SE corner outward by ~10% of the painted diagonal.
        const w = Math.round(260 * paintedScale);
        const h = Math.round(560 * paintedScale);
        win.dispatch('pointermove', pointer('pointermove', {
            x: Math.round(w * 0.1),
            y: Math.round(h * 0.1)
        }));

        assert.ok(intent > 1.25, `intent must grow with the drag, got ${intent}`);
        assert.ok(intent < 1.45, `intent must stay proportional, got ${intent}`);
    });
});

test('pointerdown is ignored when the module is in a non-float state', () => {
    withWindow(() => {
        const shell = createFloatGestures({
            getModule: makeEl,
            getDialog: makeEl,
            dragHandleSelector: '[data-drag]',
            resolveModel: () => null,
            getPaintedBox: () => ({ left: 0, top: 0, width: 10, height: 10 }),
            apply: () => {}
        });
        assert.equal(shell.begin(pointer('pointerdown'), 'drag'), false);
        assert.equal(shell.isActive(), false);
    });
});
test('cancel() tears a live gesture down without committing', () => {
    withWindow((win) => {
        const module = makeEl();
        const dialog = makeEl();
        let commits = 0;
        const shell = createFloatGestures({
            getModule: () => module,
            getDialog: () => dialog,
            dragHandleSelector: '[data-drag]',
            resolveModel: () => ({
                kind: 'uniform',
                baseW: 260,
                baseH: 560,
                getIntent: () => 1,
                setIntent: () => {},
                getPainted: () => 1
            }),
            getPaintedBox: () => ({ left: 0, top: 0, width: 260, height: 560 }),
            apply: () => {},
            commit: () => { commits += 1; }
        });

        assert.equal(shell.begin(pointer('pointerdown'), 'resize', 'se'), true);
        assert.equal(module.classList.contains('is-resizing'), true);

        shell.cancel();

        assert.equal(shell.isActive(), false);
        assert.equal(module.classList.contains('is-resizing'), false, 'host class is cleared on teardown');
        assert.equal(win.count('pointermove'), 0, 'listeners are released');
        assert.equal(win.count('pointerup'), 0);
        assert.equal(commits, 0, 'an aborted gesture never commits');
    });
});

