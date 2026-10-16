/**
 * Static markup checks for remote keypad accents + split volume row.
 * Reads index.html — does not boot the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';

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

    const css = readCssWithImports(join(root, 'css/components/remote.css'));
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

test('mute button shows trimmed label (hover tray design)', () => {
    assert.match(html, /id="remote-mute-vol-pct"[^>]*remote-panel__btn-pct/);
});

test('mute-all button shows trimmed label (hover tray design)', () => {
    assert.match(buttonChunk('remote-mute-all-btn'), /remote-panel__btn/);
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

test('power lives in shell chrome', () => {
    assert.match(html, /data-mini-slot="bind"/);
    assert.match(html, /data-mini-slot="play"/);
    assert.match(html, /data-mini-slot="stop"/);
    assert.match(html, /data-mini-slot="mute"/);
    assert.match(html, /data-mini-slot="chandown"/);
    assert.match(html, /data-mini-slot="browse"/);
    assert.match(html, /data-mini-slot="settings"/);
    assert.match(html, /data-mini-slot="voldown"/);
    assert.match(html, /data-mini-slot="layout"/);
    
    const slots = (html.match(/data-mini-slot="[a-zA-Z]+"/g) || []);
    // Hover tray buttons
    assert.match(html, /id="remote-radio-btn"[^>]*data-remote-action="radio-toggle"/);
    assert.match(html, /id="remote-mute-btn"[^>]*data-remote-action="mute"/);
    assert.match(html, /id="remote-mute-all-btn"[^>]*data-remote-action="mute-all"/);
    assert.match(html, /id="remote-play-btn"[^>]*data-remote-action="play"/);
    assert.match(html, /id="remote-play-all-btn"[^>]*data-remote-action="play-all"/);
    assert.match(html, /id="remote-stop-btn"[^>]*data-remote-action="stop"/);
    assert.match(html, /id="remote-stop-all-btn"[^>]*data-remote-action="stop-all"/);
    assert.match(html, /radio-tray__btn[^>]*is-hidden[^>]*id="remote-radio-btn"/);
    assert.match(html, /id="remote-external-popout-btn"[^>]*>/);
    assert.match(html, /id="remote-mini-float-btn"/);

    // The 12 kept mini cells are tagged; radio has no dedicated mini key.
    assert.match(html, /data-mini-slot="chanup"/);
    assert.match(html, /data-mini-slot="favorites"/);
    assert.match(html, /data-mini-slot="volup"/);
    assert.match(html, /data-mini-slot="bind"/);
    assert.match(html, /data-mini-slot="play"/);
    assert.match(html, /data-mini-slot="stop"/);
    assert.match(html, /data-mini-slot="mute"/);
    assert.match(html, /data-mini-slot="chandown"/);
    assert.match(html, /data-mini-slot="browse"/);
    assert.match(html, /data-mini-slot="settings"/);
    assert.match(html, /data-mini-slot="voldown"/);
    assert.match(html, /data-mini-slot="layout"/);
    
    // Hover tray buttons
    assert.match(html, /id="remote-play-all-btn"/);
    assert.match(html, /data-remote-action="play-all"/);
    assert.match(html, /id="remote-stop-all-btn"/);
    assert.match(html, /data-remote-action="stop-all"/);
    assert.match(html, /id="remote-mute-all-btn"/);
    assert.match(html, /data-remote-action="mute-all"/);
    // The 12 mini keys are tagged
    assert.equal(new Set(slots).size, 12, 'exactly the 12 mini keys are tagged');

    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    assert.match(css, /body\.remote-mini-floating/);
    assert.match(css, /remote-mini-float-btn/);
    // radio key removed from mini floating
    assert.doesNotMatch(css, /remote-radio-btn-mini/);
    assert.match(css, /\.remote-panel__cell--mini-only\s*\{\s*display:\s*none/s);
    assert.match(html, /miniTrayExpanded|miniTraySlotId/);
});
