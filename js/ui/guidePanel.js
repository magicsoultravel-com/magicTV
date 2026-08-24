/** Programme guide wing — one section per open TV screen, beside the remote. */
import { el, escapeHtml } from '../tvUtils.js';
import { TvPlayer } from '../tvPlayer.js';
import { MultiView, SLOT_SCREEN_LABELS } from '../multiView.js';
import { getNowNext, getSchedule } from '../epg/epgService.js';
import { formatProgrammeTime } from '../epg/xmltvParser.js';
import { loadPlayerState, savePlayerState } from '../storage/playerState.js';
import { SLOT_IDS } from '../mosaic/constants.js';
import { ACTION_ICONS } from './icons.js';
import { channelKey } from '../tvProviders/channelShape.js';
import { WingPanel } from './wingPanel.js';

const GUIDE_REFRESH_ICON = ACTION_ICONS.refresh;
const GUIDE_UNAVAILABLE_ICON = ACTION_ICONS.guideUnavailable;

const GUIDE_SLOT_ORDER = ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

let refreshTimer = null;
let lastSnapshot = '';
/** @type {Promise<void>|null} */
let loadPromise = null;
/** @type {string|null} null = equal split across all screens */
let expandedSlotId = null;
/** @type {Map<string, number>} slotId -> dayOffset (0 today, 1 tomorrow) */
const slotDayOffsets = new Map();
/** @type {Array<{ slotId: string, channel: object|null, result: object|null }>} */
let lastSlotResults = [];
/** @type {Map<string, { dayOffset: number, result: object|null }>} */
const slotScheduleCache = new Map();

function enabledScreenSlots() {
    return GUIDE_SLOT_ORDER.filter((id) => {
        if (!SLOT_IDS.includes(id)) return false;
        const slot = MultiView.slots[id];
        return slot?.enabled === true;
    });
}

function refreshButtonHtml(slotId, label) {
    return `<button type="button" class="guide-screen__refresh" data-guide-refresh="${escapeHtml(slotId)}" aria-label="Refresh TV ${escapeHtml(label)} guide" title="Refresh guide">${GUIDE_REFRESH_ICON}</button>`;
}

function slotChannel(slotId) {
    return MultiView.slots[slotId]?.player?.channel || null;
}

function channelCacheKey(channel) {
    return channelKey(channel);
}

function scheduleCacheKey(channel, dayOffset) {
    const key = channelCacheKey(channel);
    return key ? `${key}:${dayOffset}` : '';
}

function slotDayOffset(slotId) {
    return slotDayOffsets.get(slotId) ?? 0;
}

async function fetchNowNextForChannel(channel, { force = false } = {}) {
    if (!channel?.channelId && !channel?.id) return null;
    return getNowNext(channel, Date.now(), { force });
}

async function fetchResultsForSlots(slots, { force = false } = {}) {
    /** @type {Map<string, Promise<object|null>>} */
    const byChannel = new Map();

    for (const slotId of slots) {
        const channel = slotChannel(slotId);
        const key = channelCacheKey(channel);
        if (!key || byChannel.has(key)) continue;
        byChannel.set(key, fetchNowNextForChannel(channel, { force }));
    }

    const resolved = new Map();
    await Promise.all([...byChannel.entries()].map(async ([key, promise]) => {
        resolved.set(key, await promise);
    }));

    return slots.map((slotId) => {
        const channel = slotChannel(slotId);
        const key = channelCacheKey(channel);
        if (!key) return { slotId, channel, result: null };
        return { slotId, channel, result: resolved.get(key) ?? null };
    });
}

async function fetchScheduleForChannel(channel, dayOffset, { force = false } = {}) {
    if (!channel?.channelId && !channel?.id) return null;
    return getSchedule(channel, { dayOffset, nowMs: Date.now() });
}

