/** Remote control panel — default view inside the remote module. */
import { countryFlagEmoji, el, queryAllInApp } from '../tvUtils.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';
import { ACTION_ICONS, CARD_ICONS, LAYOUT_ICONS } from './icons.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { GuidePanel } from './guidePanel.js';
import { isSplit } from './moduleLayout.js';
import { syncVolumeDial } from './volumeDial.js';
import { syncMuteAllKeys, syncPlayAllKeys, syncStopAllKeys } from './remoteAllKeys.js';
import { buildStreamLink, buildDeepLink, copyShareText } from '../share/shareChannel.js';
import { navigateChannel, navigateToChannelNumber } from '../channelNav.js';
import { ChanBindPicker } from './chanBindPicker.js';
import { SettingsStore } from '../storage/settingsStore.js';
import { setMarqueeText } from './marquee.js';
import {
    resolveViewTransition
} from './viewTransitions.js';
import {
    runShutdownTransition,
    isShutdownTransitionBusy
} from './powerStyleTransition.js';
import { isBrowserCatalogTab } from './catalogModeEntry.js';

let deps = {
    switchTab: () => {},
    openTvCatalog: null,
    getRemoteModule: () => null
};

const REMOTE_KEYPAD_NAV_TABS = new Set(['remote', 'browse', 'favorites', 'recents', 'settings']);
const DIGIT_COMMIT_MS = 1500;
const DIGIT_MAX_LEN = 4;

let digitBuffer = '';
let digitTimer = null;
/** Slot that owned the digit entry when the first digit was pressed. */
let digitTargetSlotId = null;
let powerOffBusy = false;

export function syncRemoteNav(tabName) {
    const split = isSplit();
    queryAllInApp('[data-remote-nav]').forEach((btn) => {
        const nav = btn.getAttribute('data-remote-nav');
        const cell = btn.closest('.remote-panel__cell');
        const inRemoteNav = Boolean(btn.closest('#remote-panel-nav-group'));

        if (inRemoteNav) {
            // Split: hide catalog tabs on the remote keypad; leave Split/Join in place.
            const hide = split && REMOTE_KEYPAD_NAV_TABS.has(nav);
            btn.classList.toggle('is-hidden', hide);
            cell?.classList.toggle('is-hidden', hide);
        } else if (nav === 'remote') {
            btn.classList.toggle('is-hidden', split);
            cell?.classList.toggle('is-hidden', split);
        }

        btn.classList.toggle('is-active', nav === tabName);
    });
    syncNavPlacement(tabName);
}

