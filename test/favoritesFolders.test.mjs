import test from 'node:test';
import assert from 'node:assert';
import { FavoritesFolders } from '../js/ui/favoritesFolders.js';
import { TvPlayer } from '../js/tvPlayer.js';

const store = new Map();

function installStorage() {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
}

function teardownGlobals(prevWindow) {
    if (prevWindow) globalThis.window = prevWindow;
    else delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.document;
    store.clear();
}

test('FavoritesFolders wireFolderTiles and open/close folder functionality', () => {
    installStorage();
    globalThis.document = {
        getElementById: () => null
    };
    const prevWindow = globalThis.window;
    globalThis.window = { prompt: () => 'Test' };

    const appState = {
        activeTab: 'favorites',
        favoritesFolderId: null
    };

    let changedCount = 0;
    FavoritesFolders.init({
        getAppState: () => appState,
        onChanged: () => { changedCount += 1; }
    });

    const folder = TvPlayer.createFavoriteFolder('My Folder');
    assert.ok(folder.id);

    const listeners = {};
    const container = {
        dataset: {},
        contains: () => true,
        querySelectorAll: () => [],
        addEventListener(event, handler) {
            listeners[event] = handler;
        }
    };

    FavoritesFolders.wireFolderTiles(container);
    assert.equal(container.dataset.folderWired, '1');
    assert.ok(listeners['click']);
    assert.ok(listeners['pointerup']);

    const tile = { dataset: { folderId: folder.id } };

    // Simulate clicking on tile
    const fakeEvent = {
        target: {
            closest: (sel) => (sel === '.favorite-folder-tile' ? tile : null)
        },
        preventDefault: () => {},
        stopPropagation: () => {}
    };

    listeners['pointerup'](fakeEvent);
    assert.equal(appState.favoritesFolderId, folder.id);
    assert.equal(changedCount, 1);

    // Test closing folder
    FavoritesFolders.closeFavoriteFolder();
    assert.equal(appState.favoritesFolderId, null);
    assert.equal(changedCount, 2);

    teardownGlobals(prevWindow);
});

test('FavoritesFolders edit button stays wired after re-render (delegated)', () => {
    installStorage();
    const fakeEl = () => {
        const classSet = new Set();
        const kids = [];
        return {
            id: '',
            className: '',
            style: {},
            textContent: '',
            childElementCount: 0,
            classList: {
                add(...n) { for (const x of n) classSet.add(x); },
                remove(...n) { for (const x of n) classSet.delete(x); },
                contains(n) { return classSet.has(n); }
            },
            setAttribute() {},
            appendChild(node) {
                kids.push(node);
                this.childElementCount = kids.length;
            },
            remove() {},
            removeChild() {}
        };
    };
    const body = fakeEl();
    globalThis.document = {
        getElementById: () => null,
        createElement: () => fakeEl(),
        body
    };
    const prevWindow = globalThis.window;
    let promptCalls = 0;
    globalThis.window = {
        prompt: (title, def) => {
            promptCalls += 1;
            return `${def || 'Folder'} Renamed`;
        },
        setTimeout: (fn) => { fn(); return 0; },
        requestAnimationFrame: (fn) => { fn(); return 0; }
    };
    globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;

    const appState = {
        activeTab: 'favorites',
        favoritesFolderId: null
    };
    let changedCount = 0;
    FavoritesFolders.init({
        getAppState: () => appState,
        onChanged: () => { changedCount += 1; }
    });

    const folder = TvPlayer.createFavoriteFolder('Alpha');
    const originalName = folder.name;

    const listeners = {};
    const container = {
        dataset: {},
        contains: () => true,
        querySelectorAll: () => [],
        addEventListener(event, handler) {
            listeners[event] = handler;
        }
    };

    FavoritesFolders.wireFolderTiles(container);
    // Second call must not re-bind (delegated once); simulate a re-render
    // that replaces folder tile DOM — listeners stay on the container.
    FavoritesFolders.wireFolderTiles(container);

    const editBtn = { className: 'favorite-folder-tile__edit-btn' };
    const tile = {
        dataset: { folderId: folder.id },
        closest(sel) {
            return sel === '.favorite-folder-tile' ? tile : null;
        }
    };
    editBtn.closest = (sel) => {
        if (sel === '.favorite-folder-tile__edit-btn') return editBtn;
        if (sel === '.favorite-folder-tile') return tile;
        return null;
    };

    const clickEvent = {
        type: 'click',
        target: {
            closest: (sel) => editBtn.closest(sel)
        },
        preventDefault: () => {},
        stopPropagation: () => {}
    };

    listeners.click(clickEvent);
    assert.equal(promptCalls, 1);
    const updated = TvPlayer.getFavoriteFolder(folder.id);
    assert.ok(updated);
    assert.notEqual(updated.name, originalName);
    assert.ok(updated.name.includes('Renamed'));
    assert.ok(changedCount >= 1);

    teardownGlobals(prevWindow);
});