async function fetchSchedulesForSlots(slots, { force = false } = {}) {
    /** @type {Map<string, Promise<object|null>>} */
    const byKey = new Map();

    for (const slotId of slots) {
        const channel = slotChannel(slotId);
        const dayOffset = slotDayOffset(slotId);
        const key = scheduleCacheKey(channel, dayOffset);
        if (!key || byKey.has(key)) continue;
        byKey.set(key, fetchScheduleForChannel(channel, dayOffset, { force }));
    }

    const resolved = new Map();
    await Promise.all([...byKey.entries()].map(async ([key, promise]) => {
        resolved.set(key, await promise);
    }));

    return slots.map((slotId) => {
        const channel = slotChannel(slotId);
        const dayOffset = slotDayOffset(slotId);
        const key = scheduleCacheKey(channel, dayOffset);
        if (!key) return { slotId, channel, dayOffset, result: null };
        return { slotId, channel, dayOffset, result: resolved.get(key) ?? null };
    });
}

function guideSnapshot() {
    const slots = enabledScreenSlots();
    const keys = slots.map((id) => `${id}:${channelCacheKey(slotChannel(id))}:${slotDayOffset(id)}`).join('|');
    return `${expandedSlotId || 'equal'}::${keys}`;
}

function setLoading(loading) {
    const panel = el('guide-panel');
    if (panel) panel.classList.toggle('is-loading', loading);
}

function isGuideUnavailable(result, channel) {
    if (!channel?.channelId && !channel?.id) return false;
    if (!result) return false;
    return result.status !== 'ok';
}

function unavailableHint(result, channel) {
    return statusMessage(result, channel) || 'Guide not available';
}

function statusLine(result, channel) {
    if (!channel?.channelId && !channel?.id) {
        return { now: 'No channel tuned', next: '', meta: '' };
    }
    if (!result) {
        return { now: 'Loading guide…', next: '', meta: '' };
    }
    if (isGuideUnavailable(result, channel)) {
        return { now: '', next: '', meta: '' };
    }
    const now = result.current?.title || 'guide not available';
    const next = result.next
        ? `Next: ${result.next.title} at ${formatProgrammeTime(result.next.start)}`
        : '';
    const meta = statusMessage(result, channel);
    return { now, next, meta };
}

function statusMessage(result, channel) {
    if (!result) return '';
    if (result.status === 'ok') {
        const via = result.source
            ? `via ${result.source}${result.matchedName ? ` · ${result.matchedName}` : ''}`
            : '';
        return via;
    }
    if (result.status === 'no-source') {
        const cc = channel?.countrycode || channel?.country || '';
        return cc ? `No guide source for ${cc}` : 'No guide source for this country';
    }
    if (result.status === 'cors-blocked') return 'Guide source blocked (CORS)';
    if (result.status === 'error') return result.message || 'Guide lookup failed';
    if (result.status === 'miss' || result.status === 'unavailable') return 'No guide for this channel';
    return '';
}

function scheduleMessage(result) {
    if (!result) return 'Loading schedule…';
    if (result.status !== 'ok') return '';
    if (!result.dayProgrammes?.length) return 'No programmes listed';
    return '';
}

function noGuideIconHtml(hint) {
    return `<span class="guide-screen__no-guide" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}">${GUIDE_UNAVAILABLE_ICON}</span>`;
}

function syncSlotAvailability(section, result, channel) {
    if (!section) return;
    const unavailable = isGuideUnavailable(result, channel);
    section.classList.toggle('is-guide-unavailable', unavailable);

    const headRow = section.querySelector('.guide-screen__head-row');
    let iconEl = section.querySelector('.guide-screen__no-guide');
    if (unavailable) {
        const hint = unavailableHint(result, channel);
        if (!iconEl && headRow) {
            iconEl = document.createElement('span');
            iconEl.className = 'guide-screen__no-guide';
            headRow.insertBefore(iconEl, section.querySelector('.guide-screen__refresh'));
        }
        if (iconEl) {
            iconEl.innerHTML = GUIDE_UNAVAILABLE_ICON;
            iconEl.title = hint;
            iconEl.setAttribute('aria-label', hint);
        }
        const nowEl = section.querySelector('.guide-screen__now');
        const nextEl = section.querySelector('.guide-screen__next');
        if (nowEl) nowEl.textContent = '';
        if (nextEl) nextEl.textContent = '';
        section.querySelector('.guide-screen__meta')?.remove();
    } else if (iconEl) {
        iconEl.remove();
    }
}

