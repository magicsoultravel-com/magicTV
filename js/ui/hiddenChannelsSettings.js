import { TvPlayer } from '../tvPlayer.js';
import { RadioPlayer } from '../radio/radioPlayer.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml } from '../tvUtils.js';
import { CARD_ICONS } from './icons.js';
import { ChannelGrid } from './channelGrid.js';
import { createSettingsListBrowser } from './settingsListBrowser.js';
import { marqueeInnerHtml } from './marquee.js';
import { RadioBrowseView } from '../browse/radioBrowseView.js';
import { checkTileOnline } from './tileStreamCheck.js';

function isRadioCatalog() {
    return typeof document !== 'undefined'
        && document.body.classList.contains('catalog-mode-radio');
}

/**
 * Hidden-channel tile. TV tiles carry the catalog's refresh/online-check
 * affordance (preview snapshot = online, disconnect badge = offline); radio
 * tiles have no capture pipeline, so they keep the plain logo/letter frame.
 * @param {object} ch
 */
export function hiddenSettingsTileHtml(ch) {
    const initial = (ch.name || '?')[0].toUpperCase();
    const radio = isRadioCatalog();
    const unhideLabel = radio ? 'Show station' : 'Show channel';
    const isVisited = radio ? RadioPlayer.isVisited(ch) : TvPlayer.isVisited(ch);
    const refreshLabel = 'Check if online';
    const refreshHtml = radio
        ? ''
        : `<button type="button" class="channel-tile__refresh-btn" title="${refreshLabel}" aria-label="${refreshLabel}">${CARD_ICONS.tileRefresh}</button>`;
    const frameOverlays = radio
        ? ''
        : `
                    <span class="channel-tile__frame-waiting is-hidden" aria-hidden="true">${CARD_ICONS.waiting}</span>
                    <span class="channel-tile__frame-loading is-hidden" aria-hidden="true">${CARD_ICONS.loading}</span>
                    <span class="channel-tile__offline-badge is-hidden" aria-hidden="true">${CARD_ICONS.disconnect}</span>`;
    return `
        <div class="channel-tile${isVisited ? ' is-visited' : ''}" data-channel="${escapeHtml(channelKey(ch))}" role="button" tabindex="0" data-logo="${escapeHtml(ch.logo || '')}">
            ${refreshHtml}
            <button type="button" class="channel-tile__unhide-btn" title="${unhideLabel}" aria-label="${unhideLabel}">${CARD_ICONS.tileEye}</button>
            <div class="channel-tile__icon">
                <div class="channel-tile__capture-frame" data-frame-state="idle">
                    <div class="channel-tile__letter-avatar">${initial}</div>
                    <img class="channel-tile__logo-img${ch.logo ? '' : ' is-hidden'}" src="${escapeHtml(ch.logo || '')}" alt="" decoding="async">${frameOverlays}
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
    // Hidden refs store no stream URL; the check re-resolves via the catalog.
    onRefresh: (ch, tile) => checkTileOnline(ch, tile),
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
