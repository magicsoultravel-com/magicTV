import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { showAppToast } from './toast.js';
import {
    THEME_COLOR_KEYS,
    applyFontToRoot,
    applyThemeColorsToRoot,
    ensureAllFontsLoaded,
    getFontEntry,
    listFonts,
    listThemes
} from './themes.js';

function formatTextSizeLabel(size) {
    return `${Math.round((size / 16) * 100)}%`;
}

function setFontPickerOpen(open) {
    const trigger = el('font-picker-trigger');
    const menu = el('font-picker-menu');
    if (!trigger || !menu) return;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.classList.toggle('is-hidden', !open);
}

function syncFontPickerUi(fontId) {
    const entry = getFontEntry(fontId);
    const current = el('font-picker-current');
    const trigger = el('font-picker-trigger');
    const menu = el('font-picker-menu');

    if (current) {
        current.textContent = entry.label;
        current.style.fontFamily = entry.stack;
    }
    if (trigger) trigger.style.fontFamily = entry.stack;

    if (menu) {
        menu.querySelectorAll('.settings-font-picker__option').forEach((btn) => {
            const selected = btn.getAttribute('data-font-id') === entry.id;
            btn.classList.toggle('is-selected', selected);
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
    }
}

function buildFontPickerMenu() {
    const menu = el('font-picker-menu');
    if (!menu || menu.dataset.ready === '1') return;
    ensureAllFontsLoaded();
    menu.innerHTML = listFonts().map((f) => {
        const entry = getFontEntry(f.id);
        const safeStack = entry.stack.replace(/"/g, '&quot;');
        return `<button type="button" class="settings-font-picker__option" role="option" data-font-id="${entry.id}" style="font-family: ${safeStack}" aria-selected="false">${entry.label}</button>`;
    }).join('');
    menu.dataset.ready = '1';
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

function syncColorInputs(colors) {
    for (const key of THEME_COLOR_KEYS) {
        const input = el(`theme-color-${key}`);
        if (input) input.value = colors[key];
    }
}

export const Appearance = {
    bind() {
        const textSlider = el('text-size-slider');
        const textValue = el('text-size-value');
        const tileSlider = el('tile-width-slider');
        const tileValue = el('tile-width-value');
        const listSlider = el('list-width-slider');
        const listValue = el('list-width-value');
        const themeSelect = el('theme-select');
        const fontTrigger = el('font-picker-trigger');
        const fontMenu = el('font-picker-menu');

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

        const syncListUi = (width) => {
            if (listSlider) listSlider.value = String(width);
            if (listValue) listValue.textContent = `${width}px`;
            if (listSlider) listSlider.setAttribute('aria-valuetext', `${width}px`);
        };

        const syncFontUi = (fontId) => {
            syncFontPickerUi(fontId);
        };

        if (themeSelect) {
            themeSelect.innerHTML = listThemes()
                .map((t) => `<option value="${t.id}">${t.label}</option>`)
                .join('');
            themeSelect.addEventListener('change', () => {
                const id = SettingsStore.setThemeId(themeSelect.value, { resetColors: true });
                const colors = SettingsStore.getThemeColors();
                syncColorInputs(colors);
                syncFontUi(SettingsStore.getFontId());
                document.documentElement.setAttribute('data-theme', id);
                this.applyStyles();
                showAppToast(`Theme: ${listThemes().find((t) => t.id === id)?.label || id}`);
            });
        }

        buildFontPickerMenu();
        if (fontTrigger && fontMenu) {
            fontTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = fontTrigger.getAttribute('aria-expanded') !== 'true';
                setFontPickerOpen(open);
            });
            fontMenu.addEventListener('click', (e) => {
                const btn = e.target.closest('.settings-font-picker__option');
                if (!btn) return;
                const id = SettingsStore.setFontId(btn.getAttribute('data-font-id'));
                syncFontUi(id);
                setFontPickerOpen(false);
                this.applyStyles();
                showAppToast(`Font: ${getFontEntry(id).label}`);
            });
            document.addEventListener('click', (e) => {
                const picker = el('font-picker');
                if (!picker || picker.contains(e.target)) return;
                setFontPickerOpen(false);
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') setFontPickerOpen(false);
            });
        }

        for (const key of THEME_COLOR_KEYS) {
            const input = el(`theme-color-${key}`);
            if (!input) continue;
            input.addEventListener('input', () => {
                SettingsStore.setThemeColor(key, input.value);
                this.applyStyles();
            });
        }

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

        if (listSlider) {
            listSlider.addEventListener('input', () => {
                const width = SettingsStore.setListWidth(Number(listSlider.value));
                syncListUi(width);
                this.applyStyles();
            });
        }

        const resetBtn = el('reset-appearance-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const { themeId, textSize, tileWidth, listWidth, colors, fontId } = SettingsStore.resetAppearance();
                if (themeSelect) themeSelect.value = themeId;
                syncTextUi(textSize);
                syncTileUi(tileWidth);
                syncListUi(listWidth);
                syncFontUi(fontId);
                syncColorInputs(colors);
                document.documentElement.setAttribute('data-theme', themeId);
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
        const listWidth = SettingsStore.getListWidth();
        const catalogLayout = SettingsStore.getCatalogLayout();
        const themeId = SettingsStore.getThemeId();
        const colors = SettingsStore.getThemeColors();
        const fontId = SettingsStore.getFontId();

        root.style.fontSize = `${textSize}px`;
        root.style.setProperty('--tv-tile-width', `${tileWidth}px`);
        root.style.setProperty('--tv-list-width', `${listWidth}px`);
        root.setAttribute('data-theme', themeId);
        root.setAttribute('data-channel-layout', catalogLayout);
        applyThemeColorsToRoot(colors, root);
        applyFontToRoot(fontId, root);

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

        const listWidthPx = SettingsStore.getListWidth();
        const listSlider = el('list-width-slider');
        const listWidth = el('list-width-value');
        if (listSlider) listSlider.value = String(listWidthPx);
        if (listWidth) listWidth.textContent = `${listWidthPx}px`;
        if (listSlider) listSlider.setAttribute('aria-valuetext', `${listWidthPx}px`);

        const themeId = SettingsStore.getThemeId();
        const themeSelect = el('theme-select');
        if (themeSelect) {
            if (!themeSelect.options.length) {
                themeSelect.innerHTML = listThemes()
                    .map((t) => `<option value="${t.id}">${t.label}</option>`)
                    .join('');
            }
            themeSelect.value = themeId;
        }

        const fontId = SettingsStore.getFontId();
        buildFontPickerMenu();
        syncFontPickerUi(fontId);

        syncColorInputs(SettingsStore.getThemeColors());
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
