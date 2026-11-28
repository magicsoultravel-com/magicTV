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
    // 1-9 + 0 now live inside the 1-9 key's slide-out board, in dial order.
    const popout = html.slice(
        html.indexOf('id="remote-numpad-popout"'),
        html.indexOf('data-remote-key="stop"')
    );
    for (const id of ['remote-digit-1', 'remote-digit-2', 'remote-digit-3', 'remote-digit-0']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-1/);
        assert.match(popout, new RegExp(`id="${id}"`), `${id} sits in the number board`);
    }
    for (const id of ['remote-digit-4', 'remote-digit-5', 'remote-digit-6']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-2/);
        assert.match(popout, new RegExp(`id="${id}"`));
    }
    for (const id of ['remote-digit-7', 'remote-digit-8', 'remote-digit-9']) {
        assert.match(buttonChunk(id), /tv-controls__btn--main-3/);
        assert.match(popout, new RegExp(`id="${id}"`));
    }
    // Reading order 1…9 then 0 — the CSS centres 0 in column 2.
    let cursor = -1;
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
        const at = popout.indexOf(`id="remote-digit-${n}"`);
        assert.ok(at > cursor, `digit ${n} keeps dial order`);
        cursor = at;
    }
});

test('chan/vol rockers and bind match tile hover accents', () => {
    assert.match(actionButton('chan-up'), /tv-controls__btn--main-1/);
    assert.match(actionButton('vol-up'), /tv-controls__btn--main-1/);
    assert.match(actionButton('chan-down'), /tv-controls__btn--main-3/);
    assert.match(actionButton('vol-down'), /tv-controls__btn--main-3/);
    assert.match(buttonChunk('remote-chan-bind-btn'), /tv-controls__btn--main-3/);
});

