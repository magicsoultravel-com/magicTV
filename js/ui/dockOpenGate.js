/**
 * Dock sheet open gate — pauses heavy catalog/tile work while the sheet
 * transform slide runs, then flushes deferred callbacks after settle.
 */

const SHEET_OPEN_MS = 280;
const BODY_CLASS = 'dock-ui-opening';

let opening = false;
let generation = 0;
let settleTimer = 0;
/** @type {Array<() => void>} */
let pending = [];
/** @type {HTMLElement|null} */
let activeSheet = null;

function flush() {
    const cbs = pending.splice(0);
    for (const cb of cbs) {
        try {
            cb();
        } catch {
            /* ignore deferred callback errors */
        }
    }
}

function endOpen(gen) {
    if (gen !== generation) return;
    opening = false;
    activeSheet?.classList.remove('is-opening');
    activeSheet = null;
    document.body?.classList.remove(BODY_CLASS);
    // Let the last transform frame paint before heavy work.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            requestAnimationFrame(flush);
        });
    } else {
        flush();
    }
}

/**
 * Mark a dock sheet as opening. Width/wing CSS transitions are suppressed via
 * `body.dock-ui-opening` until the transform slide settles.
 * @param {HTMLElement|null|undefined} sheetEl
 */
function begin(sheetEl) {
    generation += 1;
    const gen = generation;
    opening = true;
    pending = [];

    if (activeSheet && activeSheet !== sheetEl) {
        activeSheet.classList.remove('is-opening');
    }
    activeSheet = sheetEl || null;
    activeSheet?.classList.add('is-opening');
    document.body?.classList.add(BODY_CLASS);

    if (settleTimer) clearTimeout(settleTimer);

    if (!sheetEl) {
        settleTimer = setTimeout(() => endOpen(gen), SHEET_OPEN_MS);
        return;
    }

    let settled = false;
    const settle = () => {
        if (settled || gen !== generation) return;
        settled = true;
        sheetEl.removeEventListener('transitionend', onEnd);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = 0;
        endOpen(gen);
    };
    const onEnd = (e) => {
        if (e.target === sheetEl && e.propertyName === 'transform') settle();
    };
    sheetEl.addEventListener('transitionend', onEnd);
    settleTimer = setTimeout(settle, SHEET_OPEN_MS);
}

/**
 * Run after the current dock open settles, or immediately if not opening.
 * @param {() => void} cb
 */
function afterOpen(cb) {
    if (typeof cb !== 'function') return;
    if (!opening) {
        cb();
        return;
    }
    pending.push(cb);
}

function isOpening() {
    return opening;
}

/** Cancel gate without running deferred work (e.g. immediate close). */
function cancel() {
    generation += 1;
    opening = false;
    pending = [];
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = 0;
    activeSheet?.classList.remove('is-opening');
    activeSheet = null;
    document.body?.classList.remove(BODY_CLASS);
}

export const DockOpenGate = {
    begin,
    afterOpen,
    isOpening,
    cancel,
    SHEET_OPEN_MS
};
