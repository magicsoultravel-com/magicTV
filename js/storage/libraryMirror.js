/**
 * Redundant localStorage mirror for favorites library fields.
 * Survives main-blob corrupt wipes and accidental favoriteFolders clobbers.
 */
export const LIBRARY_MIRROR_KEY = 'matrix_tv_library_v1';

/**
 * @param {unknown} folders
 * @returns {boolean}
 */
export function hasFavoriteFolders(folders) {
    return Array.isArray(folders) && folders.length > 0;
}

/**
 * @returns {Record<string, any> | null}
 */
export function readLibraryMirror() {
    try {
        const raw = localStorage.getItem(LIBRARY_MIRROR_KEY);
        if (raw == null || raw === '') return null;
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        return value;
    } catch {
        return null;
    }
}

/**
 * Persist library slice. Best-effort — never throws to callers.
 * @param {{
 *   favorites?: string[],
 *   favoritesMeta?: any[],
 *   favoriteFolders?: any[],
 *   favoritesRootOrder?: string[]
 * }} library
 */
export function writeLibraryMirror(library) {
    if (!library || typeof library !== 'object') return;
    try {
        const payload = {
            favorites: Array.isArray(library.favorites) ? library.favorites : [],
            favoritesMeta: Array.isArray(library.favoritesMeta) ? library.favoritesMeta : [],
            favoriteFolders: Array.isArray(library.favoriteFolders) ? library.favoriteFolders : [],
            favoritesRootOrder: Array.isArray(library.favoritesRootOrder)
                ? library.favoritesRootOrder
                : [],
            savedAt: Date.now()
        };
        localStorage.setItem(LIBRARY_MIRROR_KEY, JSON.stringify(payload));
    } catch {
        /* ignore — quota / private mode */
    }
}

/**
 * Pull library fields from mirror into `state` when folders are missing/empty.
 * @param {Record<string, any>} state
 * @returns {{ state: Record<string, any>, restored: boolean }}
 */
export function mergeLibraryMirrorIntoState(state) {
    const next = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
    if (hasFavoriteFolders(next.favoriteFolders)) {
        return { state: next, restored: false };
    }

    const mirror = readLibraryMirror();
    if (!mirror || !hasFavoriteFolders(mirror.favoriteFolders)) {
        return { state: next, restored: false };
    }

    next.favoriteFolders = mirror.favoriteFolders;
    if (!Array.isArray(next.favorites) || next.favorites.length === 0) {
        if (Array.isArray(mirror.favorites)) next.favorites = mirror.favorites;
        if (Array.isArray(mirror.favoritesMeta)) next.favoritesMeta = mirror.favoritesMeta;
    }
    if (!Array.isArray(next.favoritesRootOrder) || next.favoritesRootOrder.length === 0) {
        if (Array.isArray(mirror.favoritesRootOrder)) {
            next.favoritesRootOrder = mirror.favoritesRootOrder;
        }
    }
    return { state: next, restored: true };
}

/**
 * Best-effort parse of corrupt-backup raw string for library fields only.
 * @returns {Record<string, any> | null}
 */
export function tryParseLibraryFromCorruptBackup(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (!hasFavoriteFolders(value.favoriteFolders)) return null;
        return {
            favorites: Array.isArray(value.favorites) ? value.favorites : [],
            favoritesMeta: Array.isArray(value.favoritesMeta) ? value.favoritesMeta : [],
            favoriteFolders: value.favoriteFolders,
            favoritesRootOrder: Array.isArray(value.favoritesRootOrder)
                ? value.favoritesRootOrder
                : []
        };
    } catch {
        return null;
    }
}
