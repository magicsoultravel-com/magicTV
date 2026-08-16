/**
 * Native browser Picture-in-Picture + window popout fallback for multi-stream.
 * First free detach uses OS PiP; additional streams open same-origin windows.
 */
import { TvPlayer } from './tvPlayer.js';
import { showAppToast } from './ui/toast.js';
import { ACTION_ICONS } from './ui/icons.js';
import { TvPopoutWindows } from './tvPopoutWindows.js';

const POP_OUT_LABEL = 'Pop out';
const POP_IN_LABEL = 'Pop in';
const CENTER_SLOT = 'center';

export const TvPip = {
    buttons: new Set(),
    initialized: false,

    supported() {
        return typeof document !== 'undefined'
            && typeof document.pictureInPictureEnabled === 'boolean'
            && document.pictureInPictureEnabled
            && typeof HTMLVideoElement !== 'undefined'
            && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
    },

    init() {
        if (this.initialized) return;
        this.initialized = true;

        window.addEventListener('tv:state_changed', () => this.syncButtons());
        window.addEventListener('tv:pip_changed', () => {
            this.stripPipSizing();
            this.syncButtons();
        });
        window.addEventListener('tv:multiview_changed', () => this.syncButtons());
        window.addEventListener('tv:popout_changed', () => this.syncButtons());
        this.syncButtons();
    },

    isActive() {
        const native = typeof document !== 'undefined'
            && document.pictureInPictureElement === TvPlayer.video;
        return native || TvPopoutWindows.isOpen(CENTER_SLOT);
    },

    registerButton(btn) {
        if (!btn || this.buttons.has(btn)) return;
        this.buttons.add(btn);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        this.syncButtons();
    },

    syncButtons() {
        const active = this.isActive();
        const label = active ? POP_IN_LABEL : POP_OUT_LABEL;
        const icon = active
            ? ACTION_ICONS.pictureInPictureExit
            : ACTION_ICONS.pictureInPicture;

        this.buttons.forEach((btn) => {
            if (!btn.isConnected) {
                this.buttons.delete(btn);
                return;
            }
            // Window popout works without native PiP support
            btn.disabled = false;
            btn.classList.remove('is-hidden');
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.setAttribute('title', label);
            btn.setAttribute('aria-label', label);
            btn.innerHTML = icon;
        });
    },

    async toggle() {
        const video = TvPlayer.video;
        const channel = TvPlayer.channel;
        const url = channel?.url_resolved || channel?.url || '';

        if (!url && !video) {
            showAppToast('Nothing is playing yet.');
            return;
        }

        await TvPopoutWindows.detach({
            slotId: CENTER_SLOT,
            video,
            url,
            name: channel?.name || 'magicTV',
            muted: TvPlayer.muted !== false,
            pipSupported: this.supported()
        });
        this.syncButtons();
    },

    stripPipSizing() {
        const video = document.pictureInPictureElement || TvPlayer.video;
        if (!video) return;
        video.removeAttribute('width');
        video.removeAttribute('height');
        video.style.width = '';
        video.style.height = '';
    },

    exitIfActive() {
        if (TvPopoutWindows.isOpen(CENTER_SLOT)) {
            TvPopoutWindows.close(CENTER_SLOT);
        }
        if (typeof document === 'undefined' || !document.pictureInPictureElement) return;
        if (typeof document.exitPictureInPicture !== 'function') return;
        try {
            document.exitPictureInPicture().catch(() => {});
        } catch { /* ignore */ }
    }
};