function renderScheduleList(programmes, nowMs = Date.now()) {
    if (!programmes?.length) return '';
    return programmes.map((p) => {
        const isNow = p.start <= nowMs && p.stop > nowMs;
        const isPast = p.stop <= nowMs;
        const classes = ['guide-screen__prog'];
        if (isNow) classes.push('is-now');
        if (isPast) classes.push('is-past');
        const desc = p.desc
            ? `<span class="guide-screen__prog-desc">${escapeHtml(p.desc)}</span>`
            : '';
        return `<li class="${classes.join(' ')}">
            <span class="guide-screen__prog-time">${escapeHtml(formatProgrammeTime(p.start))}</span>
            <span class="guide-screen__prog-title">${escapeHtml(p.title)}</span>
            ${desc}
        </li>`;
    }).join('');
}

function dayTabsHtml(slotId, dayOffset) {
    return `<div class="guide-screen__day-tabs" role="tablist" aria-label="Guide day">
        <button type="button" class="guide-screen__day-tab${dayOffset === 0 ? ' is-active' : ''}" data-guide-day="0" data-guide-slot="${escapeHtml(slotId)}" role="tab" aria-selected="${dayOffset === 0}">Today</button>
        <button type="button" class="guide-screen__day-tab${dayOffset === 1 ? ' is-active' : ''}" data-guide-day="1" data-guide-slot="${escapeHtml(slotId)}" role="tab" aria-selected="${dayOffset === 1}">Tomorrow</button>
    </div>`;
}

function renderScreenSection(slotId, { channel, result, scheduleResult = null, dayOffset = 0 }) {
    const label = SLOT_SCREEN_LABELS[slotId] || slotId;
    const channelName = channel?.name ? escapeHtml(channel.name) : '—';
    const unavailable = isGuideUnavailable(result, channel);
    const { now, next, meta } = statusLine(result, channel);
    const scheduleEmpty = unavailable ? '' : scheduleMessage(scheduleResult);
    const scheduleList = !unavailable && scheduleResult?.status === 'ok'
        ? renderScheduleList(scheduleResult.dayProgrammes)
        : '';

    return `<section class="guide-screen${unavailable ? ' is-guide-unavailable' : ''}" data-slot-id="${escapeHtml(slotId)}" aria-label="TV ${escapeHtml(label)} guide">
        <div class="guide-screen__head-row">
            <button type="button" class="guide-screen__hit" data-guide-slot="${escapeHtml(slotId)}" aria-expanded="false">
                <span class="guide-screen__badge">TV ${escapeHtml(label)}</span>
                <span class="guide-screen__channel">${channelName}</span>
            </button>
            ${unavailable ? noGuideIconHtml(unavailableHint(result, channel)) : ''}
            ${refreshButtonHtml(slotId, label)}
        </div>
        <div class="guide-screen__body">
            <div class="guide-screen__summary">
                <p class="guide-screen__now">${escapeHtml(now)}</p>
                <p class="guide-screen__next">${escapeHtml(next)}</p>
            </div>
            <div class="guide-screen__detail">
                ${dayTabsHtml(slotId, dayOffset)}
                <div class="guide-screen__schedule" role="region" aria-label="Programme schedule">
                    ${scheduleEmpty
                        ? `<p class="guide-screen__schedule-empty">${escapeHtml(scheduleEmpty)}</p>`
                        : scheduleList
                            ? `<ul class="guide-screen__schedule-list">${scheduleList}</ul>`
                            : ''}
                </div>
                ${meta ? `<p class="guide-screen__meta">${escapeHtml(meta)}</p>` : ''}
            </div>
        </div>
    </section>`;
}

