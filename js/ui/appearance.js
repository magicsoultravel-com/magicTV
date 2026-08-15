import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { showAppToast } from './toast.js';

function formatTextSizeLabel(size) {
    return `${Math.round((size / 16) * 100)}%`;
}

// Detect each tile's name overflow and toggle the "narrow" class.
// Clone a second .marquee-text only when the single copy overflows so fitting
// names never show doubled.
function measureTileMarquee(tile) {
    if (!tile || typeof tile.classList?.toggle !== 'function') return;
    const name = tile.querySelector?.('.channel-tile__name, .country-tile__name');
    if (!name) return;

    const track = name.querySelector('.marquee-track');
    const firstText = track?.querySelector('.marquee-text');
    if (!track || !firstText) return;

    track.querySelectorAll('.marquee-text[aria-hidden="true"]').forEach((node) => node.remove());
    tile.classList.remove('narrow');

    if (typeof firstText.scrollWidth !== 'number' || typeof name.clientWidth !== 'number') {
        return;
    }

    const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const overflows = firstText.scrollWidth > name.clientWidth + 2;

    if (overflows && !reducedMotion) {
        const clone = firstText.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
        tile.classList.add('narrow');
    }
}

export const Appearance = {
    bind() {
        const textSlider = el('text-size-slider');
        const textValue = el('text-size-value');
        const tileSlider = el('tile-width-slider');
        const tileValue = el('tile-width-value');

        const syncTextUi = (size) => {
            if (textSlider) textSlider.value = String(size);
            if (textValue) textValue.textContent = formatTextSizeLabel(size);
            if (textSlider) textSlider.setAttribute('aria-valuetext', formatTextSizeLabel(size));
        };

        const syncTileUi = (width) => {
            if (tileSlider) tileSlider.value = String(width);
            if (tileValue) tileValue.textContent = `${width}px`;
            if (tileSlider) tileSlider.setAttribute('aria-valuetext', `${width}px`);
        };

        if (textSlider) {
            textSlider.addEventListener('input', () => {
                const size = SettingsStore.setTextSize(Number(textSlider.value));
                syncTextUi(size);
                this.applyStyles();
            });
        }

        if (tileSlider) {
            tileSlider.addEventListener('input', () => {
                const width = SettingsStore.setTileWidth(Number(tileSlider.value));
                syncTileUi(width);
                this.applyStyles();
            });
        }

        const resetBtn = el('reset-appearance-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const size = SettingsStore.setTextSize(16);
                const width = SettingsStore.setTileWidth(180);
                syncTextUi(size);
                syncTileUi(width);
                this.applyStyles();
                showAppToast('Appearance reset to defaults');
            });
        }
    },

    applyStyles() {
        if (!document.documentElement) return;

        const root = document.documentElement;
        const textSize = SettingsStore.getTextSize();
        const tileWidth = SettingsStore.getTileWidth();

        root.style.fontSize = `${textSize}px`;
        root.style.setProperty('--tv-tile-width', `${tileWidth}px`);

        this.updatePreviewTile();

        document.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                document.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
            });
        }
    },

    applyToTiles(container) {
        if (!container || !document.documentElement) return;

        container.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                container.querySelectorAll('.channel-tile, .country-tile').forEach(measureTileMarquee);
            });
        }
    },

    updatePreviewTile() {
        const preview = el('appearance-preview-tile');
        if (!preview) return;
        const name = el('preview-name');
        const flag = el('preview-flag');
        const avatar = el('preview-avatar');

        const channel = TvPlayer.channel;
        const nameText = channel?.name || 'Now Playing';
        const countryCode = channel?.countrycode || '';
        const initial = (nameText[0] || 'P').toUpperCase();
        const safeName = escapeHtml(nameText);

        if (name) name.innerHTML = `<span class="marquee-track"><span class="marquee-text">${safeName}</span></span>`;
        if (flag) flag.textContent = countryCode ? countryFlagEmoji(countryCode) : '';
        if (avatar) avatar.textContent = initial;
    },

    syncFromState() {
        const textSize = SettingsStore.getTextSize();
        const textSlider = el('text-size-slider');
        const textValue = el('text-size-value');
        if (textSlider) textSlider.value = String(textSize);
        if (textValue) textValue.textContent = formatTextSizeLabel(textSize);
        if (textSlider) textSlider.setAttribute('aria-valuetext', formatTextSizeLabel(textSize));

        const tileWidthPx = SettingsStore.getTileWidth();
        const tileSlider = el('tile-width-slider');
        const tileWidth = el('tile-width-value');
        if (tileSlider) tileSlider.value = String(tileWidthPx);
        if (tileWidth) tileWidth.textContent = `${tileWidthPx}px`;
        if (tileSlider) tileSlider.setAttribute('aria-valuetext', `${tileWidthPx}px`);

        this.applyStyles();
    },

    updateStorageStats() {
        const stats = el('storage-stats');
        if (!stats) return;
        const spans = stats.querySelectorAll('span');
        if (spans.length < 4) return;

        const favs = TvPlayer.getFavorites?.() || [];
        const recents = TvPlayer.getRecentsMeta?.() || [];
        spans[0].textContent = `Favorites: ${favs.length}`;
        spans[1].textContent = `Recents: ${recents.length}`;

        let localBytes = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                localBytes += (key?.length || 0) + (val?.length || 0);
            }
        } catch { /* ignore */ }
        spans[2].textContent = `localStorage: ${localBytes < 1024 ? localBytes + ' B' : (localBytes / 1024).toFixed(1) + ' KB'}`;

        if (navigator?.storage?.estimate) {
            navigator.storage.estimate().then((est) => {
                const used = est.usage || 0;
                spans[3].textContent = `Cache: ${used < 1024 ? used + ' B' : used < 1048576 ? (used / 1024).toFixed(1) + ' KB' : (used / 1048576).toFixed(1) + ' MB'}`;
            }).catch(() => { spans[3].textContent = 'Cache: —'; });
        } else {
            spans[3].textContent = 'Cache: —';
        }
    }
};
