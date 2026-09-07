/**
 * Classical CRT + T-800 (red HUD) + T-1000 (liquid metal) power-style transitions.
 * Host-scoped: tile / catalog panel; power-off uses full-viewport overlay + app content.
 */
import { el } from '../tvUtils.js';
import {
    VIEW_MOTION,
    SHUTDOWN_MOTION,
    POWER_STYLE_TRANSITIONS,
    normalizeViewTransition
} from './viewTransitions.js';

let shutdownBusy = false;

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitAnim(anim) {
    if (!anim || typeof anim.finished?.then !== 'function') {
        return Promise.resolve();
    }
    return anim.finished.catch(() => {});
}

function contentTarget(host) {
    if (!host) return null;
    if (host.id === 'app-container') return host;
    return host.querySelector('.tv-playback-surface')
        || host.querySelector('.tv-catalog-body')
        || host;
}

function ensurePowerFx(host) {
    if (!host) return null;
    let root = host.querySelector(':scope > .power-fx');
    if (!root) {
        root = document.createElement('div');
        root.className = 'power-fx';
        root.setAttribute('aria-hidden', 'true');
        root.innerHTML = [
            '<div class="power-fx__veil"></div>',
            '<div class="power-fx__crt-line"></div>',
            '<div class="power-fx__crt-dot"></div>',
            '<div class="power-fx__hud"></div>',
            '<div class="power-fx__scanlines"></div>',
            '<div class="power-fx__metal"></div>',
            '<div class="power-fx__hud-text" aria-hidden="true"></div>'
        ].join('');
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null;
        if (cs && cs.position === 'static') {
            host.dataset.powerFxPos = '1';
            host.style.position = 'relative';
        }
        host.appendChild(root);
    } else if (!root.querySelector('.power-fx__hud-text')) {
        const text = document.createElement('div');
        text.className = 'power-fx__hud-text';
        text.setAttribute('aria-hidden', 'true');
        root.appendChild(text);
    }
    return root;
}

function clearPowerFxInline(host, fx, target, overlayHost) {
    if (target) {
        target.style.transform = '';
        target.style.filter = '';
        target.style.opacity = '';
        target.style.transformOrigin = '';
    }
    if (fx) {
        fx.className = 'power-fx';
        fx.style.opacity = '';
        fx.querySelectorAll(
            '.power-fx__veil, .power-fx__crt-line, .power-fx__crt-dot, .power-fx__hud, .power-fx__metal, .power-fx__scanlines, .power-fx__hud-text'
        ).forEach((node) => {
            node.style.opacity = '';
            node.style.transform = '';
            node.style.filter = '';
            if (node.classList.contains('power-fx__hud-text')) {
                node.textContent = '';
                node.innerHTML = '';
            }
        });
    }
    const posHost = overlayHost || host;
    if (posHost?.dataset?.powerFxPos === '1') {
        posHost.style.position = '';
        delete posHost.dataset.powerFxPos;
    }
    host?.classList.remove('is-power-fx');
    overlayHost?.classList.remove('is-power-fx', 'is-active');
}

function resolveDuration(mode, opts) {
    if (typeof opts.duration === 'number') return opts.duration;
    const table = opts.motionTable || VIEW_MOTION;
    const cfg = table[mode] || table.classical || VIEW_MOTION.classical;
    return cfg.duration;
}

function resolveEasing(mode, opts) {
    const table = opts.motionTable || VIEW_MOTION;
    const cfg = table[mode] || table.classical || VIEW_MOTION.classical;
    return cfg.easing || 'ease-in-out';
}

/**
 * @param {HTMLElement} host content host
 * @param {'out'|'in'} phase
 * @param {number} duration
 * @param {string} easing
 * @param {HTMLElement | null} [overlayHost] when set, FX layers live here (full-screen shutdown)
 */
