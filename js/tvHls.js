let hlsPromise = null;

/** Same-origin vendor copy (adblock-resistant). */
const HLS_LOCAL_SRC = new URL('../vendor/hls.min.js', import.meta.url).href;
/** CDN fallback when local script is missing (dev without vendor file). */
const HLS_CDN_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js';
const HLS_CDN_INTEGRITY = 'sha256-p4s2A9diQoyrou8hZ05NR/vE50likrKPhFunNyhJNgs=';

function loadScript(src, { integrity = null, crossOrigin = null } = {}) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        if (integrity) {
            script.integrity = integrity;
            script.crossOrigin = crossOrigin || 'anonymous';
        } else if (crossOrigin) {
            script.crossOrigin = crossOrigin;
        }
        script.onload = () => {
            if (window.Hls) resolve(window.Hls);
            else reject(new Error('hls.js failed to load'));
        };
        script.onerror = () => reject(new Error('hls.js failed to load'));
        document.head.appendChild(script);
    });
}

/**
 * Load hls.js: prefer same-origin vendor build, then jsDelivr CDN.
 */
export function loadHlsLibrary() {
    if (typeof window !== 'undefined' && window.Hls) {
        return Promise.resolve(window.Hls);
    }
    if (hlsPromise) return hlsPromise;

    hlsPromise = loadScript(HLS_LOCAL_SRC)
        .catch(() => loadScript(HLS_CDN_SRC, {
            integrity: HLS_CDN_INTEGRITY,
            crossOrigin: 'anonymous'
        }))
        .catch((err) => {
            hlsPromise = null;
            throw err;
        });

    return hlsPromise;
}

export function isHlsUrl(url) {
    if (!url) return false;
    const lower = url.split('?')[0].toLowerCase();
    return lower.endsWith('.m3u8') || lower.includes('.m3u8');
}

export function canPlayNativeHls(video) {
    return !!video?.canPlayType('application/vnd.apple.mpegurl')
        || !!video?.canPlayType('application/x-mpegURL');
}