test('power + radio are keypad grid cells, not shell chrome', () => {
    // Power and radio are normal keys now, so no conditional key leaves a hole.
    assert.doesNotMatch(html, /remote-panel__cell--radio-power/);
    assert.doesNotMatch(html, /remote-module__chrome-row/);

    const gridStart = html.indexOf('class="remote-panel__grid"');
    const splitIdx = html.indexOf('id="remote-volume-split"');
    for (const [id, key] of [['remote-power-btn', 'power'], ['remote-radio-btn', 'radio']]) {
        const btnIdx = html.indexOf(`id="${id}"`);
        const cellIdx = html.lastIndexOf(`data-remote-key="${key}"`, btnIdx);
        assert.ok(btnIdx > gridStart && btnIdx < splitIdx, `${id} sits in the keypad grid`);
        assert.ok(cellIdx > gridStart && cellIdx < btnIdx, `${id} sits in its own keypad cell`);
        assert.doesNotMatch(html.slice(cellIdx, btnIdx), /data-mini-slot=/, `${id} is not a mini key`);
    }
    assert.match(html, /tv-controls__btn--main-3" id="remote-power-btn"/);
    assert.match(html, /id="remote-power-btn"[^>]*data-remote-action="power-off"/);
    assert.match(html, /id="remote-radio-btn"[^>]*data-remote-action="radio-toggle"/);
    assert.match(html, /class="[^"]*is-hidden"[^>]*id="remote-radio-btn"/);

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
    assert.match(html, /id="remote-mute-btn"[^>]*data-remote-action="mute"/);
    assert.match(html, /id="remote-mute-all-btn"[^>]*data-remote-action="mute-all"/);
    assert.match(html, /id="remote-play-btn"[^>]*data-remote-action="play"/);
    assert.match(html, /id="remote-play-all-btn"[^>]*data-remote-action="play-all"/);
    assert.match(html, /id="remote-stop-btn"[^>]*data-remote-action="stop"/);
    assert.match(html, /id="remote-stop-all-btn"[^>]*data-remote-action="stop-all"/);
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
    // The 12 mini keys are tagged
    assert.equal(new Set(slots).size, 12, 'exactly the 12 mini keys are tagged');

    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    assert.match(css, /body\.remote-mini-floating/);
    assert.match(css, /remote-mini-float-btn/);
    // radio key removed from mini floating
    assert.doesNotMatch(css, /remote-radio-btn-mini/);
    assert.match(css, /\.remote-panel__cell--mini-only\s*\{\s*display:\s*none/s);
    // Power + radio are ordinary cells: the mini grid (data-mini-slot only) drops them.
    assert.doesNotMatch(css, /remote-module__chrome-row/);
    // The "-all" fly-outs are a mini-only affordance now: those three keys have
    // their own row-4 cells on the full remote, the docked sheet and the popout.
    assert.match(
        css,
        /body:not\(\.remote-mini-floating\) #remote-panel \.remote-panel__grid \.radio-tray__popout\s*\{\s*display:\s*none/s
    );
});

test('every key is pinned to its designed slot, so hiding one leaves a hole', () => {
    // The full keypad is a fixed map: row 1 carries three keys (cols 1 / 3 / 5),
    // rows 2-6 carry five each. Conditional keys (radio, rotate, stop all, share,
    // travel) therefore sit in the middle of the board without ever shifting a
    // neighbour — their slot simply stays empty.
    const map = {
        'chan-up': [1, 1], power: [1, 3], 'vol-up': [1, 5],
        bind: [2, 1], guide: [2, 2], fav: [2, 3], radio: [2, 4], mute: [2, 5],
        'chan-down': [3, 1], play: [3, 2], numpad: [3, 3], stop: [3, 4], 'vol-down': [3, 5],
        popout: [4, 1], fullscreen: [4, 2], cast: [4, 3], share: [4, 4], travel: [4, 5],
        layout: [5, 1], rotate: [5, 2], 'play-all': [5, 3], 'stop-all': [5, 4], 'mute-all': [5, 5],
        'nav-remote': [6, 1], 'nav-browse': [6, 2], 'nav-favs': [6, 3],
        'nav-recents': [6, 4], 'nav-settings': [6, 5]
    };

    // Markup side: one tagged cell per slot, nothing extra.
    const tagged = [...html.matchAll(/data-remote-key="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(tagged.length, 28, 'every keypad cell is tagged');
    assert.equal(new Set(tagged).size, 28, 'no key is tagged twice');
    assert.deepEqual(tagged.slice().sort(), Object.keys(map).slice().sort());

    // The volume row stays the one unpinned child: a full-width auto-placed row.
    assert.doesNotMatch(html, /data-remote-key="volume"/);
    assert.match(html, /<div class="remote-panel__cell remote-panel__cell--volume">/);

    // CSS side: every key owns exactly one slot, rows 1..6 in the 3/5/5/5/5/5 shape.
    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    const rows = [];
    for (const [key, [row, col]] of Object.entries(map)) {
        assert.match(
            css,
            new RegExp(
                `body:not\\(\\.remote-mini-floating\\) #remote-panel \\[data-remote-key="${key}"\\]\\s*\\{\\s*grid-area:\\s*${row}\\s*/\\s*${col};`
            ),
            `${key} is pinned to r${row}c${col}`
        );
        rows[row] = (rows[row] || []).concat(col);
    }
    assert.deepEqual(rows.slice(1).map((cols) => cols.length), [3, 5, 5, 5, 5, 5]);
    assert.deepEqual(rows[1], [1, 3, 5], 'row 1 keeps cols 2 and 4 empty');
    const slots = Object.values(map).map(([r, c]) => `${r}/${c}`);
    assert.equal(new Set(slots).size, slots.length, 'no two keys share a slot');
    assert.match(css, /\.remote-panel__grid\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--remote-grid-cols, 5\)/s);
    assert.match(css, /\.remote-panel__cell--volume\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    // Hiding a key hides its cell, which is what leaves the pinned slot empty
    // instead of letting the neighbours slide into it.
    const tvUtilsJs = readFileSync(join(root, 'js/tvUtils.js'), 'utf8');
    assert.match(tvUtilsJs, /export function hideKeyCell\(node, hidden\)/);
    assert.match(tvUtilsJs, /node\.closest\?\.\('\.remote-panel__cell'\)\?\.classList\.toggle\('is-hidden', hide\)/);
    for (const file of ['js/ui/remoteAllKeys.js', 'js/ui/radioModule.js']) {
        assert.match(readFileSync(join(root, file), 'utf8'), /hideKeyCell\(/, `${file} hides cells, not just keys`);
    }
    assert.match(html, /id="remote-volume-split"/, 'volume keeps the last full-width row');
});

test('keypad tracks are capped at key size and the tray cells stay centred', () => {
    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    // Natural pad width, and the dialog floor derived from it (one source of truth).
    assert.match(
        css,
        /--remote-grid-width:\s*calc\(\s*var\(--remote-grid-cols\) \* var\(--remote-btn-size\)\s*\+ \(var\(--remote-grid-cols\) - 1\) \* var\(--remote-grid-gap\)\s*\)/s
    );
    assert.match(css, /--remote-min-width:\s*calc\(var\(--remote-grid-width\) \+ 2 \* var\(--remote-space-md\)\)/);
    // The pad is capped to it, so the 2× expanded dock cannot stretch the tracks.
    assert.match(css, /\.remote-panel__grid\s*\{[^}]*max-width:\s*var\(--remote-grid-width/s);
    // `.radio-tray` is the one cell with a definite width AND height (the tray box),
    // so the grid aligns it to the track/row start unless it is centred explicitly —
    // that was the play/stop/mute drift this map fixes.
    assert.match(css, /\.remote-panel__grid \.radio-tray\s*\{[^}]*justify-self:\s*center[^}]*align-self:\s*center/s);
    // The remote column is pinned to --remote-min-width while the sheet around it can
    // be wider, so it is centred instead of hugging the start (equal pad margins).
    assert.match(
        css,
        /\.remote-module__host > #tv-catalog-body,\s*\.remote-dock-sheet__inner > #tv-catalog-body\s*\{[^}]*margin-left:\s*auto[^}]*margin-right:\s*auto/s
    );
    // Row 2 col 1 bind key: the 9.5rem scope menu grows rightward from the key, or it
    // would overhang the panel's overflow-x clip.
    assert.match(
        css,
        /body:not\(\.remote-mini-floating\) #remote-panel \.remote-panel__chan-bind-popup \.chan-bind-menu\s*\{[^}]*left:\s*0[^}]*transform:\s*none/s
    );
});

test('keypad play/stop/mute hover popouts use a slide-out tray above the primary', () => {
    // Always-available popouts must not ship permanently hidden.
    assert.doesNotMatch(buttonChunk('remote-play-all-btn'), /\bis-hidden\b/);
    assert.doesNotMatch(buttonChunk('remote-mute-all-btn'), /\bis-hidden\b/);
    // Stop-all visibility is driven by playback sync, and radio by settings.
    assert.match(buttonChunk('remote-stop-all-btn'), /\bis-hidden\b/);
    assert.match(buttonChunk('remote-radio-btn'), /\bis-hidden\b/);

    // Mini fly-out copy of each "-all" key lives inside its own tile-style popout tray.
    const popoutTrays = html.match(/<div class="radio-tray__popout">/g) || [];
    assert.equal(popoutTrays.length, 3, 'play, stop and mute each get a popout tray');
    for (const id of ['remote-play-all-btn-mini', 'remote-stop-all-btn-mini', 'remote-mute-all-btn-mini']) {
        const btnIdx = html.indexOf(`id="${id}"`);
        const trayIdx = html.lastIndexOf('<div class="radio-tray__popout">', btnIdx);
        assert.ok(trayIdx > 0 && trayIdx < btnIdx, `${id} is wrapped by a popout tray`);
        assert.ok(html.indexOf('</div>', btnIdx) > btnIdx, `${id} popout tray is closed`);
    }

    // The full remote exposes the same three actions as dedicated keypad keys —
    // plain grid cells (no [data-mini-slot], no fly-out) inside the mosaic group.
    const mosaicStart = html.indexOf('id="remote-panel-mosaic-group"');
    const mosaicEnd = html.indexOf('id="remote-volume-split"');
    for (const id of ['remote-play-all-btn', 'remote-stop-all-btn', 'remote-mute-all-btn']) {
        const btnIdx = html.indexOf(`id="${id}"`);
        const cellIdx = html.lastIndexOf('<div class="remote-panel__cell', btnIdx);
        assert.ok(mosaicStart > 0 && btnIdx > mosaicStart && btnIdx < mosaicEnd, `${id} sits in the mosaic group`);
        assert.ok(cellIdx > 0 && cellIdx < btnIdx, `${id} sits in a keypad cell`);
        assert.match(
            html.slice(cellIdx, btnIdx),
            /^<div class="remote-panel__cell" data-remote-key="[a-z-]+">$/m,
            `${id} cell is a plain grid cell`
        );
    }

    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    // The tray is pointer-events:none for chrome collapsing; the primary key
    // inside a keypad cell must restore hits or Play/Stop/Mute do nothing.
    assert.match(css, /\.remote-panel__grid \.radio-tray > \.remote-panel__btn\s*\{[^}]*pointer-events:\s*auto/s);
    // Popout tray floats fully above the key, with the same dark tray language
    // and slide-up transition used by the player-tile hover controls.
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*100%/s);
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.58\)/s);
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout\s*\{[^}]*transform:\s*translateX\(-50%\)\s*translateY\(calc\(100%\s*\+\s*6px\)\)/s);
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout\s*\{[^}]*transition:[^}]*transform\s+0\.22s/s);
    // The tray animates from behind the primary (lower z-index), so its slide
    // can never intercept a click meant for the primary key.
    assert.match(css, /\.remote-panel__grid \.radio-tray > \.remote-panel__btn\s*\{[^}]*z-index:\s*2/s);
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout\s*\{[^}]*z-index:\s*1/s);
    assert.match(css, /\.remote-panel__grid \.radio-tray:hover > \.radio-tray__popout,\s*\.remote-panel__grid \.radio-tray:focus-within > \.radio-tray__popout\s*\{[^}]*transform:\s*translateX\(-50%\)\s*translateY\(0\)[^}]*visibility:\s*visible/s);
    // Hidden Stop all must not leave an empty dark tray on hover.
    assert.match(css, /\.remote-panel__grid \.radio-tray__popout:has\(> \.radio-tray__btn\.is-hidden\)\s*\{[^}]*display:\s*none/s);
    // Mini keypad must never scroll — a stray 1px scrollbar used to appear because
    // the 0.4rem gaps' subpixel rounding pushed the keypad past the dialog box.
    // The whole mini ancestor chain is overflow: visible, which also lets the
    // layout tray slide out of row 1 instead of being clipped to nothing. The
    // `#remote-shell` / `.is-active` parts of that selector list are load-bearing:
    // `#remote-shell #remote-panel.is-active` further up the same file out-ranks a
    // bare `#remote-panel` override.
    const miniOverflowGroup = css.match(/body\.remote-mini-floating #remote-module \.remote-module__dialog,[^{]*\{[^}]*\}/s);
    assert.ok(miniOverflowGroup, 'mini chain overflow rule group exists');
    assert.match(miniOverflowGroup[0], /body\.remote-mini-floating #remote-shell #remote-panel\.is-active/);
    assert.match(miniOverflowGroup[0], /overflow:\s*visible/);
    assert.doesNotMatch(miniOverflowGroup[0], /overflow:\s*(hidden|auto|scroll)/);

    // Keys keep the full remote's fixed key size instead of stretching to fill the
    // box, and the box takes its width from the grid (no inner padding/pad doubling).
    assert.match(css, /body\.remote-mini-floating #remote-panel \.remote-panel__grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*var\(--remote-btn-size/s);
    assert.match(css, /body\.remote-mini-floating #remote-panel \.remote-panel__grid\s*\{[^}]*grid-auto-rows:\s*var\(--remote-btn-size/s);
    assert.match(css, /body\.remote-mini-floating #remote-panel \.remote-panel__grid\s*\{[^}]*width:\s*max-content/s);
    assert.match(css, /body\.remote-mini-floating #remote-panel \.remote-panel__grid\s*\{[^}]*padding:\s*0/s);
    // Even frame: mini gets a symmetric pad on all four sides.
    assert.match(css, /body\.remote-mini-floating #remote-panel\s*\{[^}]*padding:\s*var\(--remote-space-md/s);

    // Mini layout tray: options compacted to fit the ~214px box, plus the flipped
    // variant used when there is no room above the key.
    assert.match(css, /body\.remote-mini-floating \.remote-panel__layout-popout \.remote-panel__layout-option\s*\{[^}]*width:\s*calc\(var\(--remote-btn-size, 40px\) \* 0\.8\)/s);
    assert.match(css, /body\.remote-mini-floating \.remote-panel__layout-wrap\.is-drop-down \.remote-panel__layout-popout\s*\{[^}]*top:\s*calc\(100% \+ 0\.35rem\)/s);
    // Bind menu: anchored to the key's left edge in mini so the 9.5rem list cannot
    // hang off the box (it used to be clipped entirely by the old overflow: hidden).
    assert.match(css, /body\.remote-mini-floating \.remote-panel__chan-bind-popup \.chan-bind-menu\s*\{[^}]*left:\s*0[^}]*transform:\s*none/s);
    // The empty dialog drag header must not consume keypad height in mini mode.
    assert.match(css, /body\.remote-mini-floating #remote-module \.remote-module__header,/);

    // Mini pad opens its tray on hover (the full remote keeps the click toggle),
    // and the dialog footprint follows the same fixed 4×3 token geometry as the CSS.
    const remotePanelJs = readFileSync(join(root, 'js/ui/remotePanel.js'), 'utf8');
    assert.match(remotePanelJs, /function isMiniFloating\(\)\s*\{[^}]*remote-mini-floating/s);
    assert.match(remotePanelJs, /wrap\.addEventListener\('pointerenter',[\s\S]{0,240}?openPicker\(name\);/);
    assert.match(remotePanelJs, /wrap\.addEventListener\('pointerleave',[\s\S]{0,400}?closePicker\(name\);[\s\S]{0,60}?POPOUT_HOVER_CLOSE_MS\);/);
    // Mini clamps against the viewport (its tray is wider than the box) and flips down.
    assert.match(remotePanelJs, /const root = mini\s*\?\s*document\.documentElement/);
    assert.match(remotePanelJs, /wrap\.classList\.add\('is-drop-down'\)/);

    const remoteModuleJs = readFileSync(join(root, 'js/ui/remoteModule.js'), 'utf8');
    assert.match(remoteModuleJs, /const MINI_COLS = 4;/);
    assert.match(remoteModuleJs, /const MINI_ROWS = 3;/);
    assert.match(remoteModuleJs, /const MINI_BTN = 40;/);
    assert.match(remoteModuleJs, /const MINI_GAP = 6\.4;/);
    assert.match(remoteModuleJs, /const MINI_PAD = 16;/);
    // Content is ceiled before the border so subpixel scaling cannot undershoot.
    assert.match(remoteModuleJs, /return Math\.ceil\(MINI_CONTENT_W \* clampModuleScale\(s\)\) \+ MINI_BORDER;/);
    assert.match(remoteModuleJs, /return Math\.ceil\(MINI_CONTENT_H \* clampModuleScale\(s\)\) \+ MINI_BORDER;/);
    assert.doesNotMatch(remoteModuleJs, /const MINI_BASE_W = 240;/);
    // Scale reset survives mini action pruning so a non-1× mini can recover.
    assert.match(html, /id="remote-scale-reset-btn"/);
    assert.match(css, /\.tv-module__action:not\(#remote-mini-float-btn\):not\(#remote-scale-reset-btn\):not\(#remote-collapse-header-btn\)/);
});

test('mini pad holds the top overlay slot so floating windows cannot bury its bottom row', () => {
    const moduleLayoutJs = readFileSync(join(root, 'js/ui/moduleLayout.js'), 'utf8');
    // SSOT: a pinned host is re-raised above whichever window was just raised, so the
    // last-interaction-wins stack can never paint the browser / multi-TV window and its
    // 1…9 screens strip over the keypad's third key row.
    assert.match(moduleLayoutJs, /const pinnedOverlayIds = new Set\(\);/);
    assert.match(moduleLayoutJs, /export function setOverlayPinnedTop\(id, pinned = true\)/);
    assert.match(moduleLayoutJs, /pinnedOverlayIds\.add\(id\)/);
    assert.match(moduleLayoutJs, /pinnedOverlayIds\.delete\(id\)/);
    // Pinned hosts are bumped after the target write, and raising a pinned host itself
    // must not bump twice (that keeps the stack counter honest).
    assert.match(
        moduleLayoutJs,
        /if \(pinnedOverlayIds\.size && !ids\.some\(\(id\) => pinnedOverlayIds\.has\(id\)\)\) \{/
    );

    const remoteModuleJs = readFileSync(join(root, 'js/ui/remoteModule.js'), 'utf8');
    assert.match(remoteModuleJs, /import \{[\s\S]*?\bsetOverlayPinnedTop\b[\s\S]*?\} from '\.\/moduleLayout\.js';/);
    // Pin follows the mini flag inside the shared body-class sync, so enter / exit /
    // close / hide / restored-mini sessions all converge on the same rule.
    assert.match(remoteModuleJs, /setOverlayPinnedTop\('remote-module', miniFloating\);/);
    // Entering mini claims the slot immediately: restored-mini skips the pointerdown raise.
    assert.match(remoteModuleJs, /function enterMiniFloating\(\)[\s\S]*?bringModuleToFront\(SHELL_REMOTE\);\n\}\n/);

    // Both float hosts sit on the same 8510 band, and the browser module is later in the
    // DOM, so it used to win the tie and cover the pad — pinning is what breaks it.
    const css = readCssWithImports(join(root, 'css/components/remote.css'));
    assert.match(css, /\.remote-module\s*\{[^}]*z-index:\s*8510/s);
    const remoteIdx = html.indexOf('id="remote-module"');
    const browserIdx = html.indexOf('id="browser-module"');
    assert.ok(remoteIdx > 0 && browserIdx > remoteIdx, 'browser module is later in the DOM than the remote module');
});