async function runClassicalPhase(host, phase, duration, easing, overlayHost = null) {
    const fxParent = overlayHost || host;
    const fx = ensurePowerFx(fxParent);
    const target = contentTarget(host);
    if (!fx || !target) return;

    const veil = fx.querySelector('.power-fx__veil');
    const line = fx.querySelector('.power-fx__crt-line');
    const dot = fx.querySelector('.power-fx__crt-dot');
    host.classList.add('is-power-fx');
    fxParent.classList.add('is-power-fx');
    if (overlayHost) overlayHost.classList.add('is-active');
    fx.classList.add('is-active', 'power-fx--classical');

    const half = { duration, easing, fill: 'forwards' };

    if (phase === 'out') {
        if (veil) veil.style.opacity = '0';
        if (line) {
            line.style.opacity = '0';
            line.style.transform = 'scaleX(1) scaleY(1)';
        }
        if (dot) {
            dot.style.opacity = '0';
            dot.style.transform = 'scale(1)';
        }
        target.style.transformOrigin = 'center center';

        const contentOut = target.animate(
            [
                { filter: 'brightness(1) contrast(1)', transform: 'scaleY(1) scaleX(1)', opacity: 1 },
                { filter: 'brightness(1.55) contrast(1.1)', transform: 'scaleY(1) scaleX(1)', opacity: 1, offset: 0.12 },
                { filter: 'brightness(2.4) contrast(1.2)', transform: 'scaleY(0.018) scaleX(1)', opacity: 1, offset: 0.52 },
                { filter: 'brightness(4)', transform: 'scaleY(0.018) scaleX(0.04)', opacity: 1, offset: 0.78 },
                { filter: 'brightness(0)', transform: 'scaleY(0.018) scaleX(0.02)', opacity: 0 }
            ],
            half
        );
        const lineOut = line?.animate(
            [
                { opacity: 0, transform: 'scaleX(0.2) scaleY(1)' },
                { opacity: 0, offset: 0.35 },
                { opacity: 1, transform: 'scaleX(1) scaleY(1)', offset: 0.52 },
                { opacity: 1, transform: 'scaleX(0.08) scaleY(1)', offset: 0.78 },
                { opacity: 0, transform: 'scaleX(0.02) scaleY(1)' }
            ],
            half
        );
        const dotOut = dot?.animate(
            [
                { opacity: 0, transform: 'scale(0.4)' },
                { opacity: 0, offset: 0.7 },
                { opacity: 1, transform: 'scale(1)', offset: 0.85 },
                { opacity: 0, transform: 'scale(0.15)' }
            ],
            half
        );
        const veilOut = veil?.animate(
            [
                { opacity: 0 },
                { opacity: 0, offset: 0.7 },
                { opacity: 1 }
            ],
            half
        );
        await Promise.all([waitAnim(contentOut), waitAnim(lineOut), waitAnim(dotOut), waitAnim(veilOut)]);
        try {
            [contentOut, lineOut, dotOut, veilOut].forEach((a) => a?.cancel?.());
        } catch { /* ignore */ }
        target.style.opacity = '0';
        target.style.filter = overlayHost ? '' : 'brightness(0)';
        target.style.transform = '';
        if (veil) veil.style.opacity = '1';
        return;
    }

    if (veil) veil.style.opacity = '1';
    target.style.opacity = '0';
    target.style.filter = 'brightness(0)';
    target.style.transform = 'scaleY(0.018) scaleX(0.02)';
    target.style.transformOrigin = 'center center';

    const contentIn = target.animate(
        [
            { filter: 'brightness(0)', transform: 'scaleY(0.018) scaleX(0.02)', opacity: 0 },
            { filter: 'brightness(4)', transform: 'scaleY(0.018) scaleX(0.04)', opacity: 1, offset: 0.22 },
            { filter: 'brightness(2.2)', transform: 'scaleY(0.018) scaleX(1)', opacity: 1, offset: 0.48 },
            { filter: 'brightness(1.4)', transform: 'scaleY(1) scaleX(1)', opacity: 1, offset: 0.88 },
            { filter: 'brightness(1) contrast(1)', transform: 'scaleY(1) scaleX(1)', opacity: 1 }
        ],
        half
    );
    const lineIn = line?.animate(
        [
            { opacity: 0, transform: 'scaleX(0.02) scaleY(1)' },
            { opacity: 1, transform: 'scaleX(0.08) scaleY(1)', offset: 0.18 },
            { opacity: 1, transform: 'scaleX(1) scaleY(1)', offset: 0.48 },
            { opacity: 0, transform: 'scaleX(1) scaleY(1)', offset: 0.62 },
            { opacity: 0 }
        ],
        half
    );
    const dotIn = dot?.animate(
        [
            { opacity: 1, transform: 'scale(0.2)' },
            { opacity: 1, transform: 'scale(1)', offset: 0.12 },
            { opacity: 0, transform: 'scale(0.4)', offset: 0.28 },
            { opacity: 0 }
        ],
        half
    );
    const veilIn = veil?.animate(
        [
            { opacity: 1 },
            { opacity: 1, offset: 0.15 },
            { opacity: 0, offset: 0.55 },
            { opacity: 0 }
        ],
        half
    );
    await Promise.all([waitAnim(contentIn), waitAnim(lineIn), waitAnim(dotIn), waitAnim(veilIn)]);
    try {
        [contentIn, lineIn, dotIn, veilIn].forEach((a) => a?.cancel?.());
    } catch { /* ignore */ }
    clearPowerFxInline(host, fx, target, overlayHost);
}

