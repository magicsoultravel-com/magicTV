/** Remote control panel — default view inside the remote module. */
import { countryFlagEmoji, el, queryAllInApp } from '../tvUtils.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import { GuidePanel } from './guidePanel.js';
import { isSplit } from './moduleLayout.js';
import { syncVolumeDial } from './volumeDial.js';
import { PLAY_ALL_SVG, PAUSE_ALL_SVG } from './tileHoverControls.js';
import { buildStreamLink, buildDeepLink, copyShareText } from '../share/shareChannel.js';

let deps = {
    switchTab: () => {},
    getRemoteModule: () => null
};

const REMOTE_KEYPAD_NAV_TABS = new Set(['remote', 'browse', 'favorites', 'recents', 'settings']);

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
    const volumeCell = grid.querySelector('.remote-panel__cell--volume');
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

    // Keep browser-related icons at end of remote keypad (before volume), never at start.
    if (volumeCell) {
        if (navGroup.parentElement !== grid || navGroup.nextElementSibling !== volumeCell) {
            grid.insertBefore(navGroup, volumeCell);
        }
    } else if (navGroup.parentElement !== grid) {
        grid.appendChild(navGroup);
    }

    if (browserNav) {
        browserNav.classList.toggle('is-hidden', !split);
        browserNav.setAttribute('aria-hidden', String(!split));
    }
}

export function syncRemoteChannelBar(_tabName) {
    const bar = el('remote-channel-bar');
    const nameEl = el('remote-channel-name');
    const flagEl = el('remote-channel-flag');
    const slotId = MultiView.statusSlotId || 'center';
    // Use the focused slot only — do not fall back to center's channel (would mislabel TV N).
    const slot = MultiView.slots?.[slotId];
    const player = slot?.player || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    const channel = player?.channel;
    const name = (channel?.name || '').trim();
    const country = channel?.countrycode || '';
    const show = Boolean(name);
    const tvLabel = SLOT_SCREEN_LABELS[slotId] || '1';

    if (bar) bar.classList.toggle('is-hidden', !show);
    if (nameEl) nameEl.textContent = show ? `TV ${tvLabel} · ${name}` : '';
    if (flagEl) flagEl.textContent = show && country ? countryFlagEmoji(country) : '';
}

function focusedChannel() {
    const slotId = MultiView.statusSlotId || 'center';
    const player = MultiView.slots?.[slotId]?.player
        || (slotId === 'center' ? MultiView.getPrimary?.() : null);
    return player?.channel || null;
}

