/** Remote control panel — default view inside the remote module. */
import { el, queryAllInApp } from '../tvUtils.js';
import { MultiView } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';

let deps = {
    switchTab: () => {},
    getRemoteModule: () => null
};

export function syncRemoteNav(tabName) {
    queryAllInApp('#tv-catalog-body [data-remote-nav]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-remote-nav') === tabName);
    });
}

export function syncRemoteChannelBar(tabName) {
    const bar = el('remote-channel-bar');
    const nameEl = el('remote-channel-name');
    const show = tabName === 'browse' || tabName === 'favorites' || tabName === 'recents';
    if (bar) bar.classList.toggle('is-hidden', !show);

    const player = MultiView.getStatusPlayer?.() || MultiView.getPrimary?.();
    const channel = player?.channel;
    const name = channel?.name || TvPlayer.channel?.name || '';

    if (!show || !name) {
        if (nameEl) nameEl.textContent = '';
        if (bar && !show) bar.classList.add('is-hidden');
        return;
    }

    if (nameEl) nameEl.textContent = name;
}

async function handleRemoteAction(action) {
    const slotId = MultiView.statusSlotId || 'center';
    switch (action) {
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
            mod?.close?.();
            break;
        }
        default:
            await MultiView.handleTileAction(
                action === 'reset' || action === 'mute-all' ? 'center' : slotId,
                action
            );
    }
    syncRemotePanel();
}

export function syncRemotePanel() {
    const slotId = MultiView.statusSlotId || 'center';
    const player = MultiView.getStatusPlayer?.() || MultiView.slots?.[slotId]?.player;
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

    const resetBtn = el('remote-reset-btn');
    if (resetBtn) {
        const custom = MultiView.hasCustomPlacement?.() ?? false;
        resetBtn.classList.toggle('is-hidden', !custom);
        resetBtn.hidden = !custom;
    }

    const mod = deps.getRemoteModule?.();
    const dockBtn = el('remote-dock-toggle');
    if (dockBtn && mod) {
        const undocked = mod.getMode?.() === 'undocked';
        dockBtn.innerHTML = undocked ? ACTION_ICONS.collapse : ACTION_ICONS.expand;
        dockBtn.title = undocked ? 'Dock remote' : 'Undock remote';
        dockBtn.setAttribute('aria-label', dockBtn.title);
    }

    const collapseBtn = el('remote-collapse-btn');
    if (collapseBtn && mod) {
        collapseBtn.innerHTML = ACTION_ICONS.collapse;
        collapseBtn.title = 'Hide remote';
        collapseBtn.setAttribute('aria-label', collapseBtn.title);
    }
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
    },

    bind() {
        const body = el('tv-catalog-body');
        if (!body || body.dataset.remoteBound === '1') return;
        body.dataset.remoteBound = '1';
        bindRemoteActions(body);
        syncRemotePanel();
    },

    syncRemotePanel,
    syncRemoteChannelBar,
    handleRemoteAction
};
