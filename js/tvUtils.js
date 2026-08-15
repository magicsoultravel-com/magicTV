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

export function bindFaviconImage(img, onError) {
    if (!img || img.dataset.faviconBound === 'true') return;
    img.dataset.faviconBound = 'true';
    img.addEventListener('load', () => {
        if (img.naturalWidth > 0) img.classList.remove('is-hidden');
    });
    img.addEventListener('error', () => {
        img.removeAttribute('src');
        img.classList.add('is-hidden');
        onError?.();
    });
}

export function syncMarquee(wrapEl, text, { error = false } = {}) {
    if (!wrapEl) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    wrapEl.classList.toggle('sidebar-media__title--error', !!error);

    if (error || reducedMotion) {
        wrapEl.classList.remove('is-marquee');
        wrapEl.innerHTML = `<span class="sidebar-media__marquee-inner" data-tv-title>${escapeHtml(text || '')}</span>`;
        return;
    }

    wrapEl.innerHTML = `<span class="sidebar-media__marquee-track"><span class="sidebar-media__marquee-inner" data-tv-title>${escapeHtml(text || '')}</span></span>`;
    const inner = wrapEl.querySelector('.sidebar-media__marquee-inner');
    const track = wrapEl.querySelector('.sidebar-media__marquee-track');
    if (!inner || !track) return;

    requestAnimationFrame(() => {
        if (inner.scrollWidth > wrapEl.clientWidth + 2) {
            wrapEl.classList.add('is-marquee');
            const clone = inner.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            clone.removeAttribute('data-tv-title');
            track.appendChild(clone);
        } else {
            wrapEl.classList.remove('is-marquee');
        }
    });
}