function syncNavPlacement(tabName) {
    const navGroup = el('remote-panel-nav-group');
    const grid = el('remote-panel')?.querySelector('.remote-panel__grid');
    if (!navGroup || !grid) return;
    if (typeof document?.querySelector !== 'function') return;

    const footerNavRow = el('remote-panel-footer-nav-row');
    const browserNav = el('browser-panel-nav-group');
    const mosaicGroup = el('remote-panel-mosaic-group');
    const split = isSplit();
    const joined = !split;
    const browserTab = tabName !== 'remote';
    const placeInFooter = joined && browserTab && footerNavRow;

    navGroup.classList.toggle('remote-panel__nav-group--footer', placeInFooter);

    if (placeInFooter) {
        if (navGroup.parentElement !== footerNavRow) {
            footerNavRow.insertBefore(navGroup, footerNavRow.firstChild);
        }
        if (browserNav) {
            browserNav.classList.add('is-hidden');
            browserNav.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    // Keep catalog nav immediately before mosaic controls (after volumes / chrome).
    if (mosaicGroup) {
        if (navGroup.parentElement !== grid || navGroup.nextElementSibling !== mosaicGroup) {
            grid.insertBefore(navGroup, mosaicGroup);
        }
    } else if (navGroup.parentElement !== grid) {
        grid.appendChild(navGroup);
    }

    if (browserNav) {
        browserNav.classList.toggle('is-hidden', !split);
        browserNav.setAttribute('aria-hidden', String(!split));
    }
}

function clearDigitBuffer({ restoreBar = true } = {}) {
    digitBuffer = '';
    digitTargetSlotId = null;
    if (digitTimer) {
        clearTimeout(digitTimer);
        digitTimer = null;
    }
    if (restoreBar) syncRemoteChannelBar();
}

function previewDigitEntry() {
    const bar = el('remote-channel-bar');
    const nameEl = el('remote-channel-name');
    const flagEl = el('remote-channel-flag');
    if (!digitBuffer) return;
    if (bar) bar.classList.remove('is-hidden');
    if (nameEl) setMarqueeText(nameEl, digitBuffer);
    if (flagEl) flagEl.textContent = '';
}

async function commitDigitBuffer() {
    const raw = digitBuffer;
    const slotId = digitTargetSlotId || MultiView.statusSlotId || 'center';
    clearDigitBuffer({ restoreBar: false });
    if (!raw) {
        syncRemoteChannelBar();
        return;
    }
    const n = parseInt(raw, 10);
    await navigateToChannelNumber(slotId, n);
    syncRemoteChannelBar();
    syncRemotePanel();
}

function appendDigit(digitChar) {
    if (digitBuffer.length >= DIGIT_MAX_LEN) return;
    if (!digitBuffer) {
        digitTargetSlotId = MultiView.statusSlotId || 'center';
    }
    digitBuffer += digitChar;
    previewDigitEntry();
    if (digitTimer) clearTimeout(digitTimer);
    if (digitBuffer.length >= DIGIT_MAX_LEN) {
        void commitDigitBuffer();
        return;
    }
    digitTimer = setTimeout(() => {
        digitTimer = null;
        void commitDigitBuffer();
    }, DIGIT_COMMIT_MS);
}

/** Prefer a preparing (tuning) slot for the bar label so focus moves do not mislabel an in-flight switch. */
function resolveChannelBarSlotId() {
    const focused = MultiView.statusSlotId || 'center';
    if (MultiView.slots?.[focused]?.player?.preparing) return focused;
    for (const [id, slot] of Object.entries(MultiView.slots || {})) {
        if (slot?.enabled && slot.player?.preparing) return id;
    }
    return focused;
}

export function syncRemoteChannelBar(_tabName) {
    if (digitBuffer) {
        previewDigitEntry();
        return;
    }

    const bar = el('remote-channel-bar');
    const nameEl = el('remote-channel-name');
    const flagEl = el('remote-channel-flag');
    const slotId = resolveChannelBarSlotId();
    // Use the bar slot only — do not fall back to center's channel (would mislabel TV N).
    const slot = MultiView.slots?.[slotId];
    const player = slot?.player || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    const channel = player?.channel;
    const name = (channel?.name || '').trim();
    const country = channel?.countrycode || '';
    const show = Boolean(name);
    const tuning = player?.preparing === true;
    const tvLabel = SLOT_SCREEN_LABELS[slotId] || '1';

    if (bar) bar.classList.toggle('is-hidden', !show && !tuning);
    if (nameEl) {
        setMarqueeText(
            nameEl,
            tuning
                ? `TV ${tvLabel} · Tuning…`
                : (show ? `TV ${tvLabel} · ${name}` : '')
        );
    }
    if (flagEl) flagEl.textContent = show && country ? countryFlagEmoji(country) : '';
}

function focusedChannel() {
    const slotId = MultiView.statusSlotId || 'center';
    const player = MultiView.slots?.[slotId]?.player
        || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    return player?.channel || null;
}

/**
 * Remote popout pickers — one host key slides a tray of options out above it.
 * The Multi-TV layout picker set this interaction; Share and TV Travel reuse it
 * so every "key with options" on the remote opens, clamps and dismisses alike.
 */
const POPOUT_PICKERS = {
    layout: {
        wrapId: 'remote-layout-picker-wrap',
        btnId: 'remote-layout-picker-btn',
        popoutId: 'remote-layout-picker-popout',
        shiftVar: '--layout-popout-shift'
    },
    share: {
        wrapId: 'remote-share-picker-wrap',
        btnId: 'remote-share-btn',
        popoutId: 'remote-share-picker-popout',
        shiftVar: '--share-popout-shift'
    },
    travel: {
        wrapId: 'remote-travel-picker-wrap',
        btnId: 'remote-travel-btn',
        popoutId: 'remote-travel-picker-popout',
        shiftVar: '--travel-popout-shift'
    }
};

const POPOUT_INSET_PX = 8;

/** Close one remote popout picker. */
function closePicker(name) {
    const ids = POPOUT_PICKERS[name];
    if (!ids) return;
    const wrap = el(ids.wrapId);
    const btn = el(ids.btnId);
    const popout = el(ids.popoutId);
    wrap?.classList.remove('is-open');
    wrap?.style.removeProperty(ids.shiftVar);
    btn?.setAttribute('aria-expanded', 'false');
    popout?.setAttribute('aria-hidden', 'true');
}

function closeLayoutPicker() {
    closePicker('layout');
}

function closeAllPickers() {
    for (const name of Object.keys(POPOUT_PICKERS)) closePicker(name);
}

/** Shift a centered popout so it stays inside the remote dialog/panel. */
function clampPopout(wrap, popout, shiftVar = '--layout-popout-shift') {
    if (!wrap || !popout) return;
    wrap.style.removeProperty(shiftVar);
    const root = wrap.closest('.remote-module__dialog') || el('remote-panel');
    if (!root) return;

    const rootRect = root.getBoundingClientRect();
    const popRect = popout.getBoundingClientRect();
    const minLeft = rootRect.left + POPOUT_INSET_PX;
    const maxRight = rootRect.right - POPOUT_INSET_PX;
    const innerW = maxRight - minLeft;

    let shift = 0;
    if (popRect.width >= innerW) {
        shift = minLeft - popRect.left;
    } else if (popRect.left < minLeft) {
        shift = minLeft - popRect.left;
    } else if (popRect.right > maxRight) {
        shift = maxRight - popRect.right;
    }

    if (shift !== 0) {
        wrap.style.setProperty(shiftVar, `${Math.round(shift)}px`);
    }
}

export function syncLayoutPicker() {
    const mode = MultiView.getSelectedLayoutMode?.() || 'grid-h';
    const modeIconKey = mode === 'grid-h'
        ? 'gridH'
        : mode === 'grid-v'
            ? 'gridV'
            : mode;
    queryAllInApp('[data-layout-mode]').forEach((btn) => {
        const layoutMode = btn.getAttribute('data-layout-mode');
        const active = layoutMode === mode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
        const iconKey = layoutMode === 'grid-h'
            ? 'gridH'
            : layoutMode === 'grid-v'
                ? 'gridV'
                : layoutMode;
        if (LAYOUT_ICONS[iconKey]) btn.innerHTML = LAYOUT_ICONS[iconKey];
    });
    const pickerBtn = el('remote-layout-picker-btn');
    if (pickerBtn) {
        const activeIcon = LAYOUT_ICONS[modeIconKey] || LAYOUT_ICONS.picker;
        if (activeIcon) pickerBtn.innerHTML = activeIcon;
    }
}

/**
 * Wire one popout picker: the host key toggles the tray, an outside press or
 * Escape dismisses it. Option clicks are wired by the caller (layout modes) or
 * flow through `data-remote-action` into `handleRemoteAction` (share / travel).
 * @param {'layout' | 'share' | 'travel'} name
 * @returns {HTMLElement | null} the wrap, or null when absent/already bound
 */
function bindPicker(name) {
    const ids = POPOUT_PICKERS[name];
    const wrap = el(ids.wrapId);
    const btn = el(ids.btnId);
    if (!wrap || !btn || wrap.dataset.popoutPickerBound === '1') return null;
    wrap.dataset.popoutPickerBound = '1';

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('is-open')) {
            closePicker(name);
            btn.blur();
            return;
        }
        wrap.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        const popout = el(ids.popoutId);
        popout?.setAttribute('aria-hidden', 'false');
        clampPopout(wrap, popout, ids.shiftVar);
    });

    if (typeof window !== 'undefined' && !window.__remotePopoutPickerDismissBound) {
        window.__remotePopoutPickerDismissBound = true;
        document.addEventListener('pointerdown', (e) => {
            for (const [key, picker] of Object.entries(POPOUT_PICKERS)) {
                if (e.target.closest?.(`#${picker.wrapId}`)) continue;
                closePicker(key);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllPickers();
        });
    }

    return wrap;
}

