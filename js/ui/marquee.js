/**
 * Overflow marquee for constrained name labels.
 * Duplicate-text CSS animation; arms only when the text is wider than its host.
 *
 * Arming is layout-driven, not paint-driven:
 * - A paint into a hidden shell (collapsed dock, `display:none` split pane) or
 *   into a tile skipped by `content-visibility: auto` reports a zero width, so
 *   an IntersectionObserver defers those hosts and retries when they appear.
 * - A ResizeObserver re-measures armed hosts when the tile width, text-size
 *   scale, window or dock size changes.
 *
 * CSS owns the motion: JS only publishes `--marquee-shift` (exact overflow in
 * px) and `--marquee-duration` (constant reading speed) on the host.
 */
import { escapeHtml } from '../tvUtils.js';

const HOSTS = [
    '.channel-tile__name',
    '.country-tile__name',
    '.favorite-folder-tile__name',
    '.tv-player-tile__name-text',
    '.tv-header-channel-name',
    '#remote-channel-name',
    '.guide-screen__channel',
    '.resume-session__tile-name-text',
    '.resume-session__cassette-title',
    '.watch-stats-row__name',
    '#radio-now-title'
].join(', ');

/** Tiles may skip layout entirely (`content-visibility: auto`) — observe these. */
const TILE_FOR_HOST = [
    '.channel-tile',
    '.country-tile',
    '.favorite-folder-tile',
    '.tv-player-tile',
    '.resume-session__tile',
    '.watch-stats-row'
].join(', ');

/** Scroll speed and cycle bounds; the cycle holds at both ends (see CSS). */
const SCROLL_PX_PER_SEC = 45;
const MIN_DURATION_S = 4;
const MAX_DURATION_S = 24;
/** Sub-pixel slack so a name that just fits never starts moving. */
const OVERFLOW_SLACK_PX = 2;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Last measured host width, so ResizeObserver only re-measures real changes. */
const lastHostWidth = new WeakMap();
const resizeWatched = new WeakSet();
const visibilityWatched = new WeakSet();
/** Reveal retries per host (see measureRevealed). */
const deferRetries = new WeakMap();
const MAX_DEFER_RETRIES = 2;
let reducedMotionBound = false;

/** @type {IntersectionObserver|null} */
let visibilityObserver = null;
/** @type {ResizeObserver|null} */
let resizeObserver = null;

export function marqueeInnerHtml(text) {
    return `<span class="marquee-track"><span class="marquee-text">${escapeHtml(text ?? '')}</span></span>`;
}

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
}

/** A runtime OS change disarms (or re-arms) everything in one pass. */
function watchReducedMotion() {
    if (reducedMotionBound || typeof window === 'undefined') return;
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query?.addEventListener) return;
    reducedMotionBound = true;
    query.addEventListener('change', () => applyMarquee(globalThis.document));
}

/** Widest of the rect and the requested box metric (0 when unpublished). */
function boxWidth(node, prop) {
    const rect = node?.getBoundingClientRect?.();
    const rectWidth = Number.isFinite(rect?.width) ? rect.width : 0;
    const measured = node?.[prop];
    return Math.max(rectWidth, Number.isFinite(measured) ? measured : 0);
}

function durationFor(overflowPx) {
    const travelSec = overflowPx / SCROLL_PX_PER_SEC;
    // Keyframes travel for 25% of the cycle, so one pass is 4× the travel time.
    const cycle = travelSec * 4;
    const clamped = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, cycle));
    return Math.round(clamped * 10) / 10;
}

function trackOf(host) {
    return host.querySelector?.(':scope > .marquee-track')
        || host.querySelector?.('.marquee-track')
        || null;
}

function firstTextOf(track) {
    return track?.querySelector?.(':scope > .marquee-text:not([aria-hidden="true"])')
        || track?.querySelector?.('.marquee-text')
        || null;
}