const T800_HUD_LINES = [
    'ANALYSIS: VISUAL INPUT DEGRADING',
    'PRIMARY SYSTEMS: FAILING',
    'CPU: CRITICAL',
    'HASTA LA VISTA, BABY'
];

function waitMs(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
    });
}

/**
 * Type HUD lines with a delayed ghost echo (movie-style repeating readout).
 * @param {HTMLElement | null} textEl
 * @param {number} duration
 * @param {'out'|'in'} phase
 */
async function runT800HudText(textEl, duration, phase) {
    if (!textEl) return;
    textEl.innerHTML = '';
    textEl.style.opacity = '1';

    const lines = phase === 'in'
        ? ['SYSTEMS ONLINE', 'OPTICAL: RESTORE', 'STANDBY CLEAR']
        : T800_HUD_LINES;

    const budget = Math.max(duration * 0.72, 400);
    const perLine = budget / lines.length;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const row = document.createElement('div');
        row.className = 'power-fx__hud-line';
        const main = document.createElement('span');
        main.className = 'power-fx__hud-main';
        const echo = document.createElement('span');
        echo.className = 'power-fx__hud-echo';
        echo.setAttribute('aria-hidden', 'true');
        row.appendChild(main);
        row.appendChild(echo);
        textEl.appendChild(row);

        const charMs = Math.min(28, Math.max(10, (perLine * 0.55) / Math.max(line.length, 1)));
        let built = '';
        for (let c = 0; c < line.length; c++) {
            built += line[c];
            main.textContent = built;
            echo.textContent = built;
            await waitMs(charMs);
        }
        // Echo linger / offset pulse
        echo.classList.add('is-echoing');
        await waitMs(perLine * 0.28);
        if (phase === 'out' && i === lines.length - 1) {
            row.classList.add('is-final');
        }
    }
}

