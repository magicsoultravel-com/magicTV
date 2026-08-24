/**
 * Unit tests for per-channel watch-time stats.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

before(() => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
});

beforeEach(() => {
    store.clear();
    if (WatchStats) WatchStats.clearWatchStats();
});

let WatchStats;
let normalizeWatchStatsMeta;

before(async () => {
    ({ normalizeWatchStatsMeta } = await import('../js/storage/playerState.js'));
    WatchStats = await import('../js/storage/watchStats.js');
});

const CHANNEL = {
    name: 'CNN',
    logo: 'https://example.com/cnn.png',
    countrycode: 'US'
};

test('addWatchSeconds accumulates per channel key', () => {
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 30, CHANNEL);
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 15, CHANNEL);
    const top = WatchStats.getTopWatched(5);
    assert.equal(top.length, 1);
    assert.equal(top[0].key, 'iptv-org:CNN.us');
    assert.equal(top[0].seconds, 45);
    assert.equal(top[0].name, 'CNN');
});

test('getTopWatched returns channels sorted by seconds desc', () => {
    WatchStats.addWatchSeconds('iptv-org:A.us', 10, { name: 'A' });
    WatchStats.addWatchSeconds('iptv-org:B.us', 50, { name: 'B' });
    WatchStats.addWatchSeconds('iptv-org:C.us', 25, { name: 'C' });
    const top = WatchStats.getTopWatched(3);
    assert.deepEqual(top.map((e) => e.key), ['iptv-org:B.us', 'iptv-org:C.us', 'iptv-org:A.us']);
});

test('clearWatchStats removes all entries', () => {
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 60, CHANNEL);
    WatchStats.clearWatchStats();
    assert.deepEqual(WatchStats.getTopWatched(), []);
    const raw = JSON.parse(store.get('matrix_tv_state') || '{}');
    assert.deepEqual(raw.watchStatsMeta, []);
});

test('watch stats persist under matrix_tv_state', () => {
    WatchStats.scheduleWatchStatsPersist(true);
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 90, CHANNEL);
    WatchStats.scheduleWatchStatsPersist(true);
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.ok(Array.isArray(raw.watchStatsMeta));
    assert.equal(raw.watchStatsMeta[0].key, 'iptv-org:CNN.us');
    assert.equal(raw.watchStatsMeta[0].seconds, 90);
});

test('normalizeWatchStatsMeta migrates keys and drops invalid rows', () => {
    const out = normalizeWatchStatsMeta([
        { key: 'CNN.us', name: 'CNN', seconds: 12 },
        { key: '', seconds: 5 },
        { key: 'iptv-org:B.us', seconds: -1 }
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'iptv-org:CNN.us');
    assert.equal(out[0].seconds, 12);
});

test('formatWatchDuration renders compact labels', () => {
    assert.equal(WatchStats.formatWatchDuration(0.4), '0.4s');
    assert.equal(WatchStats.formatWatchDuration(5.5), '5.5s');
    assert.equal(WatchStats.formatWatchDuration(45), '45s');
    assert.equal(WatchStats.formatWatchDuration(125), '2m');
    assert.equal(WatchStats.formatWatchDuration(3725), '1h 2m');
});

test('savePlayerState without watchStatsMeta patch preserves persisted watch stats', async () => {
    const { savePlayerState } = await import('../js/storage/playerState.js');
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 120, CHANNEL);
    WatchStats.scheduleWatchStatsPersist(true);
    savePlayerState({ volume: 0.5 });
    const raw = JSON.parse(store.get('matrix_tv_state'));
    assert.equal(raw.watchStatsMeta.length, 1);
    assert.equal(raw.watchStatsMeta[0].seconds, 120);
});

test('prunes to WATCH_STATS_CAP keeping highest totals', () => {
    for (let i = 0; i < WatchStats.WATCH_STATS_CAP + 5; i += 1) {
        WatchStats.addWatchSeconds(`iptv-org:Ch${i}.us`, i + 1, { name: `Ch${i}` });
    }
    WatchStats.scheduleWatchStatsPersist(true);
    const top = WatchStats.getTopWatched(WatchStats.WATCH_STATS_CAP + 10);
    assert.equal(top.length, WatchStats.WATCH_STATS_CAP);
    assert.equal(top[0].key, `iptv-org:Ch${WatchStats.WATCH_STATS_CAP + 4}.us`);
});

test('clearWatchStats aborts open accrual windows without crediting', () => {
    let aborted = false;
    const aborter = () => { aborted = true; };
    WatchStats.registerWatchAccrualAborter(aborter);
    WatchStats.addWatchSeconds('iptv-org:CNN.us', 40, CHANNEL);
    WatchStats.clearWatchStats();
    assert.equal(aborted, true);
    assert.deepEqual(WatchStats.getTopWatched(), []);
    WatchStats.unregisterWatchAccrualAborter(aborter);
});
