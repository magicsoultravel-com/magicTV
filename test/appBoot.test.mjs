/**
 * Verifies the top-level app module can be imported in a non-browser
 * environment (guarded boot) and exposes its public API.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAGICTV_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        matchMedia: () => ({ matches: true })
    };
});

test('app.js imports without a DOM and does not throw', async () => {
    // No document defined here — the guarded boot path must skip init silently.
    const mod = await import('../js/app.js');
    assert.ok(mod.TvPlayer, 'app exports TvPlayer');
    assert.ok(mod.TvProviderRegistry, 'app exports TvProviderRegistry');
});

test('index.html references every element id the app wires up', () => {
    const html = readFileSync(join(MAGICTV_DIR, 'index.html'), 'utf8');
    const appJs = readFileSync(join(MAGICTV_DIR, 'js', 'app.js'), 'utf8');

    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const needed = [...appJs.matchAll(/el\('([^']+)'\)/g)].map((m) => m[1]);

    const missing = [...new Set(needed)].filter((id) => !ids.includes(id));
    assert.deepEqual(missing, [], 'every element id requested by app.js must exist in index.html');
});