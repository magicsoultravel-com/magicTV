import { canPlayNativeHls, isHlsUrl, loadHlsLibrary } from '../tvHls.js';

export const HLS_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
export const HLS_MAX_BITRATE = 5_000_000;
/** Segments to sync to the live edge (fixed; no longer a user preference). */
export const LIVE_SYNC_DURATION_COUNT = 3;
/** Max latency (in segments) before hls.js seeks to the live edge. */
export const LIVE_MAX_LATENCY_DURATION_COUNT = 10;

export function formatQualityLabel(level, videoHeight = 0) {
    if (level?.height) return `${level.height}p`;
    if (videoHeight > 0) return `${videoHeight}p`;
    if (level?.bitrate) return `${Math.round(level.bitrate / 1000)}k`;
    return '—';
}

function resolveLevelIndex(hls) {
    if (!hls) return -1;
    if (hls.currentLevel >= 0) return hls.currentLevel;
    if (hls.loadLevel >= 0) return hls.loadLevel;
    if (hls.nextLoadLevel >= 0) return hls.nextLoadLevel;
    if (hls.firstLevel >= 0) return hls.firstLevel;
    return -1;
}

/** Apply Auto or locked level to an hls.js instance. Returns the mode actually applied. */
export function applyQualityMode(hls, mode) {
    if (!hls) return 'auto';
    if (mode === 'auto' || mode == null) {
        hls.autoLevelEnabled = true;
        hls.currentLevel = -1;
        return 'auto';
    }
    const index = Number(mode);
    if (!Number.isInteger(index) || index < 0 || !hls.levels?.[index]) {
        hls.autoLevelEnabled = true;
        hls.currentLevel = -1;
        return 'auto';
    }
    hls.autoLevelEnabled = false;
    hls.currentLevel = index;
    return index;
}

export function listQualityLevels(hls, videoHeight = 0) {
    if (!hls?.levels?.length) return [];
    return hls.levels.map((level, index) => ({
        index,
        label: formatQualityLabel(level, videoHeight)
    }));
}

export function applyHlsBufferConfig(hls, bufferSize) {
    if (!hls) return;
    hls.config.maxBufferLength = bufferSize;
    hls.config.maxBufferSize = HLS_MAX_BUFFER_BYTES;
    hls.config.maxBitrate = HLS_MAX_BITRATE;
}

export function buildHlsConfig(Hls, bufferSize) {
    return {
        maxBufferSize: HLS_MAX_BUFFER_BYTES,
        maxBufferLength: bufferSize,
        minBufferLength: 1.0,
        maxBitrate: HLS_MAX_BITRATE,
        startPosition: 0,
        enableWorker: true,
        abrController: Hls.AbrController,
        capLevelToPlayerImpl: true,
        liveSyncDurationCount: LIVE_SYNC_DURATION_COUNT,
        liveMaxLatencyDurationCount: LIVE_MAX_LATENCY_DURATION_COUNT
    };
}

export async function destroyHls(ctx) {
    if (ctx.hls) {
        ctx.hls.destroy();
        ctx.hls = null;
    }
    ctx.bandwidthEstimateBps = null;
}

/**
 * Bind the live hls.js event handlers that keep ctx's quality / error /
 * bandwidth / buffer UI in sync. Shared by attachStream (fresh attach) and
 * commitPreparedChannel (takeover of a pre-warmed staging hls).
 * @param {object} ctx player context (video, hls, playGeneration, qualityMode... emitState, updateBufferSize)
 * @param {object} hls hls.js instance to wire
 * @param {number} generation generation the handlers belong to (ctx.playGeneration)
 * @param {{ onManifestParsed?: (hls, video) => void }} [opts]
 */
