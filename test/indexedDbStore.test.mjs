/** Unit tests for the per-record batch primitives in js/storage/indexedDbStore.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDBStore } from '../js/storage/indexedDbStore.js';

const STORE = 'cache_store';

/**
 * Minimal IndexedDB stand-in with one keyPath store. Writes are buffered per
 * transaction and only applied on commit, so an aborted transaction really
 * leaves the data untouched — that is what the atomicity test relies on.
 */
function installFakeIndexedDb() {
    /** @type {Map<string, any>} */
    const data = new Map();
    const control = { mode: 'ok', transactions: 0 };

    const db = {
        objectStoreNames: { contains: (name) => name === STORE },
        createObjectStore: () => null,
        close() {},
        transaction() {
            control.transactions += 1;
            /** @type {Array<() => void>} */
            const ops = [];
            let pending = 0;
            let completed = false;

            function request(result) {
                pending += 1;
                const req = { result, onsuccess: null, onerror: null };
                setTimeout(() => {
                    req.onsuccess?.();
                    pending -= 1;
                    maybeComplete();
                }, 0);
                return req;
            }

            const tx = {
                objectStore: () => store,
                oncomplete: null,
                onerror: null,
                onabort: null
            };

            // Real IndexedDB fires every request success before the transaction
            // completes, so commit only once the request queue is drained.
            function maybeComplete() {
                if (completed || pending > 0) return;
                completed = true;
                if (control.mode === 'abort') {
                    tx.onabort?.();
                    return;
                }
                for (const op of ops) op();
                tx.oncomplete?.();
            }

            const store = {
                put: (record) => ops.push(() => data.set(record.key, record.value)),
                delete: (key) => ops.push(() => data.delete(key)),
                clear: () => ops.push(() => data.clear()),
                get: (key) =>
                    request(data.has(key) ? { key, value: data.get(key) } : undefined),
                getAll: () => request(Array.from(data, ([key, value]) => ({ key, value }))),
                getAllKeys: () => request(Array.from(data.keys()))
            };

            setTimeout(maybeComplete, 0);
            return tx;
        }
    };

    globalThis.indexedDB = {
        open() {
            const req = {
                result: db,
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
                onblocked: null
            };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
        }
    };

    return { data, control };
}

const fake = installFakeIndexedDb();

test('setMany/getMany round-trip every record through one transaction', async () => {
    const before = fake.control.transactions;
    const pairs = [
        ['magictv_frame_v3:a', { cachedAt: 1, dataUrl: 'data:,a' }],
        ['magictv_frame_v3:b', { cachedAt: 2, dataUrl: 'data:,b' }]
    ];
    assert.equal(await IndexedDBStore.setMany(pairs), true);

    const records = await IndexedDBStore.getMany([
        'magictv_frame_v3:a',
        'magictv_frame_v3:b',
        'magictv_frame_v3:missing'
    ]);
    assert.equal(records.size, 2, 'misses are omitted from the result');
    assert.equal(records.get('magictv_frame_v3:b').dataUrl, 'data:,b');
    assert.ok(fake.control.transactions > before, 'the batch used a transaction');
    assert.equal(fake.data.get('magictv_frame_v3:a').cachedAt, 1);
});

test('setMany with no pairs is a no-op success', async () => {
    assert.equal(await IndexedDBStore.setMany([]), true);
    assert.equal((await IndexedDBStore.getMany([])).size, 0);
});

test('getAllKeys lists stored keys without reading values', async () => {
    const keys = await IndexedDBStore.getAllKeys();
    assert.ok(keys.includes('magictv_frame_v3:a'));
    assert.ok(keys.every((key) => typeof key === 'string'));
});

test('removeMany deletes only the requested keys', async () => {
    await IndexedDBStore.setMany([
        ['magictv_poster_v2:a', { dataUrl: 'data:,pa' }],
        ['magictv_poster_v2:b', { dataUrl: 'data:,pb' }],
        ['magictv_poster_v2:c', { dataUrl: 'data:,pc' }]
    ]);

    await IndexedDBStore.removeMany(['magictv_poster_v2:a', 'magictv_poster_v2:b', '']);
    const keys = await IndexedDBStore.getAllKeys();
    assert.equal(keys.includes('magictv_poster_v2:a'), false);
    assert.equal(keys.includes('magictv_poster_v2:b'), false);
    assert.equal(keys.includes('magictv_poster_v2:c'), true);
});

// An aborted transaction leaves IndexedDBStore on its memory fallback, which is
// permanent for the process — keep this test last in the file.
test('setMany resolves false and stays readable when the transaction aborts', async () => {
    const before = fake.data.size;
    fake.control.mode = 'abort';
    const ok = await IndexedDBStore.setMany([
        ['magictv_frame_v3:aborted', { dataUrl: 'data:,x' }]
    ]);
    assert.equal(ok, false, 'caller is told the write is not durable');
    assert.equal(fake.data.has('magictv_frame_v3:aborted'), false, 'nothing was committed');
    assert.equal(fake.data.size, before, 'store is unchanged');

    // The value still serves this session from the memory fallback.
    const records = await IndexedDBStore.getMany(['magictv_frame_v3:aborted']);
    assert.equal(records.get('magictv_frame_v3:aborted')?.dataUrl, 'data:,x');
});
