/** Unit tests for js/epg/nameMatch.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, scoreNameMatch, matchChannelByName } from '../js/epg/nameMatch.js';

test('normalizeName strips HD suffix and lowercases', () => {
    assert.equal(normalizeName('CNN HD'), 'cnn');
    assert.equal(normalizeName('BBC One'), 'bbc one');
});

test('scoreNameMatch prefers exact matches', () => {
    assert.ok(scoreNameMatch('CNN', 'CNN HD') >= 60);
    assert.equal(scoreNameMatch('CNN', 'Fox News'), 0);
});

test('matchChannelByName finds best index entry', () => {
    const index = [
        { id: '1', names: ['CNN HD'] },
        { id: '2', names: ['Fox News'] }
    ];
    const hit = matchChannelByName('CNN', index);
    assert.equal(hit?.id, '1');
    assert.equal(hit?.matchedName, 'CNN HD');
});

test('matchChannelByName returns null below threshold', () => {
    const index = [{ id: '1', names: ['Totally Different Channel'] }];
    assert.equal(matchChannelByName('CNN', index), null);
});
