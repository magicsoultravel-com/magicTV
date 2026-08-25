import { TvPlayer } from '../tvPlayer.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml } from '../tvUtils.js';
import { CARD_ICONS } from './icons.js';
import { ChannelGrid } from './channelGrid.js';
import { createSettingsListBrowser } from './settingsListBrowser.js';

function hiddenSettingsTileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const unhideLabel = 'Show channel';
    const isVisited = TvPlayer.isVisited(ch);
    return `
        <div class="channel-tile${isVisited ? ' is-visited' : ''}" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0">
            <button type="button" class="channel-tile__unhide-btn" title="${unhideLabel}" aria-label="${unhideLabel}">${CARD_ICONS.tileEye}</button>
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

export const HiddenChannelsSettings = createSettingsListBrowser({
    sectionId: 'hidden-channels-section',
    backBtnId: 'hidden-back-btn',
    countriesId: 'hidden-countries-container',
    channelsId: 'hidden-channels-container',
    summaryCountId: 'hidden-channels-summary-count',
    getMeta: () => TvPlayer.getHiddenMeta(),
    emptyLabel: 'hidden',
    tileHtml: hiddenSettingsTileHtml,
    actionBtnSelector: '.channel-tile__unhide-btn',
    onRemove: (ch) => TvPlayer.unhideChannel(ch),
    removeToast: 'Channel restored',
    afterRemove: () => ChannelGrid.refreshVisibleCatalog()
});
