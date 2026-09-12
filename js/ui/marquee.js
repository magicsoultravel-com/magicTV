/**
 * Overflow marquee for constrained name labels.
 * Duplicate-text CSS animation; arms only when text overflows.
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
    '.resume-session__tile-name',
    '.watch-stats-row__name'
].join(', ');

export function marqueeInnerHtml(text) {
    return `<span class="marquee-track"><span class="marquee-text">${escapeHtml(text ?? '')}</span></span>`;
}

function measure(host) {
    if (!host?.classList) return;
    const track = host.querySelector?.(':scope > .marquee-track');
    const firstText = track?.querySelector?.(':scope > .marquee-text:not([aria-hidden])')
        || track?.querySelector?.(':scope > .marquee-text');
    if (!track || !firstText) return;

    track.querySelectorAll('.marquee-text[aria-hidden="true"]').forEach((n) => n.remove());
    host.classList.remove('is-marquee');

    if (typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    if (!(firstText.scrollWidth > host.clientWidth + 2)) return;

    const clone = firstText.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
    host.classList.add('is-marquee');
}

export function setMarqueeText(host, text) {
    if (!host) return;
    const value = String(text ?? '');
    host.innerHTML = marqueeInnerHtml(value);
    // Stubs often don't parse innerHTML; keep textContent readable for tests/readers.
    if (!host.querySelector?.('.marquee-text')) host.textContent = value;
    measure(host);
}

export function applyMarquee(root = document) {
    root?.querySelectorAll?.(HOSTS).forEach(measure);
}
