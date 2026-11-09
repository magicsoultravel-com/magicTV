/**
 * Catalog entry reveal — every entry point (remote nav, chrome tile, Radio
 * Browse) must put the catalog on screen *before* it paints.
 *
 * Regression: Radio Browse called `RemoteModule.open()` only when the remote was
 * fully hidden, but `isOpen()` is `mode !== 'hidden'`. A collapsed docked sheet,
 * the mini keypad pad and a hidden split Browser pane are all "open" yet cannot
 * show a catalog, so clicking Browse looked like a no-op.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogEntryReveal } from '../js/ui/catalogModeEntry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const appJs = read('js/app.js');
const remoteModuleJs = read('js/ui/remoteModule.js');
const remotePanelJs = read('js/ui/remotePanel.js');

/** Sane defaults: joined layout, remote docked and expanded. */
const base = {
    mode: 'docked',
    miniFloating: false,
    sheetExpanded: true,
    split: false,
    browserHostKind: null
};

const reveal = (patch = {}) => catalogEntryReveal({ ...base, ...patch });

test('an expanded docked sheet needs no reveal', () => {
    assert.deepEqual(reveal(), {
        exitMini: false,
        open: false,
        expandSheet: false,
        revealBrowser: null
    });
});

test('an expanded floating remote needs no reveal', () => {
    assert.deepEqual(reveal({ mode: 'undocked' }), {
        exitMini: false,
        open: false,
        expandSheet: false,
        revealBrowser: null
    });
});

test('a collapsed docked sheet expands instead of being treated as open', () => {
    const plan = reveal({ sheetExpanded: false });
    assert.equal(plan.open, false, 'already docked — do not re-open');
    assert.equal(plan.expandSheet, true, 'the sheet must expand');
});

test('a closed remote opens as an expanded docked sheet', () => {
    const plan = reveal({ mode: 'hidden', sheetExpanded: false });
    assert.equal(plan.open, true);
    assert.equal(plan.expandSheet, false, 'open() expands the sheet itself');
});

test('the mini pad always exits first and never forces a sheet', () => {
    const plan = reveal({ mode: 'undocked', miniFloating: true });
    assert.equal(plan.exitMini, true);
    assert.equal(plan.open, false, 'exiting mini already restores a visible float');
    assert.equal(plan.expandSheet, false);
});

test('mini wins over every other state', () => {
    for (const patch of [
        { mode: 'hidden' },
        { mode: 'docked', sheetExpanded: false },
        { split: true, browserHostKind: 'hidden' }
    ]) {
        const plan = reveal({ mode: 'undocked', miniFloating: true, ...patch });
        assert.equal(plan.exitMini, true, `mini exits for ${JSON.stringify(patch)}`);
        assert.equal(plan.open, false, `mini exit is enough for ${JSON.stringify(patch)}`);
        assert.equal(plan.expandSheet, false, `no sheet while floating ${JSON.stringify(patch)}`);
    }
});

test('a hidden split Browser pane is revealed before painting', () => {
    const plan = reveal({ split: true, browserHostKind: 'hidden' });
    assert.equal(plan.revealBrowser, 'undocked');
    assert.equal(plan.open, false);
});

test('an OS-popped Browser pane is pulled back in-page', () => {
    assert.equal(reveal({ split: true, browserHostKind: 'os' }).revealBrowser, 'undocked');
});

test('a visible split Browser pane is left alone', () => {
    for (const kind of ['undocked', 'docked', null]) {
        assert.equal(
            reveal({ split: true, browserHostKind: kind }).revealBrowser,
            null,
            `browserHostKind ${kind} is already on screen`
        );
    }
});

test('joined layout ignores browserHostKind', () => {
    assert.equal(reveal({ split: false, browserHostKind: 'hidden' }).revealBrowser, null);
});

test('split also reveals when the remote itself is closed', () => {
    const plan = reveal({ mode: 'hidden', split: true, browserHostKind: 'hidden' });
    assert.equal(plan.open, true, 'the split remote pane still opens');
    assert.equal(plan.revealBrowser, 'undocked', 'and the pane comes back');
});

test('catalogEntryReveal tolerates missing state', () => {
    assert.deepEqual(catalogEntryReveal(), {
        exitMini: false,
        open: true,
        expandSheet: false,
        revealBrowser: null
    });
});

test('RemoteModule exposes revealCatalog and drives it off the pure helper', () => {
    assert.match(
        remoteModuleJs,
        /import \{ catalogEntryReveal \} from '\.\/catalogModeEntry\.js';/,
        'reveal logic stays in the unit-tested helper'
    );
    assert.match(
        remoteModuleJs,
        /^\s{4}revealCatalog\(\{ slotId = null, tab = null \} = \{\}\) \{/m,
        'exported entry point'
    );
    assert.match(remoteModuleJs, /if \(plan\.exitMini\) exitMiniFloating\(\);/, 'mini pad exits first');
    assert.match(remoteModuleJs, /if \(plan\.expandSheet\) \{/, 'collapsed dock expands');
    assert.match(remoteModuleJs, /if \(tab\) syncRemoteNav\(tab\);/, 'nav rows follow the tab');
});

test('Radio Browse reveals the catalog before it paints', () => {
    const radio = appJs.match(/function openRadioCatalog\([\s\S]*?\n\}/);
    assert.ok(radio, 'openRadioCatalog exists');
    const body = radio[0];
    const revealAt = body.indexOf('RemoteModule.revealCatalog?.({ tab: nextTab })');
    assert.ok(revealAt > -1, 'radio entry reveals the catalog');
    assert.ok(
        revealAt < body.indexOf('switchTab(nextTab)'),
        'reveal happens before the tab switch paints'
    );
    assert.ok(
        revealAt < body.indexOf('ensureBrowserCatalogVisible'),
        'reveal happens before the browser pane is ensured'
    );
    assert.doesNotMatch(
        body,
        /if \(!RemoteModule\.isOpen\?\.\(\)\)/,
        'isOpen() is true for a collapsed sheet — it cannot gate the reveal'
    );
});

test('TV catalog entries reveal too (remote shell, chrome tile, welcome)', () => {
    const tv = appJs.match(/function openTvCatalog\([\s\S]*?\n\}/);
    assert.ok(tv, 'openTvCatalog exists');
    assert.match(tv[0], /RemoteModule\.revealCatalog\?\.\(\{ tab: nextTab \}\)/, 'TV entry reveals');
});

test('remote nav keys still expand the mini pad first', () => {
    assert.match(
        remotePanelJs,
        /deps\.getRemoteModule\?\.\(\)\?\.exitMiniFloating\?\.\(\)/,
        'nav keys keep the original mini-pad escape'
    );
});

