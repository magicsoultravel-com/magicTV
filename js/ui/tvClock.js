/**
 * TV Clock styles and rendering for magicTV header.
 * Reuses designs from magiclists (digital, seconds, analog, compact, military, retro, segment, mantel, hidden).
 * When the header collapses, the same zone becomes a fixed draggable overlay over the mosaic.
 */

import { DRAG_THRESHOLD_PX } from '../mosaic/constants.js';

export const CLOCK_STYLES = [
    { id: 'digital', label: 'Digital', desc: 'Hours & minutes' },
    { id: 'digital-seconds', label: 'With seconds', desc: 'Live ticking seconds' },
    { id: 'analog', label: 'Analog', desc: 'Station clock with date' },
    { id: 'compact', label: 'Compact', desc: 'Date & time inline' },
    { id: 'military', label: '24-hour', desc: 'Military time' },
    { id: 'retro', label: 'Retro LED', desc: 'Glowing display' },
    { id: 'segment', label: '7-segment', desc: 'Classic 88 display' },
    { id: 'mantel', label: 'Mantel', desc: 'Vintage desk clock' },
    { id: 'hidden', label: 'Hidden', desc: 'Hide clock completely' }
];

const STORAGE_KEY = 'magic_tv_clock_style';
const HIDDEN_STORAGE_KEY = 'magic_tv_clock_hidden';
const FLOAT_POS_STORAGE_KEY = 'magic_tv_clock_float_pos';
const FLOAT_VIEW_PAD = 8;

const SEG_POS = {
    a: [3, 1, 10, 2],
    b: [12, 3, 2, 7],
    c: [12, 12, 2, 7],
    d: [3, 20, 10, 2],
    e: [1, 12, 2, 7],
    f: [1, 3, 2, 7],
    g: [3, 10.5, 10, 2]
};

const DIGIT_ON = {
    '0': 'abcdef',
    '1': 'bc',
    '2': 'abdeg',
    '3': 'abcdg',
    '4': 'bcfg',
    '5': 'acdfg',
    '6': 'acdefg',
    '7': 'abc',
    '8': 'abcdefg',
    '9': 'abcdfg'
};

function segmentRects(activeSegs, { ghost = false } = {}) {
    return 'abcdefg'.split('').map((seg) => {
        const [x, y, w, h] = SEG_POS[seg];
        const lit = activeSegs.includes(seg);
        if (ghost) {
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8" class="seg seg--ghost"/>`;
        }
        if (!lit) return '';
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8" class="seg seg--on"/>`;
    }).join('');
}

function segmentDigitSvg(char, sizeClass = '') {
    if (char === ':') {
        return `<svg class="seg-colon ${sizeClass}" viewBox="0 0 6 24" aria-hidden="true"><circle cx="3" cy="7" r="1.6" class="seg seg--on"/><circle cx="3" cy="17" r="1.6" class="seg seg--on"/></svg>`;
    }
    const on = DIGIT_ON[char] || '';
    return `<svg class="seg-digit ${sizeClass}" viewBox="0 0 16 24" aria-hidden="true">${segmentRects('abcdefg', { ghost: true })}${segmentRects(on)}</svg>`;
}

function renderSegmentRow(str, sizeClass = '') {
    return str.split('').map((char) => segmentDigitSvg(char, sizeClass)).join('');
}

function formatSegmentTime(now) {
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const ANALOG_MARKS = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const x1 = 50 + 40 * Math.cos(angle);
    const y1 = 50 + 40 * Math.sin(angle);
    const x2 = 50 + 46 * Math.cos(angle);
    const y2 = 50 + 46 * Math.sin(angle);
    const major = i % 3 === 0;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${major ? 1.6 : 0.8}" stroke-linecap="round" opacity="${major ? 0.9 : 0.45}"/>`;
}).join('');

const ANALOG_SVG_INNER = `
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
    ${ANALOG_MARKS}
    <line class="clock-hand clock-hand--hour" x1="50" y1="50" x2="50" y2="30" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line class="clock-hand clock-hand--minute" x1="50" y1="50" x2="50" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line class="clock-hand clock-hand--second" x1="50" y1="54" x2="50" y2="16" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.75"/>
    <circle cx="50" cy="50" r="2.5" fill="currentColor"/>
`;

