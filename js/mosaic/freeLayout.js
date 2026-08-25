/**
 * Mosaic free-layout: drag, resize, placement persist, applyFreeLayout.
 * Methods are mixed into MultiView (this === MultiView).
 */
import { savePlayerState } from '../storage/playerState.js';
import { el } from '../tvUtils.js';
import {
    CORNER_IDS,
    SLOT_IDS,
    DRAG_THRESHOLD_PX,
    RESIZE_MIN_W,
    RESIZE_MIN_H,
    RESIZE_EDGES,
    clearTilePlacementStyle
} from './constants.js';

/**
 * Live free-layout board height (parity with clientWidth).
 * Prefer the parent pane — mosaic minHeight + absolute tiles make self-measure circular.
 */
function resolveFreeBoardHeight(mosaic) {
    const parentH = mosaic.parentElement?.clientHeight || 0;
    if (parentH > 0) return Math.max(Math.ceil(parentH), 240);
    const stored = Number(mosaic.dataset.freeBaseHeight);
    if (Number.isFinite(stored) && stored >= 120) return Math.ceil(stored);
    return Math.max(Math.ceil(mosaic.clientHeight || 0), 240);
}

/** Integer box clamped so a near-full tile can always sit at top/left 0. */
function clampFreeTileBox(left, top, w, h, mw, baseH) {
    let width = Math.min(Math.max(RESIZE_MIN_W, Math.round(w)), Math.max(RESIZE_MIN_W, mw));
    let height = Math.min(Math.max(RESIZE_MIN_H, Math.round(h)), Math.max(RESIZE_MIN_H, baseH));
    let x = Math.round(left);
    let y = Math.round(top);
    // Snap hairline insets to a board edge (prefer top/left when both are within 1px).
    if (x <= 1) x = 0;
    else if (x + width >= mw - 1) x = Math.max(0, mw - width);
    if (y <= 1) y = 0;
    else if (y + height >= baseH - 1) y = Math.max(0, baseH - height);
    x = Math.min(Math.max(0, x), Math.max(0, mw - width));
    y = Math.min(Math.max(0, y), Math.max(0, baseH - height));
    width = Math.min(width, Math.max(RESIZE_MIN_W, mw - x));
    height = Math.min(height, Math.max(RESIZE_MIN_H, baseH - y));
    return { left: x, top: y, w: width, h: height };
}

