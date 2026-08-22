import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('moduleActions separation flags', () => {
    beforeEach(() => {
        globalThis.document = {
            body: {
                classList: {
                    _set: new Set(),
                    add(...cls) { cls.forEach((c) => this._set.add(c)); },
                    remove(...cls) { cls.forEach((c) => this._set.delete(c)); },
                    contains(c) { return this._set.has(c); }
                }
            },
            querySelector: () => null,
            querySelectorAll: () => []
        };
    });

    afterEach(() => {
        delete globalThis.document;
    });

    it('isRemoteSeparated reflects remote external popout body class', async () => {
        const { isRemoteSeparated } = await import('../js/ui/moduleActions.js?sep=1');
        assert.equal(isRemoteSeparated(), false);
        document.body.classList.add('remote-external-popout-active');
        assert.equal(isRemoteSeparated(), true);
    });
});
