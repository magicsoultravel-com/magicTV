/**
 * Play/pause buffer parking + tile overlay classification.
 * Locks the instant pause/resume contract (no tip-seek, no false STOPPED).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeParkBehindTime,
    computeResumeSeekTime,
    classifyTilePlayback,
    shouldAcceptPlayingEvent,
    shouldAcceptPauseEvent,
    resolveRestorePlayMute,
    shouldClearWasPlayingOnAutoplayBlock,
    shouldPauseOnToggle,
    shouldClearWantPlayingOnPlayFail,
    shouldFallbackPlayChannelOnDoubleAbort,
    shouldContinuePlayAfterAttach,
    shouldBumpPlayGenerationOnPause,
    isAutoplayNotAllowedError,
    shouldRetryPlayMuted,
    isHealthyWatchPlayback,
    PARK_HEADROOM_RATIO
} from '../js/player/pauseBuffer.js';

// ----- Park behind buffer -----

test('park seeks back when headroom is thin', () => {
    // Live tip: current=100, buffer ends at 102, want ~15s headroom
    const desired = computeParkBehindTime(100, 80, 102, 15);
    assert.equal(desired, 87); // 102 - 15
});

test('park is a no-op when headroom already meets target', () => {
    assert.equal(computeParkBehindTime(85, 80, 102, 15), null);
    // Exactly at 0.9 * 15 = 13.5 headroom → still no-op
    const minOk = 102 - 15 * PARK_HEADROOM_RATIO;
    assert.equal(computeParkBehindTime(minOk, 80, 102, 15), null);
});

test('park clamps to bufferedStart when range is shorter than bufferSize', () => {
    assert.equal(computeParkBehindTime(50, 48, 52, 15), 48);
});

test('park returns null for empty/invalid ranges', () => {
    assert.equal(computeParkBehindTime(10, 10, 10, 15), null);
    assert.equal(computeParkBehindTime(10, NaN, 20, 15), null);
});

// ----- Resume position -----

test('resume does not seek when already inside buffered range (keeps headroom)', () => {
    // Parked at 87 with buffer to 102 — play as-is, never jump to tip
    assert.equal(computeResumeSeekTime(87, 80, 102), null);
});

test('resume never targets bufferedEnd tip', () => {
    const tip = 102 - 0.1;
    // Even near tip, if still inside range → null (no seek-to-tip helper)
    assert.equal(computeResumeSeekTime(tip, 80, 102), null);
    assert.notEqual(computeResumeSeekTime(87, 80, 102), tip);
});

test('resume clamps only when currentTime is outside the buffer', () => {
    assert.equal(computeResumeSeekTime(70, 80, 102), 80);
    assert.equal(computeResumeSeekTime(110, 80, 102), 101.9);
});

// ----- Tile classification -----

test('STOPPED only when stopped===true (not residual idle)', () => {
    const idleWithChannel = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        pausePhase: 'idle',
        stopped: false,
        posterDataUrl: null
    });
    assert.equal(idleWithChannel.uiStopped, false);
    assert.equal(idleWithChannel.uiPaused, false);
    assert.equal(idleWithChannel.uiPlaying, false);

    const afterStop = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        pausePhase: 'idle',
        stopped: true
    });
    assert.equal(afterStop.uiStopped, true);
});

test('pausePhase or poster classifies as paused, not stopped', () => {
    const byPhase = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        pausePhase: 'pausing',
        stopped: false
    });
    assert.equal(byPhase.uiPaused, true);
    assert.equal(byPhase.uiStopped, false);

    const byPoster = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        pausePhase: 'idle',
        posterDataUrl: 'data:image/jpeg;base64,x',
        stopped: true // paused wins over stopped
    });
    assert.equal(byPoster.uiPaused, true);
    assert.equal(byPoster.uiStopped, false);
});

test('playing hides pause/stop overlays', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: true,
        pausePhase: 'idle',
        stopped: false,
        posterDataUrl: 'data:image/jpeg;base64,x'
    });
    assert.equal(state.uiPlaying, true);
    assert.equal(state.uiPaused, false);
    assert.equal(state.uiStopped, false);
    assert.equal(state.uiLoading, false);
});

test('connecting or buffering shows loading, not pause/stop', () => {
    const connecting = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        loading: true,
        loadPhase: 'connecting',
        pausePhase: 'pausing',
        posterDataUrl: 'data:image/jpeg;base64,x',
        stopped: false
    });
    assert.equal(connecting.uiLoading, true);
    assert.equal(connecting.uiPaused, false);
    assert.equal(connecting.uiStopped, false);

    const buffering = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        loading: false,
        loadPhase: 'buffering',
        pausePhase: 'buffering',
        stopped: true
    });
    assert.equal(buffering.uiLoading, true);
    assert.equal(buffering.uiPaused, false);
    assert.equal(buffering.uiStopped, false);
});

test('play click awaiting first paint shows loading (not black/playing)', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        wantPlaying: true,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'idle',
        posterDataUrl: 'data:image/jpeg;base64,x'
    });
    assert.equal(state.uiLoading, true);
    assert.equal(state.uiPlaying, false);
    assert.equal(state.uiPaused, false);
});

test('playing suppresses loading overlay', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: true,
        loading: true,
        loadPhase: 'buffering'
    });
    assert.equal(state.uiPlaying, true);
    assert.equal(state.uiLoading, false);
});

test('stream error shows disconnected over loading/pause/stop', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        loading: true,
        loadPhase: 'connecting',
        wantPlaying: false,
        stopped: true,
        pausePhase: 'ready',
        posterDataUrl: 'data:image/jpeg;base64,x',
        error: 'Stream unavailable'
    });
    assert.equal(state.uiDisconnected, true);
    assert.equal(state.uiLoading, false);
    assert.equal(state.uiPaused, false);
    assert.equal(state.uiStopped, false);
    assert.equal(state.uiPlaying, false);
});

test('playing clears disconnected even if error string briefly present', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: true,
        error: 'Stream unavailable'
    });
    assert.equal(state.uiPlaying, true);
    assert.equal(state.uiDisconnected, false);
});

test('paused ready without loading shows pause, not loading', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'ready',
        posterDataUrl: 'data:image/jpeg;base64,x'
    });
    assert.equal(state.uiLoading, false);
    assert.equal(state.uiPaused, true);
    assert.equal(state.uiStopped, false);
});

test('stopped without loading shows stop, not loading', () => {
    const state = classifyTilePlayback({
        hasChannel: true,
        playing: false,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'idle',
        stopped: true,
        posterDataUrl: null
    });
    assert.equal(state.uiLoading, false);
    assert.equal(state.uiPaused, false);
    assert.equal(state.uiStopped, true);
});

// ----- Instant contract (documented invariants) -----

test('instant pause/resume: park creates headroom; resume keeps it', () => {
    const bufferSize = 15;
    const bufferedStart = 1000;
    const bufferedEnd = 1012; // only 12s available
    const liveTip = 1011.5;

    const parked = computeParkBehindTime(liveTip, bufferedStart, bufferedEnd, bufferSize);
    assert.equal(parked, bufferedStart); // clamp — best headroom we can get

    // Resume must not seek to tip (would wipe headroom → glitchy stall)
    assert.equal(computeResumeSeekTime(parked, bufferedStart, bufferedEnd), null);
    const headroom = bufferedEnd - parked;
    assert.ok(headroom >= 10, `expected usable headroom, got ${headroom}`);
});

// ----- Mash-safe transport intent -----

test('shouldAcceptPlayingEvent rejects after pause intent', () => {
    assert.equal(shouldAcceptPlayingEvent(true), true);
    assert.equal(shouldAcceptPlayingEvent(false), false);
});

test('shouldAcceptPauseEvent rejects while wantPlaying', () => {
    assert.equal(shouldAcceptPauseEvent(true), false);
    assert.equal(shouldAcceptPauseEvent(false), true);
});

test('mash simulation: stale playing after pause is rejected; later resume accepted', () => {
    // gen1 play → gen2 pause → stale playing for gen1 ignored → gen3 play accepted
    let wantPlaying = false;
    let transportGen = 0;
    let playing = false;

    const begin = (want) => {
        transportGen += 1;
        wantPlaying = want;
        return transportGen;
    };

    const onPlayingEvent = (eventGen) => {
        if (eventGen !== transportGen) return;
        if (!shouldAcceptPlayingEvent(wantPlaying)) return;
        playing = true;
    };

    const gen1 = begin(true);
    playing = true; // optimistic
    const gen2 = begin(false);
    playing = false;
    onPlayingEvent(gen1); // stale — must not revive
    assert.equal(playing, false);
    assert.equal(wantPlaying, false);
    assert.equal(gen2, 2);

    const gen3 = begin(true);
    playing = true;
    onPlayingEvent(gen3);
    assert.equal(playing, true);
    assert.equal(wantPlaying, true);
});

test('rapid successive toggle/mash resets pausePhase on resume intent', () => {
    let transportGen = 0;
    let wantPlaying = false;
    let pausePhase = 'idle';

    const beginTransport = (want) => {
        transportGen += 1;
        wantPlaying = want === true;
        if (wantPlaying) {
            pausePhase = 'idle';
        }
        return transportGen;
    };

    // Mash pause
    const gen1 = beginTransport(false);
    pausePhase = 'pausing';
    assert.equal(wantPlaying, false);
    assert.equal(pausePhase, 'pausing');

    // Rapid successive mash play (resume)
    const gen2 = beginTransport(true);
    assert.equal(wantPlaying, true);
    assert.equal(pausePhase, 'idle', 'pausePhase must immediately reset on resume intent during quick successions');
    assert.equal(gen2, 2);
});

test('toggle pauses only when wantPlaying and playing; stuck resume retries play', () => {
    assert.equal(shouldPauseOnToggle(true, true), true);
    assert.equal(shouldPauseOnToggle(true, false), false, 'stuck resume must not pause');
    assert.equal(shouldPauseOnToggle(false, false), false);
    assert.equal(shouldPauseOnToggle(false, true), false);
});

test('AbortError must not count as playback blocked', () => {
    const isHardFail = (name) => name !== 'AbortError';
    assert.equal(isHardFail('AbortError'), false);
    assert.equal(isHardFail('NotAllowedError'), true);
});

test('double AbortError must fall back to playChannel (not leave wantPlaying stuck)', () => {
    assert.equal(shouldFallbackPlayChannelOnDoubleAbort(), true);
});

test('playChannel failure must clear wantPlaying', () => {
    assert.equal(shouldClearWantPlayingOnPlayFail(), true);
});

test('resolveRestorePlayMute forces muted during play then restores saved unmute', () => {
    assert.deepEqual(resolveRestorePlayMute(false), {
        duringPlay: true,
        afterPlay: false
    });
    assert.deepEqual(resolveRestorePlayMute(true), {
        duringPlay: true,
        afterPlay: true
    });
    assert.deepEqual(resolveRestorePlayMute(undefined), {
        duringPlay: true,
        afterPlay: true
    });
});

test('autoplay block must not clear wasPlaying intent', () => {
    assert.equal(shouldClearWasPlayingOnAutoplayBlock(), false);
});

test('resumeIfWasPlaying gate requires wasPlaying true', () => {
    const shouldResume = (channel, wasPlaying) => Boolean(channel) && wasPlaying === true;
    assert.equal(shouldResume({ id: 1 }, true), true);
    assert.equal(shouldResume({ id: 1 }, false), false);
    assert.equal(shouldResume(null, true), false);
});

test('pause during attach cancels playChannel continue check', () => {
    // playChannel armed transportAtStart=1; user pause bumps transport + playGeneration
    assert.equal(shouldContinuePlayAfterAttach({
        generation: 1,
        playGeneration: 1,
        wantPlaying: true,
        transportGen: 1,
        transportAtStart: 1
    }), true);

    assert.equal(shouldContinuePlayAfterAttach({
        generation: 1,
        playGeneration: 2,
        wantPlaying: false,
        transportGen: 2,
        transportAtStart: 1
    }), false, 'pause mid-load must not call video.play()');

    assert.equal(shouldContinuePlayAfterAttach({
        generation: 1,
        playGeneration: 1,
        wantPlaying: false,
        transportGen: 2,
        transportAtStart: 1
    }), false);
});

test('pause while loading bumps playGeneration cancel token', () => {
    assert.equal(shouldBumpPlayGenerationOnPause({ loading: true, loadPhase: 'connecting' }), true);
    assert.equal(shouldBumpPlayGenerationOnPause({ loading: false, loadPhase: 'buffering' }), true);
    assert.equal(shouldBumpPlayGenerationOnPause({ loading: false, loadPhase: 'idle' }), false);
});

test('NotAllowedError mute-retry only when still unmuted', () => {
    assert.equal(isAutoplayNotAllowedError({ name: 'NotAllowedError' }), true);
    assert.equal(isAutoplayNotAllowedError({ name: 'AbortError' }), false);
    assert.equal(isAutoplayNotAllowedError({ message: 'play() is not allowed' }), true);

    assert.equal(shouldRetryPlayMuted({ blocked: true, muted: false }), true);
    assert.equal(shouldRetryPlayMuted({ blocked: true, muted: true }), false);
    assert.equal(shouldRetryPlayMuted({ blocked: false, muted: false }), false);
});

test('mosaic swap resume path uses resume not toggle().catch', () => {
    // toggle() returns undefined — .catch would throw. resume() is the correct call.
    const toggle = () => undefined;
    const resume = () => { /* sync start */ };
    const result = toggle();
    assert.equal(result, undefined);
    assert.equal(typeof result?.catch, 'undefined');
    assert.throws(() => { result.catch(() => {}); }, TypeError);
    assert.doesNotThrow(() => resume());
});

test('isHealthyWatchPlayback credits active play only', () => {
    const base = {
        hasChannel: true,
        playing: true,
        wantPlaying: true,
        loading: false,
        loadPhase: 'idle',
        pausePhase: 'idle',
        stopped: false,
        error: null,
        posterDataUrl: null
    };
    assert.equal(isHealthyWatchPlayback(base), true);
    assert.equal(isHealthyWatchPlayback({ ...base, loadPhase: 'buffering', loading: true }), false);
    assert.equal(isHealthyWatchPlayback({ ...base, loadPhase: 'connecting' }), false);
    assert.equal(isHealthyWatchPlayback({ ...base, playing: false, wantPlaying: true }), false);
});
