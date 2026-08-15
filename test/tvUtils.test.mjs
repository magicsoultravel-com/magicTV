/** Unit tests for js/tvUtils.js (pure helpers, no DOM needed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, countryFlagEmoji, debounce } from '../js/tvUtils.js';

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