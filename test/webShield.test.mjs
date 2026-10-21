/**
 * Page shield: levels, sandbox/permission attributes and the iframe applier.
 *
 * The shield is the only ad/nuisance defence a static page can apply to a
 * cross-origin embed — it works by *denying capabilities* (popups, top
 * navigation, downloads, modals), never by injecting into the page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_REFERRER_POLICY,
    DEFAULT_SHIELD_LEVEL,
    SHIELD_LEVELS,
    applyShieldToFrame,
    buildShieldAttributes,
    isShieldLevel,
    nextShieldLevel,
    normalizeShieldLevel,
    shieldLabel,
    shieldSummary
} from '../js/webstream/webShield.js';

function makeFrame(initial = {}) {
    const attrs = new Map(Object.entries(initial));
    return {
        attrs,
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        removeAttribute(name) { attrs.delete(name); }
    };
}

test('three levels with Basic as the default', () => {
    assert.deepEqual(SHIELD_LEVELS, ['off', 'basic', 'strict']);
    assert.equal(DEFAULT_SHIELD_LEVEL, 'basic');
});

test('normalizeShieldLevel accepts known levels and falls back to Basic', () => {
    assert.equal(normalizeShieldLevel('off'), 'off');
    assert.equal(normalizeShieldLevel('STRICT'), 'strict');
    assert.equal(normalizeShieldLevel(' Basic '), 'basic');
    assert.equal(normalizeShieldLevel('aggressive'), 'basic', 'garbage never enables a stricter claim');
    assert.equal(normalizeShieldLevel(''), 'basic');
    assert.equal(normalizeShieldLevel(null), 'basic');
    assert.equal(normalizeShieldLevel(undefined), 'basic');
    assert.equal(normalizeShieldLevel(42), 'basic');
});

test('isShieldLevel only accepts a stored level (an absent value stays absent)', () => {
    assert.equal(isShieldLevel('basic'), true);
    assert.equal(isShieldLevel('off'), true);
    assert.equal(isShieldLevel(''), false, 'unset means “use the global setting”');
    assert.equal(isShieldLevel(undefined), false);
});

test('nextShieldLevel cycles basic → strict → off → basic', () => {
    assert.equal(nextShieldLevel('basic'), 'strict');
    assert.equal(nextShieldLevel('strict'), 'off');
    assert.equal(nextShieldLevel('off'), 'basic');
    assert.equal(nextShieldLevel(''), 'strict', 'unknown values normalize to basic first');
});

test('basic sandbox blocks popups, top navigation, downloads and modals', () => {
    const spec = buildShieldAttributes('basic');
    assert.equal(spec.level, 'basic');
    assert.equal(spec.active, true);
    const tokens = spec.sandbox.split(' ');
    assert.deepEqual(tokens, ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-presentation']);
    for (const denied of ['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-top-navigation',
        'allow-top-navigation-by-user-activation', 'allow-downloads', 'allow-modals', 'allow-pointer-lock']) {
        assert.equal(tokens.includes(denied), false, `${denied} must stay off`);
    }
    assert.equal(spec.referrerpolicy, DEFAULT_REFERRER_POLICY);
});

test('strict also drops forms and the referrer', () => {
    const spec = buildShieldAttributes('strict');
    assert.equal(spec.active, true);
    const tokens = spec.sandbox.split(' ');
    assert.equal(tokens.includes('allow-forms'), false);
    assert.equal(tokens.includes('allow-scripts'), true);
    assert.equal(tokens.includes('allow-same-origin'), true, 'cookies/localStorage are required by players');
    assert.equal(spec.referrerpolicy, 'no-referrer');
});

test('off removes the sandbox entirely (plain embed, like before the shield)', () => {
    const spec = buildShieldAttributes('off');
    assert.equal(spec.level, 'off');
    assert.equal(spec.active, false);
    assert.equal(spec.sandbox, '');
    assert.equal(spec.referrerpolicy, DEFAULT_REFERRER_POLICY);
});

test('every level keeps playback permissions and denies sensors/payment', () => {
    for (const level of SHIELD_LEVELS) {
        const allow = buildShieldAttributes(level).allow;
        assert.match(allow, /autoplay/);
        assert.match(allow, /fullscreen/);
        assert.match(allow, /encrypted-media/);
        assert.match(allow, /picture-in-picture/);
        for (const denied of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'midi',
            'clipboard-write', 'display-capture']) {
            assert.ok(allow.includes(`${denied} 'none'`), `${level}: ${denied} should be denied`);
        }
    }
});

test('applyShieldToFrame writes sandbox/allow/referrerpolicy once', () => {
    const frame = makeFrame();
    const first = applyShieldToFrame(frame, 'basic');
    assert.equal(first.changed, true);
    assert.equal(first.active, true);
    assert.equal(frame.getAttribute('sandbox'), buildShieldAttributes('basic').sandbox);
    assert.equal(frame.getAttribute('referrerpolicy'), DEFAULT_REFERRER_POLICY);
    assert.match(frame.getAttribute('allow'), /autoplay/);
});

test('applyShieldToFrame is idempotent (no reload churn on re-render)', () => {
    const frame = makeFrame();
    applyShieldToFrame(frame, 'strict');
    const again = applyShieldToFrame(frame, 'strict');
    assert.equal(again.changed, false);
    assert.equal(again.level, 'strict');
});

test('applyShieldToFrame never touches src or title', () => {
    const frame = makeFrame({ src: 'https://site.tv/watch/42', title: 'Site' });
    applyShieldToFrame(frame, 'strict');
    assert.equal(frame.getAttribute('src'), 'https://site.tv/watch/42');
    assert.equal(frame.getAttribute('title'), 'Site');
    applyShieldToFrame(frame, 'off');
    assert.equal(frame.getAttribute('src'), 'https://site.tv/watch/42');
    assert.equal(frame.getAttribute('title'), 'Site');
});

test('tightening basic → strict rewrites the sandbox and the referrer', () => {
    const frame = makeFrame();
    applyShieldToFrame(frame, 'basic');
    const result = applyShieldToFrame(frame, 'strict');
    assert.equal(result.changed, true);
    assert.equal(frame.getAttribute('sandbox'), buildShieldAttributes('strict').sandbox);
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
});

test('turning the shield off removes the sandbox attribute', () => {
    const frame = makeFrame();
    applyShieldToFrame(frame, 'basic');
    const result = applyShieldToFrame(frame, 'off');
    assert.equal(result.changed, true);
    assert.equal(result.active, false);
    assert.equal(frame.getAttribute('sandbox'), null);
    assert.equal(frame.getAttribute('referrerpolicy'), DEFAULT_REFERRER_POLICY);
});

test('applyShieldToFrame tolerates a missing frame', () => {
    assert.deepEqual(applyShieldToFrame(null, 'basic'), { level: 'basic', active: true, changed: false });
    assert.deepEqual(applyShieldToFrame(undefined, 'off'), { level: 'off', active: false, changed: false });
});

test('labels and summaries describe each level', () => {
    assert.equal(shieldLabel('off'), 'Off');
    assert.equal(shieldLabel('basic'), 'Basic');
    assert.equal(shieldLabel('strict'), 'Strict');
    assert.equal(shieldLabel(''), '');
    assert.match(shieldSummary('basic'), /pop-up/i);
    assert.match(shieldSummary('strict'), /forms|referrer/i);
    assert.equal(shieldSummary('nope'), '');
});
