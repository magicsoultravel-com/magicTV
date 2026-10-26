/**
 * Static checks for Web Video (URL) tile chrome: an embedded page must not be
 * covered by the centre stop slate, and mute must stay in the tray.
 * Reads CSS + builds the hover HTML — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';
import { buildTileHoverHtml } from '../js/ui/tileHoverControls.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readCssWithImports(join(root, 'css/components/webstream.css'));

test('a page tile hides the centre slate that used to cover the iframe', () => {
    const slate = css.match(/\.tv-player-tile\.is-webpage[^{]*\.tv-player-tile__playback-state\s*\{[^}]*\}/s);
    assert.ok(slate, 'page tiles opt out of the centre slate');
    assert.match(slate[0], /display:\s*none\s*!important/);

    // Stop removes the frame — the ■ comes back so the tile is not a blank
    // square (browsers without :has() simply keep the slate hidden).
    const restored = css.match(
        /\.tv-player-tile\.is-webpage:not\(:has\(\.webstream-frame-wrap\)\) \.tv-player-tile__playback-state\s*\{[^}]*\}/s
    );
    assert.ok(restored, 'a stopped page tile still shows the ■');
    assert.match(restored[0], /display:\s*flex/);
});

test('a page tile keeps the mute tray button and its slide-out', () => {
    const hideBlock = css.match(/\.tv-player-tile\.is-webpage \[data-tile-action="pip"\][^{]*\{[^}]*\}/s);
    assert.ok(hideBlock, 'the embed-only hide rule is present');
    assert.doesNotMatch(hideBlock[0], /mute-wrap/, 'mute is no longer hidden on page tiles');
    assert.doesNotMatch(hideBlock[0], /travel-wrap/, 'TV Travel left the tile chrome for the remote');
    assert.match(hideBlock[0], /vol-rocker/, 'the volume rocker stays hidden for embeds');

    // The tray HTML still carries the same mute glyph + popout on every tile.
    for (const variant of ['center', 'corner']) {
        const html = buildTileHoverHtml(variant);
        assert.match(html, /class="tv-controls__mute-wrap"/, `${variant}: mute wrap`);
        assert.match(html, /data-tile-action="mute"/, `${variant}: mute glyph`);
        assert.match(html, /data-tile-action="mute-solo"/, `${variant}: Mute other TVs`);
        assert.match(html, /data-tile-action="mute-all"/, `${variant}: Mute all`);
        assert.doesNotMatch(html, /tv-travel/, `${variant}: TV Travel is remote-only now`);
    }
});
