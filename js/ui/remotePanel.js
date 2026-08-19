/** Remote control panel — default view inside the remote module. */
import { el, queryAllInApp } from '../tvUtils.js';
import { MultiView } from '../multiView.js';
import { TvPlayer } from '../tvPlayer.js';
import { ACTION_ICONS, NAV_ICONS, CARD_ICONS } from './icons.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';
import {
    MUTE_SVG,
    CAST_SVG,
    RESET_SVG,
    MUTE_ALL_SVG,
    VOL_DOWN_SVG,
    VOL_UP_SVG
} from './tileHoverControls.js';

const REMOTE_ICON = '<svg class="ui-icon" viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><rect x="1.5" y="2" width="9" height="7" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="5.5" r="0.8" fill="currentColor"/><circle cx="8" cy="5.5" r="0.8" fill="currentColor"/><circle cx="6" cy="7.5" r="0.8" fill="currentColor"/></svg>';

let deps = {
    switchTab: () => {},
    getRemoteModule: () => null
};

function remoteBtn(action, label, content, extraClass = '') {
    const cls = `tv-controls__btn remote-panel__btn ${extraClass}`.trim();
    return `<button type="button" class="${cls}" data-remote-action="${action}" title="${label}" aria-label="${label}">${content}</button>`;
}

function placeholderBtn(label, content, accentClass = 'tv-controls__btn--main-1') {
    return `<button type="button" class="tv-controls__btn remote-panel__btn remote-panel__btn--placeholder ${accentClass}" disabled aria-disabled="true" title="${label}" aria-label="${label}">${content}</button>`;
}

function navBtn(tab, label, icon, accentClass) {
    return `<button type="button" class="ui-icon-btn remote-panel__nav-btn ${accentClass}" data-remote-nav="${tab}" title="${label}" aria-label="${label}">${icon}</button>`;
}

export function buildRemoteChromeHtml() {
    return `<header class="remote-module__chrome">
        <h2 class="remote-module__brand">magic remote</h2>
        <div id="remote-channel-bar" class="remote-module__channel-bar is-hidden">
            <span id="remote-channel-name" class="tv-header-now-playing"></span>
        </div>
    </header>`;
}

export function buildRemoteFooterHtml() {
    return `<footer id="remote-panel-footer" class="remote-module__footer-panel">
        <div class="remote-panel__footer-nav remote-panel__cell--nav">
            ${navBtn('remote', 'Remote', REMOTE_ICON, 'tv-controls__btn--main-2')}
            ${navBtn('browse', 'Browse', NAV_ICONS.globe, 'tv-controls__btn--main-1')}
            ${navBtn('favorites', 'Favorites', NAV_ICONS.heart, 'tv-controls__btn--main-3')}
            ${navBtn('recents', 'Recents', NAV_ICONS.tv, 'tv-controls__btn--main-2')}
            ${navBtn('settings', 'Settings', NAV_ICONS.tools, 'tv-controls__btn--main-1')}
        </div>
        <div class="remote-panel__footer-screens remote-panel__cell--screens">
            <div class="remote-panel__screens tv-controls__screens">
                <button type="button" class="tv-controls__screen-btn is-active" data-screen-slot="center" aria-label="TV 1 main screen" title="TV 1 main screen">
                    <span class="tv-controls__screen-frame" aria-hidden="true"></span>
                    <span class="tv-controls__screen-label" aria-hidden="true">1</span>
                </button>
                <button type="button" class="tv-controls__screen-btn" data-screen-slot="topLeft" aria-label="TV 2 top left" title="TV 2 top left" hidden>
                    <span class="tv-controls__screen-frame" aria-hidden="true"></span>
                    <span class="tv-controls__screen-label" aria-hidden="true">2</span>
                    <span class="tv-controls__screen-remove" aria-label="Remove TV 2" title="Remove TV 2">×</span>
                </button>
                <button type="button" class="tv-controls__screen-btn" data-screen-slot="topRight" aria-label="TV 3 top right" title="TV 3 top right" hidden>
                    <span class="tv-controls__screen-frame" aria-hidden="true"></span>
                    <span class="tv-controls__screen-label" aria-hidden="true">3</span>
                    <span class="tv-controls__screen-remove" aria-label="Remove TV 3" title="Remove TV 3">×</span>
                </button>
                <button type="button" class="tv-controls__screen-btn" data-screen-slot="bottomLeft" aria-label="TV 4 bottom left" title="TV 4 bottom left" hidden>
                    <span class="tv-controls__screen-frame" aria-hidden="true"></span>
                    <span class="tv-controls__screen-label" aria-hidden="true">4</span>
                    <span class="tv-controls__screen-remove" aria-label="Remove TV 4" title="Remove TV 4">×</span>
                </button>
                <button type="button" class="tv-controls__screen-btn" data-screen-slot="bottomRight" aria-label="TV 5 bottom right" title="TV 5 bottom right" hidden>
                    <span class="tv-controls__screen-frame" aria-hidden="true"></span>
                    <span class="tv-controls__screen-label" aria-hidden="true">5</span>
                    <span class="tv-controls__screen-remove" aria-label="Remove TV 5" title="Remove TV 5">×</span>
                </button>
                <button type="button" class="tv-controls__add-screen-btn" id="add-screen-btn" aria-label="Add screen" title="Add screen">+</button>
            </div>
        </div>
    </footer>`;
}