async function runT800Phase(host, phase, duration, easing, overlayHost = null) {
    const fxParent = overlayHost || host;
    const fx = ensurePowerFx(fxParent);
    const target = contentTarget(host);
    if (!fx || !target) return;

    const veil = fx.querySelector('.power-fx__veil');
    const hud = fx.querySelector('.power-fx__hud');
    const scan = fx.querySelector('.power-fx__scanlines');
    const textEl = fx.querySelector('.power-fx__hud-text');
    const metal = fx.querySelector('.power-fx__metal');
    if (metal) metal.style.opacity = '0';

    host.classList.add('is-power-fx');
    fxParent.classList.add('is-power-fx');
    if (overlayHost) overlayHost.classList.add('is-active');
    fx.classList.add('is-active', 'power-fx--t800');

    const half = { duration, easing, fill: 'forwards' };

    if (phase === 'out') {
        if (veil) veil.style.opacity = '0';
        target.style.transformOrigin = 'center center';

        const textPromise = runT800HudText(textEl, duration, 'out');

        const contentOut = target.animate(
            [
                { filter: 'brightness(1) saturate(1) contrast(1)', transform: 'scale(1)', opacity: 1 },
                {
                    filter: 'brightness(0.75) saturate(1.6) contrast(1.25) hue-rotate(-12deg)',
                    transform: 'scale(1.02)',
                    opacity: 1,
                    offset: 0.2
                },
                {
                    filter: 'brightness(0.55) saturate(2) contrast(1.45) hue-rotate(-18deg)',
                    transform: 'scale(1.01)',
                    opacity: 1,
                    offset: 0.55
                },
                {
                    filter: 'brightness(0.25) saturate(1.2) contrast(1.6)',
                    transform: 'scale(0.98)',
                    opacity: 0.45,
                    offset: 0.82
                },
                { filter: 'brightness(0)', transform: 'scale(0.96)', opacity: 0 }
            ],
            half
        );
        const hudOut = hud?.animate(
            [
                { opacity: 0 },
                { opacity: 0.65, offset: 0.1 },
                { opacity: 0.85, offset: 0.45 },
                { opacity: 0.5, offset: 0.8 },
                { opacity: 0 }
            ],
            half
        );
        const scanOut = scan?.animate(
            [
                { opacity: 0 },
                { opacity: 0.55, offset: 0.12 },
                { opacity: 0.8, offset: 0.5 },
                { opacity: 0.25, offset: 0.85 },
                { opacity: 0 }
            ],
            half
        );
        const veilOut = veil?.animate(
            [
                { opacity: 0 },
                { opacity: 0, offset: 0.7 },
                { opacity: 1 }
            ],
            half
        );
        const textFade = textEl?.animate(
            [
                { opacity: 1 },
                { opacity: 1, offset: 0.78 },
                { opacity: 0 }
            ],
            half
        );

        await Promise.all([
            waitAnim(contentOut),
            waitAnim(hudOut),
            waitAnim(scanOut),
            waitAnim(veilOut),
            waitAnim(textFade),
            textPromise
        ]);
        try {
            [contentOut, hudOut, scanOut, veilOut, textFade].forEach((a) => a?.cancel?.());
        } catch { /* ignore */ }
        target.style.opacity = '0';
        target.style.filter = overlayHost ? '' : 'brightness(0)';
        target.style.transform = '';
        if (textEl) {
            textEl.style.opacity = '0';
            textEl.innerHTML = '';
        }
        if (veil) veil.style.opacity = '1';
        return;
    }

    if (veil) veil.style.opacity = '1';
    target.style.opacity = '0';
    target.style.filter = 'brightness(0)';
    target.style.transform = 'scale(0.96)';
    target.style.transformOrigin = 'center center';
    if (textEl) textEl.innerHTML = '';

    const textPromise = runT800HudText(textEl, duration, 'in');

    const contentIn = target.animate(
        [
            { filter: 'brightness(0)', transform: 'scale(0.96)', opacity: 0 },
            {
                filter: 'brightness(0.4) saturate(1.8) hue-rotate(-14deg)',
                transform: 'scale(0.99)',
                opacity: 0.7,
                offset: 0.35
            },
            {
                filter: 'brightness(0.85) saturate(1.3) hue-rotate(-6deg)',
                transform: 'scale(1.01)',
                opacity: 1,
                offset: 0.75
            },
            { filter: 'brightness(1) saturate(1)', transform: 'scale(1)', opacity: 1 }
        ],
        half
    );
    const hudIn = hud?.animate(
        [
            { opacity: 0 },
            { opacity: 0.7, offset: 0.25 },
            { opacity: 0.55, offset: 0.55 },
            { opacity: 0 }
        ],
        half
    );
    const scanIn = scan?.animate(
        [
            { opacity: 0 },
            { opacity: 0.6, offset: 0.3 },
            { opacity: 0.35, offset: 0.65 },
            { opacity: 0 }
        ],
        half
    );
    const veilIn = veil?.animate(
        [
            { opacity: 1 },
            { opacity: 0.5, offset: 0.25 },
            { opacity: 0, offset: 0.6 },
            { opacity: 0 }
        ],
        half
    );
    const textFade = textEl?.animate(
        [
            { opacity: 0 },
            { opacity: 1, offset: 0.15 },
            { opacity: 1, offset: 0.7 },
            { opacity: 0 }
        ],
        half
    );

    await Promise.all([
        waitAnim(contentIn),
        waitAnim(hudIn),
        waitAnim(scanIn),
        waitAnim(veilIn),
        waitAnim(textFade),
        textPromise
    ]);
    try {
        [contentIn, hudIn, scanIn, veilIn, textFade].forEach((a) => a?.cancel?.());
    } catch { /* ignore */ }
    clearPowerFxInline(host, fx, target, overlayHost);
}

