/**
 * Lazy singleton loader for the YouTube IFrame Player API.
 *
 * The API is only pulled in when a tile actually enters YouTube mode, so the
 * normal TV boot stays free of third-party scripts. Any pre-existing
 * `onYouTubeIframeAPIReady` handler is chained rather than clobbered.
 */

export const YOUTUBE_IFRAME_SCRIPT_ID = 'magictv-youtube-iframe-api';
export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/** Mirrors YT.PlayerState for adapters/tests that must not depend on the global. */
export const YT_PLAYER_STATE = Object.freeze({
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
});

let apiPromise = null;

/** @returns {any|null} */
export function getYouTubeApi() {
    const win = typeof window !== 'undefined' ? window : null;
    const api = win?.YT || (typeof globalThis !== 'undefined' ? globalThis.YT : null);
    return api?.Player ? api : null;
}

export function isYouTubeApiReady() {
    return Boolean(getYouTubeApi());
}

/**
 * Resolve once `window.YT.Player` exists (loads the script on first call).
 * Rejects on timeout / missing DOM. Safe to call repeatedly.
 * @param {{ timeoutMs?: number, doc?: Document }} [opts]
 * @returns {Promise<any>}
 */
export function loadYouTubeIframeApi({ timeoutMs = 15000, doc } = {}) {
    const ready = getYouTubeApi();
    if (ready) return Promise.resolve(ready);
    if (apiPromise) return apiPromise;

    const documentRef = doc || (typeof document !== 'undefined' ? document : null);
    if (!documentRef || typeof documentRef.createElement !== 'function') {
        return Promise.reject(new Error('YouTube API needs a browser document'));
    }

    apiPromise = new Promise((resolve, reject) => {
        const win = typeof window !== 'undefined' ? window : globalThis;
        const previousHandler = win.onYouTubeIframeAPIReady;
        let settled = false;

        const finish = (api) => {
            if (settled) return;
            const resolved = api || getYouTubeApi();
            if (!resolved) return;
            settled = true;
            clearTimeout(timer);
            resolve(resolved);
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            apiPromise = null;
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const timer = setTimeout(() => {
            fail(new Error('YouTube player API timed out'));
        }, Math.max(1000, Number(timeoutMs) || 15000));
        if (typeof timer?.unref === 'function') timer.unref();

        win.onYouTubeIframeAPIReady = function onReady(...args) {
            try {
                previousHandler?.apply(this, args);
            } catch { /* keep the API promise alive */ }
            finish(getYouTubeApi());
        };

        // A previous loader may have injected the script without the callback
        // landing on this window (hot reload) — poll briefly before injecting.
        const existing = documentRef.getElementById?.(YOUTUBE_IFRAME_SCRIPT_ID);
        if (existing) {
            const poll = setInterval(() => {
                if (settled) {
                    clearInterval(poll);
                    return;
                }
                const api = getYouTubeApi();
                if (api) {
                    clearInterval(poll);
                    finish(api);
                }
            }, 100);
            if (typeof poll?.unref === 'function') poll.unref();
            return;
        }

        const script = documentRef.createElement('script');
        script.id = YOUTUBE_IFRAME_SCRIPT_ID;
        script.src = YOUTUBE_IFRAME_API_SRC;
        script.async = true;
        script.onerror = () => fail(new Error('YouTube player API failed to load'));
        (documentRef.head || documentRef.body || documentRef.documentElement)?.appendChild(script);
    });

    return apiPromise;
}

/** Test seam — forget the cached loader promise. */
export function resetYouTubeApiLoader() {
    apiPromise = null;
}
