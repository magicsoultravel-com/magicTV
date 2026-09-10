/**
 * Static markup checks for remote keypad accents + split volume row.
 * Reads index.html — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function buttonChunk(idOrAttr) {
    const re = idOrAttr.startsWith('data-')
        ? new RegExp(`<button[^>]*${idOrAttr}="[^"]*"[^>]*>`, 'i')
        : new RegExp(`<button[^>]*id="${idOrAttr}"[^>]*>`, 'i');
    const m = html.match(re);
    assert.ok(m, `missing button matching ${idOrAttr}`);
    return m[0];
}

function actionButton(action) {
    const re = new RegExp(`<button[^>]*data-remote-action="${action}"[^>]*>`, 'i');
    const m = html.match(re);
    assert.ok(m, `missing data-remote-action="${action}"`);
    return m[0];
}

test('remote volume is one pill-height row split into half-height TV / Master', () => {
    assert.match(html, /id="remote-volume-split"/);
    assert.match(html, /remote-volume-bar--tv[\s\S]*?id="tv-volume-dial"/);
    assert.match(html, /remote-volume-bar--master[\s\S]*?id="volume-dial"/);

    const volumeCells = html.match(/class="remote-panel__cell remote-panel__cell--volume"/g) || [];
    assert.equal(volumeCells.length, 1, 'exactly one volume grid cell');

    const css = readFileSync(join(root, 'css/components/remote.css'), 'utf8');
    assert.match(css, /\.remote-panel__volume-split\s*\{[^}]*flex-direction:\s*column/s);
    assert.match(css, /\.remote-panel__volume-split\s*\{[^}]*height:\s*var\(--remote-btn-size/s);
    assert.match(css, /\.remote-panel__volume-split\s*>\s*\.remote-volume-bar\s*\{[^}]*height:\s*50%/s);
    assert.match(css, /\.remote-panel__volume-split::after\s*\{[^}]*background:\s*var\(--tv-main-3\)/s);
    assert.match(css, /\.remote-panel__volume-split::after\s*\{[^}]*height:\s*2px/s);

    const splitIdx = html.indexOf('id="remote-volume-split"');
    const mosaicIdx = html.indexOf('id="remote-panel-mosaic-group"');
    assert.ok(mosaicIdx > 0 && splitIdx > mosaicIdx, 'volume split sits below Multi-TV mosaic group');

    const tvIdx = html.indexOf('id="tv-volume-dial"', splitIdx);
    const masterIdx = html.indexOf('id="volume-dial"', splitIdx);
    assert.ok(tvIdx > splitIdx && masterIdx > tvIdx, 'TV dial precedes Master dial inside split');
});

test('mute button shows stacked TV volume percentage', () => {
    assert.match(buttonChunk('remote-mute-btn'), /remote-panel__btn--stack/);
    assert.match(html, /id="remote-mute-vol-pct"[^>]*remote-panel__btn-pct/);
});

test('mute-all button shows stacked master volume percentage', () => {
    assert.match(buttonChunk('remote-mute-all-btn'), /remote-panel__btn--stack/);
    assert.match(html, /id="remote-mute-all-vol-pct"[^>]*remote-panel__btn-pct/);
});

test('numpad digit rows use main-1 / main-2 / main-3 accents', () => {
    for (const id of ['remote-digit-1', 'remote-digit-2', 'remote-digit-3', 'remote-digit-0']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-1/);
    }
    for (const id of ['remote-digit-4', 'remote-digit-5', 'remote-digit-6']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-2/);
    }
    for (const id of ['remote-digit-7', 'remote-digit-8', 'remote-digit-9']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-3/);
    }
});

test('chan/vol rockers and bind match tile hover accents', () => {
    assert.match(actionButton('chan-up'), /tv-controls__btn--main-1/);
    assert.match(actionButton('vol-up'), /tv-controls__btn--main-1/);
    assert.match(actionButton('chan-down'), /tv-controls__btn--main-3/);
    assert.match(actionButton('vol-down'), /tv-controls__btn--main-3/);
    assert.match(buttonChunk('remote-chan-bind-btn'), /tv-controls__btn--main-3/);
});

test('power lives in shell chrome; guide/fav occupy first keypad row ends', () => {
    assert.match(html, /remote-module__chrome[\s\S]*?id="remote-power-btn"/);
    assert.match(html, /id="remote-guide-toggle"[\s\S]*?id="remote-digit-1"/);
    assert.match(html, /id="remote-digit-3"[\s\S]*?id="remote-fav-btn"/);
    assert.match(buttonChunk('remote-fav-btn'), /data-remote-action="fav"/);
});