export function buildRemotePanelHtml() {
    const digitsMain1 = ['1', '2', '3', '4', '5'].map((d) =>
        placeholderBtn(`Channel ${d}`, d, 'tv-controls__btn--main-1')
    );
    const digitsMain2 = ['6', '7', '8', '9', '0'].map((d) =>
        placeholderBtn(`Channel ${d}`, d, 'tv-controls__btn--main-2')
    );

    return `<div id="remote-panel" class="tv-panel remote-panel is-active">
        <div class="remote-panel__grid">
            <div class="remote-panel__cell">${digitsMain1[0]}</div>
            <div class="remote-panel__cell">${digitsMain1[1]}</div>
            <div class="remote-panel__cell">${digitsMain1[2]}</div>
            <div class="remote-panel__cell">${digitsMain1[3]}</div>
            <div class="remote-panel__cell">${digitsMain1[4]}</div>
            <div class="remote-panel__cell">${digitsMain2[0]}</div>
            <div class="remote-panel__cell">${digitsMain2[1]}</div>
            <div class="remote-panel__cell">${digitsMain2[2]}</div>
            <div class="remote-panel__cell">${digitsMain2[3]}</div>
            <div class="remote-panel__cell">${digitsMain2[4]}</div>
            <div class="remote-panel__cell">${placeholderBtn('Channel up', ACTION_ICONS.sortUp, 'tv-controls__btn--main-3')}</div>
            <div class="remote-panel__cell">${placeholderBtn('Channel down', ACTION_ICONS.sortDown, 'tv-controls__btn--main-3')}</div>

            <div class="remote-panel__cell">${remoteBtn('vol-down', 'Volume down', VOL_DOWN_SVG, 'tv-controls__btn--main-1')}</div>
            <div class="remote-panel__cell">${remoteBtn('vol-up', 'Volume up', VOL_UP_SVG, 'tv-controls__btn--main-1')}</div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-controls__volume-btn remote-panel__btn is-muted" id="remote-mute-btn" data-remote-action="mute" title="Unmute" aria-label="Mute or unmute" aria-pressed="true">${MUTE_SVG}</button>
            </div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-1 remote-panel__btn" id="remote-play-btn" data-remote-action="play" title="Play" aria-label="Play">${ACTION_ICONS.play}</button>
            </div>
            <div class="remote-panel__cell">${remoteBtn('stop', 'Stop', ACTION_ICONS.stop, 'tv-controls__btn--main-1')}</div>

            <div class="remote-panel__cell">${remoteBtn('fullscreen', 'Fullscreen', ACTION_ICONS.fullscreenEnter, 'tv-controls__btn--main-2')}</div>
            <div class="remote-panel__cell">${remoteBtn('pip', 'Pop out', ACTION_ICONS.pictureInPicture, 'tv-controls__btn--main-2')}</div>
            <div class="remote-panel__cell">${remoteBtn('cast', 'Cast', CAST_SVG, 'tv-controls__btn--main-2')}</div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-3 tv-controls__fav-btn remote-panel__btn" id="remote-fav-btn" data-remote-action="fav" title="Add to favorites" aria-label="Toggle favorite" aria-pressed="false">${CARD_ICONS.star}</button>
            </div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-1 remote-panel__btn" id="remote-mute-all-btn" data-remote-action="mute-all" title="Mute all" aria-label="Mute all">${MUTE_ALL_SVG}</button>
            </div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-1 remote-panel__btn is-hidden" id="remote-reset-btn" data-remote-action="reset" title="Reset multi-TV layout" aria-label="Reset multi-TV layout">${RESET_SVG}</button>
            </div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-2 remote-panel__btn" id="remote-collapse-btn" data-remote-action="collapse-toggle" title="Collapse remote" aria-label="Collapse remote">${ACTION_ICONS.collapse}</button>
            </div>
            <div class="remote-panel__cell">
                <button type="button" class="tv-controls__btn tv-controls__btn--main-2 remote-panel__btn" id="remote-dock-toggle" data-remote-action="dock-toggle" title="Undock remote" aria-label="Undock remote">${ACTION_ICONS.expand}</button>
            </div>

            <div class="remote-panel__cell remote-panel__cell--slider">
                <div class="tv-controls__volume remote-panel__volume">
                    <span class="tv-controls__volume-pct" id="volume-pct">85%</span>
                    <input type="range" class="tv-controls__volume-slider" id="volume-slider" min="0" max="100" value="85">
                </div>
            </div>
        </div>
    </div>`;
}

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
