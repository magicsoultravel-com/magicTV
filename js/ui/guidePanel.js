/** On-demand programme guide panel in the remote module. */
import { el, escapeHtml } from '../tvUtils.js';
import { TvPlayer } from '../tvPlayer.js';
import { MultiView } from '../multiView.js';
import { getNowNext, getSchedule, prefetchFavoritesGuides } from '../epg/epgService.js';
import { formatProgrammeTime } from '../epg/xmltvParser.js';
import { FavoritesRecents } from '../storage/favoritesRecents.js';

let refreshTimer = null;
let lastChannelKey = '';
/** @type {Promise<void>|null} */
let loadPromise = null;

function activeChannel() {
    const player = MultiView.getStatusPlayer?.() || MultiView.getPrimary?.();
    return player?.channel || TvPlayer.channel || null;
}

function channelCacheKey(channel) {
    if (!channel) return '';
    return `${channel.providerId || ''}:${channel.channelId || channel.id || ''}`;
}

function setLoading(loading) {
    const panel = el('guide-panel');
    if (panel) panel.classList.toggle('is-loading', loading);
    const status = el('guide-status');
    if (status && loading) status.textContent = 'Loading guide…';
}

function statusMessage(result) {
    if (!result) return '';
    if (result.status === 'ok') {
        const via = result.source
            ? `via ${result.source}${result.matchedName ? ` · ${result.matchedName}` : ''}`
            : '';
        return via;
    }
    if (result.status === 'no-source') {
        const cc = activeChannel()?.countrycode;
        return cc ? `No guide source for ${cc}` : 'No guide source for this country';
    }
    if (result.status === 'cors-blocked') return 'Guide source blocked (CORS)';
    if (result.status === 'error') return result.message || 'Guide lookup failed';
    if (result.status === 'miss' || result.status === 'unavailable') return 'No guide for this channel';
    return '';
}

function renderProgrammeRow(prog, { isCurrent = false, isPast = false } = {}) {
    const time = `${formatProgrammeTime(prog.start)} – ${formatProgrammeTime(prog.stop)}`;
    const cls = [
        'guide-panel__row',
        isCurrent ? 'is-current' : '',
        isPast ? 'is-past' : ''
    ].filter(Boolean).join(' ');
    return `<li class="${cls}"><span class="guide-panel__time">${escapeHtml(time)}</span><span class="guide-panel__title">${escapeHtml(prog.title)}</span></li>`;
}

function renderList(listEl, programmes, nowMs) {
    if (!listEl) return;
    if (!programmes?.length) {
        listEl.innerHTML = '<li class="guide-panel__empty">No programmes</li>';
        return;
    }
    listEl.innerHTML = programmes.map((p) => {
        const isCurrent = p.start <= nowMs && p.stop > nowMs;
        const isPast = p.stop <= nowMs;
        return renderProgrammeRow(p, { isCurrent, isPast });
    }).join('');
}

async function loadTomorrow() {
    const channel = activeChannel();
    const listEl = el('guide-tomorrow-list');
    if (!channel || !listEl) return;

    listEl.innerHTML = '<li class="guide-panel__empty">Loading…</li>';
    const result = await getSchedule(channel, { dayOffset: 1 });
    renderList(listEl, result.dayProgrammes, Date.now());
}