function watchResize(host) {
    if (resizeWatched.has(host) || typeof ResizeObserver !== 'function') return;
    if (!resizeObserver) {
        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const node = entry.target;
                if (!node.isConnected) {
                    resizeObserver.unobserve(node);
                    resizeWatched.delete(node);
                    continue;
                }
                if (boxWidth(node, 'clientWidth') === lastHostWidth.get(node)) continue;
                measureMarqueeHost(node);
            }
        });
    }
    resizeWatched.add(host);
    resizeObserver.observe(host);
}

function watchVisibility(host) {
    if (typeof IntersectionObserver !== 'function') return;
    const target = host.closest?.(TILE_FOR_HOST) || host;
    if (visibilityWatched.has(target)) return;
    if (!visibilityObserver) {
        visibilityObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                visibilityObserver.unobserve(entry.target);
                visibilityWatched.delete(entry.target);
                measureHostsIn(entry.target);
            }
        }, { rootMargin: '0px 0px 15% 0px' });
    }
    visibilityWatched.add(target);
    visibilityObserver.observe(target);
}

/** The observer may target a tile, so measure the host plus any labels inside it. */
function measureHostsIn(node) {
    const hosts = node?.matches?.(HOSTS)
        ? [node]
        : Array.from(node?.querySelectorAll?.(HOSTS) || []);
    if (!hosts.length) return;
    const run = () => hosts.forEach(measureRevealed);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
}

/**
 * A revealed tile is re-measured, but `IntersectionObserver` re-fires on every
 * `observe()`, so a label that stays zero-sized while visible gets a bounded
 * number of retries instead of ping-ponging with the observer.
 */
function measureRevealed(host) {
    if (measureMarqueeHost(host) !== 'deferred') {
        deferRetries.delete(host);
        return;
    }
    const retries = (deferRetries.get(host) || 0) + 1;
    if (retries > MAX_DEFER_RETRIES) return;
    deferRetries.set(host, retries);
    watchVisibility(host);
}

function measureHostOrDefer(host) {
    if (measureMarqueeHost(host) === 'deferred') watchVisibility(host);
}

/**
 * Arm, disarm or defer one label.
 * @returns {'armed'|'fits'|'deferred'|'reduced'|'skip'}
 */
export function measureMarqueeHost(host) {
    if (!host?.classList) return 'skip';
    const track = trackOf(host);
    const firstText = firstTextOf(track);
    if (!track || !firstText) return 'skip';

    track.querySelectorAll?.('.marquee-text[aria-hidden="true"]').forEach((node) => node.remove());

    if (prefersReducedMotion()) {
        host.classList.remove('is-marquee');
        return 'reduced';
    }

    // Reads first, writes after: one layout flush per batch instead of per host.
    // `getBoundingClientRect` measures the inline span correctly (an inline
    // fragment's `scrollWidth` is not reliable), so the copy never has to be
    // blockified just to be measured.
    const hostWidth = boxWidth(host, 'clientWidth');
    if (!(hostWidth > 0)) {
        host.classList.remove('is-marquee');
        return 'deferred';
    }

    const overflow = Math.ceil(boxWidth(firstText, 'scrollWidth') - hostWidth);
    lastHostWidth.set(host, hostWidth);
    watchResize(host);

    if (!(overflow > OVERFLOW_SLACK_PX)) {
        host.classList.remove('is-marquee');
        return 'fits';
    }

    host.classList.add('is-marquee');
    const clone = firstText.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild?.(clone);

    const duration = durationFor(overflow);
    host.style?.setProperty?.('--marquee-shift', `-${overflow}px`);
    host.style?.setProperty?.('--marquee-duration', `${duration}s`);
    return 'armed';
}

export function setMarqueeText(host, text) {
    if (!host) return;
    const value = String(text ?? '');
    host.innerHTML = marqueeInnerHtml(value);
    // Stubs often don't parse innerHTML; keep textContent readable for tests/readers.
    if (!host.querySelector) host.textContent = value;
    measureHostOrDefer(host);
}

export function applyMarquee(root = globalThis.document) {
    const hosts = root?.querySelectorAll?.(HOSTS);
    if (!hosts) return;
    watchReducedMotion();
    hosts.forEach(measureHostOrDefer);
}
