/** Unit tests for epg.pw JSON day mapping logic */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('epg.pw JSON list maps to programmes with inferred stop times', () => {
    const list = [
        { title: 'Show A', start_date: '2026-08-22T12:00:00+00:00', desc: 'a' },
        { title: 'Show B', start_date: '2026-08-22T13:00:00+00:00', desc: 'b' }
    ];
    const programmes = list.map((item, i) => {
        const start = new Date(item.start_date).getTime();
        const next = list[i + 1];
        const stop = next ? new Date(next.start_date).getTime() : start + 3600000;
        return { title: item.title, start, stop };
    });
    assert.equal(programmes.length, 2);
    assert.equal(programmes[0].stop, programmes[1].start);
    assert.equal(programmes[1].stop, programmes[1].start + 3600000);
});
