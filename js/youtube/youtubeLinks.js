/**
 * YouTube id / URL helpers — pure, DOM-free, shared by the mosaic adapter,
 * the clip library and the picker overlay.
 */

/** Canonical YouTube video id shape (11 URL-safe chars). */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Provider id used in mosaic channel keys for YouTube tiles. */
export const YOUTUBE_PROVIDER_ID = 'youtube';

const YOUTUBE_HOSTS = new Set([
    'youtu.be',
    'youtube.com',
    'youtube-nocookie.com'
]);

function isYouTubeHost(host) {
    if (!host) return false;
    if (YOUTUBE_HOSTS.has(host)) return true;
    return host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com');
}

/**
 * Extract an 11-char video id from a URL, share link, embed URL or bare id.
 * @param {string} input
 * @returns {string} video id or '' when the input is not a YouTube reference
 */
export function parseYouTubeId(input) {
    if (typeof input !== 'string') return '';
    const raw = input.trim();
    if (!raw) return '';
    if (YOUTUBE_ID_RE.test(raw)) return raw;

    let url;
    try {
        url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    } catch {
        return '';
    }

    const host = String(url.hostname || '').toLowerCase()
        .replace(/^www\./, '')
        .replace(/^m\./, '')
        .replace(/^music\./, '');
    if (!isYouTubeHost(host)) return '';

    const v = url.searchParams.get('v');
    if (v && YOUTUBE_ID_RE.test(v)) return v;

    const segments = url.pathname.split('/').filter(Boolean);
    const kindIndex = segments.findIndex((part) => (
        part === 'embed' || part === 'shorts' || part === 'live' || part === 'v' || part === 'e'
    ));
    if (kindIndex >= 0) {
        const candidate = segments[kindIndex + 1];
        if (candidate && YOUTUBE_ID_RE.test(candidate)) return candidate;
    }
    if (host === 'youtu.be' && segments[0] && YOUTUBE_ID_RE.test(segments[0])) {
        return segments[0];
    }
    return '';
}

/**
 * Lenient normalize: returns the id or '' (never throws).
 * @param {string} input
 * @returns {string}
 */
export function normalizeYouTubeId(input) {
    return parseYouTubeId(input);
}

/**
 * Mosaic channel key for a YouTube tile (`youtube:<videoId>`).
 * @param {string} videoId
 * @returns {string}
 */
export function youtubeKey(videoId) {
    const id = normalizeYouTubeId(videoId);
    return id ? `${YOUTUBE_PROVIDER_ID}:${id}` : '';
}

/**
 * Inverse of youtubeKey — '' for non-YouTube keys.
 * @param {string} key
 * @returns {string}
 */
export function youtubeIdFromKey(key) {
    if (typeof key !== 'string') return '';
    if (!key.startsWith(`${YOUTUBE_PROVIDER_ID}:`)) return '';
    const id = key.slice(YOUTUBE_PROVIDER_ID.length + 1);
    return YOUTUBE_ID_RE.test(id) ? id : '';
}

/** True for a mosaic slot entry / channel key that belongs to YouTube mode. */
export function isYouTubeRef(ref) {
    if (!ref) return false;
    if (typeof ref === 'object') {
        if (ref.kind === 'youtube') return true;
        if (ref.providerId === YOUTUBE_PROVIDER_ID) return true;
        return isYouTubeRef(ref.key);
    }
    return Boolean(youtubeIdFromKey(ref));
}

/** True for a mosaic slot entry that carries YouTube mode. */
export function isYouTubeEntry(entry) {
    if (!entry) return false;
    if (typeof entry === 'string') return Boolean(youtubeIdFromKey(entry));
    if (typeof entry !== 'object') return false;
    if (entry.kind === 'youtube') return true;
    return Boolean(youtubeIdFromKey(entry.key));
}

/**
 * Normalize a persisted mosaic slot entry into YouTube play config.
 * @param {any} entry
 * @returns {{ videoId: string, title: string, startAt: number } | null}
 */
export function youtubeEntryConfig(entry) {
    if (!isYouTubeEntry(entry)) return null;
    const source = typeof entry === 'object' ? entry : {};
    const videoId = normalizeYouTubeId(
        source.videoId || youtubeIdFromKey(source.key) || (typeof entry === 'string' ? entry : '')
    );
    if (!videoId) return null;
    return {
        videoId,
        title: typeof source.name === 'string' ? source.name : '',
        startAt: Math.max(0, Math.round(Number(source.startAt) || 0))
    };
}

/** Public watch URL (opens the real site). */
export function youtubeWatchUrl(videoId) {
    const id = normalizeYouTubeId(videoId);
    return id ? `https://www.youtube.com/watch?v=${id}` : '';
}

/**
 * Embed URL for the IFrame API.
 * @param {string} videoId
 * @param {{ autoplay?: boolean, start?: number, controls?: boolean, loop?: boolean, origin?: string }} [opts]
 * @returns {string}
 */
export function youtubeEmbedUrl(videoId, {
    autoplay = false,
    start = 0,
    controls = true,
    loop = false,
    origin = ''
} = {}) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return '';
    const params = new URLSearchParams({
        enablejsapi: '1',
        playsinline: '1',
        rel: '0',
        modestbranding: '1',
        controls: controls ? '1' : '0',
        autoplay: autoplay ? '1' : '0',
        loop: loop ? '1' : '0'
    });
    if (loop) params.set('playlist', id);
    const startSec = Math.max(0, Math.round(Number(start) || 0));
    if (startSec > 0) params.set('start', String(startSec));
    if (origin) params.set('origin', origin);
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

/**
 * Poster / tile thumbnail.
 * @param {string} videoId
 * @param {'default' | 'mqdefault' | 'hqdefault' | 'sddefault' | 'maxresdefault'} [quality]
 * @returns {string}
 */
export function youtubeThumbUrl(videoId, quality = 'hqdefault') {
    const id = normalizeYouTubeId(videoId);
    if (!id) return '';
    return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
}

/**
 * Thumbnail fallbacks, best first (maxres is missing for older uploads).
 * @param {string} videoId
 * @returns {string[]}
 */
export function youtubeThumbCandidates(videoId) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return [];
    return [
        youtubeThumbUrl(id, 'maxresdefault'),
        youtubeThumbUrl(id, 'hqdefault'),
        `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
    ];
}

/**
 * oEmbed endpoint used to resolve a title without an API key.
 * @param {string} videoId
 * @returns {string}
 */
export function youtubeOEmbedUrl(videoId) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return '';
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(id))}&format=json`;
}

/**
 * `m:ss` / `h:mm:ss` clock for clip durations and seek echo.
 * @param {number} seconds
 * @returns {string}
 */
export function formatYouTubeClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
