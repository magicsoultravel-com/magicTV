/**
 * Pure CSS grid template for the mosaic shell (no DOM).
 * Classic ≤6 butterfly / asymmetric templates preserved.
 * Slots 7–9 use a 3×3 hub-column butterfly (wide middle, thin satellites).
 * @param {{
 *   freeLayout?: boolean,
 *   topLeft?: boolean,
 *   topRight?: boolean,
 *   bottomLeft?: boolean,
 *   bottomRight?: boolean,
 *   bottomCenter?: boolean,
 *   topCenter?: boolean,
 *   midLeft?: boolean,
 *   midRight?: boolean
 * }} flags
 * @returns {{ areas: string, columns: string, rows: string, hasLeft: boolean, hasRight: boolean, hasTop: boolean, hasBottom: boolean, hasAnyCorner: boolean }}
 */

const HUB_COLS = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
const HUB_LEFT = 'minmax(0, 1fr) minmax(0, 2.2fr)';
const HUB_RIGHT = 'minmax(0, 2.2fr) minmax(0, 1fr)';

/**
 * 3×3 butterfly: wide hub column (topCenter / center / bottomCenter) + satellites.
 * Disabled cells are filled by spanning nearest neighbors so the grid stays solid.
 * @param {{
 *   topLeft: boolean,
 *   topRight: boolean,
 *   bottomLeft: boolean,
 *   bottomRight: boolean,
 *   bottomCenter: boolean,
 *   topCenter: boolean,
 *   midLeft: boolean,
 *   midRight: boolean
 * }} flags
 */
function resolveThreeByThreeButterfly(flags) {
    const enabled = {
        topLeft: flags.topLeft === true,
        topCenter: flags.topCenter === true,
        topRight: flags.topRight === true,
        midLeft: flags.midLeft === true,
        center: true,
        midRight: flags.midRight === true,
        bottomLeft: flags.bottomLeft === true,
        bottomCenter: flags.bottomCenter === true,
        bottomRight: flags.bottomRight === true
    };

    const ids = [
        ['topLeft', 'topCenter', 'topRight'],
        ['midLeft', 'center', 'midRight'],
        ['bottomLeft', 'bottomCenter', 'bottomRight']
    ];

    /** @type {(string|null)[][]} */
    const grid = ids.map((row) => row.map((id) => (enabled[id] ? id : null)));

    const fillVertical = (c) => {
        for (let r = 0; r < 3; r++) {
            if (grid[r][c]) continue;
            let src = null;
            for (let d = 1; d < 3; d++) {
                if (r - d >= 0 && grid[r - d][c]) {
                    src = grid[r - d][c];
                    break;
                }
                if (r + d < 3 && grid[r + d][c]) {
                    src = grid[r + d][c];
                    break;
                }
            }
            if (src) grid[r][c] = src;
        }
    };

    // Satellite columns first, then hub — prefer vertical span (corners into mid row).
    fillVertical(0);
    fillVertical(2);
    fillVertical(1);

    // Any remaining hole borrows horizontally (prefer hub).
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            if (grid[r][c]) continue;
            grid[r][c] = grid[r][1] || grid[r][0] || grid[r][2];
        }
    }

    const needTop = enabled.topLeft || enabled.topCenter || enabled.topRight;
    const needBottom = enabled.bottomLeft || enabled.bottomCenter || enabled.bottomRight;

    const rowIdx = [];
    if (needTop) rowIdx.push(0);
    rowIdx.push(1); // center hub row always present
    if (needBottom) rowIdx.push(2);

    const hasLeft = enabled.topLeft || enabled.midLeft || enabled.bottomLeft;
    const hasRight = enabled.topRight || enabled.midRight || enabled.bottomRight;
    const colIdx = [];
    if (hasLeft) colIdx.push(0);
    colIdx.push(1);
    if (hasRight) colIdx.push(2);

    const areaRows = rowIdx.map((r) => {
        const cells = colIdx.map((c) => grid[r][c] || 'center');
        return `"${cells.join(' ')}"`;
    });

    let columns = '1fr';
    if (hasLeft && hasRight) columns = HUB_COLS;
    else if (hasLeft) columns = HUB_LEFT;
    else if (hasRight) columns = HUB_RIGHT;

    const rows = rowIdx.map(() => '1fr').join(' ') || '1fr';

    return {
        areas: areaRows.join(' ') || '"center"',
        columns,
        rows
    };
}

