/**
 * Same-origin window.open popouts for multi-stream detach.
 * Native PiP remains one-at-a-time; these windows can run in parallel.
 */
import { showAppToast } from './ui/toast.js';

const windows = new Map();

function popoutHref({ url, name, muted }) {
    const params = new URLSearchParams();
    params.set('url', url);
    if (name) params.set('name', name);
    params.set('muted', muted ? '1' : '0');
    return new URL(`./popout.html?${params.toString()}`, window.location.href).href;
}

export const TvPopoutWindows = {
    isOpen(slotId) {
        const win = windows.get(slotId);
        if (!win) return false;
        if (win.closed) {
            windows.delete(slotId);
            return false;
        }
        return true;
    },

    close(slotId) {
        const win = windows.get(slotId);
        if (win && !win.closed) {
            try { win.close(); } catch { /* ignore */ }
        }
        windows.delete(slotId);
        window.dispatchEvent(new CustomEvent('tv:popout_changed', { detail: { slotId, open: false } }));
    },

    openOrFocus(slotId, { url, name = 'magicTV', muted = true } = {}) {
        if (!url) {
            showAppToast('Nothing is playing yet.');
            return null;
        }

        if (this.isOpen(slotId)) {
            try { windows.get(slotId).focus(); } catch { /* ignore */ }
            return windows.get(slotId);
        }

        const href = popoutHref({ url, name, muted });
        const features = 'popup=yes,width=480,height=270,menubar=no,toolbar=no,location=no,status=no';
        let win = null;
        try {
            win = window.open(href, `magictv-popout-${slotId}`, features);
        } catch {
            win = null;
        }

        if (!win) {
            showAppToast('Pop-out window was blocked — allow popups for this site.');
            return null;
        }

        windows.set(slotId, win);
        window.dispatchEvent(new CustomEvent('tv:popout_changed', { detail: { slotId, open: true } }));

        const poll = window.setInterval(() => {
            if (!windows.has(slotId)) {
                window.clearInterval(poll);
                return;
            }
            const w = windows.get(slotId);
            if (!w || w.closed) {
                windows.delete(slotId);
                window.clearInterval(poll);
                window.dispatchEvent(new CustomEvent('tv:popout_changed', { detail: { slotId, open: false } }));
            }
        }, 800);

        return win;
    },

    /**
     * Combined detach: prefer native PiP when free / already this video;
     * otherwise open a window popout (or close it if already open for this slot).
     */
    async detach({
        slotId,
        video,
        url,
        name,
        muted = true,
        pipSupported = false
    }) {
        if (!url) {
            showAppToast('Nothing is playing yet.');
            return;
        }

        if (this.isOpen(slotId)) {
            this.close(slotId);
            return;
        }

        const pipEl = typeof document !== 'undefined' ? document.pictureInPictureElement : null;

        if (pipSupported && video && pipEl === video) {
            try {
                await document.exitPictureInPicture();
            } catch {
                showAppToast('Couldn’t pop the video back in.');
            }
            return;
        }

        const pipFree = !pipEl;
        const canNative = pipSupported && video && (pipFree || pipEl === video);

        if (canNative && pipFree) {
            try {
                await video.requestPictureInPicture();
                return;
            } catch (e) {
                // Fall through to window popout
                if (e?.name === 'InvalidStateError') {
                    showAppToast('Stream not ready — opening a window instead.');
                }
            }
        }

        // Native PiP occupied by another video, unsupported, or failed → window
        this.openOrFocus(slotId, { url, name, muted });
    }
};
