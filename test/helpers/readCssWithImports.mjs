/**
 * Resolve CSS @import chains for static tests (no browser).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';

const IMPORT_RE = /@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g;

/**
 * @param {string} filePath absolute or cwd-relative path to a CSS file
 * @param {Set<string>} [seen]
 * @returns {string} concatenated CSS with imports inlined
 */
export function readCssWithImports(filePath, seen = new Set()) {
    const abs = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);
    if (seen.has(abs)) return '';
    seen.add(abs);
    const src = readFileSync(abs, 'utf8');
    const base = dirname(abs);
    return src.replace(IMPORT_RE, (_m, rel) => {
        const nested = join(base, rel);
        return `/* inlined ${rel} */\n${readCssWithImports(nested, seen)}\n`;
    });
}
