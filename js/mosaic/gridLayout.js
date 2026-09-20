/**
 * Pure CSS grid template for the mosaic shell (no DOM).
 * Butterfly / asymmetric templates cover the classic ≤6 slots only.
 * Extra slots (7–9) force the free-layout single-cell shell.
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

    // Free-layout or 7–9 TVs: single-cell grid shell; tiles overlay via absolute placement.
    if (freeLayout || !hasAnyCorner || hasExtraSlots) {
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

    // Six-TV butterfly: two large middle screens (center + bottomCenter), corners stay narrow.
    if (hasBottomCenter && hasTop && hasBottom && hasLeft && hasRight) {
        areas = '"topLeft center topRight" "bottomLeft bottomCenter bottomRight"';
        columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
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
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
            rows = '1fr 1fr';
        } else if (hasLeft) {
            areas = '"topLeft center" "bottomLeft center"';
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
            rows = '1fr 1fr';
        } else {
            areas = '"center topRight" "center bottomRight"';
            columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
            rows = '1fr 1fr';
        }
    } else if (hasTop) {
        rows = '1fr';
        if (hasLeft && hasRight) {
            areas = '"topLeft center topRight"';
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
        } else if (hasLeft) {
            areas = '"topLeft center"';
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
        } else {
            areas = '"center topRight"';
            columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
        }
    } else if (hasBottom) {
        rows = '1fr';
        if (hasBottomCenter && hasLeft && hasRight) {
            areas = '"bottomLeft bottomCenter bottomRight"';
            columns = 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)';
        } else if (hasLeft && hasRight) {
            areas = '"bottomLeft center bottomRight"';
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr)';
        } else if (hasLeft) {
            areas = '"bottomLeft center"';
            columns = 'minmax(0, 1fr) minmax(0, 2.2fr)';
        } else {
            areas = '"center bottomRight"';
            columns = 'minmax(0, 2.2fr) minmax(0, 1fr)';
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
