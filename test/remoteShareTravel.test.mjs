/**
 * Static checks for the two remote keys that carry a slide-out tray:
 * the single Share key (stream link / magicTV link) and TV Travel, which moved
 * off the tile hover chrome and onto the remote. Reads index.html, CSS and the
 * modules as text — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const html = read('index.html');
const remotePanelJs = read('js/ui/remotePanel.js');
const tileHoverJs = read('js/ui/tileHoverControls.js');
const tileChromeJs = read('js/mosaic/tileChrome.js');
const playbackJs = read('js/mosaic/playback.js');
const freeLayoutJs = read('js/mosaic/freeLayout.js');
const css = readCssWithImports(join(root, 'css/components/remote.css'));

/** Inner markup of the first element carrying `id="<id>"`. */
function innerOf(id) {
    const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</div>`));
    return m ? m[1] : '';
}

const count = (source, needle) => source.split(needle).length - 1;

test('share is one remote key with a two-option slide-out', () => {
    const shareWraps = html.match(/class="[^"]*\bremote-share-btn\b[^"]*"/g) || [];
    assert.equal(shareWraps.length, 1, 'exactly one share key');
    assert.equal(count(html, 'id="remote-share-btn"'), 1, 'the key keeps a stable id');
    assert.doesNotMatch(html, /id="remote-share-stream-btn"/, 'the standalone stream key is gone');
    assert.doesNotMatch(html, /id="remote-share-magictv-btn"/, 'the standalone magicTV key is gone');

    const key = html.match(/<button[^>]*id="remote-share-btn"[^>]*>/);
    assert.ok(key, 'share key exists');
    assert.match(key[0], /aria-haspopup="true"/, 'key advertises its tray');
    assert.match(key[0], /aria-expanded="false"/, 'tray starts closed');

    const tray = innerOf('remote-share-picker-popout');
    assert.equal(count(tray, 'data-remote-action="share-copy-stream"'), 1, 'stream link option');
    assert.equal(count(tray, 'data-remote-action="share-copy-magictv"'), 1, 'magicTV link option');
    assert.equal(count(tray, 'data-remote-action="share-copy-'), 2, 'exactly two copy paths');
});

test('share key hides with the channel and closes its tray', () => {
    assert.match(
        remotePanelJs,
        /queryAllInApp\('\.remote-share-btn'\)/,
        'sync targets the share wrap'
    );
    assert.match(
        remotePanelJs,
        /wrap\.classList\.toggle\('is-hidden', !showShare\)/,
        'the wrap hides only when no channel is loaded'
    );
    assert.match(
        remotePanelJs,
        /wrap\.classList\.remove\('is-open'\)/,
        'a stale open tray is dropped when the key hides'
    );
    assert.match(remotePanelJs, /closePicker\('share'\)/, 'copying closes the tray');
});

test('TV Travel is remote-only — tile chrome no longer carries it', () => {
    assert.match(html, /id="remote-travel-btn"/, 'the remote hosts the travel key');
    assert.match(html, /id="remote-travel-picker-popout"/, 'the remote hosts the travel tray');

    assert.doesNotMatch(tileHoverJs, /tv-travel/, 'no travel buttons in tile hover HTML');
    assert.doesNotMatch(tileHoverJs, /travelWrap/, 'no travel wrap builder');
    assert.doesNotMatch(tileHoverJs, /ensureTravelWraps/, 'no travel upgrade path');
    assert.doesNotMatch(tileChromeJs, /tv-travel/, 'no travel actions in tile chrome');
    assert.doesNotMatch(playbackJs, /tv-travel/, 'no travel state sync over tiles');
    assert.doesNotMatch(freeLayoutJs, /travel-wrap/, 'no travel drag guard left behind');
});

test('travel tray offers Off / Quick / Slow / Random and drives the global ring', () => {
    const tray = innerOf('remote-travel-picker-popout');
    for (const action of ['tv-travel-off', 'tv-travel-quick', 'tv-travel-slow', 'tv-travel-random']) {
        assert.equal(
            count(tray, `data-remote-action="${action}"`),
            1,
            `${action} option present`
        );
    }
    assert.match(tray, /aria-pressed="false"/, 'options start unpressed');

    // Ring-wide API: start/stop the global travel, never a per-slot mode.
    assert.match(remotePanelJs, /MultiView\.startTvTravel\?\.\(/, 'starts the global travel');
    assert.match(remotePanelJs, /MultiView\.stopTvTravel\?\.\(/, 'stops the global travel');
    assert.doesNotMatch(remotePanelJs, /setTravelMode/, 'no invented per-slot API');

    // Only meaningful with 2+ screens, and a running travel stops when the ring shrinks.
    assert.match(remotePanelJs, /function syncTvTravelPicker\(multiTv\)/, 'travel sync exists');
    assert.match(
        remotePanelJs,
        /if \(!multiTv && active\) \{[\s\S]*?MultiView\.stopTvTravel\?\.\(\)/,
        'travel stops when fewer than two screens remain'
    );
    assert.match(
        remotePanelJs,
        /wrap\?\.classList\.toggle\('is-hidden', !multiTv\)/,
        'travel key hides with a single screen'
    );
});

test('both trays reuse the layout picker slide-out recipe', () => {
    assert.match(css, /\.remote-panel__share-popout,\s*\n\.remote-panel__travel-popout\s*\{/, 'shared tray block');
    assert.match(
        css,
        /\.remote-panel__share-wrap\.is-open \.remote-panel__share-popout,[\s\S]*?\.remote-panel__travel-wrap\.is-open \.remote-panel__travel-popout\s*\{/,
        'each tray opens off its own wrap'
    );
    assert.match(css, /--share-popout-shift/, 'share tray clamps with its own shift');
    assert.match(css, /--travel-popout-shift/, 'travel tray clamps with its own shift');
    assert.match(
        remotePanelJs,
        /shiftVar: '--share-popout-shift'/,
        'JS clamps the share tray'
    );
    assert.match(
        remotePanelJs,
        /shiftVar: '--travel-popout-shift'/,
        'JS clamps the travel tray'
    );
});
