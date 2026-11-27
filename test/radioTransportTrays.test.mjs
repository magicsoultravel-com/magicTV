/**
 * Static checks for the Magic Radio transport: Cast now slides out of Play and
 * the "mute other TVs / play radio" key slides out of Mute, both with the TV
 * tiles' popout recipe instead of sitting in transport row 2. The station rocker
 * moved to the cassette's right gutter, one rocker row up. Reads index.html and
 * the CSS as text — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readCssWithImports(join(root, 'css/tv-landing.css'));

const count = (source, needle) => source.split(needle).length - 1;

/** Markup of the `<div data-radio-tray="<name>">` wrapper, closing tag included. */
function trayWrap(name) {
    const open = new RegExp(
        `<div class="[^"]*radio-module__tray-wrap[^"]*"[^>]*data-radio-tray="${name}"[^>]*>`
    );
    const m = open.exec(html);
    assert.ok(m, `missing radio tray wrap for "${name}"`);

    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let tag;
    while ((tag = tagRe.exec(html))) {
        depth += tag[0] === '</div>' ? -1 : 1;
        if (depth === 0) return html.slice(m.index, tag.index);
    }
    throw new Error(`unterminated radio tray wrap "${name}"`);
}

/** The transport toolbar block (keys only — stops before the cast menu). */
const transport = (() => {
    const start = html.indexOf('class="radio-module__transport"');
    assert.ok(start > -1, 'radio transport exists');
    const end = html.indexOf('radio-module__cast-menu', start);
    assert.ok(end > start, 'cast menu follows the transport');
    return html.slice(start, end);
})();

test('Cast rides a slide-out on the Play key', () => {
    const playWrap = trayWrap('play');
    assert.match(playWrap, /radio-module__tray-wrap--play/, 'play key is a tray wrap');
    assert.match(playWrap, /radio-module__tray--play/, 'play key owns a tray');
    assert.equal(count(playWrap, '<button'), 2, 'play key + one cast option');
    assert.equal(count(playWrap, 'id="radio-play-btn"'), 1, 'play key id kept');
    assert.equal(count(playWrap, 'id="radio-cast-btn"'), 1, 'cast id kept inside the tray');
    assert.equal(count(playWrap, 'data-radio-action="cast"'), 1, 'one cast action');

    assert.equal(count(transport, 'id="radio-cast-btn"'), 1, 'cast appears once in the transport');
    assert.equal(count(html, 'id="radio-cast-btn"'), 1, 'no orphaned cast key');
});

test('the mute-others key rides a slide-out on the Mute key', () => {
    const muteWrap = trayWrap('mute');
    assert.match(muteWrap, /radio-module__tray-wrap--mute/, 'mute key is a tray wrap');
    assert.match(muteWrap, /radio-module__tray--mute/, 'mute key owns a tray');
    assert.equal(count(muteWrap, '<button'), 2, 'mute key + one focus option');
    assert.equal(count(muteWrap, 'id="radio-mute-btn"'), 1, 'mute key id kept');
    assert.equal(count(muteWrap, 'data-radio-action="focus-radio"'), 1, 'focus-radio action');
    assert.equal(count(html, 'data-radio-action="focus-radio"'), 1, 'no orphaned focus key');
    assert.equal(count(html, 'id="radio-mute-btn"'), 1, 'mute key keeps a stable id');
});

test('the radio focus key uses the tiles\' unmute-this / mute-rest glyph', () => {
    const muteWrap = trayWrap('mute');
    // MUTE_SOLO_SVG from js/ui/tileHoverControls.js — bar + down-arrow + speaker.
    assert.match(muteWrap, /d="M2\.2 2\.2v7\.6M1\.4 2\.2h1\.6"/, 'solo bar');
    assert.match(muteWrap, /d="M5\.2 3\.2v5\.6M3\.8 7\.2 5\.2 8\.8 6\.6 7\.2"/, 'solo arrow');
    assert.match(muteWrap, /d="M13\.4 5\.1c\.55\.55\.55 1\.7 0 2\.25/, 'solo wave');
    // The old sigma "mute all" glyph is gone from the radio transport.
    assert.doesNotMatch(muteWrap, /mosaic-mute-all-sigma/, 'no mute-all sigma');
    assert.doesNotMatch(transport, /M6 2H1L4\.8 6 1 10H6/, 'sigma path no longer in the transport');
    assert.doesNotMatch(transport, /mosaic-mute-all-/, 'no mute-all glyph classes left behind');
});

test('the transport keeps its five keys and loses the second-key row', () => {
    assert.equal(count(transport, '<button'), 7, '5 keys + 2 tray options');
    assert.equal(count(transport, 'data-radio-tray='), 2, 'exactly two tray wraps');
    assert.equal(count(transport, 'id="radio-volume-slider"'), 1, 'volume stays in the transport');
    assert.match(
        css,
        /\.radio-module__vol\.remote-volume-bar\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
        'the volume bar spans the freed row'
    );
});

test('trays use the tile popout recipe: animate up, open on hover and focus', () => {
    assert.match(
        css,
        /\.radio-module__tray-wrap\s*\{[^}]*position:\s*relative[^}]*display:\s*inline-flex/s,
        'wrap anchors the tray'
    );
    assert.match(
        css,
        /\.radio-module__tray\s*\{[^}]*bottom:\s*calc\(100% \+ 0\.3rem \* var\(--radio-scale, 1\)\)/s,
        'tray sits above the key'
    );
    assert.match(
        css,
        /\.radio-module__tray\s*\{[^}]*translateY\(calc\(100% \+ 4px\)\)[^}]*opacity:\s*0/s,
        'tray starts tucked behind the key'
    );
    assert.match(
        css,
        /\.radio-module__tray-wrap:hover \.radio-module__tray,\s*\.radio-module__tray-wrap:focus-within \.radio-module__tray\s*\{[^}]*translateY\(0\)[^}]*opacity:\s*1/s,
        'tray slides up on hover / keyboard focus'
    );
    assert.match(
        css,
        /\.radio-module__tray-wrap::after\s*\{[^}]*bottom:\s*100%/s,
        'hover bridge keeps the tray open across the gap'
    );
    // Trays must outrank the rocker's stacking context.
    assert.match(css, /\.radio-module__controls\s*\{[^}]*z-index:\s*3/s, 'controls paint above the rocker');
});

test('the station rocker moved to the right gutter, one row up', () => {
    const rocker = css.match(/\.radio-module__station-rocker\.tv-player-tile__rocker\s*\{([^}]*)\}/);
    assert.ok(rocker, 'station rocker rule exists');
    assert.match(rocker[1], /left:\s*auto/, 'no longer pinned to the left');
    assert.match(rocker[1], /right:\s*calc\(2px \* var\(--radio-scale, 1\)\)/, 'mirrored to the right');
    assert.match(rocker[1], /top:\s*calc\(22px \* var\(--radio-scale, 1\)\)/, 'lifted one rocker row');

    const menu = css.match(/\.chan-bind-menu\.radio-module__station-bind-menu\s*\{([^}]*)\}/);
    assert.ok(menu, 'bind menu rule exists');
    assert.match(menu[1], /right:\s*calc\(100% \+ 0\.35rem\)/, 'menu opens leftward from the right gutter');
    assert.match(menu[1], /left:\s*auto/, 'no leftward overflow');
});
