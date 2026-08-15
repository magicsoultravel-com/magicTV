import { canPlayNativeHls, isHlsUrl, loadHlsLibrary } from '../tvHls.js';

export const HLS_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
export const HLS_MAX_BITRATE = 5_000_000;
/** Segments to sync to the live edge (fixed; no longer a user preference). */
export const LIVE_SYNC_DURATION_COUNT = 3;

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
        liveMaxLatencyDurationCount: 10
    };
}

export async function destroyHls(ctx) {
    if (ctx.hls) {
        ctx.hls.destroy();
        ctx.hls = null;
    }
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
            ctx.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (generation !== ctx.playGeneration) {
                    resolve();
                    return;
                }
                ctx.connection = 'connected';
                ctx.qualityLevel = 0;
                ctx.qualityLabel = 'auto';
                ctx.emitState();
                resolve();
            });
            ctx.hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                if (generation !== ctx.playGeneration || !ctx.hls) return;
                if (data.level !== undefined && ctx.hls.levels?.[data.level]?.height) {
                    ctx.qualityLabel = `${ctx.hls.levels[data.level].height}p`;
                }
                ctx.emitState();
            });
            ctx.hls.on(Hls.Events.ERROR, (_, data) => {
                if (generation !== ctx.playGeneration) return;
                if (data.fatal) {
                    ctx.error = 'Stream unavailable';
                    ctx.errorCount = (ctx.errorCount || 0) + 1;
                    reject(new Error('Stream unavailable'));
                    return;
                }
                if (!ctx.hls) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    ctx.hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    ctx.hls.recoverMediaError();
                }
            });
            ctx.hls.on(Hls.Events.BUFFER_DEPTH_UPDATE, () => {
                if (generation !== ctx.playGeneration) return;
                ctx.emitState();
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
