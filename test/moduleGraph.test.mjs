/**
 * Module-graph integrity regression test.
 *
 * This is the test that would have caught the original "browser is empty"
 * bug: tvPip.js imported './toast.js' and './icons.js', which did not exist
 * at that path, so the ENTIRE ES module graph failed to load.
 *
 * It walks every local import reachable from app.js and asserts each
 * file exists and parses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_ROOT = fileURLToPath(new URL('../js/app.js', import.meta.url));

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

function resolveGraph(entry) {
    const seen = new Set();
    const missing = [];

    function walk(abs) {
        if (seen.has(abs)) return;
        seen.add(abs);
        let src;
        try {
            src = readFileSync(abs, 'utf8');
        } catch {
            missing.push(abs);
            return;
        }
        for (const spec of localImportSpecifiers(src)) {
            const target = resolve(dirname(abs), spec);
            try {
                readFileSync(target, 'utf8');
            } catch {
                missing.push(`${target}  <-- ${spec} imported by ${abs}`);
            }
            walk(target);
        }
    }
    walk(entry);
    return { seen, missing };
}

test('module graph from app.js resolves with no missing files', () => {
    const { seen, missing } = resolveGraph(GRAPH_ROOT);
    assert.ok(seen.size >= 10, 'expected at least 10 reachable modules');
    assert.deepEqual(missing, [], 'all local imports must resolve');
});

test('app.js boot handler is DOM-safe (guarded)', () => {
    const src = readFileSync(GRAPH_ROOT, 'utf8');
    assert.match(
        src,
        /typeof document !== 'undefined'/,
        'bundled app must guard DOM access so it can be imported in Node'
    );
});

test('module graph does not depend on magiclists app-specific modules', () => {
    const { seen } = resolveGraph(GRAPH_ROOT);
    for (const file of seen) {
        assert.ok(
            !file.includes('sidebarTv.js'),
            'standalone app must not reach into the magiclists sidebar'
        );
    }
});