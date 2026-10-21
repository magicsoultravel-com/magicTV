/**
 * YouTube queue chrome contract: hover markup, tray markup, CSS gating, and the
 * settings controls that drive it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildTileHoverHtml,
    buildYouTubeQueueTrayHtml
} from '../js/ui/tileHoverControls.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'M7lc1UVf-VE';

test('both tile variants carry one prev / next / tray group in the local row', () => {
    for (const variant of ['corner', 'center']) {
        const html = buildTileHoverHtml(variant);
        const localRow = html.slice(html.indexOf('data-controls-row="local"'));

        assert.equal((localRow.match(/tv-controls__ytqueue-wrap/g) || []).length, 1,
            `${variant}: exactly one queue group`);
        for (const action of ['yt-prev', 'yt-next', 'yt-queue']) {
            assert.equal((localRow.match(new RegExp(`data-tile-action="${action}"`, 'g')) || []).length, 1,
                `${variant}: one ${action} button`);
            assert.match(localRow,
                new RegExp(`data-tile-action="${action}" data-controls-target="local"`),
                `${variant}: ${action} carries the local target`);
        }

        assert.match(localRow, /data-yt-queue-tray/);
        assert.match(localRow, /data-yt-queue-strip/);
        // The group sits right after the YouTube button (not inside its popout).
        assert.ok(localRow.indexOf('tv-controls__youtube-wrap') < localRow.indexOf('tv-controls__ytqueue-wrap'));
        assert.ok(localRow.indexOf('tv-controls__ytqueue-wrap') < localRow.indexOf('data-tile-action="fav"'));

        // No tray entries in the static markup — they come from the queue sync.
        assert.doesNotMatch(localRow, /data-tile-action="yt-play"/);
    }
});

test('tray markup renders thumbnails from i.ytimg.com and marks the current clip', () => {
    const html = buildYouTubeQueueTrayHtml({
        index: 1,
        items: [
            { videoId: ID_A, title: 'First', source: 'current' },
            { videoId: ID_B, title: 'Second <script>', source: 'related' }
        ]
    });

    assert.equal((html.match(/data-tile-action="yt-play"/g) || []).length, 2);
    assert.match(html, new RegExp(`data-yt-index="0"[^>]*data-yt-source="current"`));
    assert.match(html, new RegExp(`data-yt-index="1"[^>]*data-yt-source="related"`));
    assert.match(html, new RegExp(`src="https://i\\.ytimg\\.com/vi/${ID_A}/mqdefault\\.jpg"`));
    assert.match(html, new RegExp(`src="https://i\\.ytimg\\.com/vi/${ID_B}/mqdefault\\.jpg"`));
    assert.match(html, /aria-current="true"/);
    assert.equal((html.match(/aria-current="true"/g) || []).length, 1, 'only the playing clip is current');
    assert.match(html, /Second &lt;script&gt;/, 'titles are escaped');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /tv-controls__ytqueue-item is-current/);
});

test('tray markup degrades to an empty / loading state with no items', () => {
    assert.match(buildYouTubeQueueTrayHtml({ items: [] }), /Queue is empty/);
    assert.match(buildYouTubeQueueTrayHtml({ items: [], relatedLoading: true }), /Looking for related videos/);
    assert.match(buildYouTubeQueueTrayHtml({ items: [{ videoId: ID_A }], relatedLoading: true }), /ytqueue-more/);
    assert.doesNotMatch(buildYouTubeQueueTrayHtml({ items: [{ videoId: 'bad' }] }), /data-tile-action="yt-play"/);
    assert.match(buildYouTubeQueueTrayHtml({}), /Queue is empty/);
});

test('CSS hides the queue group outside YouTube mode and slides the tray open', () => {
    const css = read('css/components/youtube.css');
    assert.match(css, /\.tv-controls__ytqueue-wrap \{[^}]*display: none;/);
    assert.match(css, /\.tv-player-tile\.is-youtube \.tv-controls__ytqueue-wrap \{[^}]*display: inline-flex;/);
    assert.match(css, /\.tv-controls__ytqueue-wrap\.is-open \.tv-controls__ytqueue-popout/);
    assert.match(css, /\.tv-controls__ytqueue-wrap:hover \.tv-controls__ytqueue-popout/);
    // Edge tiles must never push the tray off-screen.
    assert.match(css, /data-slot="topLeft"[^{]*\.tv-controls__ytqueue-wrap/);
    assert.match(css, /data-slot="topRight"[^{]*\.tv-controls__ytqueue-wrap/);
    assert.match(css, /\.tv-controls__ytqueue-strip \{[^}]*overflow-x: auto;/);
});

test('settings markup + bindings exist for the YouTube section', () => {
    const html = read('index.html');
    for (const id of [
        'youtube-related-enabled',
        'youtube-related-provider-select',
        'youtube-related-instance-input',
        'youtube-queue-auto-advance',
        'clear-youtube-history-btn'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `index.html has #${id}`);
    }

    const appearance = read('js/ui/appearance.js');
    for (const id of [
        'youtube-related-enabled',
        'youtube-related-provider-select',
        'youtube-related-instance-input',
        'youtube-queue-auto-advance',
        'clear-youtube-history-btn'
    ]) {
        assert.match(appearance, new RegExp(`el\\('${id}'\\)`), `appearance.js binds #${id}`);
    }
    assert.match(appearance, /setYouTubeRelatedEnabled/);
    assert.match(appearance, /setYouTubeRelatedProvider/);
    assert.match(appearance, /setYouTubeRelatedInstance/);
    assert.match(appearance, /setYouTubeQueueAutoAdvance/);
    assert.match(appearance, /clearYouTubeHistory/);
});
