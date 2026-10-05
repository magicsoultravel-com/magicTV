import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    SCALE_MIN,
    SCALE_MAX,
    REMOTE_BASE_W,
    REMOTE_BASE_H,
    RADIO_BASE_W,
    BROWSER_BASE_W,
    BROWSER_BASE_H,
    clampModuleScale,
    scaleFromWidth,
    uniformScaleFromCorner,
    freeCornerResize,
    browserTileScaleFromGeom
} from '../js/ui/moduleScaleResize.js';

describe('moduleScaleResize', () => {
    it('clamps module scale to 0.5–1.5', () => {
        assert.equal(clampModuleScale(0.1), SCALE_MIN);
        assert.equal(clampModuleScale(3), SCALE_MAX);
        assert.equal(clampModuleScale(1), 1);
        assert.equal(clampModuleScale('nope'), 1);
    });

    it('derives scale from width', () => {
        assert.equal(scaleFromWidth(REMOTE_BASE_W, REMOTE_BASE_W), 1);
        assert.equal(scaleFromWidth(REMOTE_BASE_W * 0.5, REMOTE_BASE_W), 0.5);
        assert.equal(scaleFromWidth(RADIO_BASE_W * 1.5, RADIO_BASE_W), 1.5);
    });

    it('uniform corner scale preserves aspect and anchors opposite corner', () => {
        const se = uniformScaleFromCorner({
            originLeft: 100,
            originTop: 50,
            originW: REMOTE_BASE_W,
            originH: REMOTE_BASE_H,
            originScale: 1,
            baseW: REMOTE_BASE_W,
            baseH: REMOTE_BASE_H,
            dx: REMOTE_BASE_W,
            dy: REMOTE_BASE_H,
            edge: 'se'
        });
        assert.ok(se.scale > 1);
        assert.ok(se.scale <= SCALE_MAX);
        assert.equal(se.left, 100);
        assert.equal(se.top, 50);

        const nw = uniformScaleFromCorner({
            originLeft: 100,
            originTop: 50,
            originW: REMOTE_BASE_W,
            originH: REMOTE_BASE_H,
            originScale: 1,
            baseW: REMOTE_BASE_W,
            baseH: REMOTE_BASE_H,
            dx: 40,
            dy: 40,
            edge: 'nw'
        });
        assert.ok(nw.scale < 1);
        assert.ok(nw.left > 100);
        assert.ok(nw.top > 50);
    });

    it('free corner resize floors at mins', () => {
        const next = freeCornerResize({
            originLeft: 10,
            originTop: 10,
            originW: 400,
            originH: 500,
            dx: -500,
            dy: -500,
            edge: 'se',
            minW: 260,
            minH: 480
        });
        assert.equal(next.width, 260);
        assert.equal(next.height, 480);
    });

    it('browser tiles shrink only below baseline', () => {
        assert.equal(
            browserTileScaleFromGeom({
                width: BROWSER_BASE_W * 2,
                height: BROWSER_BASE_H * 2
            }),
            1
        );
        assert.equal(
            browserTileScaleFromGeom({
                width: BROWSER_BASE_W * 0.5,
                height: BROWSER_BASE_H * 0.5
            }),
            0.5
        );
        assert.ok(
            browserTileScaleFromGeom({
                width: BROWSER_BASE_W * 0.75,
                height: BROWSER_BASE_H
            }) < 1
        );
    });
});
