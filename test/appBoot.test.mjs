/**
 * Verifies the top-level app module can be imported in a non-browser
 * environment (guarded boot) and that wired element ids exist in index.html.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAGICTV_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH_ROOT = join(MAGICTV_DIR, 'js', 'app.js');

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

function localImportSpecifiers(source) {
    const specs = [];
    const re = /(?:import[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"])/g;
    let m;
    while ((m = re.exec(source))) {
        const spec = m[1] || m[2];
        if (spec && spec.startsWith('.')) specs.push(spec);
    }
    return specs;
}

function collectElIds(entry) {
    const seen = new Set();
    const ids = new Set();

    function walk(abs) {
        if (seen.has(abs)) return;
        seen.add(abs);
        let src;
        try {
            src = readFileSync(abs, 'utf8');
        } catch {
            return;
        }
        for (const id of src.matchAll(/el\('([^']+)'\)/g)) {
            ids.add(id[1]);
        }
        for (const spec of localImportSpecifiers(src)) {
            walk(resolve(dirname(abs), spec));
        }
    }
    walk(entry);
    return [...ids];
}

test('app.js imports without a DOM and does not throw', async () => {
    // No document defined here — the guarded boot path must skip init silently.
    await import('../js/app.js');
    const { TvPlayer } = await import('../js/tvPlayer.js');
    const { TvProviderRegistry } = await import('../js/tvProviders/registry.js');
    assert.ok(TvPlayer, 'TvPlayer module loads');
    assert.ok(TvProviderRegistry, 'TvProviderRegistry module loads');
});

test('index.html references every element id the app wires up', () => {
    const html = readFileSync(join(MAGICTV_DIR, 'index.html'), 'utf8');
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const needed = collectElIds(GRAPH_ROOT);

    const missing = needed.filter((id) => !ids.includes(id));
    assert.deepEqual(missing, [], 'every element id requested from the app module graph must exist in index.html');
});