function analogSvgHtml(className = 'clock-analog-face') {
    return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">${ANALOG_SVG_INNER}</svg>`;
}

function formatTime(now, style) {
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const pad = (n) => String(n).padStart(2, '0');

    if (style === 'military') {
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    if (style === 'digital-seconds' || style === 'segment') {
        return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(now, style) {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
    const dateString = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (style === 'compact') return `${weekday} ${dateString}`;
    return `${weekday}, ${dateString}`;
}

function formatStationDate(now) {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${weekday} · ${day} ${month}`;
}

function setHandRotation(svg, selector, degrees) {
    const hand = svg?.querySelector(selector);
    if (hand) hand.setAttribute('transform', `rotate(${degrees} 50 50)`);
}

function updateAnalogHands(svg, now) {
    if (!svg) return;
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    setHandRotation(svg, '.clock-hand--hour', (h + m / 60) * 30);
    setHandRotation(svg, '.clock-hand--minute', (m + s / 60) * 6);
    setHandRotation(svg, '.clock-hand--second', s * 6);
}

function safeAreaInset(side) {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return 0;
    try {
        const raw = getComputedStyle(document.documentElement)
            .getPropertyValue(`env(safe-area-inset-${side})`);
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

function defaultFloatPosition() {
    return {
        left: Math.max(16, FLOAT_VIEW_PAD + safeAreaInset('left')),
        top: Math.max(12, FLOAT_VIEW_PAD + safeAreaInset('top'))
    };
}

function clampFloatPosition(left, top, width, height) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const padL = Math.max(FLOAT_VIEW_PAD, safeAreaInset('left'));
    const padR = Math.max(FLOAT_VIEW_PAD, safeAreaInset('right'));
    const padT = Math.max(FLOAT_VIEW_PAD, safeAreaInset('top'));
    const padB = Math.max(FLOAT_VIEW_PAD, safeAreaInset('bottom'));
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const maxLeft = Math.max(padL, vw - padR - w);
    const maxTop = Math.max(padT, vh - padB - h);
    return {
        left: Math.round(Math.min(Math.max(padL, left), maxLeft)),
        top: Math.round(Math.min(Math.max(padT, top), maxTop))
    };
}

function loadFloatPosition() {
    try {
        const raw = localStorage.getItem(FLOAT_POS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const left = Number(parsed?.left);
        const top = Number(parsed?.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        return { left, top };
    } catch {
        return null;
    }
}

function saveFloatPosition(pos) {
    try {
        localStorage.setItem(FLOAT_POS_STORAGE_KEY, JSON.stringify({
            left: Math.round(pos.left),
            top: Math.round(pos.top)
        }));
    } catch {
        // ignore
    }
}

export const TvClock = {
    zone: null,
    dateEl: null,
    timeEl: null,
    analogEl: null,
    analogDateEl: null,
    segmentTimeEl: null,
    mantelDateEl: null,
    mantelTimeEl: null,
    intervalId: null,
    currentStyle: 'digital',
    isHidden: false,
    isFloating: false,
    _floatWanted: false,
    _dragBound: false,
    _drag: null,
    _onPointerDown: null,
    _onPointerMove: null,
    _onPointerUp: null,
    _onResize: null,

    init() {
        this.zone = document.getElementById('tv-clock-zone');
        if (!this.zone) return;

        this.dateEl = document.getElementById('tv-clock-date');
        this.timeEl = document.getElementById('tv-clock-time');
        this.analogEl = document.getElementById('tv-clock-analog');
        this.analogDateEl = document.getElementById('tv-clock-analog-date');
        this.segmentTimeEl = document.getElementById('tv-clock-segment-time');
        this.mantelDateEl = document.getElementById('tv-clock-mantel-date');
        this.mantelTimeEl = document.getElementById('tv-clock-mantel-time');

        const analogFaceMount = this.analogEl?.querySelector('.clock-departure-face');
        if (analogFaceMount && !analogFaceMount.querySelector('svg')) {
            analogFaceMount.innerHTML = analogSvgHtml();
        }

        this.loadStoredPrefs();
        this.applyStyle(this.currentStyle, { silent: true });
        this.applyHidden(this.isHidden, { silent: true });

        this.updateTime();
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.updateTime(), 1000);

        this.bindSettings();
        this._bindDrag();
    },

    loadStoredPrefs() {
        try {
            const storedStyle = localStorage.getItem(STORAGE_KEY);
            if (storedStyle && CLOCK_STYLES.some((s) => s.id === storedStyle)) {
                this.currentStyle = storedStyle;
            }
            const storedHidden = localStorage.getItem(HIDDEN_STORAGE_KEY);
            if (storedHidden != null) {
                this.isHidden = storedHidden === '1' || storedHidden === 'true';
            }
            if (this.currentStyle === 'hidden') {
                this.isHidden = true;
            }
        } catch (e) {
            // ignore
        }
    },

    savePrefs() {
        try {
            localStorage.setItem(STORAGE_KEY, this.currentStyle);
            localStorage.setItem(HIDDEN_STORAGE_KEY, this.isHidden ? '1' : '0');
        } catch (e) {
            // ignore
        }
    },

    applyStyle(styleId, { silent = false } = {}) {
        const valid = CLOCK_STYLES.find((s) => s.id === styleId) ? styleId : 'digital';
        if (valid === 'hidden') {
            this.currentStyle = 'digital';
            this.isHidden = true;
        } else {
            this.currentStyle = valid;
            this.isHidden = false;
        }

        if (this.zone) {
            this.zone.setAttribute('data-clock-style', this.currentStyle);
        }
        if (!silent) {
            this.savePrefs();
            this.updateTime();
        }
        const select = document.getElementById('tv-clock-style-select');
        if (select) {
            select.value = this.isHidden ? 'hidden' : this.currentStyle;
        }
        this._syncFloating();
    },

    applyHidden(hidden, { silent = false } = {}) {
        this.isHidden = Boolean(hidden);
        if (this.zone) {
            if (this.isHidden) {
                this.zone.setAttribute('data-clock-hidden', '1');
            } else {
                this.zone.removeAttribute('data-clock-hidden');
            }
        }
        if (!silent) {
            this.savePrefs();
        }
        const select = document.getElementById('tv-clock-style-select');
        if (select) {
            select.value = this.isHidden ? 'hidden' : this.currentStyle;
        }
        this._syncFloating();
    },

    /**
     * Header collapse asks the clock to float (or return to the header row).
     * Hidden clocks never float.
     * @param {boolean} enabled
     */
    setFloating(enabled) {
        this._floatWanted = Boolean(enabled);
        this._syncFloating();
    },

    _syncFloating() {
        const shouldFloat = this._floatWanted && !this.isHidden && !!this.zone;
        if (shouldFloat === this.isFloating) {
            if (shouldFloat) this._applyFloatPosition();
            return;
        }
        if (shouldFloat) {
            this._enterFloating();
        } else {
            this._exitFloating();
        }
    },

    _enterFloating() {
        if (!this.zone) return;
        this.isFloating = true;
        this.zone.classList.add('is-clock-floating');
        this._applyFloatPosition();
    },

    _exitFloating() {
        if (!this.zone) return;
        this._endDrag();
        this.isFloating = false;
        this.zone.classList.remove('is-clock-floating', 'is-clock-dragging');
        this.zone.style.left = '';
        this.zone.style.top = '';
    },

    _applyFloatPosition() {
        if (!this.zone || !this.isFloating) return;
        const saved = loadFloatPosition();
        const fallback = defaultFloatPosition();
        const rect = this.zone.getBoundingClientRect();
        const w = rect.width || this.zone.offsetWidth || 120;
        const h = rect.height || this.zone.offsetHeight || 32;
        const next = clampFloatPosition(
            saved?.left ?? fallback.left,
            saved?.top ?? fallback.top,
            w,
            h
        );
        this.zone.style.left = `${next.left}px`;
        this.zone.style.top = `${next.top}px`;
    },

    _bindDrag() {
        if (this._dragBound || !this.zone) return;
        this._dragBound = true;

        this._onPointerDown = (e) => {
            if (!this.isFloating || this.isHidden || !this.zone) return;
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            const rect = this.zone.getBoundingClientRect();
            this._drag = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                originLeft: rect.left,
                originTop: rect.top,
                width: rect.width,
                height: rect.height,
                moved: false
            };
            try {
                this.zone.setPointerCapture(e.pointerId);
            } catch {
                // ignore
            }
            window.addEventListener('pointermove', this._onPointerMove);
            window.addEventListener('pointerup', this._onPointerUp);
            window.addEventListener('pointercancel', this._onPointerUp);
        };

        this._onPointerMove = (e) => {
            const drag = this._drag;
            if (!drag || e.pointerId !== drag.pointerId || !this.zone) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (!drag.moved) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                drag.moved = true;
                this.zone.classList.add('is-clock-dragging');
            }
            e.preventDefault();
            const next = clampFloatPosition(
                drag.originLeft + dx,
                drag.originTop + dy,
                drag.width,
                drag.height
            );
            this.zone.style.left = `${next.left}px`;
            this.zone.style.top = `${next.top}px`;
        };

        this._onPointerUp = (e) => {
            const drag = this._drag;
            if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
            if (drag.moved && this.zone) {
                const rect = this.zone.getBoundingClientRect();
                const next = clampFloatPosition(rect.left, rect.top, rect.width, rect.height);
                this.zone.style.left = `${next.left}px`;
                this.zone.style.top = `${next.top}px`;
                saveFloatPosition(next);
            }
            this._endDrag();
        };

        this._onResize = () => {
            if (!this.isFloating) return;
            this._applyFloatPosition();
        };

        this.zone.addEventListener('pointerdown', this._onPointerDown);
        window.addEventListener('resize', this._onResize);
    },

    _endDrag() {
        if (this._drag && this.zone) {
            try {
                this.zone.releasePointerCapture(this._drag.pointerId);
            } catch {
                // ignore
            }
        }
        this._drag = null;
        this.zone?.classList.remove('is-clock-dragging');
        if (this._onPointerMove) window.removeEventListener('pointermove', this._onPointerMove);
        if (this._onPointerUp) {
            window.removeEventListener('pointerup', this._onPointerUp);
            window.removeEventListener('pointercancel', this._onPointerUp);
        }
    },

    updateTime() {
        if (!this.zone || this.isHidden) return;
        const now = new Date();

        if (this.currentStyle === 'analog') {
            if (this.analogDateEl) {
                this.analogDateEl.textContent = formatStationDate(now);
            }
            const faceSvg = this.analogEl?.querySelector('.clock-analog-face');
            updateAnalogHands(faceSvg, now);
            return;
        }

        if (this.currentStyle === 'segment') {
            if (this.segmentTimeEl) {
                const segmentStr = formatSegmentTime(now);
                this.segmentTimeEl.innerHTML = renderSegmentRow(segmentStr);
                this.segmentTimeEl.setAttribute('aria-label', segmentStr);
            }
            return;
        }

        if (this.currentStyle === 'mantel') {
            if (this.mantelDateEl) this.mantelDateEl.textContent = formatStationDate(now);
            if (this.mantelTimeEl) this.mantelTimeEl.textContent = formatTime(now, 'digital');
            return;
        }

        const timeStr = formatTime(now, this.currentStyle);
        const dateStr = formatDate(now, this.currentStyle);

        if (this.dateEl) this.dateEl.textContent = dateStr;
        if (this.timeEl) this.timeEl.textContent = timeStr;
    },

    bindSettings() {
        const select = document.getElementById('tv-clock-style-select');
        if (!select) return;

        select.innerHTML = CLOCK_STYLES.map((s) => `
            <option value="${s.id}">${s.label}</option>
        `).join('');

        select.value = this.isHidden ? 'hidden' : this.currentStyle;

        select.addEventListener('change', () => {
            const val = select.value;
            if (val === 'hidden') {
                this.applyHidden(true);
            } else {
                this.applyHidden(false);
                this.applyStyle(val);
            }
        });
    }

};
