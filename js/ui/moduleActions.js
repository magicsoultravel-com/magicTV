/** Shared lookups for remote vs browser module action bars. */
import { queryAllInApp } from '../tvUtils.js';

const REMOTE_END = '.tv-module__actions--remote-end';
const BROWSER_END = '.tv-module__actions--browser-end';
const START = '.tv-module__actions--start';

function pick(selector, preferredHosts = []) {
    for (const host of preferredHosts) {
        const found = host.querySelector?.(selector);
        if (found) return found;
    }
    return queryAllInApp(selector)[0] ?? null;
}

export function remoteEndActionsEl(preferredHost = null) {
    const hosts = [
        preferredHost,
        document.querySelector('.remote-popout-body'),
        document.querySelector('#remote-module-host'),
        document.querySelector('#remote-dock-host'),
        document.querySelector('#remote-module-staging')
    ].filter(Boolean);
    return pick(REMOTE_END, hosts);
}

export function browserEndActionsEl(preferredHost = null) {
    const hosts = [
        preferredHost,
        document.querySelector('.browser-popout-body'),
        document.querySelector('.browser-popout-module__host'),
        document.querySelector('#remote-module-host'),
        document.querySelector('#remote-dock-host'),
        document.querySelector('#remote-module-staging')
    ].filter(Boolean);
    return pick(BROWSER_END, hosts);
}

export function startActionsEl(preferredHost = null) {
    const hosts = [
        preferredHost,
        document.querySelector('.browser-popout-body'),
        document.querySelector('.remote-popout-body'),
        document.querySelector('.browser-popout-module__host'),
        document.querySelector('#remote-module-host'),
        document.querySelector('#remote-dock-host'),
        document.querySelector('#remote-module-staging')
    ].filter(Boolean);
    return pick(START, hosts);
}

export function isRemoteSeparated() {
    return typeof document !== 'undefined'
        && document.body.classList.contains('remote-external-popout-active');
}

export function isBrowserSeparated() {
    return typeof document !== 'undefined'
        && (document.body.classList.contains('browser-popout-open')
            || document.body.classList.contains('browser-external-popout-active'));
}
