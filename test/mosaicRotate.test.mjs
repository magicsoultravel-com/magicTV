/**
 * Mosaic rotation: ring order, move list, pointer permutation, and commit wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeRotationRing,
    buildRotationMoves,
    applyRotationMoves,
    rotateMethods
} from '../js/mosaic/rotate.js';

/** Slot map factory — enabled flags per TV 1..6 (center + corners). */
function makeSlots(enabled = ['center'], players = {}) {
    return {
        center: { id: 'center', enabled: enabled.includes('center'), player: players.center ?? null },
        topLeft: { id: 'topLeft', enabled: enabled.includes('topLeft'), player: players.topLeft ?? null },
        topRight: { id: 'topRight', enabled: enabled.includes('topRight'), player: players.topRight ?? null },
        bottomLeft: { id: 'bottomLeft', enabled: enabled.includes('bottomLeft'), player: players.bottomLeft ?? null },
        bottomRight: { id: 'bottomRight', enabled: enabled.includes('bottomRight'), player: players.bottomRight ?? null },
        bottomCenter: { id: 'bottomCenter', enabled: enabled.includes('bottomCenter'), player: players.bottomCenter ?? null }
    };
}

function player(name) {
    return {
        id: '?',
        channel: { providerId: 'iptv-org', channelId: name.toLowerCase(), name },
        playing: true,
        stopped: false,
        emitStateCalls: 0,
        resumeCalls: 0,
        emitState() { this.emitStateCalls += 1; },
        resume() { this.resumeCalls += 1; }
    };
}

test('computeRotationRing keeps TV screen-label order (1..6) and needs a player', () => {
    const slots = makeSlots(
        ['bottomCenter', 'center', 'topRight', 'topLeft'],
        { center: player('A'), topRight: player('C'), topLeft: player('B'), bottomCenter: player('F') }
    );
    assert.deepEqual(computeRotationRing(slots), ['center', 'topLeft', 'topRight', 'bottomCenter']);
});

test('computeRotationRing skips enabled slots without players', () => {
    const slots = makeSlots(['center', 'topLeft'], { center: player('A') });
    assert.deepEqual(computeRotationRing(slots), ['center']);
});

test('computeRotationRing handles missing/empty slot maps', () => {
    assert.deepEqual(computeRotationRing(null), []);
    assert.deepEqual(computeRotationRing({}), []);
});

test('buildRotationMoves: 1 becomes 2, 2 becomes 3, final becomes 1', () => {
    const ring = ['center', 'topLeft', 'topRight'];
    assert.deepEqual(buildRotationMoves(ring), [
        { from: 'center', to: 'topLeft' },
        { from: 'topLeft', to: 'topRight' },
        { from: 'topRight', to: 'center' }
    ]);
});

test('buildRotationMoves: fewer than two TVs means no rotation', () => {
    assert.deepEqual(buildRotationMoves([]), []);
    assert.deepEqual(buildRotationMoves(['center']), []);
    assert.deepEqual(buildRotationMoves(undefined), []);
});

test('applyRotationMoves permutes players along the ring', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const slots = makeSlots(['center', 'topLeft', 'topRight'], { center: a, topLeft: b, topRight: c });
    const moves = buildRotationMoves(['center', 'topLeft', 'topRight']);

    const next = applyRotationMoves(slots, moves);

    // TV 1 gets the last TV's channel; TV 2 gets TV 1's; TV 3 gets TV 2's.
    assert.equal(next.center.player, c);
    assert.equal(next.topLeft.player, a);
    assert.equal(next.topRight.player, b);
    // Original map untouched (commitRotation relies on snapshots taken up front).
    assert.equal(slots.center.player, a);
    assert.equal(slots.topLeft.player, b);
    assert.equal(slots.topRight.player, c);
});

test('applyRotationMoves is order-safe for chained moves', () => {
    // A naive in-place loop would clobber B before it is read as a source.
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const slots = makeSlots(['center', 'topLeft', 'topRight'], { center: a, topLeft: b, topRight: c });
    const next = applyRotationMoves(slots, buildRotationMoves(['center', 'topLeft', 'topRight']));
    assert.deepEqual(
        [next.center.player, next.topLeft.player, next.topRight.player],
        [c, a, b]
    );
});

test('applyRotationMoves keeps non-ring slots and empty players intact', () => {
    const a = player('A');
    const slots = makeSlots(['center', 'topRight'], { center: a });
    const next = applyRotationMoves(slots, buildRotationMoves(['center', 'topRight']));
    assert.equal(next.center.player, null);
    assert.equal(next.topRight.player, a);
    assert.equal(next.bottomLeft.player, null);
    assert.equal(next.bottomLeft.enabled, false);
});

