/**
 * Per-user YouTube clip library (localStorage) + oEmbed metadata lookup.
 * Library entries are what the mosaic picker offers for one-click YouTube mode.
 */
import {
    normalizeYouTubeId,
    youtubeOEmbedUrl,
    youtubeThumbUrl,
    youtubeWatchUrl
} from './youtubeLinks.js';

export const YOUTUBE_LIBRARY_KEY = 'magictv_youtube_library_v1';
export const YOUTUBE_LIBRARY_LIMIT = 120;

function readRaw() {
    try {
        return localStorage.getItem(YOUTUBE_LIBRARY_KEY);
    } catch {
        return null;
    }
}

function writeRaw(value) {
    try {
        localStorage.setItem(YOUTUBE_LIBRARY_KEY, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {any} raw
 * @returns {{ videoId: string, title: string, thumb: string, addedAt: number, author?: string } | null}
 */
export function normalizeYouTubeClip(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const videoId = normalizeYouTubeId(raw.videoId || raw.id || raw.key || '');
    if (!videoId) return null;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
    const thumb = typeof raw.thumb === 'string' && raw.thumb
        ? raw.thumb
        : youtubeThumbUrl(videoId);
    const addedAt = Number.isFinite(Number(raw.addedAt)) ? Number(raw.addedAt) : 0;
    const author = typeof raw.author === 'string' ? raw.author.trim().slice(0, 120) : '';
    return {
        videoId,
        title: title || `YouTube ${videoId}`,
        thumb,
        addedAt,
        ...(author ? { author } : {})
    };
}

/**
 * @param {any} raw
 * @returns {{ clips: ReturnType<typeof normalizeYouTubeClip>[] }}
 */
export function normalizeYouTubeLibrary(raw) {
    const source = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.clips) ? raw.clips : []);
    const seen = new Set();
    const clips = [];
    for (const entry of source) {
        const clip = normalizeYouTubeClip(entry);
        if (!clip || seen.has(clip.videoId)) continue;
        seen.add(clip.videoId);
        clips.push(clip);
        if (clips.length >= YOUTUBE_LIBRARY_LIMIT) break;
    }
    return { clips };
}

/** @returns {{ clips: ReturnType<typeof normalizeYouTubeClip>[] }} */
export function loadYouTubeLibrary() {
    const raw = readRaw();
    if (!raw) return { clips: [] };
    try {
        return normalizeYouTubeLibrary(JSON.parse(raw));
    } catch {
        return { clips: [] };
    }
}

/** @param {{ clips?: any[] } | any[]} library */
export function saveYouTubeLibrary(library) {
    const normalized = normalizeYouTubeLibrary(library);
    writeRaw(JSON.stringify(normalized));
    return normalized;
}

/** Newest first. */
export function listYouTubeClips() {
    return loadYouTubeLibrary().clips
        .slice()
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

/**
 * Insert / refresh a clip (newest first).
 * @param {{ videoId: string, title?: string, thumb?: string, author?: string }} entry
 */
export function addYouTubeClip(entry) {
    const clip = normalizeYouTubeClip({ ...entry, addedAt: Date.now() });
    if (!clip) return null;
    const { clips } = loadYouTubeLibrary();
    const next = [clip, ...clips.filter((existing) => existing.videoId !== clip.videoId)];
    saveYouTubeLibrary({ clips: next });
    return clip;
}

/**
 * @param {string} videoId
 * @returns {boolean} true when a clip was removed
 */
export function removeYouTubeClip(videoId) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return false;
    const { clips } = loadYouTubeLibrary();
    const next = clips.filter((clip) => clip.videoId !== id);
    if (next.length === clips.length) return false;
    saveYouTubeLibrary({ clips: next });
    return true;
}

/**
 * @param {{ videoId: string, title?: string, thumb?: string }} entry
 * @returns {boolean} true when added, false when removed
 */
export function toggleYouTubeClip(entry) {
    const id = normalizeYouTubeId(entry?.videoId || '');
    if (!id) return false;
    if (hasYouTubeClip(id)) {
        removeYouTubeClip(id);
        return false;
    }
    addYouTubeClip(entry);
    return true;
}

/**
 * Resolve title/author/thumb via the public oEmbed endpoint (no API key).
 * Never throws; resolves null on timeout / network / private video.
 * @param {string} videoId
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ videoId: string, title: string, author: string, thumb: string } | null>}
 */
export async function fetchYouTubeMeta(videoId, { timeoutMs = 6000, fetchImpl } = {}) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return null;
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return null;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = 0;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            try { controller?.abort(); } catch { /* ignore */ }
            resolve(null);
        }, Math.max(500, Number(timeoutMs) || 6000));
    });

    const request = (async () => {
        try {
            const response = await doFetch(youtubeOEmbedUrl(id), {
                signal: controller?.signal,
                credentials: 'omit'
            });
            if (!response?.ok) return null;
            const data = await response.json();
            const title = typeof data?.title === 'string' ? data.title.trim() : '';
            if (!title) return null;
            return {
                videoId: id,
                title,
                author: typeof data?.author_name === 'string' ? data.author_name.trim() : '',
                thumb: typeof data?.thumbnail_url === 'string' && data.thumbnail_url
                    ? data.thumbnail_url
                    : youtubeThumbUrl(id)
            };
        } catch {
            return null;
        }
    })();

    try {
        const meta = await Promise.race([request, timeout]);
        return meta || null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Canonical watch URL for a library clip (share / open externally). */
export function youtubeClipUrl(clipOrId) {
    const id = normalizeYouTubeId(
        typeof clipOrId === 'string' ? clipOrId : clipOrId?.videoId || ''
    );
    return youtubeWatchUrl(id);
}

/** @param {string} videoId */
export function hasYouTubeClip(videoId) {
    const id = normalizeYouTubeId(videoId);
    if (!id) return false;
    return loadYouTubeLibrary().clips.some((clip) => clip.videoId === id);
}