function bindLayoutPicker() {
    const wrap = bindPicker('layout');
    if (!wrap) return;

    wrap.querySelectorAll('[data-layout-mode]').forEach((opt) => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = opt.getAttribute('data-layout-mode');
            if (mode) MultiView.setSelectedLayoutMode(mode);
            closeLayoutPicker();
            syncRemotePanel();
        });
    });
}

function bindSharePicker() {
    bindPicker('share');
}

function bindTravelPicker() {
    bindPicker('travel');
}

async function handleRemoteAction(action) {
    const slotId = MultiView.statusSlotId || 'center';
    try {
        if (typeof action === 'string' && action.startsWith('digit-')) {
            const digit = action.slice('digit-'.length);
            if (/^\d$/.test(digit)) appendDigit(digit);
            return;
        }

        switch (action) {
        case 'share-copy-stream': {
            closePicker('share');
            const channel = focusedChannel();
            if (channel) copyShareText(buildStreamLink(channel), 'Stream link copied');
            break;
        }
        case 'share-copy-magictv': {
            closePicker('share');
            const channel = focusedChannel();
            if (channel) {
                const link = buildDeepLink(channel);
                if (link) copyShareText(link, 'magicTV link copied');
            }
            break;
        }
        // TV Travel rotates the whole ring (MultiView global), never one slot.
        // Re-picking the running style stops it inside startTvTravel(); the
        // explicit "Off" key stays as the obvious way out.
        case 'tv-travel-off': {
            closePicker('travel');
            MultiView.stopTvTravel?.();
            break;
        }
        case 'tv-travel-quick':
        case 'tv-travel-slow':
        case 'tv-travel-random': {
            closePicker('travel');
            MultiView.startTvTravel?.(action.slice('tv-travel-'.length));
            break;
        }
        case 'vol-up': {
            const player = MultiView.slots?.[slotId]?.player
                || (slotId === 'center' ? MultiView.getPrimary?.() : null);
            if (player?.channel) {
                MultiView.setSlotVolume(slotId, (player.volume ?? 1) + 0.05);
            }
            break;
        }
        case 'vol-down': {
            const player = MultiView.slots?.[slotId]?.player
                || (slotId === 'center' ? MultiView.getPrimary?.() : null);
            if (player?.channel) {
                MultiView.setSlotVolume(slotId, (player.volume ?? 1) - 0.05);
            }
            break;
        }
        case 'power-off': {
            // Chrome only allows window.close() for script-opened windows (e.g. remote
            // OS popout). On a normal user tab it no-ops with no prompt — so always
            // play shutdown animation, power down playback, then close when allowed.
            if (powerOffBusy || isShutdownTransitionBusy()) break;
            powerOffBusy = true;
            try {
                const mode = resolveViewTransition(
                    SettingsStore.getShutdownTransition(),
                    'shutdown'
                );
                await runShutdownTransition(mode);
            } catch {
                /* best-effort animation */
            }
            try {
                await MultiView.handleTileAction('center', 'stop-all');
            } catch {
                /* best-effort shutdown */
            }
            const win = typeof window !== 'undefined' ? window : null;
            try {
                win?.close?.();
            } catch {
                /* ignore */
            }
            if (win && !win.closed) {
                const { showAppToast } = await import('./toast.js');
                showAppToast('Close this tab to power off');
            }
            break;
        }
        case 'chan-up':
            clearDigitBuffer({ restoreBar: false });
            await navigateChannel(slotId, 'up');
            break;
        case 'chan-down':
            clearDigitBuffer({ restoreBar: false });
            await navigateChannel(slotId, 'down');
            break;
        case 'chan-bind-toggle':
            break;
        case 'guide-toggle': {
            GuidePanel.toggle();
            break;
        }
        case 'radio-toggle': {
            const { RadioModule } = await import('./radioModule.js');
            RadioModule.toggle();
            break;
        }
        case 'rotate': {
            await MultiView.rotateScreens();
            break;
        }
        default:
            await MultiView.handleTileAction(
                action === 'mute-all' || action === 'stop-all' || action === 'play-all' ? 'center' : slotId,
                action
            );
        }
    } finally {
        syncRemotePanel();
        syncRemoteChannelBar();
    }
}

