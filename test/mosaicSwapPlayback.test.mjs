/**
 * Mosaic tile swap: preserve per-stream play state (never resume stopped).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    shouldResumeAfterSwap,
    captureSwapPlaybackState,
    resolveSwapPlaybackAction,
    applySwapPlaybackContinuity
} from '../js/mosaic/swapPlayback.js';
import { clearSwapClasses } from '../js/mosaic/constants.js';
import { TILE_SWAP_DURATIONS } from '../js/ui/viewTransitions.js';

test('shouldResumeAfterSwap only when was playing and not stopped', () => {
    assert.equal(shouldResumeAfterSwap({ wasPlaying: true, stopped: false }), true);
    assert.equal(shouldResumeAfterSwap({ wasPlaying: true, stopped: true }), false);
    assert.equal(shouldResumeAfterSwap({ wasPlaying: false, stopped: false }), false);
    assert.equal(shouldResumeAfterSwap({ wasPlaying: false, stopped: true }), false);
});

test('captureSwapPlaybackState reads playing and stopped', () => {
    assert.deepEqual(captureSwapPlaybackState({ playing: true, stopped: false }), {
        wasPlaying: true,
        stopped: false
    });
    assert.deepEqual(captureSwapPlaybackState({ playing: false, stopped: true }), {
        wasPlaying: false,
        stopped: true
    });
    assert.deepEqual(captureSwapPlaybackState(null), {
        wasPlaying: false,
        stopped: false
    });
});

test('matrix: playing ↔ stopped — stopped stream must not resume', () => {
    const playingBefore = { wasPlaying: true, stopped: false };
    const stoppedBefore = { wasPlaying: false, stopped: true };

    // After identity swap, stopped player lands in center with channel still set
    const stoppedPlayer = { playing: false, stopped: true, channel: { name: 'A' }, posterDataUrl: 'x' };
    assert.deepEqual(resolveSwapPlaybackAction(stoppedBefore, stoppedPlayer), {
        clearPoster: false,
        resume: false
    });

    const livePlayer = { playing: false, stopped: false, channel: { name: 'B' }, posterDataUrl: 'y' };
    assert.deepEqual(resolveSwapPlaybackAction(playingBefore, livePlayer), {
        clearPoster: true,
        resume: true
    });
});

test('matrix: playing ↔ paused — paused stays paused', () => {
    const pausedBefore = { wasPlaying: false, stopped: false };
    const pausedPlayer = { playing: false, channel: { name: 'P' } };
    assert.deepEqual(resolveSwapPlaybackAction(pausedBefore, pausedPlayer), {
        clearPoster: false,
        resume: false
    });
});

test('matrix: playing ↔ playing — resume only if remount dropped play', () => {
    const before = { wasPlaying: true, stopped: false };
    assert.deepEqual(
        resolveSwapPlaybackAction(before, { playing: true, channel: { name: 'L' } }),
        { clearPoster: true, resume: false }
    );
    assert.deepEqual(
        resolveSwapPlaybackAction(before, { playing: false, channel: { name: 'L' } }),
        { clearPoster: true, resume: true }
    );
});

test('matrix: stopped ↔ paused — neither resumes', () => {
    assert.equal(
        resolveSwapPlaybackAction(
            { wasPlaying: false, stopped: true },
            { playing: false, channel: { name: 'S' } }
        ).resume,
        false
    );
    assert.equal(
        resolveSwapPlaybackAction(
            { wasPlaying: false, stopped: false },
            { playing: false, channel: { name: 'P' } }
        ).resume,
        false
    );
});

test('applySwapPlaybackContinuity uses player identity not slot', () => {
    const calls = [];
    const stopped = {
        playing: false,
        stopped: true,
        channel: { name: 'Stopped' },
        posterDataUrl: 'poster',
        resume() { calls.push('stopped'); }
    };
    const live = {
        playing: false,
        stopped: false,
        channel: { name: 'Live' },
        posterDataUrl: 'live',
        resume() { calls.push('live'); }
    };

    // Simulate old bug inputs: "center was playing" applied to wrong player
    applySwapPlaybackContinuity({ wasPlaying: false, stopped: true }, stopped);
    applySwapPlaybackContinuity({ wasPlaying: true, stopped: false }, live);

    assert.deepEqual(calls, ['live']);
    assert.equal(stopped.posterDataUrl, 'poster');
    assert.equal(live.posterDataUrl, null);
});

test('clearSwapClasses removes every TILE_SWAP_DURATIONS mode class', () => {
    const classes = new Set([
        'tv-swap-out',
        'tv-swap-in',
        'is-swapping',
        ...Object.keys(TILE_SWAP_DURATIONS).map((mode) => `tv-swap--${mode}`)
    ]);
    const tile = {
        classList: {
            remove(...names) {
                for (const name of names) classes.delete(name);
            }
        }
    };
    clearSwapClasses(tile);
    assert.equal(classes.size, 0);
    // Explicitly cover modes that used to stick after swap cleanup.
    for (const mode of ['glitch', 'slideleft', 'slideright', 'spiralin', 'spiralout']) {
        assert.ok(Object.hasOwn(TILE_SWAP_DURATIONS, mode));
    }
});
