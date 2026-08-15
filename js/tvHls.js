let hlsPromise = null;

export function loadHlsLibrary() {
    if (typeof window !== 'undefined' && window.Hls) {
        return Promise.resolve(window.Hls);
    }
    if (hlsPromise) return hlsPromise;

    hlsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js';
        script.async = true;
        script.onload = () => {
            if (window.Hls) resolve(window.Hls);
            else reject(new Error('hls.js failed to load'));
        };
        script.onerror = () => reject(new Error('hls.js failed to load'));
        document.head.appendChild(script);
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