export function syncRemotePanel() {
    const slotId = MultiView.statusSlotId || 'center';
    const player = MultiView.slots?.[slotId]?.player
        || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    const intentPlaying = player?.wantPlaying === true || player?.playing === true;

    const playBtn = el('remote-play-btn');
    if (playBtn) {
        playBtn.innerHTML = intentPlaying ? ACTION_ICONS.pause : ACTION_ICONS.play;
        playBtn.title = intentPlaying ? 'Pause' : 'Play';
        playBtn.setAttribute('aria-label', playBtn.title);
    }

    const muteBtn = el('remote-mute-btn');
    if (muteBtn && player) {
        const audible = MultiView.isSlotAudible?.(player) ?? !player.muted;
        muteBtn.classList.toggle('is-muted', !audible);
        muteBtn.setAttribute('aria-pressed', String(!audible));
        muteBtn.title = audible ? 'Mute' : 'Unmute';
        muteBtn.setAttribute('aria-label', muteBtn.title);
        const wave = muteBtn.querySelector('.tile-mute-wave, .remote-mute-wave');
        const slash = muteBtn.querySelector('.tile-mute-slash, .remote-mute-slash');
        if (wave) wave.style.opacity = audible ? '1' : '0';
        if (slash) slash.style.opacity = audible ? '0' : '1';
    }

    // Share key hides as a whole (cell stays) so the chrome row never reflows.
    const showShare = Boolean(player?.channel);
    queryAllInApp('.remote-share-btn').forEach((wrap) => {
        wrap.classList.toggle('is-hidden', !showShare);
        if (showShare) return;
        // Drop a stale open tray so it cannot reappear with the next channel.
        wrap.classList.remove('is-open');
        wrap.querySelector('.remote-panel__share-popout')?.setAttribute('aria-hidden', 'true');
        wrap.querySelector('button[aria-expanded]')?.setAttribute('aria-expanded', 'false');
    });

    const favBtn = el('remote-fav-btn');
    if (favBtn) {
        if (player?.channel) {
            const isFav = FavoritesRecents.isFavorite(player.channel);
            favBtn.classList.toggle('is-active', isFav);
            favBtn.innerHTML = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
            favBtn.setAttribute('aria-pressed', String(isFav));
            favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        } else {
            favBtn.classList.remove('is-active');
            favBtn.innerHTML = CARD_ICONS.star;
            favBtn.setAttribute('aria-pressed', 'false');
            favBtn.title = 'Add to favorites';
        }
        favBtn.setAttribute('aria-label', favBtn.title);
    }

    // "All" keys: full-remote mosaic keys + mini hover fly-outs share one sync.
    syncMuteAllKeys(MultiView.isMuteAllActive?.() ?? false);

    const anyPlaying = MultiView.isAnyPlaying?.() ?? false;
    const allPlaying = MultiView.isAllPlaying?.() ?? false;

    // Play all morphs to Pause all while everything plays.
    syncPlayAllKeys(allPlaying);
    syncStopAllKeys(anyPlaying);

    // Rotate TVs / TV Travel — only meaningful (and visible) with 2+ screens.
    const tvCount = MultiView.getRotationRing?.().length
        ?? Object.values(MultiView.slots || {}).filter((slot) => slot?.enabled).length;
    const multiTv = tvCount > 1;

    const rotateBtn = el('remote-rotate-btn');
    rotateBtn?.classList.toggle('is-hidden', !multiTv);

    syncTvTravelPicker(multiTv);

    const guideBtn = el('remote-guide-toggle');
    if (guideBtn) {
        const visible = GuidePanel.isVisible();
        guideBtn.innerHTML = visible ? ACTION_ICONS.guideShow : ACTION_ICONS.guideHide;
        guideBtn.classList.toggle('is-active', visible);
        guideBtn.setAttribute('aria-pressed', String(visible));
        guideBtn.title = visible ? 'Hide TV guide' : 'Show TV guide';
        guideBtn.setAttribute('aria-label', guideBtn.title);
    }

    syncVolumeDial();
    ChanBindPicker.syncBindButtons();
    syncLayoutPicker();
}

