/** Shared lookups for remote module action bars. */
import { queryAllInApp } from '../tvUtils.js';

const REMOTE_END = '.tv-module__actions--remote-end';
const BROWSER_END = '.tv-module__actions--browser-end';
const START = '.tv-module__actions--start';

function preferredHosts(extra = null) {
    return [
        extra,
        document.querySelector('#remote-external-host'),
        document.querySelector('#browser-module-host'),
        document.querySelector('#browser-dock-host'),
        document.querySelector('#remote-module-host'),
        document.querySelector('#remote-dock-host'),
        document.querySelector('#remote-module-staging')
    ].filter(Boolean);
}

function pick(selector, hosts = []) {
    for (const host of hosts) {
        const found = host.querySelector?.(selector);
        if (found) return found;
    }
    return queryAllInApp(selector)[0] ?? null;
}

export function remoteEndActionsEl(preferredHost = null) {
    return pick(REMOTE_END, preferredHosts(preferredHost));
}

export function browserEndActionsEl(preferredHost = null) {
    return pick(BROWSER_END, preferredHosts(preferredHost));
}

export function startActionsEl(preferredHost = null) {
    return pick(START, preferredHosts(preferredHost));
}

export function isRemoteSeparated() {
    return typeof document !== 'undefined'
        && document.body.classList.contains('remote-external-popout-active');
}