export function bindHlsPlaybackHandlers(ctx, hls, generation, opts = {}) {
    if (!hls || typeof hls !== 'object') return;
    const video = ctx.video;
    const events = hls.constructor?.Events || hls.Events;
    if (!events) return;

    hls.on(events.MANIFEST_PARSED, () => {
        if (generation !== ctx.playGeneration || !ctx.hls) return;
        ctx.connection = 'connected';
        ctx.qualityMode = applyQualityMode(ctx.hls, ctx.qualityMode);
        const levelIdx = resolveLevelIndex(ctx.hls);
        if (levelIdx >= 0 && ctx.hls.levels?.[levelIdx]) {
            ctx.qualityLevel = levelIdx;
            ctx.qualityLabel = formatQualityLabel(
                ctx.hls.levels[levelIdx],
                video.videoHeight
            );
        } else {
            ctx.qualityLevel = -1;
            ctx.qualityLabel = formatQualityLabel(null, video.videoHeight);
        }
        opts.onManifestParsed?.(ctx.hls, video);
        ctx.emitState();
    });

    hls.on(events.LEVEL_SWITCHED, (_, data) => {
        if (generation !== ctx.playGeneration || !ctx.hls) return;
        const prevLevel = ctx.qualityLevel;
        const prevLabel = ctx.qualityLabel;
        if (data.level !== undefined) {
            ctx.qualityLevel = data.level;
            ctx.qualityLabel = formatQualityLabel(
                ctx.hls.levels?.[data.level],
                video.videoHeight
            );
        }
        if (ctx.qualityLevel !== prevLevel || ctx.qualityLabel !== prevLabel) {
            ctx.emitState();
        }
    });

    hls.on(events.FRAG_LOADED, (_, data) => {
        if (generation !== ctx.playGeneration) return;
        const prevBw = ctx.bandwidthEstimateBps;
        const prevLabel = ctx.qualityLabel;
        const bw = data?.stats?.bwEstimate ?? data?.frag?.stats?.bwEstimate;
        if (Number.isFinite(bw) && bw > 0) {
            ctx.bandwidthEstimateBps = bw;
        }
        if ((ctx.qualityLabel === '—' || !ctx.qualityLabel) && video.videoHeight) {
            ctx.qualityLabel = formatQualityLabel(null, video.videoHeight);
        }
        if (
            ctx.bandwidthEstimateBps !== prevBw
            || ctx.qualityLabel !== prevLabel
        ) {
            ctx.emitState();
        }
    });

    hls.on(events.ERROR, (_, data) => {
        if (generation !== ctx.playGeneration) return;
        if (data.fatal) {
            ctx.error = 'Stream unavailable';
            ctx.errorCount = (ctx.errorCount || 0) + 1;
            if (typeof ctx._onPlaybackFatal === 'function') {
                ctx._onPlaybackFatal(data);
            }
            try { ctx.emitState(); } catch { /* ignore */ }
            return;
        }
        if (!ctx.hls) return;
        if (data.type === hls.constructor?.ErrorTypes?.NETWORK_ERROR
            || data.type === 'networkError') {
            ctx.hls.startLoad();
        } else if (data.type === hls.constructor?.ErrorTypes?.MEDIA_ERROR
            || data.type === 'mediaError') {
            ctx.hls.recoverMediaError();
        }
    });

    hls.on(events.BUFFER_DEPTH_UPDATE, () => {
        if (generation !== ctx.playGeneration) return;
        const now = Date.now();
        if (ctx._lastBufferDepthEmit && now - ctx._lastBufferDepthEmit < 400) {
            return;
        }
        ctx._lastBufferDepthEmit = now;
        ctx.emitState();
    });
}

/**
 * Attach a stream URL to ctx.video. ctx must provide:
 * video, hls, playGeneration, getBufferSize(), updateBufferSize(), emitState()
 */
export async function attachStream(ctx, url, generation = ctx.playGeneration) {
    await destroyHls(ctx);
    if (generation !== ctx.playGeneration) return;
    const video = ctx.video;
    ctx.connection = 'connecting';
    ctx.qualityMode = 'auto';
    ctx.qualityLevel = -1;
    ctx.qualityLabel = '—';
    ctx.bandwidthEstimateBps = null;
    video.removeAttribute('src');
    video.load();

    if (isHlsUrl(url)) {
        if (canPlayNativeHls(video)) {
            if (generation !== ctx.playGeneration) return;
            video.src = url;
            ctx.updateBufferSize();
            return;
        }
        const Hls = await loadHlsLibrary();
        if (generation !== ctx.playGeneration) return;
        if (!Hls.isSupported()) {
            throw new Error('HLS not supported');
        }
        await new Promise((resolve, reject) => {
            if (generation !== ctx.playGeneration) {
                resolve();
                return;
            }
            ctx.hls = new Hls(buildHlsConfig(Hls, ctx.getBufferSize()));
            ctx._onPlaybackFatal = () => reject(new Error('Stream unavailable'));
            bindHlsPlaybackHandlers(ctx, ctx.hls, generation, {
                onManifestParsed: () => resolve()
            });
            ctx.hls.loadSource(url);
            ctx.hls.attachMedia(video);
        });
        return;
    }

    if (generation !== ctx.playGeneration) return;
    video.src = url;
    ctx.updateBufferSize();
}
