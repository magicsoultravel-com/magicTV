/**
 * Native browser Picture-in-Picture control for the TV player.
 * "Pop out" moves the live <video> into an OS-level always-on-top window
 * (draggable / resizable by the browser). "Pop in" returns it to the app.
 * Works in Chrome and Firefox on desktop; buttons are hidden where unsupported.
 */
import { TvPlayer } from './tvPlayer.js';
import { showAppToast } from './toast.js';
import { ACTION_ICONS } from './icons.js';

const POP_OUT_LABEL = 'Pop out';
const POP_IN_LABEL = 'Pop in';

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

        if (!this.supported()) {
            this.syncButtons();
            return;
        }

        const video = TvPlayer.video;
        if (video) {
            video.addEventListener('enterpictureinpicture', () => this.syncButtons());
            video.addEventListener('leavepictureinpicture', () => {
                this.stripPipSizing();
                // Re-mount the video into whichever container is current now that
                // the floating window is gone (also refreshes sidebar transport UI).
                TvPlayer.emitState();
                this.syncButtons();
            });
        }

        window.addEventListener('tv:state_changed', () => this.syncButtons());
        this.syncButtons();
    },

    isActive() {
        return typeof document !== 'undefined' && Boolean(document.pictureInPictureElement);
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
        const supported = this.supported();
        const active = supported && this.isActive();
        const label = active ? POP_IN_LABEL : POP_OUT_LABEL;
        const icon = supported
            ? (active ? ACTION_ICONS.pictureInPictureExit : ACTION_ICONS.pictureInPicture)
            : null;

        this.buttons.forEach((btn) => {
            if (!btn.isConnected) {
                this.buttons.delete(btn);
                return;
            }
            if (!supported) {
                btn.classList.add('is-hidden');
                btn.disabled = true;
                return;
            }
            btn.disabled = false;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.setAttribute('title', label);
            btn.setAttribute('aria-label', label);
            if (icon) btn.innerHTML = icon;
        });
    },

    async toggle() {
        if (!this.supported()) {
            showAppToast('Pop out isn’t supported in this browser.');
            return;
        }

        const video = TvPlayer.video;
        if (!video) {
            showAppToast('Nothing is playing yet.');
            return;
        }

        if (this.isActive()) {
            try {
                await document.exitPictureInPicture();
            } catch {
                showAppToast('Couldn’t pop the video back in.');
            }
            return;
        }

        try {
            await video.requestPictureInPicture();
        } catch (e) {
            let msg = 'Couldn’t pop the video out.';
            if (!TvPlayer.channel) {
                msg = 'Nothing is playing yet.';
            } else if (e?.name === 'InvalidStateError') {
                msg = 'The stream isn’t ready to pop out yet — try again in a moment.';
            } else if (e?.name === 'NotSupportedError' || e?.name === 'NotFoundError') {
                msg = 'Pop out isn’t supported for this stream or browser.';
            }
            showAppToast(msg);
        }
    },

    // The browser leaves explicit width/height on the video element while it is
    // in the PiP window; clear it so the in-app CSS sizing wins after pop-in.
    stripPipSizing() {
        const video = TvPlayer.video;
        if (!video) return;
        video.removeAttribute('width');
        video.removeAttribute('height');
        video.style.width = '';
        video.style.height = '';
    },

    exitIfActive() {
        if (!this.isActive()) return;
        if (typeof document.exitPictureInPicture !== 'function') return;
        try {
            document.exitPictureInPicture().catch(() => {});
        } catch { /* ignore */ }
    }
};