async function runT1000Phase(host, phase, duration, easing, overlayHost = null) {
    const fxParent = overlayHost || host;
    const fx = ensurePowerFx(fxParent);
    const target = contentTarget(host);
    if (!fx || !target) return;

    const veil = fx.querySelector('.power-fx__veil');
    const metal = fx.querySelector('.power-fx__metal');
    const hud = fx.querySelector('.power-fx__hud');
    const scan = fx.querySelector('.power-fx__scanlines');
    const textEl = fx.querySelector('.power-fx__hud-text');
    if (hud) hud.style.opacity = '0';
    if (scan) scan.style.opacity = '0';
    if (textEl) {
        textEl.style.opacity = '0';
        textEl.innerHTML = '';
    }

    host.classList.add('is-power-fx');
    fxParent.classList.add('is-power-fx');
    if (overlayHost) overlayHost.classList.add('is-active');
    fx.classList.add('is-active', 'power-fx--t1000');

    const half = { duration, easing, fill: 'forwards' };

    if (phase === 'out') {
        if (veil) veil.style.opacity = '0';
        target.style.transformOrigin = 'center center';

        const contentOut = target.animate(
            [
                { filter: 'brightness(1) saturate(1) contrast(1)', transform: 'scale(1) skewX(0deg)', opacity: 1 },
                {
                    filter: 'brightness(1.25) saturate(0.55) contrast(1.35)',
                    transform: 'scaleY(0.97) scaleX(1.03) skewX(-1deg)',
                    opacity: 1,
                    offset: 0.22
                },
                {
                    filter: 'brightness(1.55) saturate(0.2) contrast(1.5)',
                    transform: 'scaleY(0.7) scaleX(1.12) skewX(3deg)',
                    opacity: 0.85,
                    offset: 0.55
                },
                {
                    filter: 'brightness(1.9) saturate(0) contrast(1.7)',
                    transform: 'scaleY(0.28) scaleX(1.2) skewX(-4deg)',
                    opacity: 0.4,
                    offset: 0.8
                },
                {
                    filter: 'brightness(0)',
                    transform: 'scaleY(0.06) scaleX(1.35)',
                    opacity: 0
                }
            ],
            half
        );
        const metalOut = metal?.animate(
            [
                { opacity: 0, transform: 'scale(1.08)', filter: 'blur(10px)' },
                { opacity: 0.35, transform: 'scale(1.02)', filter: 'blur(4px)', offset: 0.18 },
                { opacity: 0.95, transform: 'scale(1)', filter: 'blur(0.5px)', offset: 0.42 },
                { opacity: 1, transform: 'scaleY(0.55) scaleX(1.18)', filter: 'blur(0px)', offset: 0.72 },
                { opacity: 0, transform: 'scaleY(0.08) scaleX(1.4)', filter: 'blur(3px)' }
            ],
            half
        );
        const veilOut = veil?.animate(
            [
                { opacity: 0 },
                { opacity: 0, offset: 0.58 },
                { opacity: 1 }
            ],
            half
        );
        await Promise.all([waitAnim(contentOut), waitAnim(metalOut), waitAnim(veilOut)]);
        try {
            [contentOut, metalOut, veilOut].forEach((a) => a?.cancel?.());
        } catch { /* ignore */ }
        target.style.opacity = '0';
        target.style.filter = overlayHost ? '' : 'brightness(0)';
        target.style.transform = '';
        if (veil) veil.style.opacity = '1';
        return;
    }

    if (veil) veil.style.opacity = '1';
    target.style.opacity = '0';
    target.style.filter = 'brightness(0)';
    target.style.transform = 'scaleY(0.06) scaleX(1.35)';
    target.style.transformOrigin = 'center center';

    const contentIn = target.animate(
        [
            { filter: 'brightness(0)', transform: 'scaleY(0.06) scaleX(1.35)', opacity: 0 },
            {
                filter: 'brightness(1.7) saturate(0) contrast(1.6)',
                transform: 'scaleY(0.28) scaleX(1.18)',
                opacity: 0.55,
                offset: 0.28
            },
            {
                filter: 'brightness(1.3) saturate(0.35) contrast(1.35)',
                transform: 'scaleY(0.75) scaleX(1.06)',
                opacity: 1,
                offset: 0.58
            },
            {
                filter: 'brightness(1.05) saturate(0.8)',
                transform: 'scale(1.01)',
                opacity: 1,
                offset: 0.85
            },
            { filter: 'brightness(1) saturate(1)', transform: 'scale(1)', opacity: 1 }
        ],
        half
    );
    const metalIn = metal?.animate(
        [
            { opacity: 0, transform: 'scaleY(0.08) scaleX(1.4)', filter: 'blur(3px)' },
            { opacity: 1, transform: 'scaleY(0.5) scaleX(1.15)', filter: 'blur(0px)', offset: 0.3 },
            { opacity: 0.75, transform: 'scale(1)', filter: 'blur(1px)', offset: 0.58 },
            { opacity: 0, transform: 'scale(1.06)', filter: 'blur(8px)' }
        ],
        half
    );
    const veilIn = veil?.animate(
        [
            { opacity: 1 },
            { opacity: 0.55, offset: 0.22 },
            { opacity: 0, offset: 0.55 },
            { opacity: 0 }
        ],
        half
    );
    await Promise.all([waitAnim(contentIn), waitAnim(metalIn), waitAnim(veilIn)]);
    try {
        [contentIn, metalIn, veilIn].forEach((a) => a?.cancel?.());
    } catch { /* ignore */ }
    clearPowerFxInline(host, fx, target, overlayHost);
}

