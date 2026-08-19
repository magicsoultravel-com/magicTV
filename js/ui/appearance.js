import { TvPlayer } from '../tvPlayer.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { showAppToast } from './toast.js';
import { RemoteModule } from './remoteModule.js';
import { BrowserPopout } from './browserPopout.js';
import { REMOTE_TEXTURES } from './remoteTextures.js';
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

function syncRemoteIdleFadeUi({ enabled, delaySec, fadeSec }) {
    const idleFadeEnabled = el('remote-idle-fade-enabled');
    const idleDelaySlider = el('remote-idle-delay-slider');
    const idleDelayValue = el('remote-idle-delay-value');
    const idleFadeSlider = el('remote-idle-fade-slider');
    const idleFadeValue = el('remote-idle-fade-value');
    if (idleFadeEnabled) idleFadeEnabled.checked = enabled === true;
    if (idleDelaySlider) idleDelaySlider.value = String(delaySec);
    if (idleDelayValue) idleDelayValue.textContent = `${delaySec}s`;
    if (idleDelaySlider) idleDelaySlider.setAttribute('aria-valuetext', `${delaySec}s`);
    if (idleFadeSlider) idleFadeSlider.value = String(fadeSec);
    if (idleFadeValue) idleFadeValue.textContent = `${fadeSec}s`;
    if (idleFadeSlider) idleFadeSlider.setAttribute('aria-valuetext', `${fadeSec}s`);
}

