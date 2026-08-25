/**
 * Theme presets and CSS custom-property keys for Appearance.
 * Each preset seeds 13 editable colors; shadows stay fixed in CSS.
 */

export const THEME_COLOR_KEYS = [
    'main-1',
    'main-1-flip',
    'main-2',
    'main-2-flip',
    'main-3',
    'main-3-flip',
    'bg',
    'bg-secondary',
    'border',
    'border-light',
    'text-primary',
    'text-secondary',
    'text-muted'
];

/** Map storage key → CSS variable name */
export const THEME_CSS_VARS = {
    'main-1': '--tv-main-1',
    'main-1-flip': '--tv-main-1-flip',
    'main-2': '--tv-main-2',
    'main-2-flip': '--tv-main-2-flip',
    'main-3': '--tv-main-3',
    'main-3-flip': '--tv-main-3-flip',
    bg: '--tv-bg',
    'bg-secondary': '--tv-bg-secondary',
    border: '--tv-border',
    'border-light': '--tv-border-light',
    'text-primary': '--tv-text-primary',
    'text-secondary': '--tv-text-secondary',
    'text-muted': '--tv-text-muted'
};

export const THEME_COLOR_LABELS = {
    'main-1': 'Main 1',
    'main-1-flip': 'Main 1 flip',
    'main-2': 'Main 2',
    'main-2-flip': 'Main 2 flip',
    'main-3': 'Main 3',
    'main-3-flip': 'Main 3 flip',
    bg: 'Background',
    'bg-secondary': 'Background secondary',
    border: 'Border',
    'border-light': 'Border light',
    'text-primary': 'Text primary',
    'text-secondary': 'Text secondary',
    'text-muted': 'Text muted'
};

export const DEFAULT_THEME_ID = 'miami-vice';
export const DEFAULT_FONT_ID = 'system';

/**
 * Available UI fonts. Non-system entries load from Google Fonts on demand.
 * Theme defaults: first three share `system`; others get a signature face.
 */
export const FONT_CATALOG = {
    system: {
        id: 'system',
        label: 'System',
        stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        googleFamily: null
    },
    inter: {
        id: 'inter',
        label: 'Inter',
        stack: '"Inter", system-ui, sans-serif',
        googleFamily: 'Inter:wght@400;500;600;700'
    },
    'space-grotesk': {
        id: 'space-grotesk',
        label: 'Space Grotesk',
        stack: '"Space Grotesk", system-ui, sans-serif',
        googleFamily: 'Space+Grotesk:wght@400;500;600;700'
    },
    'exo-2': {
        id: 'exo-2',
        label: 'Exo 2',
        stack: '"Exo 2", system-ui, sans-serif',
        googleFamily: 'Exo+2:wght@400;500;600;700'
    },
    syne: {
        id: 'syne',
        label: 'Syne',
        stack: '"Syne", system-ui, sans-serif',
        googleFamily: 'Syne:wght@400;500;600;700'
    },
    'share-tech-mono': {
        id: 'share-tech-mono',
        label: 'Share Tech Mono',
        stack: '"Share Tech Mono", ui-monospace, monospace',
        googleFamily: 'Share+Tech+Mono'
    },
    vt323: {
        id: 'vt323',
        label: 'VT323',
        stack: '"VT323", ui-monospace, monospace',
        googleFamily: 'VT323'
    },
    nunito: {
        id: 'nunito',
        label: 'Nunito',
        stack: '"Nunito", system-ui, sans-serif',
        googleFamily: 'Nunito:wght@400;500;600;700'
    },
    oswald: {
        id: 'oswald',
        label: 'Oswald',
        stack: '"Oswald", system-ui, sans-serif',
        googleFamily: 'Oswald:wght@400;500;600;700'
    },
    'jetbrains-mono': {
        id: 'jetbrains-mono',
        label: 'JetBrains Mono',
        stack: '"JetBrains Mono", ui-monospace, monospace',
        googleFamily: 'JetBrains+Mono:wght@400;500;600;700'
    },
    'press-start-2p': {
        id: 'press-start-2p',
        label: 'Press Start 2P',
        stack: '"Press Start 2P", ui-monospace, monospace',
        googleFamily: 'Press+Start+2P'
    },
    silkscreen: {
        id: 'silkscreen',
        label: 'Silkscreen',
        stack: '"Silkscreen", ui-monospace, monospace',
        googleFamily: 'Silkscreen:wght@400;700'
    },
    orbitron: {
        id: 'orbitron',
        label: 'Orbitron',
        stack: '"Orbitron", system-ui, sans-serif',
        googleFamily: 'Orbitron:wght@400;500;600;700'
    },
    bungee: {
        id: 'bungee',
        label: 'Bungee',
        stack: '"Bungee", system-ui, sans-serif',
        googleFamily: 'Bungee'
    },
    'dotgothic16': {
        id: 'dotgothic16',
        label: 'DotGothic16',
        stack: '"DotGothic16", system-ui, sans-serif',
        googleFamily: 'DotGothic16'
    },
    'unifraktur-cook': {
        id: 'unifraktur-cook',
        label: 'Unifraktur Cook',
        stack: '"UnifrakturCook", serif',
        googleFamily: 'UnifrakturCook'
    },
    'cinzel-decorative': {
        id: 'cinzel-decorative',
        label: 'Cinzel Decorative',
        stack: '"Cinzel Decorative", serif',
        googleFamily: 'Cinzel+Decorative:wght@400;700'
    },
    'metal-mania': {
        id: 'metal-mania',
        label: 'Metal Mania',
        stack: '"Metal Mania", system-ui, cursive',
        googleFamily: 'Metal+Mania'
    },
    monoton: {
        id: 'monoton',
        label: 'Monoton',
        stack: '"Monoton", system-ui, sans-serif',
        googleFamily: 'Monoton'
    },
    'rubik-glitch': {
        id: 'rubik-glitch',
        label: 'Rubik Glitch',
        stack: '"Rubik Glitch", system-ui, sans-serif',
        googleFamily: 'Rubik+Glitch'
    },
    'major-mono-display': {
        id: 'major-mono-display',
        label: 'Major Mono Display',
        stack: '"Major Mono Display", ui-monospace, monospace',
        googleFamily: 'Major+Mono+Display'
    }
};

