/**
 * Minimal HLS player for detached popout windows.
 * Query: ?url=…&name=…&muted=0|1
 */
import { attachStream } from './player/hlsAttach.js';
import { DEFAULT_BUFFER_SIZE } from './storage/playerState.js';

function qs(name) {
    try {
        return new URLSearchParams(window.location.search).get(name) || '';
    } catch {
        return '';
    }
}

function setStatus(text) {
    const el = document.getElementById('status');
    if (!el) return;
    if (!text) {
        el.classList.add('is-hidden');
        el.textContent = '';
        return;
    }
    el.classList.remove('is-hidden');
    el.textContent = text;
}

async function boot() {
    const url = qs('url');
    const name = qs('name') || 'magicTV';
    const muted = qs('muted') !== '0';

    document.title = name;

    const video = document.getElementById('video');
    if (!video || !url) {
        setStatus('No stream URL');
        return;
    }

    video.playsInline = true;
    video.muted = muted;
    video.autoplay = true;
    video.volume = muted ? 0.85 : 0.85;

    const ctx = {
        video,
        hls: null,
        playGeneration: 1,
        connection: 'idle',
        qualityLevel: 0,
        qualityLabel: 'Auto',
        error: null,
        getBufferSize: () => DEFAULT_BUFFER_SIZE,
        updateBufferSize() {},
        emitState() {}
    };

    try {
        setStatus('Connecting…');
        await attachStream(ctx, url, 1);
        await video.play();
        setStatus('');
    } catch (e) {
        const blocked = e?.name === 'NotAllowedError'
            || String(e?.message || '').toLowerCase().includes('not allowed');
        if (blocked) {
            setStatus('Tap to unmute / play');
            const resume = async () => {
                try {
                    video.muted = false;
                    await video.play();
                    setStatus('');
                } catch { /* ignore */ }
                video.removeEventListener('click', resume);
            };
            video.addEventListener('click', resume);
        } else {
            setStatus('Stream unavailable');
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
