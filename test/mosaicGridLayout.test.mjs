/**
 * Pure mosaic CSS grid template.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMosaicGridTemplate } from '../js/mosaic/gridLayout.js';

test('center-only and free-layout use single-cell shell', () => {
    assert.deepEqual(resolveMosaicGridTemplate({}), {
        areas: '"center"',
        columns: '1fr',
        rows: '1fr',
        hasLeft: false,
        hasRight: false,
        hasTop: false,
        hasBottom: false,
        hasAnyCorner: false
    });
    const free = resolveMosaicGridTemplate({
        freeLayout: true,
        topLeft: true,
        topRight: true
    });
    assert.equal(free.areas, '"center"');
    assert.equal(free.columns, '1fr');
    assert.equal(free.hasAnyCorner, true);
});

test('full four-corner mosaic uses 2x3 areas', () => {
    const g = resolveMosaicGridTemplate({
        topLeft: true,
        topRight: true,
        bottomLeft: true,
        bottomRight: true
    });
    assert.equal(g.areas, '"topLeft center topRight" "bottomLeft center bottomRight"');
    assert.equal(g.rows, '1fr 1fr');
    assert.equal(g.hasLeft && g.hasRight && g.hasTop && g.hasBottom, true);
});

test('left-only top+bottom uses two-column layout', () => {
    const g = resolveMosaicGridTemplate({
        topLeft: true,
        bottomLeft: true
    });
    assert.equal(g.areas, '"topLeft center" "bottomLeft center"');
    assert.equal(g.hasRight, false);
});

test('top-right only is single row', () => {
    const g = resolveMosaicGridTemplate({ topRight: true });
    assert.equal(g.areas, '"center topRight"');
    assert.equal(g.rows, '1fr');
});
