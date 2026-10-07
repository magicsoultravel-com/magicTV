/**
 * TV Travel — auto-rotate mosaic screens on a style-driven loop.
 * Methods mix into MultiView (this === MultiView).
 *
 * Styles:
 *   quick  — short FLIP hop, then wait tvTravelTickSec
 *   slow   — FLIP spans the full tick (continuous crawl between hops)
 *   random — timing from Channel switch setting; tick dwell like quick
 */
import {
    SettingsStore,
    normalizeTvTravelStyle,
    DEFAULT_TV_TRAVEL_STYLE
} from '../storage/settingsStore.js';
import {
    resolveViewTransition,
    VIEW_MOTION,
    TILE_SWAP_DURATIONS
} from '../ui/viewTransitions.js';
import { prefersReducedMotion, waitMs } from './constants.js';
import { TILE_TRAVEL_MS, TILE_TRAVEL_STAGGER_MS } from './tileTravel.js';

export { normalizeTvTravelStyle, DEFAULT_TV_TRAVEL_STYLE };

export const QUICK_TRAVEL_MS = TILE_TRAVEL_MS;

/**
 * Resolve rotateScreens opts for a travel style.
 * @param {'quick' | 'slow' | 'random'} style
 * @returns {{ animate?: boolean, travel?: { durationMs: number, staggerMs?: number, easing?: string, settleMs?: number } }}
 */
export function resolveTvTravelRotateOpts(style) {
    if (prefersReducedMotion()) {
        return { animate: false };
    }
    const tickMs = Math.max(1000, SettingsStore.getTvTravelTickSec() * 1000);

    if (style === 'slow') {
        // Whole hop lasts the tick — next step starts as soon as travel settles.
        return {
            animate: true,
            travel: {
                durationMs: tickMs,
                staggerMs: 0,
                settleMs: 40,
                easing: 'linear'
            }
        };
    }
    if (style === 'random') {
        const mode = resolveViewTransition(SettingsStore.getSwapTransition(), 'swap');
        if (mode === 'instant') {
            return { animate: false };
        }
        const motion = VIEW_MOTION[mode] || VIEW_MOTION.smooth;
        const swapHalf = TILE_SWAP_DURATIONS[mode];
        const durationMs = Number.isFinite(swapHalf)
            ? Math.max(swapHalf, motion.duration || TILE_TRAVEL_MS)
            : (motion.duration || TILE_TRAVEL_MS);
        return {
            animate: true,
            travel: {
                durationMs,
                staggerMs: TILE_TRAVEL_STAGGER_MS,
                easing: motion.easing || 'cubic-bezier(0.22, 1, 0.36, 1)'
            }
        };
    }
    // quick
    return {
        animate: true,
        travel: {
            durationMs: QUICK_TRAVEL_MS,
            staggerMs: TILE_TRAVEL_STAGGER_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }
    };
}

function emptyTravelState() {
    return {
        active: false,
        style: /** @type {'quick' | 'slow' | 'random' | null} */ (null),
        gen: 0,
        /** @type {((value?: void) => void) | null} */
        waitResolve: null,
        /** @type {ReturnType<typeof setTimeout> | null} */
        waitTimer: null
    };
}

