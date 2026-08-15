/** Shared localStorage blob for magicTV (legacy key name). */
export const STATE_KEY = 'matrix_tv_state';

export function readPersistedState() {
    try {
        return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    } catch {
        return {};
    }
}

export function patchPersistedState(patch) {
    const next = { ...readPersistedState(), ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}
