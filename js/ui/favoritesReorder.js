import { TvPlayer } from '../tvPlayer.js';
import {
    mergeVisibleFavoriteOrder,
    mergeVisibleFolderItems
} from '../storage/favoritesRecents.js';
import { el } from '../tvUtils.js';

const DRAG_THRESHOLD_PX = 6;
const INSERT_HYSTERESIS_PX = 10;

const GRID_ITEM_SELECTOR = '.channel-tile, .favorite-folder-tile, .favorite-folder-parent-tile';

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

function isDraggableTile(tile) {
    if (!tile) return false;
    if (tile.classList.contains('favorite-folder-tile')) return false;
    if (tile.classList.contains('favorite-folder-parent-tile')) return false;
    if (tile.classList.contains('channel-tile--placeholder')) return false;
    return tile.classList.contains('channel-tile');
}

function tilesOf(grid, exclude = null) {
    return [...grid.querySelectorAll('.channel-tile')].filter((t) => t !== exclude && isDraggableTile(t));
}

function isInFolderView() {
    return !!deps.getAppState()?.favoritesFolderId;
}

/** Reorder slots are channel tiles only — folders stay fixed above channels at root. */
function channelSlotNodes(grid, draggedTile, placeholder) {
    return [...grid.children].filter((node) => {
        if (node === placeholder) return true;
        if (node.classList.contains('favorite-folder-parent-tile')) return false;
        return node.classList.contains('channel-tile') && node !== draggedTile;
    });
}

function cacheSlotGeometry(s) {
    const slots = channelSlotNodes(s.grid, s.tile, s.placeholder);
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

function movePlaceholderToChannelIndex(s, index) {
    const { grid, tile, placeholder } = s;
    const slots = channelSlotNodes(grid, tile, placeholder).filter((node) => node !== placeholder);
    const ref = slots[index] || null;
    if (ref) {
        grid.insertBefore(placeholder, ref);
        return;
    }
    const lastChannel = slots[slots.length - 1];
    if (lastChannel) {
        lastChannel.after(placeholder);
        return;
    }
    const lastFolder = grid.querySelector('.favorite-folder-tile:last-of-type');
    if (lastFolder) {
        lastFolder.after(placeholder);
        return;
    }
    const parent = grid.querySelector('.favorite-folder-parent-tile');
    if (parent) {
        parent.after(placeholder);
        return;
    }
    grid.appendChild(placeholder);
}

function clearDropTargets(grid) {
    grid?.querySelectorAll?.('.is-drop-target').forEach((node) => {
        node.classList.remove('is-drop-target');
    });
}

function pointerOverFolderDropTarget(grid, clientX, clientY) {
    if (isInFolderView()) return null;
    const under = typeof document !== 'undefined'
        ? document.elementFromPoint(clientX, clientY)
        : null;
    const folder = under?.closest?.('.favorite-folder-tile');
    if (!folder || !grid.contains(folder)) return null;
    return folder;
}

function pointerOverParentDropTarget(grid, clientX, clientY) {
    if (!isInFolderView()) return null;
    const under = typeof document !== 'undefined'
        ? document.elementFromPoint(clientX, clientY)
        : null;
    const parent = under?.closest?.('.favorite-folder-parent-tile');
    if (!parent || !grid.contains(parent)) return null;
    return parent;
}

function updateDropTargetHighlight(s, clientX, clientY) {
    const { grid, tile } = s;
    if (!grid) return;
    clearDropTargets(grid);

    if (!tile?.dataset?.channel) return;

    const folder = pointerOverFolderDropTarget(grid, clientX, clientY);
    if (folder) {
        folder.classList.add('is-drop-target');
        return;
    }

    const parent = pointerOverParentDropTarget(grid, clientX, clientY);
    if (parent) parent.classList.add('is-drop-target');
}

function beginDrag(s) {
    const { tile, grid } = s;
    s.dragged = true;
    grid.classList.add('is-reordering');
    tile.classList.add('is-dragging');
    clearDropTargets(grid);

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
    const { tile, grid } = s;
    const dx = clientX - s.offsetX - s.originLeft;
    const dy = clientY - s.offsetY - s.originTop;
    tile.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    updateDropTargetHighlight(s, clientX, clientY);

    // Over a folder/escape drop target: highlight only, never move placeholder into folder rows.
    if (tile.dataset.channel && (
        pointerOverFolderDropTarget(grid, clientX, clientY)
        || pointerOverParentDropTarget(grid, clientX, clientY)
    )) {
        return;
    }

    const index = insertIndexFromCache(s, clientX, clientY);
    if (index === s.insertIndex) return;

    movePlaceholderToChannelIndex(s, index);
    cacheSlotGeometry(s);
}

function cancelPendingFrame() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
    }
    pendingPointer = null;
}