function patchSlotSection(section, slotId, { channel, result, scheduleResult, dayOffset }) {
    if (!section) return;

    const channelEl = section.querySelector('.guide-screen__channel');
    const nowEl = section.querySelector('.guide-screen__now');
    const nextEl = section.querySelector('.guide-screen__next');
    let metaEl = section.querySelector('.guide-screen__meta');

    const { now, next, meta } = statusLine(result, channel);
    syncSlotAvailability(section, result, channel);
    if (channelEl) channelEl.textContent = channel?.name || '—';
    if (nowEl && !isGuideUnavailable(result, channel)) nowEl.textContent = now;
    if (nextEl && !isGuideUnavailable(result, channel)) nextEl.textContent = next;

    if (meta) {
        if (!metaEl) {
            metaEl = document.createElement('p');
            metaEl.className = 'guide-screen__meta';
            section.querySelector('.guide-screen__detail')?.appendChild(metaEl);
        }
        metaEl.textContent = meta;
    } else if (metaEl) {
        metaEl.remove();
    }

    if (typeof dayOffset === 'number') {
        section.querySelectorAll('.guide-screen__day-tab').forEach((tab) => {
            const active = Number(tab.dataset.guideDay) === dayOffset;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    if (scheduleResult !== undefined) {
        const scheduleEl = section.querySelector('.guide-screen__schedule');
        if (scheduleEl) {
            const empty = scheduleMessage(scheduleResult);
            if (empty) {
                scheduleEl.innerHTML = `<p class="guide-screen__schedule-empty">${escapeHtml(empty)}</p>`;
            } else {
                scheduleEl.innerHTML = `<ul class="guide-screen__schedule-list">${renderScheduleList(scheduleResult.dayProgrammes)}</ul>`;
            }
        }
    }
}

function scheduleSlotsToLoad() {
    const slots = enabledScreenSlots();
    const visible = slots.filter((slotId) => {
        const entry = lastSlotResults.find((r) => r.slotId === slotId);
        return !isGuideUnavailable(entry?.result ?? null, entry?.channel ?? slotChannel(slotId));
    });
    if (!expandedSlotId || slots.length <= 1) return visible;
    return visible.includes(expandedSlotId) ? [expandedSlotId] : visible;
}

async function loadSchedulesForVisibleSlots({ force = false } = {}) {
    const slots = scheduleSlotsToLoad();
    if (!slots.length) return;

    const schedules = await fetchSchedulesForSlots(slots, { force });
    for (const entry of schedules) {
        slotScheduleCache.set(entry.slotId, { dayOffset: entry.dayOffset, result: entry.result });
        const section = el('guide-screens')?.querySelector(`.guide-screen[data-slot-id="${entry.slotId}"]`);
        patchSlotSection(section, entry.slotId, {
            channel: entry.channel,
            result: lastSlotResults.find((r) => r.slotId === entry.slotId)?.result ?? null,
            scheduleResult: entry.result,
            dayOffset: entry.dayOffset
        });
    }
}

async function refreshSlotGuide(slotId) {
    if (!enabledScreenSlots().includes(slotId)) return;

    const channel = slotChannel(slotId);
    let result = null;
    if (channel?.channelId || channel?.id) {
        result = await getNowNext(channel, Date.now(), { force: true });
    }

    const idx = lastSlotResults.findIndex((r) => r.slotId === slotId);
    const entry = { slotId, channel, result };
    if (idx >= 0) lastSlotResults[idx] = entry;
    else lastSlotResults.push(entry);

    const section = el('guide-screens')?.querySelector(`.guide-screen[data-slot-id="${slotId}"]`);
    patchSlotSection(section, slotId, { channel, result, dayOffset: slotDayOffset(slotId) });

    slotScheduleCache.delete(slotId);
    await loadSchedulesForVisibleSlots({ force: true });
    lastSnapshot = guideSnapshot();
}

async function setSlotDayOffset(slotId, dayOffset) {
    if (!enabledScreenSlots().includes(slotId)) return;
    slotDayOffsets.set(slotId, dayOffset === 1 ? 1 : 0);
    slotScheduleCache.delete(slotId);

    const section = el('guide-screens')?.querySelector(`.guide-screen[data-slot-id="${slotId}"]`);
    patchSlotSection(section, slotId, {
        channel: slotChannel(slotId),
        result: lastSlotResults.find((r) => r.slotId === slotId)?.result ?? null,
        scheduleResult: null,
        dayOffset
    });

    const schedules = await fetchSchedulesForSlots([slotId], { force: true });
    const entry = schedules[0];
    if (entry) {
        slotScheduleCache.set(slotId, { dayOffset: entry.dayOffset, result: entry.result });
        patchSlotSection(section, slotId, {
            channel: entry.channel,
            result: lastSlotResults.find((r) => r.slotId === slotId)?.result ?? null,
            scheduleResult: entry.result,
            dayOffset: entry.dayOffset
        });
    }
    lastSnapshot = guideSnapshot();
}

function syncExpandedLayout(slotResults = lastSlotResults) {
    const container = el('guide-screens');
    if (!container) return;

    const slots = enabledScreenSlots();
    const resultMap = new Map(slotResults.map((r) => [r.slotId, r]));

    if (expandedSlotId) {
        const expanded = resultMap.get(expandedSlotId);
        if (isGuideUnavailable(expanded?.result ?? null, expanded?.channel ?? slotChannel(expandedSlotId))) {
            expandedSlotId = null;
        }
    }
    if (expandedSlotId && !slots.includes(expandedSlotId)) {
        expandedSlotId = null;
    }

    const isEqual = !expandedSlotId || slots.length <= 1;

    container.classList.toggle('is-equal-split', isEqual);
    container.classList.toggle('is-slot-expanded', !isEqual);
    container.dataset.screenCount = String(slots.length);

    container.querySelectorAll('.guide-screen').forEach((section) => {
        const slotId = section.dataset.slotId;
        if (!slots.includes(slotId)) {
            section.remove();
            return;
        }
        const expanded = !isEqual && slotId === expandedSlotId;
        const data = resultMap.get(slotId);
        syncSlotAvailability(section, data?.result ?? null, data?.channel ?? slotChannel(slotId));
        section.hidden = false;
        section.classList.toggle('is-expanded', expanded);
        section.classList.toggle('is-collapsed', !isEqual && !expanded);
        section.querySelector('.guide-screen__hit')?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    loadSchedulesForVisibleSlots().catch(() => {});
}

function setExpandedSlot(slotId, { focus = true } = {}) {
    const slots = enabledScreenSlots();
    if (slotId && slots.includes(slotId)) {
        const entry = lastSlotResults.find((r) => r.slotId === slotId);
        if (isGuideUnavailable(entry?.result ?? null, entry?.channel ?? slotChannel(slotId))) {
            return;
        }
    }
    if (!slotId || !slots.includes(slotId)) {
        expandedSlotId = null;
    } else if (expandedSlotId === slotId && slots.length > 1) {
        expandedSlotId = null;
    } else {
        expandedSlotId = slotId;
    }

    const state = loadPlayerState();
    savePlayerState({
        remoteModule: {
            ...(state.remoteModule || {}),
            guideExpandedSlot: expandedSlotId
        }
    });

    if (focus && expandedSlotId) {
        MultiView.focusScreen?.(expandedSlotId);
    }

    syncExpandedLayout(lastSlotResults);
}

function renderGuideScreens(slotResults) {
    const container = el('guide-screens');
    if (!container) return;

    const slots = enabledScreenSlots();
    const filtered = slotResults.filter((r) => slots.includes(r.slotId));

    if (!filtered.length) {
        container.classList.remove('is-equal-split', 'is-slot-expanded');
        container.removeAttribute('data-screen-count');
        container.innerHTML = '<p class="guide-wing__empty">No screens open</p>';
        lastSlotResults = [];
        slotScheduleCache.clear();
        return;
    }

    container.innerHTML = filtered.map(({ slotId, channel, result }) => {
        const cached = slotScheduleCache.get(slotId);
        return renderScreenSection(slotId, {
            channel,
            result,
            scheduleResult: cached?.result ?? null,
            dayOffset: slotDayOffset(slotId)
        });
    }).join('');

    lastSlotResults = filtered;
    syncExpandedLayout(filtered);
}

async function refreshGuide() {
    if (!WingPanel.isGuideMode()) return;

    const slots = enabledScreenSlots();
    const snapshot = guideSnapshot();

    if (snapshot === lastSnapshot && loadPromise) return loadPromise;

    lastSnapshot = snapshot;
    setLoading(true);

    loadPromise = (async () => {
        try {
            const results = await fetchResultsForSlots(slots);

            if (guideSnapshot() !== snapshot) return;

            renderGuideScreens(results);
        } finally {
            setLoading(false);
            loadPromise = null;
        }
    })();

    return loadPromise;
}

function scheduleBoundaryRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshGuide().catch(() => {});
    }, 60 * 1000);
}

function activeChannel() {
    const player = MultiView.getStatusPlayer?.() || MultiView.getPrimary?.();
    return player?.channel || TvPlayer.channel || null;
}

export const GuidePanel = {
    init() {
        const saved = loadPlayerState().remoteModule || {};
        expandedSlotId = saved.guideExpandedSlot || null;
        WingPanel.init();
        this.bind();
    },

    bind() {
        const panel = el('guide-panel');
        if (panel) panel.dataset.guideModule = '1';

        el('guide-screens')?.addEventListener('click', (e) => {
            const refreshBtn = e.target.closest?.('[data-guide-refresh]');
            if (refreshBtn) {
                e.preventDefault();
                e.stopPropagation();
                const slotId = refreshBtn.getAttribute('data-guide-refresh');
                if (slotId) {
                    refreshBtn.classList.add('is-spinning');
                    refreshSlotGuide(slotId)
                        .catch(() => {})
                        .finally(() => refreshBtn.classList.remove('is-spinning'));
                }
                return;
            }

            const dayBtn = e.target.closest?.('[data-guide-day]');
            if (dayBtn) {
                e.preventDefault();
                e.stopPropagation();
                const slotId = dayBtn.getAttribute('data-guide-slot');
                const dayOffset = Number(dayBtn.getAttribute('data-guide-day'));
                if (slotId) setSlotDayOffset(slotId, dayOffset).catch(() => {});
                return;
            }

            const btn = e.target.closest?.('[data-guide-slot]');
            if (!btn) return;
            e.preventDefault();
            const slotId = btn.getAttribute('data-guide-slot');
            if (slotId) setExpandedSlot(slotId);
        });

        window.addEventListener('tv:state_changed', () => {
            const slots = enabledScreenSlots();
            if (expandedSlotId && !slots.includes(expandedSlotId)) {
                expandedSlotId = null;
            }
            const snap = guideSnapshot();
            if (snap !== lastSnapshot) {
                lastSnapshot = '';
                slotScheduleCache.clear();
                refreshGuide().catch(() => {});
            }
            scheduleBoundaryRefresh();
        });

        window.addEventListener('tv:epg_updated', () => {
            refreshGuide().catch(() => {});
        });
    },

    isVisible() {
        return WingPanel.isGuideMode();
    },

    setVisible(visible, { silent = false } = {}) {
        WingPanel.setGuideOpen(visible !== false, { silent });
        const panel = this.getPanelEl();
        if (panel && WingPanel.isGuideMode()) {
            lastSnapshot = '';
            refreshGuide().catch(() => {});
        }
        return WingPanel.isGuideMode();
    },

    toggle() {
        const next = WingPanel.toggleGuide();
        if (WingPanel.isGuideMode()) {
            lastSnapshot = '';
            refreshGuide().catch(() => {});
        }
        return next;
    },

    refresh() {
        lastSnapshot = '';
        slotScheduleCache.clear();
        return refreshGuide();
    },

    getPanelEl() {
        return el('guide-panel');
    }
};

/** Main header now/next (status TV only — guide wing has per-screen status). */
export async function updateProgrammeHeader() {
    const titleEl = el('header-program-title');
    const nextEl = el('header-program-next');
    const channel = activeChannel();

    if (!channel?.channelId && !channel?.id) {
        if (titleEl) titleEl.textContent = '';
        if (nextEl) nextEl.textContent = '';
        if (GuidePanel.isVisible()) refreshGuide().catch(() => {});
        return;
    }

    if (titleEl) titleEl.textContent = 'Loading guide…';
    if (nextEl) nextEl.textContent = '';

    const result = await getNowNext(channel);
    if (channelCacheKey(activeChannel()) !== channelCacheKey(channel)) return;

    if (result.status !== 'ok') {
        const fallback = 'guide not available';
        if (titleEl) titleEl.textContent = fallback;
        if (nextEl) nextEl.textContent = '';
    } else {
        const currentTitle = result.current?.title || '';
        const nextLine = result.next
            ? `Next: ${result.next.title} at ${formatProgrammeTime(result.next.start)}`
            : '';
        if (titleEl) titleEl.textContent = currentTitle || 'guide not available';
        if (nextEl) nextEl.textContent = nextLine;
    }

    window.dispatchEvent(new CustomEvent('tv:epg_updated', { detail: result }));
    if (GuidePanel.isVisible()) refreshGuide().catch(() => {});
}
