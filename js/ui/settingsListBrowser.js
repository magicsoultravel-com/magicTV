/**
 * Shared country → channel browser used by Hidden / Visited settings sections.
 */
import { channelKey, parseChannelKey } from '../tvProviders/channelShape.js';
import { countryFlagEmoji, escapeHtml, el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import { Appearance } from './appearance.js';

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

function groupByCountry(meta, countryNameFn) {
    const groups = new Map();
    for (const entry of meta) {
        const code = entry.countrycode || '';
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push(entry);
    }
    return [...groups.entries()]
        .map(([code, entries]) => ({ code, entries, count: entries.length }))
        .sort((a, b) => countryNameFn(a.code).localeCompare(countryNameFn(b.code)));
}

/**
 * @param {object} config
 * @param {string} config.sectionId
 * @param {string} config.backBtnId
 * @param {string} config.countriesId
 * @param {string} config.channelsId
 * @param {string} config.summaryCountId
 * @param {() => object[]} config.getMeta
 * @param {string} config.emptyLabel  e.g. "hidden" / "visited"
 * @param {(ch: object) => string} config.tileHtml
 * @param {string} config.actionBtnSelector
 * @param {(ch: object) => boolean} config.onRemove
 * @param {string} config.removeToast
 * @param {() => void} [config.afterRemove]
 */
export function createSettingsListBrowser(config) {
    let deps = {
        appState: null,
        onPlay: () => {}
    };
    let selectedCountry = null;
    let bound = false;
    const api = {};

    function countryName(code) {
        const countries = deps.appState?.countries || [];
        const match = countries.find((c) => c.iso_3166_1 === code);
        return match?.name || code || 'Unknown';
    }

    function updateSummaryCount() {
        const summary = el(config.summaryCountId);
        if (!summary) return;
        const count = config.getMeta().length;
        summary.textContent = count ? `(${count})` : '';
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
            const btn = tile.querySelector(config.actionBtnSelector);
            if (!btn) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (config.onRemove(ch)) {
                    showAppToast(config.removeToast);
                    config.afterRemove?.();
                    api.refresh();
                }
            });
            btn.addEventListener('keydown', (e) => e.stopPropagation());
        });
    }

    Object.assign(api, {
        init({ appState, onPlay }) {
            deps = { appState, onPlay: typeof onPlay === 'function' ? onPlay : () => {} };
        },

        bind() {
            if (bound) return;
            bound = true;
            const backBtn = el(config.backBtnId);
            if (backBtn) {
                backBtn.addEventListener('click', () => api.showCountries());
            }
            const section = el(config.sectionId);
            if (section) {
                section.addEventListener('toggle', () => {
                    if (section.open) api.refresh();
                });
            }
        },

        showCountries() {
            selectedCountry = null;
            const countries = el(config.countriesId);
            const channels = el(config.channelsId);
            const backBtn = el(config.backBtnId);
            if (countries) countries.classList.remove('is-hidden');
            if (channels) channels.classList.add('is-hidden');
            if (backBtn) backBtn.classList.add('is-hidden');
            api.renderCountries();
        },

        renderCountries() {
            const container = el(config.countriesId);
            if (!container) return;
            updateSummaryCount();
            const meta = config.getMeta();
            if (!meta.length) {
                container.innerHTML = `<div class="empty-state"><p class="empty-state__text">No ${escapeHtml(config.emptyLabel)} channels</p></div>`;
                return;
            }
            const groups = groupByCountry(meta, countryName);
            container.innerHTML = groups.map(({ code, count }) => `
            <div class="country-tile" data-country="${escapeHtml(code)}" role="button" tabindex="0">
                <div class="country-tile__icon">${countryFlagEmoji(code)}</div>
                <div class="country-tile__body">
                    <h3 class="country-tile__name"><span class="marquee-track"><span class="marquee-text">${escapeHtml(countryName(code))}</span></span></h3>
                    <div class="country-tile__count">${count} ${escapeHtml(config.emptyLabel)}</div>
                </div>
            </div>
        `).join('');

            container.querySelectorAll('.country-tile').forEach((tile) => {
                const open = () => api.showChannels(tile.dataset.country);
                tile.addEventListener('click', open);
                tile.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                });
            });
            Appearance.applyToTiles(container);
        },

        showChannels(countryCode) {
            selectedCountry = countryCode;
            const countries = el(config.countriesId);
            const channelsEl = el(config.channelsId);
            const backBtn = el(config.backBtnId);
            if (countries) countries.classList.add('is-hidden');
            if (channelsEl) channelsEl.classList.remove('is-hidden');
            if (backBtn) backBtn.classList.remove('is-hidden');
            api.renderChannels();
        },

        renderChannels() {
            const container = el(config.channelsId);
            if (!container) return;
            const meta = config.getMeta().filter((e) => (e.countrycode || '') === (selectedCountry || ''));
            if (!meta.length) {
                container.innerHTML = `<div class="empty-state"><p class="empty-state__text">No ${escapeHtml(config.emptyLabel)} channels</p></div>`;
                return;
            }
            const channels = meta.map(metaToChannel);
            container.innerHTML = channels.map((ch) => config.tileHtml(ch)).join('');
            wireTiles(container, channels);
            Appearance.applyToTiles(container);
        },

        refresh() {
            updateSummaryCount();
            if (selectedCountry) {
                api.renderChannels();
            } else {
                api.renderCountries();
            }
        }
    });

    return api;
}
