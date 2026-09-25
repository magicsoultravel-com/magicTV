/** Sanity checks for same-origin hls.js vendor + loader helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHlsUrl, canPlayNativeHls } from '../js/tvHls.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorPath = join(root, 'vendor', 'hls.min.js');

test('vendor/hls.min.js is present for same-origin load', () => {
    const st = statSync(vendorPath);
    assert.ok(st.size > 100_000, 'vendor build should be a real minified bundle');
    const head = readFileSync(vendorPath, 'utf8').slice(0, 20);
    assert.match(head, /function|!function/);
});

test('isHlsUrl detects m3u8', () => {
    assert.equal(isHlsUrl('https://ex.test/live.m3u8'), true);
    assert.equal(isHlsUrl('https://ex.test/live.mp4'), false);
});

test('canPlayNativeHls gates on canPlayType', () => {
    assert.equal(canPlayNativeHls(null), false);
    assert.equal(canPlayNativeHls({ canPlayType: () => '' }), false);
    assert.equal(canPlayNativeHls({
        canPlayType: (t) => (t.includes('mpegurl') ? 'maybe' : '')
    }), true);
});

test('buildHlsConfig applies deeper buffer caps for high-bitrate IPTV', async () => {
    const {
        buildHlsConfig,
        HLS_MAX_BUFFER_BYTES,
        HLS_MAX_BITRATE
    } = await import('../js/player/hlsAttach.js');
    const { DEFAULT_BUFFER_SIZE } = await import('../js/storage/playerState.js');
    assert.equal(DEFAULT_BUFFER_SIZE, 30);
    assert.equal(HLS_MAX_BUFFER_BYTES, 64 * 1024 * 1024);
    assert.equal(HLS_MAX_BITRATE, 12_000_000);
    const cfg = buildHlsConfig({ AbrController: class {} }, 30);
    assert.equal(cfg.maxBufferLength, 30);
    assert.equal(cfg.minBufferLength, 3.0);
    assert.equal(cfg.maxBufferSize, HLS_MAX_BUFFER_BYTES);
    assert.equal(cfg.maxBitrate, HLS_MAX_BITRATE);
});