function bindRemoteActions(root, { forceTvCatalog = false } = {}) {
    root?.querySelectorAll('[data-remote-nav]').forEach((btn) => {
        if (btn.dataset.navBound === '1') return;
        btn.dataset.navBound = '1';
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-remote-nav');
            if (!tab) return;
            // Mini-floating nav keys expand back to the full remote first — the
            // compact dialog cannot present a catalog.
            deps.getRemoteModule?.()?.exitMiniFloating?.();
            // Remote keypad / remote-shell: always open TV catalog for browser tabs.
            if (forceTvCatalog && isBrowserCatalogTab(tab) && typeof deps.openTvCatalog === 'function') {
                deps.openTvCatalog({ tab });
                return;
            }
            deps.switchTab(tab);
        });
    });

    root?.querySelectorAll('[data-remote-action]').forEach((btn) => {
        if (btn.dataset.actionBound === '1') return;
        btn.dataset.actionBound = '1';
        btn.addEventListener('click', (e) => {
            const action = btn.getAttribute('data-remote-action');
            if (action === 'chan-bind-toggle') {
                e.stopPropagation();
                return;
            }
            if (action) handleRemoteAction(action);
        });
    });
}

/**
 * TV Travel now lives on the remote (tile chrome no longer carries it). It is a
 * ring-wide mode — every screen rotates — so the key only makes sense with 2+
 * screens, and a running travel must stop when the ring shrinks back to one.
 * @param {boolean} multiTv
 */