function syncBrowserPopoutToggleUi(enabled) {
    const toggle = el('browser-popout-prefer-open');
    if (!toggle) return;
    const on = enabled === true;
    toggle.classList.toggle('is-active', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
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
        const pickerOpacitySlider = el('channel-picker-opacity-slider');
        const pickerOpacityValue = el('channel-picker-opacity-value');
        const idleFadeEnabled = el('remote-idle-fade-enabled');
        const idleDelaySlider = el('remote-idle-delay-slider');
        const idleDelayValue = el('remote-idle-delay-value');
        const idleFadeSlider = el('remote-idle-fade-slider');
        const idleFadeValue = el('remote-idle-fade-value');
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

        const syncPickerOpacityUi = (pct) => {
            if (pickerOpacitySlider) pickerOpacitySlider.value = String(pct);
            if (pickerOpacityValue) pickerOpacityValue.textContent = `${pct}%`;
            if (pickerOpacitySlider) pickerOpacitySlider.setAttribute('aria-valuetext', `${pct}%`);
        };

        const syncIdleFadeUi = syncRemoteIdleFadeUi;

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

        if (pickerOpacitySlider) {
            pickerOpacitySlider.addEventListener('input', () => {
                const pct = SettingsStore.setChannelPickerOpacity(Number(pickerOpacitySlider.value));
                syncPickerOpacityUi(pct);
                this.applyStyles();
            });
        }

        if (idleFadeEnabled) {
            idleFadeEnabled.addEventListener('change', () => {
                SettingsStore.setRemoteIdleFadeEnabled(idleFadeEnabled.checked);
                RemoteModule.resetIdleFade();
            });
        }

        if (idleDelaySlider) {
            idleDelaySlider.addEventListener('input', () => {
                const delaySec = SettingsStore.setRemoteIdleDelaySec(Number(idleDelaySlider.value));
                syncIdleFadeUi({
                    enabled: SettingsStore.getRemoteIdleFadeEnabled(),
                    delaySec,
                    fadeSec: SettingsStore.getRemoteIdleFadeSec()
                });
                RemoteModule.resetIdleFade();
            });
        }

        if (idleFadeSlider) {
            idleFadeSlider.addEventListener('input', () => {
                const fadeSec = SettingsStore.setRemoteIdleFadeSec(Number(idleFadeSlider.value));
                syncIdleFadeUi({
                    enabled: SettingsStore.getRemoteIdleFadeEnabled(),
                    delaySec: SettingsStore.getRemoteIdleDelaySec(),
                    fadeSec
                });
                RemoteModule.resetIdleFade();
            });
        }

        const browserPopoutToggle = el('browser-popout-prefer-open');
        if (browserPopoutToggle && browserPopoutToggle.dataset.bound !== '1') {
            browserPopoutToggle.dataset.bound = '1';
            browserPopoutToggle.addEventListener('click', () => {
                const next = SettingsStore.setBrowserPopoutPreferOpen(
                    browserPopoutToggle.getAttribute('aria-pressed') !== 'true'
                );
                syncBrowserPopoutToggleUi(next);
                if (!next) {
                    BrowserPopout.close();
                }
                BrowserExternalPopout.syncBtn();
                showAppToast(next
                    ? 'Browse/Favorites/Recents open in a split window'
                    : 'Browser panels docked in remote');
            });
        }

        const remoteTextureSelect = el('remote-texture-select');
        if (remoteTextureSelect && remoteTextureSelect.dataset.bound !== '1') {
            remoteTextureSelect.dataset.bound = '1';
            if (!remoteTextureSelect.options?.length) {
                remoteTextureSelect.innerHTML = REMOTE_TEXTURES
                    .map((t) => `<option value="${t.id}">${t.label}</option>`)
                    .join('');
            }
            remoteTextureSelect.addEventListener('change', () => {
                const texture = SettingsStore.setRemoteTexture(remoteTextureSelect.value);
                this.applyStyles();
                const label = REMOTE_TEXTURES.find((t) => t.id === texture)?.label || texture;
                showAppToast(`Remote texture: ${label}`);
            });
        }

        const activeTileSelect = el('active-tile-select');
        if (activeTileSelect && activeTileSelect.dataset.bound !== '1') {
            activeTileSelect.dataset.bound = '1';
            activeTileSelect.addEventListener('change', () => {
                const style = SettingsStore.setActiveTileStyle(activeTileSelect.value);
                this.applyStyles();
                showAppToast(`Active tile: ${activeTileSelect.options[activeTileSelect.selectedIndex].text}`);
            });
        }

        const visitedStyleSelect = el('visited-style-select');
        if (visitedStyleSelect && visitedStyleSelect.dataset.bound !== '1') {
            visitedStyleSelect.dataset.bound = '1';
            visitedStyleSelect.addEventListener('change', () => {
                const style = SettingsStore.setVisitedStyle(visitedStyleSelect.value);
                this.applyStyles();
                showAppToast(`Visited accent: ${visitedStyleSelect.options[visitedStyleSelect.selectedIndex].text}`);
            });
        }

        const recentsCapInput = el('recents-cap-input');
        if (recentsCapInput && recentsCapInput.dataset.bound !== '1') {
            recentsCapInput.dataset.bound = '1';
            recentsCapInput.addEventListener('change', () => {
                const cap = SettingsStore.setRecentsCap(Number(recentsCapInput.value));
                recentsCapInput.value = String(cap);
                showAppToast(`Recent channels: ${cap}`);
            });
            recentsCapInput.addEventListener('blur', () => {
                recentsCapInput.value = String(SettingsStore.getRecentsCap());
            });
        }

        const nonVisitedStyleSelect = el('non-visited-style-select');
        if (nonVisitedStyleSelect && nonVisitedStyleSelect.dataset.bound !== '1') {
            nonVisitedStyleSelect.dataset.bound = '1';
            nonVisitedStyleSelect.addEventListener('change', () => {
                const style = SettingsStore.setNonVisitedStyle(nonVisitedStyleSelect.value);
                this.applyStyles();
                showAppToast(`Non-visited accent: ${nonVisitedStyleSelect.options[nonVisitedStyleSelect.selectedIndex].text}`);
            });
        }

        const resetBtn = el('reset-appearance-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const {
                    themeId,
                    textSize,
                    tileWidth,
                    listWidth,
                    channelPickerOpacity,
                    remoteIdleFadeEnabled,
                    remoteIdleDelaySec,
                    remoteIdleFadeSec,
                    browserPopoutPreferOpen,
                    activeTileStyle,
                    visitedStyle,
                    nonVisitedStyle,
                    colors,
                    fontId
                } = SettingsStore.resetAppearance();
                if (themeSelect) themeSelect.value = themeId;
                syncTextUi(textSize);
                syncTileUi(tileWidth);
                syncListUi(listWidth);
                syncPickerOpacityUi(channelPickerOpacity);
                syncIdleFadeUi({
                    enabled: remoteIdleFadeEnabled,
                    delaySec: remoteIdleDelaySec,
                    fadeSec: remoteIdleFadeSec
                });
                syncBrowserPopoutToggleUi(browserPopoutPreferOpen);
                if (activeTileSelect) activeTileSelect.value = activeTileStyle;
                if (visitedStyleSelect) visitedStyleSelect.value = visitedStyle;
                if (nonVisitedStyleSelect) nonVisitedStyleSelect.value = nonVisitedStyle;
                syncFontUi(fontId);
                syncColorInputs(colors);
                document.documentElement.setAttribute('data-theme', themeId);
                this.applyStyles();
                RemoteModule.resetIdleFade();
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
        const channelPickerOpacity = SettingsStore.getChannelPickerOpacity();
        const catalogLayout = SettingsStore.getCatalogLayout();
        const themeId = SettingsStore.getThemeId();
        const colors = SettingsStore.getThemeColors();
        const fontId = SettingsStore.getFontId();

        root.style.fontSize = `${textSize}px`;
        root.style.setProperty('--tv-tile-width', `${tileWidth}px`);
        root.style.setProperty('--tv-list-width', `${listWidth}px`);
        root.style.setProperty('--remote-module-opacity', String(channelPickerOpacity / 100));
        root.style.setProperty('--channel-picker-opacity', String(channelPickerOpacity / 100));
        root.setAttribute('data-remote-texture', SettingsStore.getRemoteTexture());
        root.setAttribute('data-theme', themeId);
        root.setAttribute('data-channel-layout', catalogLayout);
        root.setAttribute('data-active-tile-style', SettingsStore.getActiveTileStyle());
        root.setAttribute('data-visited-style', SettingsStore.getVisitedStyle());
        root.setAttribute('data-non-visited-style', SettingsStore.getNonVisitedStyle());
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
        const shouldPlay = SettingsStore.getActiveTileStyle() !== 'none';

        const previewTile = el('appearance-preview-tile');
        const previewList = el('appearance-preview-list');

        const channel = TvPlayer.channel;
        const nameText = channel?.name || 'Now Playing';
        const countryCode = channel?.countrycode || '';
        const initial = (nameText[0] || 'P').toUpperCase();
        const safeName = escapeHtml(nameText);

        if (previewTile) {
            previewTile.classList.toggle('is-playing', shouldPlay);
            // Tile variant always wears is-visited (it represents a visited channel).
            // The visited-accent CSS is gated on data-visited-style, so when that's
            // "undistinguished" the tile looks plain — no leak from non-visited accent.
            previewTile.classList.add('is-visited');
        }
        if (previewList) {
            previewList.classList.toggle('is-playing', shouldPlay);
            // List variant never has is-visited (represents an unvisited channel),
            // so the non-visited accent CSS applies when active.
            previewList.classList.remove('is-visited');
        }

        // Update tile preview elements.
        const name = el('preview-name');
        const flag = el('preview-flag');
        const avatar = el('preview-avatar');
        if (name) name.innerHTML = `<span class="marquee-track"><span class="marquee-text">${safeName}</span></span>`;
        if (flag) flag.textContent = countryCode ? countryFlagEmoji(countryCode) : '';
        if (avatar) avatar.textContent = initial;

        // Update list preview elements.
        const listName = el('preview-list-name');
        const listFlag = el('preview-list-flag');
        const listAvatar = el('preview-list-avatar');
        if (listName) listName.innerHTML = `<span class="marquee-track"><span class="marquee-text">${safeName}</span></span>`;
        if (listFlag) listFlag.textContent = countryCode ? countryFlagEmoji(countryCode) : '';
        if (listAvatar) listAvatar.textContent = initial;
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

        const pickerOpacity = SettingsStore.getChannelPickerOpacity();
        const pickerOpacitySlider = el('channel-picker-opacity-slider');
        const pickerOpacityValue = el('channel-picker-opacity-value');
        if (pickerOpacitySlider) pickerOpacitySlider.value = String(pickerOpacity);
        if (pickerOpacityValue) pickerOpacityValue.textContent = `${pickerOpacity}%`;
        if (pickerOpacitySlider) pickerOpacitySlider.setAttribute('aria-valuetext', `${pickerOpacity}%`);

        syncRemoteIdleFadeUi({
            enabled: SettingsStore.getRemoteIdleFadeEnabled(),
            delaySec: SettingsStore.getRemoteIdleDelaySec(),
            fadeSec: SettingsStore.getRemoteIdleFadeSec()
        });

        syncBrowserPopoutToggleUi(SettingsStore.getBrowserPopoutPreferOpen());

        const remoteTextureSelect = el('remote-texture-select');
        if (remoteTextureSelect) {
            if (!remoteTextureSelect.options?.length) {
                remoteTextureSelect.innerHTML = REMOTE_TEXTURES
                    .map((t) => `<option value="${t.id}">${t.label}</option>`)
                    .join('');
            }
            remoteTextureSelect.value = SettingsStore.getRemoteTexture();
        }

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

        const activeTileStyle = SettingsStore.getActiveTileStyle();
        const activeTileSelect = el('active-tile-select');
        if (activeTileSelect) {
            activeTileSelect.value = activeTileStyle;
        }

        const visitedStyle = SettingsStore.getVisitedStyle();
        const visitedStyleSelect = el('visited-style-select');
        if (visitedStyleSelect) {
            visitedStyleSelect.value = visitedStyle;
        }

        const nonVisitedStyle = SettingsStore.getNonVisitedStyle();
        const nonVisitedStyleSelect = el('non-visited-style-select');
        if (nonVisitedStyleSelect) {
            nonVisitedStyleSelect.value = nonVisitedStyle;
        }

        const recentsCap = SettingsStore.getRecentsCap();
        const recentsCapInput = el('recents-cap-input');
        if (recentsCapInput) {
            recentsCapInput.value = String(recentsCap);
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
        if (spans.length < 6) return;

        const favs = TvPlayer.getFavorites?.() || [];
        const recents = TvPlayer.getRecentsMeta?.() || [];
        const hidden = TvPlayer.getHiddenMeta?.() || [];
        const visited = TvPlayer.getVisitedKeys?.() || [];
        spans[0].textContent = `Favorites: ${favs.length}`;
        spans[1].textContent = `Recents: ${recents.length}`;
        spans[2].textContent = `Hidden: ${hidden.length}`;
        spans[3].textContent = `Visited: ${visited.length}`;

        let localBytes = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                localBytes += (key?.length || 0) + (val?.length || 0);
            }
        } catch { /* ignore */ }
        spans[4].textContent = `localStorage: ${localBytes < 1024 ? localBytes + ' B' : (localBytes / 1024).toFixed(1) + ' KB'}`;

        if (navigator?.storage?.estimate) {
            navigator.storage.estimate().then((est) => {
                const used = est.usage || 0;
                spans[5].textContent = `Cache: ${used < 1024 ? used + ' B' : used < 1048576 ? (used / 1024).toFixed(1) + ' KB' : (used / 1048576).toFixed(1) + ' MB'}`;
            }).catch(() => { spans[5].textContent = 'Cache: —'; });
        } else {
            spans[5].textContent = 'Cache: —';
        }
    }
};
