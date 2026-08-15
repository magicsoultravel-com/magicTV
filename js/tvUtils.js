export function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function countryFlagEmoji(code) {
    if (!code || typeof code !== 'string' || code.length !== 2) return '🌐';
    const upper = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return '🌐';
    return String.fromCodePoint(
        ...[...upper].map((char) => 0x1F1E6 + char.charCodeAt(0) - 65)
    );
}

export function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

/** Human-friendly relative time for a cache timestamp, e.g. "just now", "3m ago", "2h ago". */
export function formatRelativeTime(ts, now = Date.now()) {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const sec = Math.max(0, Math.floor((now - ts) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return `${Math.floor(day / 7)}w ago`;
}

export function el(id) {
    return document.getElementById(id);
}

export function els(query) {
    return Array.from(document.querySelectorAll(query));
}