export const THEME_PRESETS = {
    'miami-vice': {
        id: 'miami-vice',
        label: 'Miami Vice',
        fontId: 'system',
        colors: {
            'main-1': '#00FFFF',
            'main-1-flip': '#FF00FF',
            'main-2': '#00FF88',
            'main-2-flip': '#FF00FF',
            'main-3': '#FF00FF',
            'main-3-flip': '#00FFFF',
            bg: '#0A0E27',
            'bg-secondary': '#141829',
            border: '#2A2E3A',
            'border-light': '#3A3E4A',
            'text-primary': '#FFFFFF',
            'text-secondary': '#B3B3B3',
            'text-muted': '#737373'
        }
    },
    'minimal-dark': {
        id: 'minimal-dark',
        label: 'Minimal Dark',
        fontId: 'system',
        colors: {
            'main-1': '#9A9A9A',
            'main-1-flip': '#C8C8C8',
            'main-2': '#6E6E6E',
            'main-2-flip': '#A8A8A8',
            'main-3': '#B8B8B8',
            'main-3-flip': '#888888',
            bg: '#1A1A1A',
            'bg-secondary': '#242424',
            border: '#333333',
            'border-light': '#4A4A4A',
            'text-primary': '#E8E8E8',
            'text-secondary': '#A0A0A0',
            'text-muted': '#6A6A6A'
        }
    },
    'minimal-light': {
        id: 'minimal-light',
        label: 'Minimal Light',
        fontId: 'system',
        colors: {
            'main-1': '#5A5A5A',
            'main-1-flip': '#3A3A3A',
            'main-2': '#7A7A7A',
            'main-2-flip': '#4A4A4A',
            'main-3': '#4A4A4A',
            'main-3-flip': '#6A6A6A',
            bg: '#D0D0D0',
            'bg-secondary': '#BEBEBE',
            border: '#A8A8A8',
            'border-light': '#909090',
            'text-primary': '#2A2A2A',
            'text-secondary': '#4A4A4A',
            'text-muted': '#6A6A6A'
        }
    },
    'trippy-hippy': {
        id: 'trippy-hippy',
        label: 'Trippy Hippy',
        fontId: 'syne',
        colors: {
            'main-1': '#FF6B00',
            'main-1-flip': '#C400FF',
            'main-2': '#39FF14',
            'main-2-flip': '#FF00AA',
            'main-3': '#00E5FF',
            'main-3-flip': '#FFE600',
            bg: '#1A0A24',
            'bg-secondary': '#2A1040',
            border: '#4A2060',
            'border-light': '#6A3080',
            'text-primary': '#FFE8FF',
            'text-secondary': '#D0A0FF',
            'text-muted': '#8860A8'
        }
    },
    matrix: {
        id: 'matrix',
        label: 'Matrix',
        fontId: 'share-tech-mono',
        colors: {
            'main-1': '#00FF41',
            'main-1-flip': '#003B00',
            'main-2': '#00FF41',
            'main-2-flip': '#003B00',
            'main-3': '#39FF14',
            'main-3-flip': '#008F11',
            bg: '#0D0D0D',
            'bg-secondary': '#121212',
            border: '#1A3A1A',
            'border-light': '#2A5A2A',
            'text-primary': '#00FF41',
            'text-secondary': '#00BB33',
            'text-muted': '#007A22'
        }
    },
    africa: {
        id: 'africa',
        label: 'Africa',
        fontId: 'nunito',
        colors: {
            'main-1': '#FCD116',
            'main-1-flip': '#CE1126',
            'main-2': '#007A3D',
            'main-2-flip': '#CE1126',
            'main-3': '#CE1126',
            'main-3-flip': '#FCD116',
            bg: '#1A1208',
            'bg-secondary': '#2A1C0C',
            border: '#4A3820',
            'border-light': '#6A5030',
            'text-primary': '#FFF4D6',
            'text-secondary': '#D4B86A',
            'text-muted': '#8A7040'
        }
    },
    spaceship: {
        id: 'spaceship',
        label: 'Spaceship',
        fontId: 'orbitron',
        colors: {
            'main-1': '#4DE8F0',
            'main-1-flip': '#FF9F43',
            'main-2': '#8FB8D8',
            'main-2-flip': '#E85D4C',
            'main-3': '#FFB84D',
            'main-3-flip': '#3D9BFF',
            bg: '#0A0E12',
            'bg-secondary': '#121820',
            border: '#2A3540',
            'border-light': '#3D4F5C',
            'text-primary': '#E8F2F7',
            'text-secondary': '#9BB0C0',
            'text-muted': '#5A6E7C'
        }
    },
    starlight: {
        id: 'starlight',
        label: 'Starlight',
        fontId: 'space-grotesk',
        colors: {
            'main-1': '#C9D7FF',
            'main-1-flip': '#D4A5FF',
            'main-2': '#A8C5FF',
            'main-2-flip': '#FFD6A5',
            'main-3': '#E8D5FF',
            'main-3-flip': '#9ED8FF',
            bg: '#07071A',
            'bg-secondary': '#10102A',
            border: '#2A2A4A',
            'border-light': '#3E3E68',
            'text-primary': '#F0F0FF',
            'text-secondary': '#B0B0D8',
            'text-muted': '#7070A0'
        }
    },
    forest: {
        id: 'forest',
        label: 'Forest',
        fontId: 'nunito',
        colors: {
            'main-1': '#7CB86A',
            'main-1-flip': '#D4A017',
            'main-2': '#4A8B5C',
            'main-2-flip': '#C4783A',
            'main-3': '#A8C97A',
            'main-3-flip': '#8B5A2B',
            bg: '#0C1610',
            'bg-secondary': '#14201A',
            border: '#2A3E30',
            'border-light': '#3D5644',
            'text-primary': '#E8F0E0',
            'text-secondary': '#A8C0A0',
            'text-muted': '#6A8068'
        }
    },
    arctic: {
        id: 'arctic',
        label: 'Arctic',
        fontId: 'inter',
        colors: {
            'main-1': '#8FD3E8',
            'main-1-flip': '#B8A9FF',
            'main-2': '#A8E6CF',
            'main-2-flip': '#FFB6C1',
            'main-3': '#E0F7FA',
            'main-3-flip': '#81D4FA',
            bg: '#0E1620',
            'bg-secondary': '#162230',
            border: '#2A3E50',
            'border-light': '#3D5568',
            'text-primary': '#F0F7FA',
            'text-secondary': '#A8C4D0',
            'text-muted': '#6A8490'
        }
    },
    wooden: {
        id: 'wooden',
        label: 'Wooden (Archaic)',
        fontId: 'unifraktur-cook',
        colors: {
            'main-1': '#C4A574',
            'main-1-flip': '#8B4513',
            'main-2': '#A67C52',
            'main-2-flip': '#D4C4A8',
            'main-3': '#8B6914',
            'main-3-flip': '#5C4033',
            bg: '#1A120C',
            'bg-secondary': '#241A12',
            border: '#3D2E20',
            'border-light': '#5A4430',
            'text-primary': '#F0E6D2',
            'text-secondary': '#C4B090',
            'text-muted': '#8A7058'
        }
    },
    antique: {
        id: 'antique',
        label: 'Antique',
        fontId: 'cinzel-decorative',
        colors: {
            'main-1': '#8B7355',
            'main-1-flip': '#6B7F6A',
            'main-2': '#A09080',
            'main-2-flip': '#5C5346',
            'main-3': '#B8976A',
            'main-3-flip': '#4A4840',
            bg: '#E8E4DC',
            'bg-secondary': '#D8D2C8',
            border: '#C0B8AC',
            'border-light': '#A8A090',
            'text-primary': '#2A2824',
            'text-secondary': '#5A554C',
            'text-muted': '#7A756C'
        }
    }
};

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function normalizeHex(value, fallback = '#000000') {
    if (typeof value !== 'string') return fallback;
    let v = value.trim();
    if (/^[0-9A-Fa-f]{6}$/.test(v)) v = `#${v}`;
    if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
        v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    }
    return HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