async function runReducedPhase(host, phase, duration, overlayHost = null) {
    const fxParent = overlayHost || host;
    const fx = ensurePowerFx(fxParent);
    const target = contentTarget(host);
    const veil = fx?.querySelector('.power-fx__veil');
    host?.classList.add('is-power-fx');
    fxParent?.classList.add('is-power-fx');
    if (overlayHost) overlayHost.classList.add('is-active');
    fx?.classList.add('is-active');
    const ms = Math.min(duration || 180, 220);
    if (phase === 'out') {
        const a = veil?.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: ms,
            easing: 'ease',
            fill: 'forwards'
        });
        await waitAnim(a);
        try { a?.cancel?.(); } catch { /* ignore */ }
        if (veil) veil.style.opacity = '1';
        if (target) target.style.opacity = '0';
        return;
    }
    if (veil) veil.style.opacity = '1';
    if (target) target.style.opacity = '0';
    const show = target?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ms,
        easing: 'ease',
        fill: 'forwards'
    });
    const hide = veil?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: ms,
        easing: 'ease',
        fill: 'forwards'
    });
    await Promise.all([waitAnim(show), waitAnim(hide)]);
    clearPowerFxInline(host, fx, target, overlayHost);
}

/**
 * Host-scoped classical / T-800 / T-1000 transition.
 * @param {string} mode
 * @param {{
 *   phase?: 'out'|'in'|'both',
 *   host?: HTMLElement | null,
 *   hosts?: HTMLElement[],
 *   overlayHost?: HTMLElement | null,
 *   onMidpoint?: () => void | Promise<void>,
 *   duration?: number,
 *   motionTable?: Record<string, { duration: number, easing: string }>
 * }} [opts]
 */
