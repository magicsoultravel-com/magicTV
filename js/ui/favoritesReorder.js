import { TvPlayer } from '../tvPlayer.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { mergeVisibleFavoriteOrder } from '../storage/favoritesRecents.js';
import { el } from '../tvUtils.js';

const DRAG_THRESHOLD_PX = 6;
const INSERT_HYSTERESIS_PX = 10;

let deps = {
    getAppState: () => null,
    isReorderEnabled: () => true,
    onReordered: () => {}
};

let session = null;
let suppressClick = false;
let wired = false;
let rafId = 0;
let pendingPointer = null;

function tilesOf(grid, exclude = null) {
    return [...grid.querySelectorAll('.channel-tile')].filter((t) => t !== exclude);
}

function slotElements(grid, tile, placeholder) {
    return [...grid.children].filter(
        (node) => node === placeholder || (node.classList.contains('channel-tile') && node !== tile)
    );
}

function cacheSlotGeometry(s) {
    const slots = slotElements(s.grid, s.tile, s.placeholder);
    s.slotCache = slots.map((node) => {
        const r = node.getBoundingClientRect();
        return {
            el: node,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            halfH: r.height / 2
        };
    });
    s.insertIndex = slots.indexOf(s.placeholder);
    if (s.insertIndex < 0) s.insertIndex = slots.length;
}

/**
 * Insert index from cached slot geometry (reading order), with hysteresis so
 * the placeholder does not flicker on mid-line boundaries.
 */
function insertIndexFromCache(s, clientX, clientY) {
    const cache = s.slotCache || [];
    const h = INSERT_HYSTERESIS_PX;
    let next = cache.length;

    for (let i = 0; i < cache.length; i += 1) {
        const slot = cache[i];
        const beforeRow = clientY < slot.cy - h;
        const sameRowBefore = Math.abs(clientY - slot.cy) <= slot.halfH + h && clientX < slot.cx - h;
        if (beforeRow || sameRowBefore) {
            next = i;
            break;
        }
    }

    // Stay put unless the pointer clearly crossed into a new slot.
    if (s.insertIndex != null && next !== s.insertIndex) {
        const cur = cache[s.insertIndex];
        if (cur) {
            const stillInCurrent =
                clientX >= cur.left - h
                && clientX <= cur.right + h
                && clientY >= cur.top - h
                && clientY <= cur.bottom + h;
            if (stillInCurrent) return s.insertIndex;
        }
    }
    return next;
}

function beginDrag(s) {
    const { tile, grid } = s;
    s.dragged = true;
    grid.classList.add('is-reordering');
    tile.classList.add('is-dragging');

    const rect = tile.getBoundingClientRect();
    s.width = rect.width;
    s.height = rect.height;
    s.originLeft = rect.left;
    s.originTop = rect.top;
    s.offsetX = s.startX - rect.left;
    s.offsetY = s.startY - rect.top;

    const placeholder = document.createElement('div');
    placeholder.className = 'channel-tile channel-tile--placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.minHeight = `${rect.height}px`;
    grid.insertBefore(placeholder, tile);
    s.placeholder = placeholder;

    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.style.left = `${rect.left}px`;
    tile.style.top = `${rect.top}px`;
    tile.style.transform = 'translate3d(0, 0, 0)';
    tile.classList.add('is-drag-float');

    cacheSlotGeometry(s);
}

function moveDrag(s, clientX, clientY) {
    const { tile, grid, placeholder } = s;
    const dx = clientX - s.offsetX - s.originLeft;
    const dy = clientY - s.offsetY - s.originTop;
    tile.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

    const index = insertIndexFromCache(s, clientX, clientY);
    if (index === s.insertIndex) return;

    const slots = slotElements(grid, tile, placeholder);
    const ref = slots[index] || null;
    if (ref === placeholder) {
        s.insertIndex = index;
        return;
    }
    if (ref) grid.insertBefore(placeholder, ref);
    else grid.appendChild(placeholder);

    cacheSlotGeometry(s);
}

function cancelPendingFrame() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
    }
    pendingPointer = null;
}

function endDrag(s) {
    cancelPendingFrame();
    const { tile, grid, placeholder, dragged, pointerId } = s;
    try { tile.releasePointerCapture?.(pointerId); } catch { /* ignore */ }

    tile.classList.remove('is-dragging', 'is-drag-float');
    tile.style.left = '';
    tile.style.top = '';
    tile.style.width = '';
    tile.style.height = '';
    tile.style.transform = '';
    grid.classList.remove('is-reordering');

    if (dragged && placeholder?.parentNode) {
        grid.insertBefore(tile, placeholder);
        placeholder.remove();

        const visibleKeys = tilesOf(grid).map((t) => t.dataset.channel).filter(Boolean);
        const fullKeys = TvPlayer.getFavorites();
        const merged = mergeVisibleFavoriteOrder(fullKeys, visibleKeys);
        const changed = TvPlayer.reorderFavorites(merged);
        if (changed) {
            const appState = deps.getAppState();
            if (appState?.favoritesList) {
                const byKey = new Map(appState.favoritesList.map((ch) => [channelKey(ch), ch]));
                appState.favoritesList = merged.map((k) => byKey.get(k)).filter(Boolean);
            }
            deps.onReordered();
        }
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 300);
    } else if (placeholder) {
        placeholder.remove();
    }
}

function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest?.('.channel-tile__fav-btn')) return;
    if (!deps.isReorderEnabled()) return;

    const grid = el('favorites-grid');
    if (!grid || e.currentTarget !== grid) return;

    const tile = e.target.closest?.('.channel-tile');
    if (!tile || !grid.contains(tile) || tile.classList.contains('channel-tile--placeholder')) return;

    session = {
        grid,
        tile,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dragged: false,
        placeholder: null,
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
        originLeft: 0,
        originTop: 0,
        slotCache: null,
        insertIndex: 0
    };

    const onMove = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;
        const dx = ev.clientX - session.startX;
        const dy = ev.clientY - session.startY;
        if (!session.dragged) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            beginDrag(session);
            try { session.tile.setPointerCapture?.(session.pointerId); } catch { /* ignore */ }
        }
        pendingPointer = { x: ev.clientX, y: ev.clientY };
        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (!session?.dragged || !pendingPointer) return;
                const { x, y } = pendingPointer;
                pendingPointer = null;
                moveDrag(session, x, y);
            });
        }
        ev.preventDefault();
    };

    const onUp = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        // Apply last pending pointer before commit so drop index matches finger.
        if (session.dragged && pendingPointer) {
            moveDrag(session, pendingPointer.x, pendingPointer.y);
        }
        cancelPendingFrame();
        endDrag(session);
        session = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}

function onClickCapture(e) {
    if (!suppressClick) return;
    if (!e.target.closest?.('.channel-tile')) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
}

export const FavoritesReorder = {
    init({ getAppState, isReorderEnabled, onReordered } = {}) {
        deps = {
            getAppState: getAppState || (() => null),
            isReorderEnabled: isReorderEnabled || (() => true),
            onReordered: onReordered || (() => {})
        };
        if (wired) return;
        const grid = el('favorites-grid');
        if (!grid) return;
        grid.addEventListener('pointerdown', onPointerDown);
        grid.addEventListener('click', onClickCapture, true);
        wired = true;
    }
};
