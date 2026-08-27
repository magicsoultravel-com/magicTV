import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCastPlaying } from '../js/cast/chromecastManager.js';
import { buildTileHoverHtml, buildTileVolRockerHtml, hydrateTileHoverControls } from '../js/ui/tileHoverControls.js';

test('buildTileHoverHtml includes cast and dual rows', () => {
    const html = buildTileHoverHtml('corner');
    assert.match(html, /data-controls-row="cast"/);
    assert.match(html, /data-controls-row="local"/);
    assert.match(html, />CAST</);
    assert.match(html, /data-tile-action="cast"/);
    assert.doesNotMatch(html, /data-cast-toggle="host-audio"/);
    assert.match(html, /data-cast-toggle="host-video"/);
    assert.match(html, /data-controls-target="cast"/);
    assert.match(html, /data-controls-target="local"/);
    assert.equal((html.match(/data-tile-action="cast"/g) || []).length, 1);

    const castRow = html.slice(
        html.indexOf('data-controls-row="cast"'),
        html.indexOf('data-controls-row="local"')
    );
    assert.doesNotMatch(castRow, /data-tile-action="browse"/);
    assert.doesNotMatch(castRow, /data-tile-action="pip"/);
    assert.doesNotMatch(castRow, /data-tile-action="fullscreen"/);
    assert.doesNotMatch(castRow, /data-tile-action="fav"/);
    assert.doesNotMatch(castRow, /data-tile-action="cast"/);
    assert.match(castRow, /data-tile-action="play"/);
    assert.match(castRow, /data-tile-action="stop"/);
    assert.match(castRow, /data-tile-action="mute"/);
    assert.match(castRow, /data-tile-action="cast-vol-down"/);
    assert.match(castRow, /data-tile-action="cast-vol-up"/);

    const localRow = html.slice(html.indexOf('data-controls-row="local"'));
    assert.doesNotMatch(localRow, /data-tile-action="cast-vol-down"/);
    assert.doesNotMatch(localRow, /data-tile-action="cast-vol-up"/);
    assert.doesNotMatch(localRow, /data-tile-action="vol-up"/);
    assert.doesNotMatch(localRow, /data-tile-action="vol-down"/);
    assert.doesNotMatch(localRow, /data-tile-vol-pct/);
});

test('buildTileVolRockerHtml is outside the hover strip', () => {
    const html = buildTileVolRockerHtml('local');
    assert.match(html, /tv-player-tile__vol-rocker/);
    assert.match(html, /data-tile-action="vol-up"/);
    assert.match(html, /data-tile-action="vol-down"/);
    assert.match(html, /data-tile-vol-pct/);
    assert.doesNotMatch(html, /data-controls-row/);
});

test('buildTileHoverHtml center variant includes mosaic controls', () => {
    const html = buildTileHoverHtml('center');
    assert.match(html, /data-tile-action="reset"/);
    assert.match(html, /data-tile-action="mute-all"/);
    assert.doesNotMatch(html, /data-tile-action="swap"/);
});

test('hydrateTileHoverControls replaces hover content once', () => {
    const mosaic = { dataset: {}, querySelectorAll: () => [] };
    const origDoc = globalThis.document;
    globalThis.document = {
        getElementById(id) {
            return id === 'player-mosaic' ? mosaic : null;
        }
    };
    try {
        hydrateTileHoverControls();
        assert.equal(mosaic.dataset.hoverHydrated, '1');
    } finally {
        globalThis.document = origDoc;
    }
});

test('deriveCastPlaying is false for idle, missing media, and paused', () => {
    assert.equal(deriveCastPlaying(null, null), false);
    assert.equal(deriveCastPlaying({}, null), false);
    assert.equal(deriveCastPlaying({ playerState: 'IDLE' }, null), false);
    assert.equal(deriveCastPlaying({ isPaused: false, playerState: 'IDLE' }, { playerState: 'IDLE' }), false);
    assert.equal(deriveCastPlaying({ playerState: 'PAUSED' }, { playerState: 'PAUSED' }), false);
    assert.equal(deriveCastPlaying({ playerState: 'STOPPED' }, null), false);
});

test('deriveCastPlaying is true for PLAYING and BUFFERING', () => {
    assert.equal(deriveCastPlaying({ playerState: 'PLAYING' }, null), true);
    assert.equal(deriveCastPlaying({ playerState: 'BUFFERING' }, { playerState: 'BUFFERING' }), true);
    assert.equal(deriveCastPlaying(null, { playerState: 'playing' }), true);
});
