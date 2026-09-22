/** Shared lookups for remote module action bars. */
import { queryAllInApp } from '../tvUtils.js';

const REMOTE_END = '.tv-module__actions--remote-end';
const BROWSER_END = '.tv-module__actions--browser-end';
const END_CLUSTER = '.tv-module__actions-cluster--end';
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

export function endClusterEl(preferredHost = null) {
    return pick(END_CLUSTER, preferredHosts(preferredHost));
}

export function startActionsEl(preferredHost = null) {
    return pick(START, preferredHosts(preferredHost));
}

/** Keep remote-end then browser-end inside the shared end cluster (joined layout). */
export function assembleEndCluster(preferredHost = null) {
    const cluster = endClusterEl(preferredHost);
    if (!cluster) return null;
    const remoteEnd = remoteEndActionsEl(preferredHost);
    const browserEnd = browserEndActionsEl(preferredHost);
    // appendChild re-orders: remote first, then browser.
    if (remoteEnd) cluster.appendChild(remoteEnd);
    if (browserEnd) cluster.appendChild(browserEnd);
    return cluster;
}

export function isRemoteSeparated() {
    return typeof document !== 'undefined'
        && document.body.classList.contains('remote-external-popout-active');
}