function commitDrag(s, clientX, clientY) {
    const { tile, grid, placeholder, dragged } = s;
    if (!dragged || !placeholder?.parentNode) return false;

    grid.insertBefore(tile, placeholder);
    placeholder.remove();

    const folderId = deps.getAppState()?.favoritesFolderId || null;
    const folderTarget = pointerOverFolderDropTarget(grid, clientX, clientY);
    const parentTarget = pointerOverParentDropTarget(grid, clientX, clientY);
    const channelKeyRef = tile.dataset.channel;

    if (channelKeyRef && folderTarget && !folderId) {
        TvPlayer.moveFavoriteToFolder(channelKeyRef, folderTarget.dataset.folderId);
        deps.onReordered();
        return true;
    }

    if (channelKeyRef && parentTarget && folderId) {
        TvPlayer.moveFavoriteToRoot(channelKeyRef);
        deps.onReordered();
        return true;
    }

    if (folderId) {
        const visibleKeys = tilesOf(grid)
            .map((t) => t.dataset.channel)
            .filter(Boolean);
        const folder = TvPlayer.getFavoriteFolder(folderId);
        if (!folder) return false;
        const merged = mergeVisibleFolderItems(folder.items, visibleKeys);
        const changed = TvPlayer.reorderFavoriteFolderItems(folderId, merged);
        if (changed) deps.onReordered();
        return changed;
    }

    const visibleKeys = tilesOf(grid)
        .map((t) => t.dataset.channel)
        .filter(Boolean);
    const fullKeys = TvPlayer.getFavoritesRootOrder();
    const merged = mergeVisibleFavoriteOrder(fullKeys, visibleKeys);
    const changed = TvPlayer.reorderFavoritesRoot(merged);
    if (changed) deps.onReordered();
    return changed;
}

function endDrag(s, clientX, clientY) {
    cancelPendingFrame();
    const { tile, grid, pointerId, dragged } = s;
    try { tile.releasePointerCapture?.(pointerId); } catch { /* ignore */ }

    clearDropTargets(grid);
    tile.classList.remove('is-dragging', 'is-drag-float');
    tile.style.left = '';
    tile.style.top = '';
    tile.style.width = '';
    tile.style.height = '';
    tile.style.transform = '';
    grid.classList.remove('is-reordering');

    if (dragged) {
        commitDrag(s, clientX, clientY);
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 300);
    } else if (s.placeholder) {
        s.placeholder.remove();
    }
}

function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest?.('.channel-tile__fav-btn')) return;
    if (e.target.closest?.('.channel-tile__hide-btn')) return;
    if (e.target.closest?.('.channel-tile__refresh-btn')) return;
    if (e.target.closest?.('.favorite-folder-tile')) return;
    if (e.target.closest?.('.favorite-folder-parent-tile')) return;
    if (!deps.isReorderEnabled()) return;

    const grid = el('favorites-grid');
    if (!grid || e.currentTarget !== grid) return;

    const tile = e.target.closest?.(GRID_ITEM_SELECTOR);
    if (!tile || !grid.contains(tile) || !isDraggableTile(tile)) return;

    session = {
        grid,
        tile,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
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
        session.lastX = ev.clientX;
        session.lastY = ev.clientY;
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
        if (session.dragged && pendingPointer) {
            moveDrag(session, pendingPointer.x, pendingPointer.y);
        }
        cancelPendingFrame();
        endDrag(session, session.lastX, session.lastY);
        session = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}

function onClickCapture(e) {
    if (!suppressClick) return;
    if (!e.target.closest?.('.channel-tile')) return;
    if (e.target.closest?.('.favorite-folder-tile, .favorite-folder-parent-tile')) return;
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