export function getThemePreset(themeId) {
    return THEME_PRESETS[themeId] || THEME_PRESETS[DEFAULT_THEME_ID];
}

export function getPresetColors(themeId) {
    return { ...getThemePreset(themeId).colors };
}

export function sanitizeThemeColors(partial, themeId = DEFAULT_THEME_ID) {
    const base = getPresetColors(themeId);
    const out = { ...base };
    if (!partial || typeof partial !== 'object') return out;
    for (const key of THEME_COLOR_KEYS) {
        if (partial[key] != null) {
            out[key] = normalizeHex(partial[key], base[key]);
        }
    }
    return out;
}

export function applyThemeColorsToRoot(colors, root = document.documentElement) {
    if (!root?.style) return;
    const map = sanitizeThemeColors(colors);
    for (const key of THEME_COLOR_KEYS) {
        const cssVar = THEME_CSS_VARS[key];
        root.style.setProperty(cssVar, map[key]);
    }
    // Prefer stylesheet aliases (--tv-primary → --tv-main-1); drop any stale inline copies.
    root.style.removeProperty('--tv-primary');
    root.style.removeProperty('--tv-accent');
    root.style.removeProperty('--tv-secondary');
}

export function getPresetFontId(themeId) {
    const preset = getThemePreset(themeId);
    return normalizeFontId(preset.fontId);
}

