/**
 * Mosaic rotation: push every TV's channel around the ring by one screen
 * (TV 1 → 2 → … → N → 1). Methods mix into MultiView (this === MultiView).
 *
 * The picture itself travels: before rewiring slot pointers we snapshot each
 * moving video frame; after the commit a floating clone flies from the source
 * tile rect to the destination tile rect, then the live video is revealed.
 */
import { el } from '../tvUtils.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { resolveViewTransition } from '../ui/viewTransitions.js';
import { snapshotVideoPoster } from '../tiles/streamCapture.js';
import {
    PLAY_FILL_ORDER,
    prefersReducedMotion,
    waitMs
} from './constants.js';
import {
    captureSwapPlaybackState,
    applySwapPlaybackContinuity
} from './swapPlayback.js';

/** Travel animation timing (matches the slide-mode easing language). */
const ROTATE_TRAVEL_MS = 480;
const ROTATE_STAGGER_MS = 45;
const ROTATE_SETTLE_MS = 80;

/**
 * Enabled TV slots in screen-label order (TV 1..6).
 * PLAY_FILL_ORDER matches SLOT_SCREEN_LABELS numbering; SLOT_IDS does not.
 * @param {Record<string, { enabled?: boolean, player?: object | null } | undefined>} slots
 * @returns {string[]}
 */
export function computeRotationRing(slots) {
    if (!slots) return [];
    return PLAY_FILL_ORDER.filter((id) => {
        const slot = slots[id];
        return Boolean(slot?.enabled && slot?.player);
    });
}

/**
 * Rotation moves: the channel on ring[i] travels to ring[i + 1]; the last wraps to TV 1.
 * @param {string[]} ring
 * @returns {{ from: string, to: string }[]}
 */
export function buildRotationMoves(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return [];
    return ring.map((from, i) => ({ from, to: ring[(i + 1) % ring.length] }));
}

/**
 * Pure: apply rotation moves to a slot map — returns a new map with players
 * permuted. Reads only the ORIGINAL map, so move order can never clobber a
 * not-yet-read source slot.
 * @template T
 * @param {Record<string, T>} slots
 * @param {{ from: string, to: string }[]} moves
 * @returns {Record<string, T>}
 */
export function applyRotationMoves(slots, moves) {
    const next = {};
    for (const id of Object.keys(slots)) {
        next[id] = { ...slots[id] };
    }
    for (const { from, to } of moves) {
        const player = slots[from]?.player ?? null;
        next[to] = { ...next[to], player };
    }
    return next;
}

/**
 * Snapshot a moving player's current picture (live frame first, poster fallback).
 * @param {{ video?: HTMLVideoElement | null, posterDataUrl?: string | null } | null | undefined} player
 * @returns {string | null} data URL
 */
function captureRotateSnapshot(player) {
    let dataUrl = null;
    try {
        dataUrl = snapshotVideoPoster(player?.video, {
            maxWidth: 720,
            quality: 0.78,
            rejectBlack: false
        });
    } catch {
        dataUrl = null;
    }
    if (dataUrl) return dataUrl;
    const poster = player?.posterDataUrl;
    return typeof poster === 'string' && poster ? poster : null;
}

/**
 * Viewport rects for every ring tile. Returns null when anything is hidden or
 * unmeasurable — rotation then commits without the travel animation.
 * @param {string[]} ring
 * @returns {Map<string, DOMRect> | null}
 */
function captureTileRects(ring) {
    if (typeof document === 'undefined') return null;
    const rects = new Map();
    for (const id of ring) {
        const tile = el(`player-tile-${id}`);
        if (!tile || tile.classList.contains('is-hidden')) return null;
        const rect = tile.getBoundingClientRect?.() || null;
        if (!rect || rect.width < 8 || rect.height < 8) return null;
        rects.set(id, rect);
    }
    return rects;
}

/**
 * Build the flying snapshot clones (one per move with a capturable picture),
 * anchored at their source tile rect. FLIP transform targets ride along in
 * dataset so the caller only has to flip `transform`.
 * @param {{ from: string, to: string }[]} moves
 * @param {Map<string, object>} playerBySlot
 * @param {Map<string, DOMRect>} rects
 * @returns {HTMLElement[]}
 */
function buildRotateClones(moves, playerBySlot, rects) {
    if (typeof document === 'undefined') return [];
    const clones = [];
    moves.forEach(({ from, to }, i) => {
        const src = rects.get(from);
        const dst = rects.get(to);
        const dataUrl = captureRotateSnapshot(playerBySlot.get(from));
        if (!src || !dst || !dataUrl) return;
        const node = document.createElement('div');
        node.className = 'tv-rotate-clone';
        node.style.left = `${src.left}px`;
        node.style.top = `${src.top}px`;
        node.style.width = `${src.width}px`;
        node.style.height = `${src.height}px`;
        node.style.zIndex = String(9000 + i);
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.src = dataUrl;
        node.appendChild(img);
        node.dataset.dx = String(dst.left - src.left);
        node.dataset.dy = String(dst.top - src.top);
        node.dataset.sx = String(dst.width / src.width);
        node.dataset.sy = String(dst.height / src.height);
        document.body.appendChild(node);
        clones.push(node);
    });
    return clones;
}