async function handleRemoteAction(action) {
    const slotId = MultiView.statusSlotId || 'center';
    switch (action) {
        case 'share-copy-stream': {
            const channel = focusedChannel();
            if (channel) copyShareText(buildStreamLink(channel), 'Stream link copied');
            break;
        }
        case 'share-copy-magictv': {
            const channel = focusedChannel();
            if (channel) {
                const link = buildDeepLink(channel);
                if (link) copyShareText(link, 'magicTV link copied');
            }
            break;
        }
        case 'vol-up':
            MultiView.setSharedVolume((MultiView.sharedVolume ?? TvPlayer.volume ?? 0.85) + 0.05);
            break;
        case 'vol-down':
            MultiView.setSharedVolume((MultiView.sharedVolume ?? TvPlayer.volume ?? 0.85) - 0.05);
            break;
        case 'dock-toggle': {
            const mod = deps.getRemoteModule?.();
            if (!mod) break;
            if (mod.getMode?.() === 'undocked') mod.dock?.();
            else mod.undock?.();
            break;
        }
        case 'collapse-toggle': {
            const mod = deps.getRemoteModule?.();
            mod?.hide?.() ?? mod?.close?.();
            break;
        }
        case 'guide-toggle': {
            GuidePanel.toggle();
            break;
        }
        default:
            await MultiView.handleTileAction(
                action === 'reset' || action === 'mute-all' || action === 'stop-all' || action === 'play-all' ? 'center' : slotId,
                action
            );
    }
    syncRemotePanel();
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

    queryAllInApp('.remote-share-btn').forEach((btn) => {
        const show = Boolean(player?.channel);
        btn.classList.toggle('is-hidden', !show);
        const cell = btn.closest('.remote-panel__cell');
        if (cell) cell.classList.toggle('is-hidden', !show);
    });

    const muteAllActive = MultiView.isMuteAllActive?.() ?? false;
    const muteAllBtn = el('remote-mute-all-btn');
    if (muteAllBtn) {
        const label = muteAllActive ? 'Unmute all' : 'Mute all';
        muteAllBtn.title = label;
        muteAllBtn.setAttribute('aria-label', label);
        muteAllBtn.setAttribute('aria-pressed', String(muteAllActive));
        const wave = muteAllBtn.querySelector('.mosaic-mute-all-wave, .remote-mute-all-wave');
        const slash = muteAllBtn.querySelector('.mosaic-mute-all-slash, .remote-mute-all-slash');
        if (wave) wave.style.opacity = muteAllActive ? '0' : '1';
        if (slash) slash.setAttribute('opacity', muteAllActive ? '1' : '0');
    }

    const anyPlaying = MultiView.isAnyPlaying?.() ?? false;
    const allPlaying = MultiView.isAllPlaying?.() ?? false;

    const playAllBtn = el('remote-play-all-btn');
    if (playAllBtn) {
        const isPause = allPlaying;
        const label = isPause ? 'Pause all' : 'Play all';
        playAllBtn.title = label;
        playAllBtn.setAttribute('aria-label', label);
        playAllBtn.setAttribute('aria-pressed', String(isPause));
        playAllBtn.innerHTML = isPause ? PAUSE_ALL_SVG : PLAY_ALL_SVG;
    }

    const stopAllBtn = el('remote-stop-all-btn');
    if (stopAllBtn) {
        const label = 'Stop all';
        stopAllBtn.title = label;
        stopAllBtn.setAttribute('aria-label', label);
        stopAllBtn.classList.toggle('is-hidden', !anyPlaying);
        stopAllBtn.setAttribute('aria-disabled', String(!anyPlaying));
        stopAllBtn.setAttribute('aria-pressed', String(anyPlaying));
        const stopCell = typeof stopAllBtn.closest === 'function' ? stopAllBtn.closest('.remote-panel__cell') : null;
        if (stopCell) stopCell.classList.toggle('is-hidden', !anyPlaying);
    }

    const mod = deps.getRemoteModule?.();
    const dockBtn = el('remote-dock-toggle');
    if (dockBtn && mod) {
        const undocked = mod.getMode?.() === 'undocked';
        dockBtn.innerHTML = undocked ? ACTION_ICONS.dock : ACTION_ICONS.undock;
        dockBtn.title = undocked ? 'Dock remote' : 'Undock remote';
        dockBtn.setAttribute('aria-label', dockBtn.title);
    }

    const collapseBtn = el('remote-collapse-btn');
    if (collapseBtn && mod) {
        collapseBtn.innerHTML = ACTION_ICONS.collapse;
        const unhidden = mod.getMode?.() !== 'hidden';
        collapseBtn.classList.toggle('is-module-unhidden', unhidden);
        collapseBtn.title = unhidden ? 'Hide remote' : 'Show remote';
        collapseBtn.setAttribute('aria-label', collapseBtn.title);
    }

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
}

function bindRemoteActions(root) {
    root?.querySelectorAll('[data-remote-nav]').forEach((btn) => {
        if (btn.dataset.navBound === '1') return;
        btn.dataset.navBound = '1';
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-remote-nav');
            if (tab) deps.switchTab(tab);
        });
    });

    root?.querySelectorAll('[data-remote-action]').forEach((btn) => {
        if (btn.dataset.actionBound === '1') return;
        btn.dataset.actionBound = '1';
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-remote-action');
            if (action) handleRemoteAction(action);
        });
    });
}

export const RemotePanel = {
    init({ switchTab, getRemoteModule } = {}) {
        if (typeof switchTab === 'function') deps.switchTab = switchTab;
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
            bindRemoteActions(remote);
        }
        const browser = el('browser-shell');
        if (browser && browser.dataset.remoteBound !== '1') {
            browser.dataset.remoteBound = '1';
            bindRemoteActions(browser);
        }
        syncRemotePanel();
    },

    syncRemotePanel,
    syncRemoteChannelBar,
    handleRemoteAction
};