function syncTvTravelPicker(multiTv) {
    const wrap = el('remote-travel-picker-wrap');
    const btn = el('remote-travel-btn');
    const style = MultiView.getTvTravelStyle?.() || null;
    let active = MultiView.isTvTravelActive?.() === true;

    if (!multiTv && active) {
        MultiView.stopTvTravel?.();
        active = false;
    }
    wrap?.classList.toggle('is-hidden', !multiTv);
    if (!multiTv) closePicker('travel');

    if (btn) {
        const label = active && style ? `TV Travel (${style})` : 'TV Travel';
        btn.classList.toggle('is-active', active);
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }

    el('remote-travel-picker-popout')
        ?.querySelectorAll('[data-remote-action^="tv-travel-"]')
        .forEach((opt) => {
            const key = (opt.getAttribute('data-remote-action') || '').slice('tv-travel-'.length);
            const on = key === 'off' ? !active : (active && key === style);
            opt.classList.toggle('is-active', on);
            opt.setAttribute('aria-pressed', String(on));
        });
}

export const RemotePanel = {
    init({ switchTab, openTvCatalog, getRemoteModule } = {}) {
        if (typeof switchTab === 'function') deps.switchTab = switchTab;
        if (typeof openTvCatalog === 'function') deps.openTvCatalog = openTvCatalog;
        if (typeof getRemoteModule === 'function') deps.getRemoteModule = getRemoteModule;
        if (typeof window !== 'undefined' && !window.__remoteGuideVisBound) {
            window.__remoteGuideVisBound = true;
            window.addEventListener('guide:visibility_changed', () => syncRemotePanel());
        }
    },

    bind() {
        const remote = el('remote-shell') || el('tv-catalog-body');
        if (remote && remote.dataset.remoteBound !== '1') {
            remote.dataset.remoteBound = '1';
            bindRemoteActions(remote, { forceTvCatalog: true });
        }
        const browser = el('browser-shell');
        if (browser && browser.dataset.remoteBound !== '1') {
            browser.dataset.remoteBound = '1';
            // Browser-shell nav stays sticky (radio session keeps radio).
            bindRemoteActions(browser, { forceTvCatalog: false });
        }
        bindLayoutPicker();
        bindSharePicker();
        bindTravelPicker();
        syncRemotePanel();
    },

    syncRemotePanel,
    syncRemoteChannelBar,
    syncLayoutPicker,
    handleRemoteAction
};
