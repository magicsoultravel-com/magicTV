/** @module Visited channels browser inside settings — mirror of hiddenChannelsSettings. */
import { TvPlayer } from '../tvPlayer.js';
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';
import { Appearance } from './appearance.js';
import { ChannelGrid } from './channelGrid.js';

let deps = {
    appState: null,
    onPlay: () => {}
};

let selectedCountry = null;
let bound = false;

function metaToChannel(entry) {
    const parsed = parseChannelKey(entry.key);
    return {
        providerId: parsed?.providerId,
        channelId: parsed?.channelId,
        channeluuid: entry.key,
        name: entry.name || '',
        logo: entry.logo || '',
        countrycode: entry.countrycode || '',
        url_resolved: '',
        categories: []
    };
}

function countryName(code) {
    const countries = deps.appState?.countries || [];
    const match = countries.find((c) => c.iso_3166_1 === code);
    return match?.name || code || 'Unknown';
}

function groupByCountry(meta) {
    const groups = new Map();
    for (const entry of meta) {
        const code = entry.countrycode || '';
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push(entry);
    }
    return [...groups.entries()]
        .map(([code, entries]) => ({ code, entries, count: entries.length }))
        .sort((a, b) => countryName(a.code).localeCompare(countryName(b.code)));
}
function visitedSettingsTileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const unvisitLabel = 'Remove from visited';
    return `
        <div class="channel-tile is-visited" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-url="${escapeHtml(ch.url_resolved || '')}" data-logo="${escapeHtml(ch.logo || '')}">
            <button type="button" class="channel-tile__unvisit-btn" title="${unvisitLabel}" aria-label="${unvisitLabel}">${CARD_ICONS.tileUnvisited}</button>
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame-state="idle">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img${ch.logo ? '' : ' is-hidden'}" src="${escapeHtml(ch.logo || '')}" alt="" decoding="async">
                </div>
            </div>
            <div class="channel-tile__body">
                <h3 class="channel-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(ch.name || 'Unknown')}</span></span></h3>
                <span class="channel-tile__flag">${countryFlagEmoji(ch.countrycode)}</span>
            </div>
        </div>
    `;
}

function wireTiles(container, channels) {
    if (!container) return;
    container.querySelectorAll('.channel-tile').forEach((tile) => {
        const key = tile.dataset.channel;
        const ch = channels.find((c) => channelKey(c) === key);
        if (!ch) return;
        const play = () => deps.onPlay(ch);
        tile.addEventListener('click', play);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
        });
        const btn = tile.querySelector('.channel-tile__unvisit-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (TvPlayer.unvisitChannel(ch)) {
                showAppToast('Removed from visited');
                ChannelGrid.syncVisitedTiles();
                VisitedChannelsSettings.refresh();
            }
        });
        btn.addEventListener('keydown', (e) => e.stopPropagation());
    });
}

function updateSummaryCount() {
    const summary = el('visited-channels-summary-count');
    if (!summary) return;
    const count = TvPlayer.getVisitedMeta().length;
    summary.textContent = count ? `(${count})` : '';
}
export const VisitedChannelsSettings = {
    init({ appState, onPlay }) {
        deps = { appState, onPlay: typeof onPlay === 'function' ? onPlay : () => {} };
    },

    bind() {
        if (bound) return;
        bound = true;
        const backBtn = el('visited-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.showCountries());
        }
        const section = el('visited-channels-section');
        if (section) {
            section.addEventListener('toggle', () => {
                if (section.open) this.refresh();
            });
        }
    },

    showCountries() {
        selectedCountry = null;
        const countries = el('visited-countries-container');
        const channels = el('visited-channels-container');
        const backBtn = el('visited-back-btn');
        if (countries) countries.classList.remove('is-hidden');
        if (channels) channels.classList.add('is-hidden');
        if (backBtn) backBtn.classList.add('is-hidden');
        this.renderCountries();
    },

    renderCountries() {
        const container = el('visited-countries-container');
        if (!container) return;
        updateSummaryCount();
        const meta = TvPlayer.getVisitedMeta();
        if (!meta.length) {
            container.innerHTML = '<div class="empty-state"><p class="empty-state__text">No visited channels</p></div>';
            return;
        }
        const groups = groupByCountry(meta);
        container.innerHTML = groups.map(({ code, count }) => `
            <div class="country-tile" data-country="${escapeHtml(code)}" role="button" tabindex="0">
                <div class="country-tile__icon">${countryFlagEmoji(code)}</div>
                <div class="country-tile__body">
                    <h3 class="country-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(countryName(code))}</span></span></h3>
                    <div class="country-tile__count">${count} visited</div>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.country-tile').forEach((tile) => {
            const open = () => this.showChannels(tile.dataset.country);
            tile.addEventListener('click', open);
            tile.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });
        Appearance.applyToTiles(container);
    },

    showChannels(countryCode) {
        selectedCountry = countryCode;
        const countries = el('visited-countries-container');
        const channelsEl = el('visited-channels-container');
        const backBtn = el('visited-back-btn');
        if (countries) countries.classList.add('is-hidden');
        if (channelsEl) channelsEl.classList.remove('is-hidden');
        if (backBtn) backBtn.classList.remove('is-hidden');
        this.renderChannels();
    },

    renderChannels() {
        const container = el('visited-channels-container');
        if (!container) return;
        const meta = TvPlayer.getVisitedMeta().filter((e) => (e.countrycode || '') === (selectedCountry || ''));
        if (!meta.length) {
            container.innerHTML = '<div class="empty-state"><p class="empty-state__text">No visited channels</p></div>';
            return;
        }
        const channels = meta.map(metaToChannel);
        container.innerHTML = channels.map((ch) => visitedSettingsTileHtml(ch)).join('');
        wireTiles(container, channels);
        Appearance.applyToTiles(container);
    },

    refresh() {
        updateSummaryCount();
        if (selectedCountry) {
            this.renderChannels();
        } else {
            this.renderCountries();
        }
    }
};