async function refreshGuide() {
    const channel = activeChannel();
    const status = el('guide-status');
    const todayList = el('guide-today-list');
    const key = channelCacheKey(channel);

    if (!channel?.channelId && !channel?.id) {
        lastChannelKey = '';
        if (status) status.textContent = 'Tune a channel to see its guide';
        if (todayList) todayList.innerHTML = '';
        const tomorrowList = el('guide-tomorrow-list');
        if (tomorrowList) tomorrowList.innerHTML = '';
        return;
    }

    if (key === lastChannelKey && loadPromise) return loadPromise;

    lastChannelKey = key;
    setLoading(true);

    loadPromise = (async () => {
        try {
            const nowMs = Date.now();
            const todayResult = await getSchedule(channel, { dayOffset: 0, nowMs });

            if (channelCacheKey(activeChannel()) !== key) return;

            const msg = statusMessage(todayResult);
            if (status) status.textContent = msg;

            if (todayResult.status === 'ok') {
                renderList(todayList, todayResult.dayProgrammes, nowMs);
            } else if (todayList) {
                todayList.innerHTML = '';
            }

            const tomorrowDetails = el('guide-tomorrow');
            const tomorrowList = el('guide-tomorrow-list');
            if (tomorrowDetails && !tomorrowDetails.open) {
                if (tomorrowList) tomorrowList.innerHTML = '';
            } else if (tomorrowDetails?.open) {
                await loadTomorrow();
            }
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

async function lookupFavorites() {
    const btn = el('guide-favorites-btn');
    const resultsEl = el('guide-favorites-results');
    if (!resultsEl) return;

    const meta = FavoritesRecents.getFavoritesMeta();
    if (!meta.length) {
        resultsEl.textContent = 'No favorites to look up';
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Looking up…';
    }
    resultsEl.innerHTML = '<div class="guide-panel__empty">Starting…</div>';

    const results = await prefetchFavoritesGuides(meta, {
        onProgress({ done, total, channel, result }) {
            resultsEl.innerHTML = `<div class="guide-panel__empty">${done}/${total} — ${escapeHtml(channel.name || '')}…</div>`;
            if (result?.status === 'ok') refreshGuide().catch(() => {});
        }
    });

    resultsEl.innerHTML = results.map((r) => {
        if (r.status === 'ok') {
            return `<div class="guide-panel__fav-row guide-panel__fav-row--ok">✓ ${escapeHtml(r.name)} (${escapeHtml(r.country)}) — ${escapeHtml(r.source || '')}${r.matchedName ? ` · ${escapeHtml(r.matchedName)}` : ''}</div>`;
        }
        if (r.status === 'no-source') {
            return `<div class="guide-panel__fav-row">— ${escapeHtml(r.name)} (${escapeHtml(r.country)}) — no source</div>`;
        }
        if (r.status === 'cors-blocked') {
            return `<div class="guide-panel__fav-row">— ${escapeHtml(r.name)} (${escapeHtml(r.country)}) — CORS blocked</div>`;
        }
        return `<div class="guide-panel__fav-row">— ${escapeHtml(r.name)} (${escapeHtml(r.country)}) — no match</div>`;
    }).join('');

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Look up guides for favorites';
    }
}

export const GuidePanel = {
    bind() {
        const toggle = el('guide-panel-toggle');
        const body = el('guide-panel-body');
        const tomorrowDetails = el('guide-tomorrow');
        const favBtn = el('guide-favorites-btn');

        toggle?.addEventListener('click', () => {
            const open = body?.classList.toggle('is-open');
            if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) refreshGuide().catch(() => {});
        });

        tomorrowDetails?.addEventListener('toggle', () => {
            if (tomorrowDetails.open) loadTomorrow().catch(() => {});
        });

        favBtn?.addEventListener('click', () => {
            lookupFavorites().catch(() => {});
        });

        window.addEventListener('tv:state_changed', () => {
            const key = channelCacheKey(activeChannel());
            if (key !== lastChannelKey) {
                refreshGuide().catch(() => {});
            }
            scheduleBoundaryRefresh();
        });

        window.addEventListener('tv:epg_updated', () => {
            refreshGuide().catch(() => {});
        });
    },

    refresh() {
        return refreshGuide();
    }
};

/** Header now/next line updates (shared with PlayerChrome). */
export async function updateProgrammeHeader() {
    const titleEl = el('header-program-title');
    const nextEl = el('header-program-next');
    const remoteTitle = el('remote-program-title');
    const channel = activeChannel();

    if (!channel?.channelId && !channel?.id) {
        if (titleEl) titleEl.textContent = '';
        if (nextEl) nextEl.textContent = '';
        if (remoteTitle) remoteTitle.textContent = '';
        return;
    }

    if (titleEl) titleEl.textContent = 'Loading guide…';
    if (nextEl) nextEl.textContent = '';
    if (remoteTitle) remoteTitle.textContent = '';

    const result = await getNowNext(channel);
    if (channelCacheKey(activeChannel()) !== channelCacheKey(channel)) return;

    if (result.status !== 'ok') {
        const fallback = 'guide not available';
        if (titleEl) titleEl.textContent = fallback;
        if (nextEl) nextEl.textContent = '';
        if (remoteTitle) remoteTitle.textContent = fallback;
        return;
    }

    const currentTitle = result.current?.title || '';
    const nextLine = result.next
        ? `Next: ${result.next.title} at ${formatProgrammeTime(result.next.start)}`
        : '';

    if (titleEl) titleEl.textContent = currentTitle || 'guide not available';
    if (nextEl) nextEl.textContent = nextLine;
    if (remoteTitle) remoteTitle.textContent = currentTitle || 'guide not available';

    window.dispatchEvent(new CustomEvent('tv:epg_updated', { detail: result }));
}
