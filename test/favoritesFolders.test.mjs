import test from 'node:test';
import assert from 'node:assert';
import { FavoritesFolders } from '../js/ui/favoritesFolders.js';
import { TvPlayer } from '../js/tvPlayer.js';

const store = new Map();

test('FavoritesFolders wireFolderTiles and open/close folder functionality', () => {
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
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

    if (prevWindow) globalThis.window = prevWindow;
    else delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.document;
    store.clear();
});




