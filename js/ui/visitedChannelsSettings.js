/** @module Visited channels browser inside settings. */
import { TvPlayer } from '../tvPlayer.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml } from '../tvUtils.js';
import { CARD_ICONS } from './icons.js';
import { ChannelGrid } from './channelGrid.js';
import { createSettingsListBrowser } from './settingsListBrowser.js';

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

export const VisitedChannelsSettings = createSettingsListBrowser({
    sectionId: 'visited-channels-section',
    backBtnId: 'visited-back-btn',
    countriesId: 'visited-countries-container',
    channelsId: 'visited-channels-container',
    summaryCountId: 'visited-channels-summary-count',
    getMeta: () => TvPlayer.getVisitedMeta(),
    emptyLabel: 'visited',
    tileHtml: visitedSettingsTileHtml,
    actionBtnSelector: '.channel-tile__unvisit-btn',
    onRemove: (ch) => TvPlayer.unvisitChannel(ch),
    removeToast: 'Removed from visited',
    afterRemove: () => ChannelGrid.syncVisitedTiles()
});
