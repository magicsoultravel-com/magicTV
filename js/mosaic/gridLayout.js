/**
 * Pure CSS grid template for the mosaic shell (no DOM).
 * @param {{
 *   freeLayout?: boolean,
 *   topLeft?: boolean,
 *   topRight?: boolean,
 *   bottomLeft?: boolean,
 *   bottomRight?: boolean,
 *   bottomCenter?: boolean
 * }} flags
 * @returns {{ areas: string, columns: string, rows: string, hasLeft: boolean, hasRight: boolean, hasTop: boolean, hasBottom: boolean, hasAnyCorner: boolean }}
 */
export function resolveMosaicGridTemplate({
    freeLayout = false,
    topLeft = false,
    topRight = false,
    bottomLeft = false,
    bottomRight = false,
    bottomCenter = false
} = {}) {
    const hasTopLeft = topLeft === true;
    const hasTopRight = topRight === true;
    const hasBottomLeft = bottomLeft === true;
    const hasBottomRight = bottomRight === true;
    const hasBottomCenter = bottomCenter === true;
    const hasLeft = hasTopLeft || hasBottomLeft;
    const hasRight = hasTopRight || hasBottomRight;
    const hasTop = hasTopLeft || hasTopRight;
    const hasBottom = hasBottomLeft || hasBottomRight || hasBottomCenter;
    const hasAnyCorner = hasLeft || hasRight || hasBottomCenter;

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
