/**
 * Bulk station UUID resolve: IDB hits + one POST for misses; partial API responses.
 */
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
    const m = new Map();
    return {
        getItem(k) { return m.has(k) ? m.get(k) : null; },
        setItem(k, v) { m.set(k, String(v)); },
        removeItem(k) { m.delete(k); },
        clear() { m.clear(); }
    };
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.indexedDB = undefined;

const { RadioBrowserApi } = await import('../js/radio/radioBrowserApi.js');
const { RadioBrowserProvider } = await import('../js/radio/radioProviders/radioBrowser.js');

const MIRROR = 'https://de1.api.radio-browser.info/json';

before(() => {
    sessionStorage.setItem('magictv_radio_api_base', MIRROR);
});

afterEach(async () => {
    await RadioBrowserApi.clearCache();
    sessionStorage.setItem('magictv_radio_api_base', MIRROR);
    globalThis.fetch = undefined;
});

function station(uuid, name) {
    return {
        stationuuid: uuid,
        name,
        url_resolved: `https://stream.example/${uuid}.mp3`,
        favicon: '',
        countrycode: 'US',
        lastcheckok: 1
    };
}

test('bulk resolve: IDB hit + one POST for misses; partial response omits missing UUID', async () => {
    const cached = station('aaa-111', 'Cached');
    // Seed IDB via a prior write through the API helper path.
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/stations/byuuid/aaa-111') && (!init?.method || init.method === 'GET')) {
            return { ok: true, json: async () => [cached] };
        }
        throw new Error(`unexpected seed fetch: ${u}`);
    };
    await RadioBrowserApi.getStationByUuid('aaa-111');

    let postCount = 0;
    let postBody = '';
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        assert.equal(init?.method, 'POST', 'misses use POST bulk');
        assert.match(u, /\/stations\/byuuid$/);
        postCount += 1;
        postBody = String(init.body || '');
        // Server only knows bbb — ccc is missing from the response.
        return {
            ok: true,
            json: async () => [station('bbb-222', 'From Network')]
        };
    };

    const raw = await RadioBrowserApi.getStationsByUuidsBulk([
        'aaa-111',
        'bbb-222',
        'ccc-333'
    ]);

    assert.equal(postCount, 1, 'exactly one bulk network call');
    assert.match(postBody, /uuids=/);
    assert.match(postBody, /bbb-222/);
    assert.match(postBody, /ccc-333/);
    assert.ok(!postBody.includes('aaa-111'), 'fresh IDB hit not re-fetched');

    const ids = raw.map((s) => s.stationuuid).sort();
    assert.deepEqual(ids, ['aaa-111', 'bbb-222'], 'partial API: missing UUID not in result');
    assert.ok(!raw.some((s) => s.stationuuid === 'ccc-333'));
});

test('provider getStationsByIds normalizes bulk hits; favorites can placeholder missing', async () => {
    globalThis.fetch = async (url, init) => {
        assert.equal(init?.method, 'POST');
        return {
            ok: true,
            json: async () => [
                station('hit-1', 'One'),
                station('hit-2', 'Two')
            ]
        };
    };

    const keys = ['radio-browser:hit-1', 'radio-browser:missing', 'radio-browser:hit-2'];
    const ids = keys.map((k) => k.slice('radio-browser:'.length));
    const stations = await RadioBrowserProvider.getStationsByIds(ids);
    const byKey = new Map(stations.map((s) => [`radio-browser:${s.stationId}`, s]));
    const rows = keys.map((k) => byKey.get(k) || { stationuuid: k, name: k, favicon: '', countrycode: '' });

    assert.equal(rows.length, 3, 'tile count matches favorite keys');
    assert.equal(rows[0].name, 'One');
    assert.equal(rows[1].name, 'radio-browser:missing', 'placeholder for unresolved');
    assert.equal(rows[2].name, 'Two');
});
