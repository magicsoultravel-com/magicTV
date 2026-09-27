import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveCastPlaying,
    sniffCastContentType,
    buildCastLoadAttempts,
    buildMediaInfoOptions,
    formatCastError
} from '../js/cast/chromecastManager.js';
import {
    buildTileHoverHtml,
    buildTileVolRockerHtml,
    buildTileCastVolRockerHtml,
    hydrateTileHoverControls
} from '../js/ui/tileHoverControls.js';

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
    assert.doesNotMatch(castRow, /data-tile-action="cast-vol-down"/);
    assert.doesNotMatch(castRow, /data-tile-action="cast-vol-up"/);
    assert.doesNotMatch(castRow, /data-tile-action="vol-up"/);
    assert.doesNotMatch(castRow, /data-tile-action="vol-down"/);

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

test('buildTileCastVolRockerHtml has cast icon and cast target volume controls', () => {
    const html = buildTileCastVolRockerHtml();
    assert.match(html, /tv-player-tile__vol-rocker--cast/);
    assert.match(html, /data-tile-cast-vol-rocker/);
    assert.match(html, /data-tile-cast-vol-pct/);
    assert.match(html, /tv-player-tile__rocker-cast-icon/);
    assert.match(html, /data-controls-target="cast"/);
    assert.match(html, /data-tile-action="vol-up"/);
    assert.match(html, /data-tile-action="vol-down"/);
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

test('deriveCastPlaying is true for PLAYING, BUFFERING, and LOADING', () => {
    assert.equal(deriveCastPlaying({ playerState: 'PLAYING' }, null), true);
    assert.equal(deriveCastPlaying({ playerState: 'BUFFERING' }, { playerState: 'BUFFERING' }), true);
    assert.equal(deriveCastPlaying({ playerState: 'LOADING' }, null), true);
    assert.equal(deriveCastPlaying(null, { playerState: 'playing' }), true);
});

test('sniffCastContentType prefers apple MPEG-URL for m3u8', () => {
    assert.equal(
        sniffCastContentType('https://example.com/live.m3u8'),
        'application/vnd.apple.mpegurl'
    );
    assert.equal(
        sniffCastContentType('https://cdn.example/stream?format=m3u8'),
        'application/vnd.apple.mpegurl'
    );
    assert.equal(
        sniffCastContentType('https://example.com/video.mp4'),
        'application/x-mpegURL'
    );
});

test('buildCastLoadAttempts orders TS then FMP4 then no hint', () => {
    const attempts = buildCastLoadAttempts('https://x.test/a.m3u8');
    assert.equal(attempts.length, 4);
    assert.equal(attempts[0].contentType, 'application/vnd.apple.mpegurl');
    assert.equal(attempts[0].segment, 'TS');
    assert.equal(attempts[1].segment, 'FMP4');
    assert.equal(attempts[2].segment, null);
    assert.equal(attempts[3].contentType, 'application/x-mpegURL');
    assert.equal(attempts[3].segment, 'TS');
});

test('buildMediaInfoOptions includes logo when absolute http(s)', () => {
    const withLogo = buildMediaInfoOptions({
        url_resolved: 'https://x.test/a.m3u8',
        name: 'News',
        logo: 'https://cdn.test/logo.png'
    });
    assert.equal(withLogo.title, 'News');
    assert.equal(withLogo.logo, 'https://cdn.test/logo.png');
    assert.equal(withLogo.contentType, 'application/vnd.apple.mpegurl');

    const relative = buildMediaInfoOptions({
        url: 'https://x.test/a.m3u8',
        logo: '/relative.png'
    });
    assert.equal(relative.logo, '');
});

test('formatCastError maps load failures to short toasts', () => {
    assert.equal(formatCastError(null), 'Cast failed');
    assert.equal(
        formatCastError(new Error('Cast load did not start — stream unreachable by Cast device')),
        'Stream unreachable by Cast device'
    );
    assert.equal(
        formatCastError(new Error('Cast load failed — stream may be blocked for Chromecast')),
        'Cast load failed — stream may be blocked for Chromecast'
    );
    assert.match(formatCastError(new Error('cancel')), /cancel/i);
});
