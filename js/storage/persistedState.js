/** Shared localStorage blob for magicTV (legacy key name). */
export const STATE_KEY = 'matrix_tv_state';

/**
 * Parse the stored blob. Returns `{ ok, value }` — on corrupt JSON, `ok` is false
 * and `value` is `{}` so UI can still boot without treating storage as writable-empty.
 */
export function parsePersistedStateRaw() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw == null || raw === '') return { ok: true, value: {} };
        try {
            const value = JSON.parse(raw);
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return { ok: false, value: {} };
            }
            return { ok: true, value };
        } catch {
            return { ok: false, value: {} };
        }
    } catch {
        return { ok: false, value: {} };
    }
}

export function readPersistedState() {
    return parsePersistedStateRaw().value;
}

/**
 * Drop session chrome that often bloats the blob while keeping library + settings.
 * Used after QuotaExceeded (and by boot migration as a last resort).
 * @param {Record<string, any>} state
 * @returns {Record<string, any>}
 */
export function compactNonEssentialPersistedState(state) {
    const src = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const next = { ...src };

    next.mosaicPlacement = {};

    if (next.mosaicSlots && typeof next.mosaicSlots === 'object' && !Array.isArray(next.mosaicSlots)) {
        const slots = {};
        for (const [id, entry] of Object.entries(next.mosaicSlots)) {
            if (!entry) continue;
            if (typeof entry === 'string') {
                slots[id] = { key: entry, name: '', muted: true, volume: 1, url: '' };
                continue;
            }
            if (typeof entry !== 'object') continue;
            slots[id] = {
                key: entry.key || '',
                name: entry.name || '',
                muted: entry.muted !== false,
                volume: Number.isFinite(Number(entry.volume)) ? Number(entry.volume) : 1,
                url: ''
            };
        }
        next.mosaicSlots = slots;
    }

    if (next.remoteModule && typeof next.remoteModule === 'object') {
        next.remoteModule = {
            left: 24,
            top: 48,
            width: 320,
            height: 560,
            mode: 'hidden',
            pinned: false,
            open: false,
            targetSlotId: 'center',
            sheetHeight: 0.45,
            sheetExpanded: true,
            dockSide: 'left'
        };
    }
    delete next.channelPicker;

    return next;
}

/**
 * Write the full blob. On QuotaExceeded, compact nonessential chrome once and retry.
 * @param {Record<string, any>} value
 * @param {{ force?: boolean }} [opts] - force bypasses corrupt-blob write refusal (migration only)
 * @returns {Record<string, any>}
 */
export function writePersistedState(value, { force = false } = {}) {
    const parsed = parsePersistedStateRaw();
    if (!force && !parsed.ok) {
        console.warn(
            `[magicTV] Refusing to write ${STATE_KEY}: stored JSON is corrupt. ` +
                'Fix or clear the key manually to avoid wiping user data.'
        );
        return parsed.value;
    }

    const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(payload));
        return payload;
    } catch (err) {
        const compacted = compactNonEssentialPersistedState(payload);
        try {
            localStorage.setItem(STATE_KEY, JSON.stringify(compacted));
            console.warn(
                `[magicTV] ${STATE_KEY} write failed (${err?.name || 'Error'}); ` +
                    'dropped nonessential session chrome and retried.'
            );
            return compacted;
        } catch (err2) {
            console.warn(
                `[magicTV] Failed to write ${STATE_KEY} after compact:`,
                err2?.message || err2
            );
            return parsed.ok ? parsed.value : {};
        }
    }
}

export function patchPersistedState(patch) {
    const parsed = parsePersistedStateRaw();
    if (!parsed.ok) {
        console.warn(
            `[magicTV] Refusing to write ${STATE_KEY}: stored JSON is corrupt. ` +
                'Fix or clear the key manually to avoid wiping user data.'
        );
        return parsed.value;
    }
    const next = { ...parsed.value, ...patch };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
    }
    return writePersistedState(next);
}