export function normalizeFontId(value) {
    if (typeof value === 'string' && FONT_CATALOG[value]) return value;
    return DEFAULT_FONT_ID;
}

export function getFontEntry(fontId) {
    return FONT_CATALOG[normalizeFontId(fontId)];
}

export function listFonts() {
    return Object.values(FONT_CATALOG).map(({ id, label }) => ({ id, label }));
}

const loadedGoogleFonts = new Set();

export function ensureFontLoaded(fontId) {
    const entry = getFontEntry(fontId);
    if (!entry.googleFamily || typeof document === 'undefined') return;
    if (loadedGoogleFonts.has(entry.id)) return;

    const href = `https://fonts.googleapis.com/css2?family=${entry.googleFamily}&display=swap`;
    const existing = document.querySelector(`link[data-tv-font="${entry.id}"]`);
    if (existing) {
        loadedGoogleFonts.add(entry.id);
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-tv-font', entry.id);
    document.head.appendChild(link);
    loadedGoogleFonts.add(entry.id);
}

/** Preload every catalog face so the font picker can preview each option. */
export function ensureAllFontsLoaded() {
    for (const id of Object.keys(FONT_CATALOG)) {
        ensureFontLoaded(id);
    }
}

export function applyFontToRoot(fontId, root = document.documentElement) {
    if (!root?.style) return;
    const entry = getFontEntry(fontId);
    ensureFontLoaded(entry.id);
    root.style.setProperty('--tv-font-family', entry.stack);
    root.setAttribute('data-font', entry.id);
}

export function listThemes() {
    return Object.values(THEME_PRESETS).map(({ id, label }) => ({ id, label }));
}