export const tvTravelMethods = {
    _tvTravel: emptyTravelState(),

    isTvTravelActive() {
        return this._tvTravel?.active === true;
    },

    /** @returns {'quick' | 'slow' | 'random' | null} */
    getTvTravelStyle() {
        return this.isTvTravelActive() ? this._tvTravel.style : null;
    },

    /**
     * Start (or switch) TV Travel. Re-selecting the active style stops it.
     * @param {string} style
     * @returns {boolean} true if travel is running after the call
     */
    startTvTravel(style) {
        const next = normalizeTvTravelStyle(style);
        if (this.isTvTravelActive() && this._tvTravel.style === next) {
            this.stopTvTravel();
            return false;
        }
        if ((this.getRotationRing?.() || []).length < 2) {
            this.stopTvTravel();
            return false;
        }

        this._cancelTvTravelWait();
        const gen = (this._tvTravel?.gen || 0) + 1;
        this._tvTravel = {
            active: true,
            style: next,
            gen,
            waitResolve: null,
            waitTimer: null
        };
        SettingsStore.setTvTravelStyle(next);
        void this._runTvTravelLoop(gen);
        this._notifyTvTravelChanged();
        return true;
    },

    stopTvTravel() {
        if (!this._tvTravel?.active && !this._tvTravel?.style) {
            this._cancelTvTravelWait();
            return;
        }
        const gen = (this._tvTravel?.gen || 0) + 1;
        this._cancelTvTravelWait();
        this._tvTravel = {
            active: false,
            style: null,
            gen,
            waitResolve: null,
            waitTimer: null
        };
        this._notifyTvTravelChanged();
    },

    /** Wake Quick/Random dwell so the next loop uses the new tick. */
    rescheduleTvTravelTick() {
        if (!this.isTvTravelActive()) return;
        const style = this._tvTravel.style;
        if (style !== 'quick' && style !== 'random') return;
        if (!this._tvTravel.waitTimer) return;
        this._cancelTvTravelWait();
    },

    ensureTvTravelWatch() {
        if (typeof window === 'undefined' || this._tvTravelWatchBound) return;
        this._tvTravelWatchBound = true;
        window.addEventListener('tv:multiview_changed', () => {
            if (!this.isTvTravelActive()) return;
            if ((this.getRotationRing?.() || []).length < 2) {
                this.stopTvTravel();
            }
            this.syncMosaicChrome?.();
        });
        window.addEventListener('tv:tv_travel_changed', () => {
            this.syncMosaicChrome?.();
        });
    },

    _notifyTvTravelChanged() {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
        window.dispatchEvent(new CustomEvent('tv:tv_travel_changed', {
            detail: {
                active: this.isTvTravelActive(),
                style: this.getTvTravelStyle()
            }
        }));
    },

    _cancelTvTravelWait() {
        const state = this._tvTravel;
        if (!state) return;
        if (state.waitTimer != null) {
            clearTimeout(state.waitTimer);
            state.waitTimer = null;
        }
        if (state.waitResolve) {
            const resolve = state.waitResolve;
            state.waitResolve = null;
            resolve();
        }
    },

    /**
     * @param {number} ms
     * @param {number} gen
     */
    _tvTravelWait(ms, gen) {
        return new Promise((resolve) => {
            if (!this._tvTravel?.active || this._tvTravel.gen !== gen) {
                resolve();
                return;
            }
            this._tvTravel.waitResolve = resolve;
            this._tvTravel.waitTimer = setTimeout(() => {
                if (this._tvTravel) {
                    this._tvTravel.waitTimer = null;
                    this._tvTravel.waitResolve = null;
                }
                resolve();
            }, Math.max(0, ms));
        });
    },

    /**
     * @param {number} gen
     */
    async _runTvTravelLoop(gen) {
        while (this._tvTravel?.active && this._tvTravel.gen === gen) {
            const ring = this.getRotationRing?.() || [];
            if (ring.length < 2) {
                this.stopTvTravel();
                break;
            }

            const style = this._tvTravel.style || 'quick';
            const opts = resolveTvTravelRotateOpts(style);

            while (this.swapBusy && this._tvTravel?.active && this._tvTravel.gen === gen) {
                await waitMs(40);
            }
            if (!this._tvTravel?.active || this._tvTravel.gen !== gen) break;

            await this.rotateScreens?.(opts);

            if (!this._tvTravel?.active || this._tvTravel.gen !== gen) break;

            if (style === 'slow') {
                // Animation already consumed the tick — hop again immediately.
                continue;
            }

            const tickSec = SettingsStore.getTvTravelTickSec();
            await this._tvTravelWait(tickSec * 1000, gen);
        }
    }
};