/** Flip every clone toward its destination rect (CSS transition does the easing). */
function launchRotateClones(clones) {
    if (!clones.length) return;
    // Commit the source position before transforming, or the transition is skipped.
    void clones[0].offsetWidth;
    clones.forEach((node, i) => {
        node.style.transitionDelay = `${i * ROTATE_STAGGER_MS}ms`;
        node.style.transform =
            `translate(${node.dataset.dx || '0'}px, ${node.dataset.dy || '0'}px)`
            + ` scale(${node.dataset.sx || '1'}, ${node.dataset.sy || '1'})`;
    });
}

export const rotateMethods = {
    /** Enabled TV slots in screen-label order (drives the Rotate button visibility). */
    getRotationRing() {
        return computeRotationRing(this.slots);
    },

    /**
     * Rewire slot→player pointers along the ring (TV 1 → 2 → … → N → 1),
     * remount, keep per-stream transport state, persist and broadcast.
     * @returns {boolean} whether a rotation was committed
     */
    commitRotation() {
        const ring = computeRotationRing(this.slots);
        const moves = buildRotationMoves(ring);
        if (!moves.length) return false;

        // Snapshot players + transport flags BEFORE any pointer is rewritten.
        const sourcePlayers = new Map(ring.map((id) => [id, this.slots[id].player]));
        const continuity = ring.map((id) => captureSwapPlaybackState(this.slots[id].player));

        moves.forEach(({ from, to }) => {
            const player = sourcePlayers.get(from) ?? null;
            this.slots[to].player = player;
            if (player) player.id = to;
        });

        // Keep remembered stub keys aligned with the rotated assignment so
        // persistSlots never keeps a stale entry behind an empty player.
        ring.forEach((id) => {
            const channel = this.slots[id].player?.channel ?? null;
            const key = channel ? channelKey(channel) : null;
            if (key) this.rememberedSlotKeys[id] = key;
            else delete this.rememberedSlotKeys[id];
        });

        this.mountAll();

        // Resume only streams that were live; never stopped ones (same as swap).
        ring.forEach((id, i) => {
            applySwapPlaybackContinuity(continuity[i], sourcePlayers.get(ring[i]));
        });

        this.persistSlots();
        ring.forEach((id) => this.slots[id].player?.emitState?.());
        this.scheduleRefreshTiles();
        this.syncScreenControls?.();

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('tv:multiview_changed', {
                detail: { primary: 'center', rotated: true }
            }));
        }
        return true;
    },

    /**
     * Rotate every TV's channel to the next screen with a travelling-picture
     * animation. Skips animation for the `instant` transition setting and
     * prefers-reduced-motion, and falls back to a plain commit whenever rects
     * or snapshots are unavailable.
     * @param {{ animate?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    async rotateScreens(opts = {}) {
        const ring = computeRotationRing(this.slots);
        const moves = buildRotationMoves(ring);
        if (!moves.length || this.swapBusy) return false;

        const animate = opts.animate !== false
            && !prefersReducedMotion()
            && resolveViewTransition(SettingsStore.getSwapTransition(), 'swap') !== 'instant';

        this.swapBusy = true;
        let clones = [];
        try {
            const rects = animate ? captureTileRects(ring) : null;
            const playerBySlot = new Map(ring.map((id) => [id, this.slots[id].player]));
            // Snapshots must be captured before commit — the video still lives
            // in its source tile until mountAll() moves it.
            clones = rects ? buildRotateClones(moves, playerBySlot, rects) : [];

            // Hide the incoming pictures until their travelling clone lands.
            if (clones.length) {
                ring.forEach((id) => {
                    el(`player-tile-${id}`)?.classList.add('is-rotate-arriving');
                });
            }

            const committed = this.commitRotation();
            if (!committed) return false;

            if (clones.length) {
                launchRotateClones(clones);
                await waitMs(
                    ROTATE_TRAVEL_MS
                    + ROTATE_STAGGER_MS * Math.max(0, clones.length - 1)
                    + ROTATE_SETTLE_MS
                );
            }
            return true;
        } finally {
            clones.forEach((node) => node.remove?.());
            if (typeof document !== 'undefined') {
                ring.forEach((id) => {
                    el(`player-tile-${id}`)?.classList.remove('is-rotate-arriving');
                });
            }
            this.swapBusy = false;
        }
    },
};