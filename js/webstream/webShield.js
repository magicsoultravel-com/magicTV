/**
 * Page shield for Web Video *embed* mode — the only ad/tracking defence a
 * static client can apply to a cross-origin iframe.
 *
 * A third-party page inside an iframe is a black box: the parent cannot inject
 * CSS/JS, block subresources, mute the site's player or remove in-stream ads.
 * What the parent *can* do is refuse capabilities, which is what actually
 * annoys people on ad-heavy pages:
 *
 *   - `allow-popups`           → no pop-unders / new-tab ads
 *   - `allow-top-navigation*`  → the frame cannot navigate magicTV away
 *   - `allow-downloads`        → no drive-by .exe / .dmg downloads
 *   - `allow-modals`           → no fake "your Flash is outdated" alert() scams
 *   - `allow-forms` (strict)   → no cross-tile form hijack / fake logins
 *
 * Levels:
 *   off    — today's plain attributes (escape hatch for sites that need popups)
 *   basic  — popups / top-nav / downloads / modals blocked, player untouched
 *   strict — basic + no forms + no-referrer
 *
 * `allow-scripts` and `allow-same-origin` stay in every sandboxed level: the
 * frame is cross-origin (so it cannot reach our window) and it needs its real
 * origin for cookies/localStorage, otherwise nearly every player breaks.
 *
 * Pure module (no globals): `applyShieldToFrame` only calls the element API it
 * is handed, so it is unit-testable in Node with a stub node.
 */

/** Supported levels, least → most restrictive. */
export const SHIELD_LEVELS = ['off', 'basic', 'strict'];

/** Default level (popups/dialogs/downloads blocked, player unaffected). */
export const DEFAULT_SHIELD_LEVEL = 'basic';

/** Permissions the player legitimately needs. */
const BASE_ALLOW = ['autoplay', 'fullscreen', 'encrypted-media', 'picture-in-picture'];

/** Feature-policy denials (already denied cross-origin, kept explicit). */
const DENIED_ALLOW = [
    'camera',
    'microphone',
    'geolocation',
    'payment',
    'usb',
    'serial',
    'hid',
    'midi',
    'clipboard-write',
    'display-capture'
];

const SANDBOX_BASIC = ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-presentation'];
const SANDBOX_STRICT = ['allow-scripts', 'allow-same-origin', 'allow-presentation'];

/** Referrer policy used when the shield is off (unchanged from v1 embed). */
export const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

const LABELS = { off: 'Off', basic: 'Basic', strict: 'Strict' };

const SUMMARIES = {
    off: 'Page loads exactly as it would in a normal tab.',
    basic: 'Blocks pop-ups, new-tab ads, downloads and alert() dialogs.',
    strict: 'Also blocks forms and sends no referrer.'
};

/**
 * @param {unknown} value
 * @returns {'off' | 'basic' | 'strict'}
 */
export function normalizeShieldLevel(value) {
    const level = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SHIELD_LEVELS.includes(level) ? level : DEFAULT_SHIELD_LEVEL;
}

/** True when the value is a real level (an absent value is ''). */
export function isShieldLevel(value) {
    return typeof value === 'string' && SHIELD_LEVELS.includes(value);
}

/**
 * Cycle used by the tile button: basic → strict → off → basic.
 * @param {string} level
 * @returns {'off' | 'basic' | 'strict'}
 */
export function nextShieldLevel(level) {
    const current = normalizeShieldLevel(level);
    if (current === 'basic') return 'strict';
    if (current === 'strict') return 'off';
    return 'basic';
}

/**
 * @param {string} level
 * @returns {string} 'Off' | 'Basic' | 'Strict' | '' for an unknown value
 */
export function shieldLabel(level) {
    return LABELS[level] || '';
}

/**
 * One-line explanation for hints and titles.
 * @param {string} level
 * @returns {string}
 */
export function shieldSummary(level) {
    return SUMMARIES[level] || '';
}

/**
 * Attributes implied by a level.
 * @param {string} level
 * @returns {{ level: string, active: boolean, sandbox: string, allow: string, referrerpolicy: string }}
 */
export function buildShieldAttributes(level) {
    const normalized = normalizeShieldLevel(level);
    const allow = [...BASE_ALLOW, ...DENIED_ALLOW.map((feature) => `${feature} 'none'`)].join('; ');
    if (normalized === 'off') {
        return {
            level: normalized,
            active: false,
            sandbox: '',
            allow,
            referrerpolicy: DEFAULT_REFERRER_POLICY
        };
    }
    const tokens = normalized === 'strict' ? SANDBOX_STRICT : SANDBOX_BASIC;
    return {
        level: normalized,
        active: true,
        sandbox: tokens.join(' '),
        allow,
        referrerpolicy: normalized === 'strict' ? 'no-referrer' : DEFAULT_REFERRER_POLICY
    };
}

/**
 * Apply (or remove) the shield attributes on a live iframe.
 *
 * Sandbox flags are only honoured at navigation, so the caller must re-navigate
 * when `changed` is true and the frame already loaded something.
 *
 * @param {any} frame iframe-ish element (setAttribute/getAttribute/removeAttribute)
 * @param {string} level
 * @returns {{ level: string, active: boolean, changed: boolean }}
 */
export function applyShieldToFrame(frame, level) {
    const spec = buildShieldAttributes(level);
    if (!frame?.setAttribute) {
        return { level: spec.level, active: spec.active, changed: false };
    }

    let changed = false;
    const set = (name, value) => {
        if ((frame.getAttribute?.(name) ?? null) !== value) {
            frame.setAttribute(name, value);
            changed = true;
        }
    };
    const clear = (name) => {
        if (frame.getAttribute?.(name) !== null && frame.getAttribute?.(name) !== undefined) {
            frame.removeAttribute?.(name);
            changed = true;
        }
    };

    if (spec.sandbox) set('sandbox', spec.sandbox);
    else clear('sandbox');

    set('allow', spec.allow);
    set('referrerpolicy', spec.referrerpolicy);

    return { level: spec.level, active: spec.active, changed };
}
