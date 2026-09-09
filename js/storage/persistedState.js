/** Shared localStorage blob for magicTV (legacy key name). */
export const STATE_KEY = 'matrix_tv_state';

/**
 * Parse the stored blob. Returns `{ ok, value }` — on corrupt JSON, `ok` is false
 * and `value` is `{}` so UI can still boot without treating storage as writable-empty.
 */
export function parsePersistedStateRaw() {
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
}

export function readPersistedState() {
    return parsePersistedStateRaw().value;
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
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}
