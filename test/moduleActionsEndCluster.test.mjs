import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(tag = 'div', className = '') {
    const node = {
        tagName: tag.toUpperCase(),
        className,
        children: [],
        parentElement: null,
        nextSibling: null,
        appendChild(child) {
            if (child.parentElement) {
                const idx = child.parentElement.children.indexOf(child);
                if (idx >= 0) child.parentElement.children.splice(idx, 1);
            }
            child.parentElement = node;
            child.nextSibling = null;
            if (node.children.length) {
                node.children[node.children.length - 1].nextSibling = child;
            }
            node.children.push(child);
            return child;
        },
        insertBefore(child, ref) {
            if (child.parentElement) {
                const idx = child.parentElement.children.indexOf(child);
                if (idx >= 0) child.parentElement.children.splice(idx, 1);
            }
            child.parentElement = node;
            const at = ref ? node.children.indexOf(ref) : -1;
            if (at >= 0) {
                node.children.splice(at, 0, child);
            } else {
                node.children.push(child);
            }
            for (let i = 0; i < node.children.length; i++) {
                node.children[i].nextSibling = node.children[i + 1] || null;
            }
            return child;
        },
        querySelector(sel) {
            if (sel === ':scope > .tv-module__actions--browser-end'
                || sel === '.tv-module__actions--browser-end') {
                return node.children.find((c) => c.className.includes('browser-end')) || null;
            }
            if (sel === '.tv-module__actions--remote-end') {
                return node.children.find((c) => c.className.includes('remote-end')) || null;
            }
            if (sel === '.tv-module__actions-cluster--end') {
                return node.className.includes('actions-cluster--end') ? node : null;
            }
            for (const child of node.children) {
                const found = child.querySelector?.(sel);
                if (found) return found;
            }
            return null;
        }
    };
    return node;
}

describe('assembleEndCluster', () => {
    let staging;
    let cluster;
    let remoteEnd;
    let browserEnd;

    beforeEach(() => {
        staging = makeEl('div', 'remote-module-staging');
        staging.id = 'remote-module-staging';
        cluster = makeEl('div', 'tv-module__actions-cluster tv-module__actions-cluster--end');
        remoteEnd = makeEl('div', 'tv-module__actions tv-module__actions--remote-end');
        browserEnd = makeEl('div', 'tv-module__actions tv-module__actions--browser-end');
        cluster.appendChild(remoteEnd);
        cluster.appendChild(browserEnd);
        staging.appendChild(cluster);

        const els = new Map([['remote-module-staging', staging]]);
        globalThis.document = {
            querySelector: (sel) => {
                if (sel === '#remote-module-staging') return staging;
                if (sel === '#remote-external-host') return null;
                if (sel === '#browser-module-host') return null;
                if (sel === '#browser-dock-host') return null;
                if (sel === '#remote-module-host') return null;
                if (sel === '#remote-dock-host') return null;
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel.includes('actions-cluster--end')) return [cluster];
                if (sel.includes('actions--remote-end')) return [remoteEnd];
                if (sel.includes('actions--browser-end')) return [browserEnd];
                return [];
            },
            getElementById: (id) => els.get(id) || null
        };
    });

    afterEach(() => {
        delete globalThis.document;
    });

    it('reassembles remote-end then browser-end inside the cluster', async () => {
        const host = makeEl('div', 'remote-module__host');
        host.appendChild(remoteEnd);
        host.appendChild(browserEnd);

        const { assembleEndCluster } = await import(`../js/ui/moduleActions.js?t=${Date.now()}`);
        const assembled = assembleEndCluster();
        assert.equal(assembled, cluster);
        assert.equal(remoteEnd.parentElement, cluster);
        assert.equal(browserEnd.parentElement, cluster);
        assert.deepEqual(cluster.children.map((c) => c.className), [
            remoteEnd.className,
            browserEnd.className
        ]);
    });
});
