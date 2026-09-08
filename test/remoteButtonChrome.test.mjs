/**
 * Static CSS budgets for remote button chrome + catalog tool popups.
 * Reads remote.css — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/components/remote.css'), 'utf8');

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

test('catalog tools open filter/category/sort popups downward', () => {
    assert.match(
        css,
        /\.remote-module__catalog-tools\s+\.tv-tab--filter-input[\s\S]*?top:\s*calc\(100%\s*\+\s*4px\)/
    );
    assert.match(
        css,
        /\.remote-module__catalog-tools\s+\.tv-tab--category[\s\S]*?bottom:\s*auto/
    );
    assert.match(
        css,
        /\.remote-module__catalog-tools\s+\.tv-tab--sort[\s\S]*?top:\s*calc\(100%\s*\+\s*4px\)/
    );
});

test('ninja shape still strips button chrome', () => {
    const ninja = css.match(
        /\[data-remote-button-shape="ninja"\]\s+\.remote-panel__btn,\s*\n\[data-remote-button-shape="ninja"\]\s+\.remote-panel__nav-btn\s*\{[^}]+\}/
    );
    assert.ok(ninja, 'missing ninja shape block');
    assert.match(ninja[0], /filter:\s*none/);
    assert.match(ninja[0], /background:\s*transparent/);
    assert.match(ninja[0], /box-shadow:\s*none/);
});
