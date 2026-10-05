/**
 * Stop & play sequencing helper tests (1s delay + cancel via generation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure helper mirroring tileChrome stop-play cancel rules.
 * @param {{ stopPlayGeneration: number, channelKey: string|null }} player
 * @param {number} gen
 * @param {string} expectedKey
 */
function shouldResumeAfterStopPlay(player, gen, expectedKey) {
    if (gen !== player.stopPlayGeneration) return false;
    if (player.channelKey !== expectedKey) return false;
    return true;
}

test('stop-play resumes when generation and channel match', () => {
    const player = { stopPlayGeneration: 3, channelKey: 'iptv-org:A' };
    assert.equal(shouldResumeAfterStopPlay(player, 3, 'iptv-org:A'), true);
});

test('stop-play aborts when a newer stop-play superseded it', () => {
    const player = { stopPlayGeneration: 4, channelKey: 'iptv-org:A' };
    assert.equal(shouldResumeAfterStopPlay(player, 3, 'iptv-org:A'), false);
});

test('stop-play aborts when channel changed during the wait', () => {
    const player = { stopPlayGeneration: 3, channelKey: 'iptv-org:B' };
    assert.equal(shouldResumeAfterStopPlay(player, 3, 'iptv-org:A'), false);
});
