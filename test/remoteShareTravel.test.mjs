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
        /hideKeyCell\(wrap, !showShare\)/,
        'the wrap and its grid cell hide only when no channel is loaded'
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
        /hideKeyCell\(wrap, !multiTv\)/,
        'travel key hides (cell included) with a single screen'
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

test('every remote tray opens on hover, on every surface', () => {
    // One hover recipe for layout / share / travel / the number board, gated by
    // pointer type only — the full remote, docked sheet and popout hover too.
    assert.match(remotePanelJs, /wrap\.addEventListener\('pointerenter', \(e\) => \{\s*\n\s*if \(e\.pointerType === 'touch'\) return;/, 'hover opens the tray');
    assert.match(remotePanelJs, /wrap\.addEventListener\('pointerleave', \(e\) => \{\s*\n\s*if \(e\.pointerType === 'touch'\) return;/, 'leaving arms the close timer');
    assert.doesNotMatch(remotePanelJs, /!isMiniFloating\(\)\) return;/, 'no mini-only hover gate is left');
    for (const id of ['remote-layout-picker-wrap', 'remote-share-picker-wrap', 'remote-travel-picker-wrap', 'remote-numpad-wrap']) {
        assert.match(remotePanelJs, new RegExp(`wrapId: '${id}'`), `${id} is a registered picker`);
    }
    assert.match(remotePanelJs, /bindPicker\('numpad'\)/, 'the 1-9 key is wired like the other trays');

    // The bind key is a picker too: hover opens the scope menu, leaving closes it.
    const chanBindJs = read('js/ui/chanBindPicker.js');
    assert.match(chanBindJs, /function openMenuEl\(menuEl, btnEl\)/, 'menu open helper is shared by click + hover');
    assert.match(chanBindJs, /popup\.addEventListener\('pointerenter'/, 'hover opens the bind menu');
    assert.match(chanBindJs, /popup\.addEventListener\('pointerleave'/, 'leaving closes the bind menu');
    assert.match(chanBindJs, /MENU_HOVER_CLOSE_MS/, 'the bind menu keeps the tray grace period');
    assert.doesNotMatch(chanBindJs, /!isMiniFloating/, 'the bind menu is not mini-gated');

    // The "-all" fly-outs are a mini-only affordance: Play all / Stop all / Mute all
    // have their own row-4 keys on every other surface.
    assert.match(
        css,
        /body:not\(\.remote-mini-floating\) #remote-panel \.remote-panel__grid \.radio-tray__popout\s*\{\s*display:\s*none/s
    );
});

test('1-9 key drops the number board into the keypad body', () => {
    // One key replaces ten: the digits keep their ids, actions and accents.
    assert.match(html, /id="remote-numpad-wrap"/);
    assert.match(html, /id="remote-numpad-btn"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"/);
    assert.match(html, /class="[^"]*remote-panel__btn--numpad"[^>]*id="remote-numpad-btn"/);
    const board = html.slice(html.indexOf('id="remote-numpad-popout"'), html.indexOf('data-remote-key="stop"'));
    assert.equal((board.match(/data-remote-action="digit-/g) || []).length, 10, 'all ten digits live in the board');
    assert.equal((html.match(/<div class="remote-panel__cell"[^>]*><button[^>]*remote-panel__btn--digit/g) || []).length, 0, 'no digit owns a grid cell');

    // The board is a tray: absolute, three columns, clamped with its own var.
    assert.match(css, /\.remote-panel__numpad-wrap\s*\{[^}]*position:\s*relative/s);
    assert.match(css, /\.remote-panel__numpad-popout\s*\{[^}]*top:\s*calc\(100% \+ 0\.35rem\)/s);
    assert.match(css, /\.remote-panel__numpad-popout\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*var\(--remote-btn-size/s);
    assert.match(css, /\.remote-panel__numpad-popout\s*\{[^}]*z-index:\s*9000/s);
    assert.match(css, /\.remote-panel__numpad-wrap\.is-open \.remote-panel__numpad-popout\s*\{[^}]*visibility:\s*visible/s);
    assert.match(css, /\.remote-panel__numpad-popout #remote-digit-0\s*\{[^}]*grid-column:\s*2/s);
    assert.match(remotePanelJs, /shiftVar: '--numpad-popout-shift'/);
    assert.match(css, /--numpad-popout-shift/);
});