export const freeLayoutMethods = {
    beginFreePlacementGesture(session) {
        if (!this.hasCustomPlacement()) {
            this.captureGridAsPlacement();
        }
        this.raiseTileInStack(session.slotId);
        this.applyFreeLayout();

        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;
        const mosaicRect = mosaic.getBoundingClientRect();
        const tileRect = session.tile.getBoundingClientRect();
        const mw = mosaic.clientWidth;
        const baseH = resolveFreeBoardHeight(mosaic);
        const box = clampFreeTileBox(
            tileRect.left - mosaicRect.left,
            tileRect.top - mosaicRect.top,
            tileRect.width,
            tileRect.height,
            mw,
            baseH
        );
        session.originLeft = box.left;
        session.originTop = box.top;
        session.width = box.w;
        session.height = box.h;
        session.dragOriginClientX = session.startX;
        session.dragOriginClientY = session.startY;
    },

    hasCustomPlacement() {
        return SLOT_IDS.some((id) => Boolean(this.mosaicPlacement[id]));
    },

    isPlacementSane() {
        if (!this.hasCustomPlacement()) return true;
        for (const id of SLOT_IDS) {
            const p = this.mosaicPlacement[id];
            if (!p) continue;
            if (p.w < 0.05 || p.h < 0.08) return false;
        }
        return true;
    },

    sanitizePlacementMap(raw = {}) {
        const next = { ...raw };
        CORNER_IDS.forEach((id) => {
            if (!next[id]) return;
            if (!this.slots[id]?.enabled) delete next[id];
        });
        if (next.center && !this.slots.center?.enabled) delete next.center;
        return next;
    },

    ensureCenterOnTop() {
        if (!this.hasCustomPlacement() || !this.mosaicPlacement.center) return;
        let maxOther = 0;
        for (const id of SLOT_IDS) {
            if (id === 'center') continue;
            const p = this.mosaicPlacement[id];
            if (!p) continue;
            maxOther = Math.max(maxOther, p.z || 1);
        }
        const centerZ = this.mosaicPlacement.center.z || 1;
        if (centerZ <= maxOther) {
            this.placementZTop = Math.max(this.placementZTop, maxOther + 1);
            this.mosaicPlacement.center.z = this.placementZTop;
        } else {
            this.placementZTop = Math.max(this.placementZTop, centerZ);
        }
    },

    raiseTileInStack(slotId) {
        if (!this.hasCustomPlacement() || !slotId || !this.mosaicPlacement[slotId]) return;

        this.placementZTop += 1;
        const top = this.placementZTop;
        this.mosaicPlacement[slotId].z = top;
        const tile = el(`player-tile-${slotId}`);
        if (tile) tile.style.zIndex = String(top);
    },

    placementZForSlot(slotId) {
        const p = this.mosaicPlacement[slotId];
        if (p?.z != null) return p.z;
        return 1;
    },

    syncPlacementChrome() {
        if (typeof document === 'undefined') return;
        const app = el('app-container') || document.body;
        const custom = this.hasCustomPlacement();
        app.classList.toggle('has-custom-mosaic-placement', custom);
        const resetBtns = [el('mosaic-reset-btn')].filter(Boolean);
        resetBtns.forEach((btn) => {
            btn.classList.toggle('is-hidden', !custom);
            btn.hidden = !custom;
        });
    },

    onTilePointerDown(e) {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-tile-action]')) return;
        if (e.target.closest?.('[data-cast-toggle]')) return;
        if (e.target.closest?.('.tv-controls__cast-wrap')) return;
        if (e.target.closest?.('.tv-player-tile__hover')) return;
        if (e.target.closest?.('[data-quality-wrap]')) return;
        if (this.swapBusy) return;

        const tile = e.target.closest?.('.tv-player-tile');
        if (!tile || tile.classList.contains('is-hidden')) return;
        const slotId = tile.getAttribute('data-slot');
        if (!slotId || !SLOT_IDS.includes(slotId)) return;
        if (!this.slots[slotId]?.enabled) return;

        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        const resizeHandle = e.target.closest?.('[data-resize]');
        const resizeEdge = resizeHandle?.getAttribute('data-resize');
        if (resizeHandle && (!resizeEdge || !RESIZE_EDGES.has(resizeEdge))) return;

        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        this.dragSession = {
            mode: resizeHandle ? 'resize' : 'drag',
            edges: resizeEdge || '',
            slotId,
            tile,
            pointerId: e.pointerId,
            startX,
            startY,
            originLeft: 0,
            originTop: 0,
            width: 0,
            height: 0,
            dragged: Boolean(resizeHandle),
        };

        if (resizeHandle) {
            this.beginTileResize(this.dragSession);
        }

        const onMove = (ev) => {
            if (!this.dragSession || ev.pointerId !== this.dragSession.pointerId) return;
            if (this.dragSession.mode === 'resize') {
                this.moveTileResize(this.dragSession, ev.clientX, ev.clientY);
                return;
            }
            const dx = ev.clientX - this.dragSession.startX;
            const dy = ev.clientY - this.dragSession.startY;
            if (!this.dragSession.dragged) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                this.beginTileDrag(this.dragSession);
            }
            this.moveTileDrag(this.dragSession, ev.clientX, ev.clientY);
        };

        const onUp = (ev) => {
            if (!this.dragSession || ev.pointerId !== this.dragSession.pointerId) return;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            if (this.dragSession.mode === 'resize') {
                this.endTileResize(this.dragSession);
            } else {
                this.endTileDrag(this.dragSession);
            }
            this.dragSession = null;
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        try { tile.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    },

    beginTileDrag(session) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        session.dragged = true;
        this.beginFreePlacementGesture(session);
        session.dragOriginLeft = session.originLeft;
        session.dragOriginTop = session.originTop;

        session.tile.classList.add('is-dragging');
        session.tile.classList.add('is-placed');
        session.tile.style.zIndex = String(this.placementZForSlot(session.slotId));
    },

    moveTileDrag(session, clientX, clientY) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        const mw = mosaic.clientWidth;
        const baseH = resolveFreeBoardHeight(mosaic);
        mosaic.dataset.freeBaseHeight = String(baseH);
        const dx = clientX - (session.dragOriginClientX ?? session.startX);
        const dy = clientY - (session.dragOriginClientY ?? session.startY);
        const box = clampFreeTileBox(
            (session.dragOriginLeft ?? session.originLeft) + dx,
            (session.dragOriginTop ?? session.originTop) + dy,
            session.width,
            session.height,
            mw,
            baseH
        );

        session.tile.style.left = `${box.left}px`;
        session.tile.style.top = `${box.top}px`;
        session.tile.style.width = `${box.w}px`;
        session.tile.style.height = `${box.h}px`;

        if (mw > 0 && baseH > 0) {
            this.mosaicPlacement[session.slotId] = {
                x: box.left / mw,
                y: box.top / baseH,
                w: box.w / mw,
                h: box.h / baseH,
                z: this.placementZForSlot(session.slotId)
            };
        }

        const maxBottom = box.top + box.h;
        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, maxBottom + 8))}px`;
    },

    endTileDrag(session) {
        if (!session?.tile) return;
        session.tile.classList.remove('is-dragging');
        try { session.tile.releasePointerCapture?.(session.pointerId); } catch { /* ignore */ }

        if (session.dragged) {
            this.persistPlacement();
            this.applyFreeLayout();
            this.syncPlacementChrome();
            return;
        }

        // Click (no drag): raise that tile to the top of the z-stack (no swap).
        const { slotId } = session;
        if (slotId && SLOT_IDS.includes(slotId) && this.slots[slotId]?.enabled) {
            if (this.hasCustomPlacement()) {
                this.raiseTileInStack(slotId);
                this.persistPlacement();
            }
            this.maybeRetargetChannelPicker(slotId);
        }
    },

    beginTileResize(session) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        this.beginFreePlacementGesture(session);

        session.tile.classList.add('is-resizing');
        session.tile.classList.add('is-placed');
        session.tile.style.zIndex = String(this.placementZForSlot(session.slotId));
    },

    moveTileResize(session, clientX, clientY) {
        const mosaic = el('player-mosaic');
        if (!mosaic || !session?.tile) return;

        const mw = mosaic.clientWidth;
        const baseH = resolveFreeBoardHeight(mosaic);
        mosaic.dataset.freeBaseHeight = String(baseH);

        const dx = clientX - (session.dragOriginClientX ?? session.startX);
        const dy = clientY - (session.dragOriginClientY ?? session.startY);
        const edges = session.edges || '';

        let left = session.originLeft;
        let top = session.originTop;
        let w = session.width;
        let h = session.height;
        const right = session.originLeft + session.width;
        const bottom = session.originTop + session.height;

        if (edges.includes('e')) {
            w = Math.max(RESIZE_MIN_W, session.width + dx);
            w = Math.min(w, Math.max(RESIZE_MIN_W, mw - left));
        }
        if (edges.includes('s')) {
            h = Math.max(RESIZE_MIN_H, session.height + dy);
            h = Math.min(h, Math.max(RESIZE_MIN_H, baseH - top));
        }
        if (edges.includes('w')) {
            const nextLeft = Math.min(right - RESIZE_MIN_W, Math.max(0, session.originLeft + dx));
            w = right - nextLeft;
            left = nextLeft;
        }
        if (edges.includes('n')) {
            const nextTop = Math.min(bottom - RESIZE_MIN_H, Math.max(0, session.originTop + dy));
            h = bottom - nextTop;
            top = nextTop;
        }

        const box = clampFreeTileBox(left, top, w, h, mw, baseH);

        session.tile.style.left = `${box.left}px`;
        session.tile.style.top = `${box.top}px`;
        session.tile.style.width = `${box.w}px`;
        session.tile.style.height = `${box.h}px`;

        if (mw > 0 && baseH > 0) {
            this.mosaicPlacement[session.slotId] = {
                x: box.left / mw,
                y: box.top / baseH,
                w: box.w / mw,
                h: box.h / baseH,
                z: this.placementZForSlot(session.slotId)
            };
        }

        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, box.top + box.h + 8))}px`;
    },

    endTileResize(session) {
        if (!session?.tile) return;
        session.tile.classList.remove('is-resizing');
        try { session.tile.releasePointerCapture?.(session.pointerId); } catch { /* ignore */ }

        this.persistPlacement();
        this.applyFreeLayout();
        this.syncPlacementChrome();
    },

    captureGridAsPlacement() {
        const mosaic = el('player-mosaic');
        if (!mosaic) return;

        // Enter free-layout board metrics (padding/gap 0) before measuring so
        // TV 1 is not baked with the padded-grid top inset.
        mosaic.classList.add('is-free-layout');
        void mosaic.offsetWidth;

        const mosaicRect = mosaic.getBoundingClientRect();
        const mw = mosaicRect.width || mosaic.clientWidth;
        const mh = mosaicRect.height || mosaic.clientHeight;
        if (mw <= 0 || mh <= 0) {
            mosaic.classList.remove('is-free-layout');
            return;
        }

        const next = {};
        let z = 1;
        // Measure every visible tile after padding/gap are zeroed, then absolutize.
        SLOT_IDS.forEach((id) => {
            if (!this.slots[id]?.enabled) return;
            const tile = el(`player-tile-${id}`);
            if (!tile || tile.classList.contains('is-hidden')) return;
            const r = tile.getBoundingClientRect();
            const box = clampFreeTileBox(
                r.left - mosaicRect.left,
                r.top - mosaicRect.top,
                Math.max(48, r.width),
                Math.max(36, r.height),
                mw,
                mh
            );
            next[id] = {
                x: box.left / mw,
                y: box.top / mh,
                w: box.w / mw,
                h: box.h / mh,
                z: z++
            };
            tile.style.left = `${box.left}px`;
            tile.style.top = `${box.top}px`;
            tile.style.width = `${box.w}px`;
            tile.style.height = `${box.h}px`;
            tile.style.zIndex = String(next[id].z);
            tile.classList.add('is-placed');
        });

        if (!Object.keys(next).length) {
            mosaic.classList.remove('is-free-layout');
            return;
        }

        this.mosaicPlacement = next;
        this.placementZTop = Object.values(next).reduce((max, p) => Math.max(max, p.z || 1), 1);
        this.ensureCenterOnTop();
        if (next.center) {
            const centerTile = el('player-tile-center');
            if (centerTile) centerTile.style.zIndex = String(next.center.z);
        }
        mosaic.dataset.freeBaseHeight = String(Math.ceil(mh));
        mosaic.style.minHeight = `${Math.ceil(mh)}px`;
        this.syncLayout();
        this.syncPlacementChrome();
    },

    applyFreeLayout() {
        const mosaic = el('player-mosaic');
        if (!mosaic || !this.hasCustomPlacement()) return;

        this.mosaicPlacement = this.sanitizePlacementMap(this.mosaicPlacement);

        if (!this.isPlacementSane()) {
            this.mosaicPlacement = {};
            this.placementZTop = 1;
            this.clearFreeLayoutStyles();
            this.persistPlacement();
            this.syncLayout();
            this.syncPlacementChrome();
            return;
        }

        const mw = mosaic.clientWidth;
        if (mw <= 0) return;

        const baseH = resolveFreeBoardHeight(mosaic);
        mosaic.dataset.freeBaseHeight = String(baseH);

        mosaic.classList.add('is-free-layout');

        let maxBottom = 0;
        SLOT_IDS.forEach((id) => {
            const tile = el(`player-tile-${id}`);
            if (!tile) return;
            const enabled = this.slots[id]?.enabled;
            if (!enabled) {
                clearTilePlacementStyle(tile);
                return;
            }
            const p = this.mosaicPlacement[id];
            if (!p) {
                clearTilePlacementStyle(tile);
                return;
            }
            const box = clampFreeTileBox(
                p.x * mw,
                p.y * baseH,
                Math.max(RESIZE_MIN_W, p.w * mw),
                Math.max(RESIZE_MIN_H, p.h * baseH),
                mw,
                baseH
            );
            tile.style.left = `${box.left}px`;
            tile.style.top = `${box.top}px`;
            tile.style.width = `${box.w}px`;
            tile.style.height = `${box.h}px`;
            tile.style.zIndex = String(p.z || 1);
            tile.classList.add('is-placed');
            maxBottom = Math.max(maxBottom, box.top + box.h);
        });

        mosaic.style.minHeight = `${Math.ceil(Math.max(baseH, maxBottom + 8))}px`;
        this.syncPlacementChrome();
    },

    clearFreeLayoutStyles() {
        const mosaic = el('player-mosaic');
        mosaic?.classList.remove('is-free-layout');
        if (mosaic) {
            mosaic.style.minHeight = '';
            delete mosaic.dataset.freeBaseHeight;
        }
        SLOT_IDS.forEach((id) => clearTilePlacementStyle(el(`player-tile-${id}`)));
    },

    persistPlacement() {
        const cleaned = this.sanitizePlacementMap(this.mosaicPlacement);
        this.mosaicPlacement = cleaned;
        savePlayerState({ mosaicPlacement: { ...cleaned } });
    },

    resetMosaicPlacement() {
        this.mosaicPlacement = {};
        this.placementZTop = 1;
        this.clearFreeLayoutStyles();
        this.persistPlacement();
        this.syncLayout();
        this.mountAll();
        this.scheduleRefreshTiles();
        this.syncPlacementChrome();
    },
};