export async function runPowerStyleTransition(mode, opts = {}) {
    const resolved = normalizeViewTransition(mode);
    if (!POWER_STYLE_TRANSITIONS.has(resolved)) {
        await opts.onMidpoint?.();
        return;
    }

    const hosts = (opts.hosts || (opts.host ? [opts.host] : [])).filter(Boolean);
    if (!hosts.length) {
        await opts.onMidpoint?.();
        return;
    }

    const phase = opts.phase || 'both';
    const duration = resolveDuration(resolved, opts);
    const easing = resolveEasing(resolved, opts);
    const reduced = prefersReducedMotion();
    const overlayHost = opts.overlayHost || null;

    const runPhase = async (p) => {
        await Promise.all(hosts.map((host) => {
            if (reduced) return runReducedPhase(host, p, Math.min(duration, 220), overlayHost);
            if (resolved === 't800') {
                return runT800Phase(host, p, duration, easing, overlayHost);
            }
            if (resolved === 't1000') {
                return runT1000Phase(host, p, duration, easing, overlayHost);
            }
            return runClassicalPhase(host, p, duration, easing, overlayHost);
        }));
    };

    if (phase === 'out') {
        await runPhase('out');
        return;
    }
    if (phase === 'in') {
        await runPhase('in');
        return;
    }

    await runPhase('out');
    try {
        await opts.onMidpoint?.();
    } catch { /* commit best-effort */ }
    await runPhase('in');
}

function ensureShutdownScreen() {
    let screen = el('shutdown-screen');
    if (screen) return screen;
    if (typeof document === 'undefined') return null;
    screen = document.createElement('div');
    screen.id = 'shutdown-screen';
    screen.className = 'shutdown-screen';
    screen.setAttribute('aria-hidden', 'true');
    document.body.appendChild(screen);
    return screen;
}

/**
 * Full-viewport power-off (out only): squeezes #app-container, FX on #shutdown-screen.
 * Power-style modes use CRT/T2; other shared modes fade the app to black.
 * @param {string} mode resolved transition id
 */
export async function runShutdownTransition(mode) {
    if (shutdownBusy) return;
    shutdownBusy = true;
    try {
        const resolved = normalizeViewTransition(mode);
        const app = el('app-container') || document.body;
        const screen = ensureShutdownScreen();
        if (!screen) return;

        if (resolved === 'instant' || prefersReducedMotion()) {
            screen.classList.add('is-active');
            const fx = ensurePowerFx(screen);
            fx?.classList.add('is-active');
            const veil = fx?.querySelector('.power-fx__veil');
            if (veil) veil.style.opacity = '1';
            if (app) app.style.opacity = '0';
            return;
        }

        if (POWER_STYLE_TRANSITIONS.has(resolved)) {
            const cfg = SHUTDOWN_MOTION[resolved] || SHUTDOWN_MOTION.classical;
            await runPowerStyleTransition(resolved, {
                phase: 'out',
                host: app,
                overlayHost: screen,
                duration: cfg.duration,
                motionTable: SHUTDOWN_MOTION
            });
            return;
        }

        // Shared list fallback: timed fade to black on the full-viewport veil.
        const cfg = VIEW_MOTION[resolved] || VIEW_MOTION.fade;
        const duration = Math.max(cfg.duration || 380, 600);
        screen.classList.add('is-active');
        const fx = ensurePowerFx(screen);
        fx?.classList.add('is-active');
        const veil = fx?.querySelector('.power-fx__veil');
        if (veil) veil.style.opacity = '0';
        const fadeApp = app?.animate(
            [
                { opacity: 1, filter: 'brightness(1)' },
                { opacity: 0, filter: 'brightness(0.4)' }
            ],
            { duration, easing: cfg.easing || 'ease', fill: 'forwards' }
        );
        const fadeVeil = veil?.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration, easing: cfg.easing || 'ease', fill: 'forwards' }
        );
        await Promise.all([waitAnim(fadeApp), waitAnim(fadeVeil)]);
        try {
            fadeApp?.cancel?.();
            fadeVeil?.cancel?.();
        } catch { /* ignore */ }
        if (app) app.style.opacity = '0';
        if (veil) veil.style.opacity = '1';
    } finally {
        shutdownBusy = false;
    }
}

export function isShutdownTransitionBusy() {
    return shutdownBusy;
}

/** Remove leftover power-fx layers after an out-only (skipIn) transition. */
export function clearPowerStyleHost(host) {
    if (!host) return;
    const fx = host.querySelector(':scope > .power-fx');
    const target = contentTarget(host);
    clearPowerFxInline(host, fx, target, null);
    fx?.remove();
}