test('getRotationRing reads live MultiView slots', () => {
    const ctx = {
        slots: makeSlots(['center', 'bottomRight'], { center: player('A'), bottomRight: player('E') })
    };
    assert.deepEqual(rotateMethods.getRotationRing.call(ctx), ['center', 'bottomRight']);
});

test('commitRotation rewires pointers, ids, stub keys and broadcasts', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const slots = makeSlots(['center', 'topLeft', 'topRight'], { center: a, topLeft: b, topRight: c });
    const calls = { mountAll: 0, persist: 0, refresh: 0 };

    const ctx = {
        slots,
        rememberedSlotKeys: {
            center: 'iptv-org:stale',
            topLeft: 'iptv-org:stale-b',
            bottomLeft: 'iptv-org:not-in-ring'
        },
        mountAll() { calls.mountAll += 1; },
        persistSlots() { calls.persist += 1; },
        scheduleRefreshTiles() { calls.refresh += 1; },
        syncScreenControls() {}
    };

    const dispatched = [];
    globalThis.window = { dispatchEvent: (evt) => dispatched.push(evt) };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };

    try {
        assert.equal(rotateMethods.commitRotation.call(ctx), true);

        // Channel assignment rotated: 1→2, 2→3, 3→1.
        assert.equal(slots.topLeft.player, a);
        assert.equal(slots.topRight.player, b);
        assert.equal(slots.center.player, c);
        // Player ids follow their new slot (mountVideo targets depend on it).
        assert.equal(a.id, 'topLeft');
        assert.equal(b.id, 'topRight');
        assert.equal(c.id, 'center');
        // Stub keys realigned with the channels that LANDED in each slot;
        // entries outside the ring (e.g. a disabled slot) stay untouched.
        assert.deepEqual(ctx.rememberedSlotKeys, {
            center: 'iptv-org:c',
            topLeft: 'iptv-org:a',
            topRight: 'iptv-org:b',
            bottomLeft: 'iptv-org:not-in-ring'
        });
        // Every live stream resumes after remount; state emitted per moved player.
        assert.equal(a.resumeCalls + b.resumeCalls + c.resumeCalls, 0); // still playing
        assert.equal(a.emitStateCalls + b.emitStateCalls + c.emitStateCalls, 3);
        assert.equal(calls.mountAll, 1);
        assert.equal(calls.persist, 1);
        assert.equal(calls.refresh, 1);
        assert.equal(dispatched.length, 1);
        assert.equal(dispatched[0].type, 'tv:multiview_changed');
        assert.deepEqual(dispatched[0].detail, { primary: 'center', rotated: true });
    } finally {
        delete globalThis.window;
        delete globalThis.CustomEvent;
    }
});

test('commitRotation resumes remounted streams and refuses single-TV rings', () => {
    const a = player('A');
    // Simulate a remount that dropped playback (browser reparent pause).
    const b = player('B');
    b.playing = false;
    b.posterDataUrl = 'poster';
    const slots = makeSlots(['center', 'topLeft'], { center: a, topLeft: b });

    const ctx = {
        slots,
        rememberedSlotKeys: {},
        mountAll() {
            // mountVideo moves each <video>: browsers can drop play state.
            Object.values(slots).forEach((slot) => { if (slot.player) slot.player.playing = false; });
        },
        persistSlots() {},
        scheduleRefreshTiles() {},
        syncScreenControls() {}
    };

    assert.equal(rotateMethods.commitRotation.call(ctx), true);
    // TV 1's stream landed on TV 2 and must keep playing.
    assert.equal(slots.topLeft.player, a);
    assert.equal(a.resumeCalls, 1);
    assert.equal(a.posterDataUrl, null);
    // TV 2 had no stream playing — it must stay paused with its poster kept.
    assert.equal(slots.center.player, b);
    assert.equal(b.resumeCalls, 0);
    assert.equal(b.posterDataUrl, 'poster');

    // Single TV → no rotation, no side effects.
    const solo = makeSlots(['center'], { center: player('A') });
    const soloCtx = {
        slots: solo,
        rememberedSlotKeys: {},
        mountAll() { throw new Error('must not remount'); },
        persistSlots() { throw new Error('must not persist'); },
        scheduleRefreshTiles() { throw new Error('must not refresh'); }
    };
    assert.equal(rotateMethods.commitRotation.call(soloCtx), false);
});