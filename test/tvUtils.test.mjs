/** Unit tests for js/tvUtils.js (pure helpers, no DOM needed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, countryFlagEmoji, debounce, formatRelativeTime } from '../js/tvUtils.js';

test('escapeHtml escapes HTML metacharacters', () => {
    assert.equal(escapeHtml('<script>&"quoted"</script>'),
        '&lt;script&gt;&amp;&quot;quoted&quot;&lt;/script&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml('plain text'), 'plain text');
});

test('countryFlagEmoji returns regional indicator flag for 2-letter codes', () => {
    assert.equal(countryFlagEmoji('US'), '🇺🇸');
    assert.equal(countryFlagEmoji('DE'), '🇩🇪');
    assert.equal(countryFlagEmoji('gb'), '🇬🇧');
});

test('countryFlagEmoji falls back for invalid input', () => {
    assert.equal(countryFlagEmoji(null), '🌐');
    assert.equal(countryFlagEmoji(''), '🌐');
    assert.equal(countryFlagEmoji('USA'), '🌐');
    assert.equal(countryFlagEmoji('@'), '🌐');
    assert.equal(countryFlagEmoji('11'), '🌐');
});

test('debounce waits and invokes once', async () => {
    let calls = 0;
    const fn = debounce(() => { calls += 1; }, 20);

    fn();
    fn();
    fn();
    assert.equal(calls, 0, 'not called before the delay');

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, 1, 'called exactly once after trailing delay');

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, 1, 'no extra calls without new input');
});
test('formatRelativeTime buckets timestamps into friendly labels', () => {
    const now = 1_000_000_000_000;
    assert.equal(formatRelativeTime(now - 10_000, now), 'just now');
    assert.equal(formatRelativeTime(now - 3 * 60_000, now), '3m ago');
    assert.equal(formatRelativeTime(now - 2 * 3_600_000, now), '2h ago');
    assert.equal(formatRelativeTime(now - 5 * 86_400_000, now), '5d ago');
    assert.equal(formatRelativeTime(now - 3 * 7 * 86_400_000, now), '3w ago');
});

test('formatRelativeTime returns empty for missing timestamps', () => {
    assert.equal(formatRelativeTime(0), '');
    assert.equal(formatRelativeTime(null), '');
    assert.equal(formatRelativeTime(undefined), '');
    assert.equal(formatRelativeTime(NaN), '');
});