export function resolveMosaicGridTemplate({
    freeLayout = false,
    topLeft = false,
    topRight = false,
    bottomLeft = false,
    bottomRight = false,
    bottomCenter = false,
    topCenter = false,
    midLeft = false,
    midRight = false
} = {}) {
    const hasTopLeft = topLeft === true;
    const hasTopRight = topRight === true;
    const hasBottomLeft = bottomLeft === true;
    const hasBottomRight = bottomRight === true;
    const hasBottomCenter = bottomCenter === true;
    const hasTopCenter = topCenter === true;
    const hasMidLeft = midLeft === true;
    const hasMidRight = midRight === true;
    const hasExtraSlots = hasTopCenter || hasMidLeft || hasMidRight;
    const hasLeft = hasTopLeft || hasBottomLeft || hasMidLeft;
    const hasRight = hasTopRight || hasBottomRight || hasMidRight;
    const hasTop = hasTopLeft || hasTopRight || hasTopCenter;
    const hasBottom = hasBottomLeft || hasBottomRight || hasBottomCenter;
    const hasAnyCorner = hasLeft || hasRight || hasBottomCenter || hasExtraSlots;

    let areas = '"center"';
    let columns = '1fr';
    let rows = '1fr';

    // Free-layout: single-cell grid shell; tiles overlay via absolute placement.
    if (freeLayout || !hasAnyCorner) {
        return {
            areas,
            columns,
            rows,
            hasLeft,
            hasRight,
            hasTop,
            hasBottom,
            hasAnyCorner
        };
    }

    // 7–9 (or any layout using topCenter / midLeft / midRight): 3×3 hub butterfly.
    if (hasExtraSlots) {
        const expanded = resolveThreeByThreeButterfly({
            topLeft: hasTopLeft,
            topRight: hasTopRight,
            bottomLeft: hasBottomLeft,
            bottomRight: hasBottomRight,
            bottomCenter: hasBottomCenter,
            topCenter: hasTopCenter,
            midLeft: hasMidLeft,
            midRight: hasMidRight
        });
        return {
            ...expanded,
            hasLeft,
            hasRight,
            hasTop,
            hasBottom,
            hasAnyCorner
        };
    }

    // Six-TV butterfly: two large middle screens (center + bottomCenter), corners stay narrow.
    if (hasBottomCenter && hasTop && hasBottom && hasLeft && hasRight) {
        areas = '"topLeft center topRight" "bottomLeft bottomCenter bottomRight"';
        columns = HUB_COLS;
        rows = '1fr 1fr';
        return {
            areas,
            columns,
            rows,
            hasLeft,
            hasRight,
            hasTop,
            hasBottom,
            hasAnyCorner
        };
    }

    if (hasTop && hasBottom) {
        if (hasLeft && hasRight) {
            areas = '"topLeft center topRight" "bottomLeft center bottomRight"';
            columns = HUB_COLS;
            rows = '1fr 1fr';
        } else if (hasLeft) {
            areas = '"topLeft center" "bottomLeft center"';
            columns = HUB_LEFT;
            rows = '1fr 1fr';
        } else {
            areas = '"center topRight" "center bottomRight"';
            columns = HUB_RIGHT;
            rows = '1fr 1fr';
        }
    } else if (hasTop) {
        rows = '1fr';
        if (hasLeft && hasRight) {
            areas = '"topLeft center topRight"';
            columns = HUB_COLS;
        } else if (hasLeft) {
            areas = '"topLeft center"';
            columns = HUB_LEFT;
        } else {
            areas = '"center topRight"';
            columns = HUB_RIGHT;
        }
    } else if (hasBottom) {
        rows = '1fr';
        if (hasBottomCenter && hasLeft && hasRight) {
            areas = '"bottomLeft bottomCenter bottomRight"';
            columns = 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)';
        } else if (hasLeft && hasRight) {
            areas = '"bottomLeft center bottomRight"';
            columns = HUB_COLS;
        } else if (hasLeft) {
            areas = '"bottomLeft center"';
            columns = HUB_LEFT;
        } else {
            areas = '"center bottomRight"';
            columns = HUB_RIGHT;
        }
    }

    return {
        areas,
        columns,
        rows,
        hasLeft,
        hasRight,
        hasTop,
        hasBottom,
        hasAnyCorner
    };
}
