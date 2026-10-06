import { TvPlayer } from '../tvPlayer.js';
import { RadioPlayer } from '../radio/radioPlayer.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml } from '../tvUtils.js';
import { CARD_ICONS } from './icons.js';
import { ChannelGrid } from './channelGrid.js';
import { createSettingsListBrowser } from './settingsListBrowser.js';
import { marqueeInnerHtml } from './marquee.js';
import { RadioBrowseView } from '../browse/radioBrowseView.js';

function isRadioCatalog() {
    return typeof document !== 'undefined'
        && document.body.classList.contains('catalog-mode-radio');
}

function hiddenSettingsTileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const unhideLabel = isRadioCatalog() ? 'Show station' : 'Show channel';
    const isVisited = isRadioCatalog() ? RadioPlayer.isVisited(ch) : TvPlayer.isVisited(ch);
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
                <h3 class="channel-tile__name">${marqueeInnerHtml(ch.name || 'Unknown')}</h3>
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
    getMeta: () => (isRadioCatalog() ? RadioPlayer.getHiddenMeta() : TvPlayer.getHiddenMeta()),
    emptyLabel: 'hidden',
    tileHtml: hiddenSettingsTileHtml,
    actionBtnSelector: '.channel-tile__unhide-btn',
    onRemove: (ch) => (isRadioCatalog() ? RadioPlayer.unhideChannel(ch) : TvPlayer.unhideChannel(ch)),
    removeToast: 'Restored',
    afterRemove: (ch) => {
        if (isRadioCatalog()) {
            RadioBrowseView.refresh();
            RadioBrowseView.syncVisitedTiles();
        } else {
            ChannelGrid.revealChannelTiles(ch);
        }
    }
});
