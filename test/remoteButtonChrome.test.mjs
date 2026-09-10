/**
 * Static CSS budgets for remote button chrome + catalog tool popouts.
 * Reads remote.css (and nested @imports) — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readCssWithImports(join(root, 'css/components/remote.css'));

/** Max drop-shadow() calls inside any single filter: declaration. */
function maxDropShadowsPerFilter(source) {
    let max = 0;
    const re = /filter:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(source))) {
        const body = m[1];
        if (/\bnone\b/.test(body)) continue;
        const count = (body.match(/drop-shadow\(/g) || []).length;
        if (count > max) max = count;
    }
    return max;
}

test('clip-path button shapes use at most 2 drop-shadows per filter', () => {
    assert.ok(
        maxDropShadowsPerFilter(css) <= 2,
        `expected ≤2 drop-shadows per filter:, got ${maxDropShadowsPerFilter(css)}`
    );
});

test('shared remote button base does not transition filter or promote will-change', () => {
    const base = css.match(
        /\.remote-panel__btn,\s*\n\.remote-panel__nav-btn\s*\{[^}]+\}/
    );
    assert.ok(base, 'missing shared .remote-panel__btn / __nav-btn block');
    const block = base[0];
    assert.doesNotMatch(block, /will-change:\s*transform/);
    const transition = block.match(/transition:\s*([^;]+);/s);
    assert.ok(transition, 'missing transition in shared button block');
    assert.doesNotMatch(transition[1], /\bfilter\b/);
    assert.doesNotMatch(transition[1], /\bbox-shadow\b/);
});

test('catalog filter/category/sort are portaled out of the footer when open', () => {
    assert.match(css, /portaled to document\.body/);
    assert.match(css, /body\s*>\s*\.is-catalog-tool-popout\.tv-tab--category/);
    assert.match(
        css,
        /\.remote-panel__footer-chrome\s*\{[^}]*overflow-y:\s*hidden/s
    );
    // Failed approach: keep them inside footer with overflow visible.
    assert.doesNotMatch(
        css,
        /\.remote-panel__footer-chrome\s*\{[^}]*overflow:\s*visible/s
    );
});

test('ninja shape still strips button chrome', () => {
    const ninja = css.match(
        /\[data-remote-button-shape="ninja"\]\s+:is\(\.remote-panel__btn,\s*\.remote-panel__nav-btn\)\s*\{[^}]+\}/
    );
    assert.ok(ninja, 'missing ninja shape block');
    assert.match(ninja[0], /filter:\s*none/);
    assert.match(ninja[0], /background:\s*transparent/);
    assert.match(ninja[0], /box-shadow:\s*none/);
});

test('clip-path shape ::before sits under button content', () => {
    const before = css.match(
        /:is\(\[data-remote-button-shape="triangle-up"\].*?\[data-remote-button-shape="rhombus"\]\)\s+:is\(\.remote-panel__btn,\s*\.remote-panel__nav-btn\)::before\s*\{[^}]+\}/s
    );
    assert.ok(before, 'missing shared clip-path ::before block');
    assert.match(before[0], /z-index:\s*-1/);
});

test('squircle is rounder toward circle (48%)', () => {
    const base = css.match(
        /\.remote-panel__btn,\s*\n\.remote-panel__nav-btn\s*\{[^}]+\}/
    );
    assert.ok(base, 'missing shared .remote-panel__btn / __nav-btn block');
    assert.match(base[0], /border-radius:\s*48%/);

    const squircle = css.match(
        /\[data-remote-button-shape="squircle"\]\s+:is\(\.remote-panel__btn,\s*\.remote-panel__nav-btn\)\s*\{[^}]+\}/
    );
    assert.ok(squircle, 'missing squircle shape block');
    assert.match(squircle[0], /border-radius:\s*48%/);
});

test('remote activated chrome uses shared btn tint/ring/press tokens', () => {
    assert.match(css, /currentColor\s+var\(--btn-tint-active\)/);
    assert.match(css, /currentColor\s+var\(--btn-ring-active\)/);
    assert.match(css, /transform:\s*scale\(var\(--btn-press-scale\)\)/);
    assert.doesNotMatch(css, /transform:\s*translateY\(1px\)/);
});

test('clip-path activated ::before uses --btn-tint-active', () => {
    assert.match(
        css,
        /::before[\s\S]{0,200}currentColor\s+var\(--btn-tint-active\)/
    );
});

test('layout popout transform uses --layout-popout-shift clamp var', () => {
    assert.match(
        css,
        /\.remote-panel__layout-popout\s*\{[^}]*translateX\(calc\(-50%\s*\+\s*var\(--layout-popout-shift,\s*0px\)\)\)/s
    );
    assert.match(
        css,
        /\.remote-panel__layout-wrap\.is-open\s+\.remote-panel__layout-popout\s*\{[^}]*translateX\(calc\(-50%\s*\+\s*var\(--layout-popout-shift,\s*0px\)\)\)/s
    );
});
