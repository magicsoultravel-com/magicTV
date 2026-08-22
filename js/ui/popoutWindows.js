/** Shared popout window helpers (Document PiP + browser popup fallback). */
import { showAppToast } from './toast.js';

export const REMOTE_PIP_W = 280;
export const REMOTE_PIP_H = 640;
export const REMOTE_POPUP_W = 280;
export const REMOTE_POPUP_H = 640;

/** @type {Window|null} */
let activePipWindow = null;
/** @type {{ type: string, id: string }|null} */
let activePipOwner = null;

export function appDirectoryUrl() {
    try {
        const path = window.location.pathname || '/';
        const dir = path.endsWith('/') ? path : path.replace(/[^/]+$/, '');
        return new URL(dir, window.location.origin).href;
    } catch {
        return window.location.href;
    }
}

export function supportsDocumentPip() {
    try {
        return typeof window !== 'undefined'
            && window.isSecureContext !== false
            && !!(window.documentPictureInPicture
                && typeof window.documentPictureInPicture.requestWindow === 'function');
    } catch {
        return false;
    }
}

/** True when the page already has a native video Picture-in-Picture element. */
export function anyNativeVideoPipActive() {
    try {
        return typeof document !== 'undefined' && !!document.pictureInPictureElement;
    } catch {
        return false;
    }
}

/** Prefer popup when native video PiP is active or another Document PiP owner is open. */
export function shouldUseDocumentPipFor(owner = null) {
    if (!supportsDocumentPip()) return false;
    if (anyNativeVideoPipActive()) return false;
    if (!isPipOccupied()) return true;
    if (!owner) return false;
    const active = getActivePipOwner();
    return active?.type === owner.type && active?.id === owner.id;
}

export function isPipOccupied() {
    return !!(activePipWindow && !activePipWindow.closed);
}

export function getActivePipOwner() {
    return isPipOccupied() ? activePipOwner : null;
}

export function registerPipWindow(win, owner) {
    if (!win) return;
    activePipWindow = win;
    activePipOwner = owner || null;
    const clear = () => {
        if (activePipWindow === win) {
            activePipWindow = null;
            activePipOwner = null;
        }
    };
    win.addEventListener('pagehide', clear);
}

export function unregisterPipWindow(win) {
    if (activePipWindow === win) {
        activePipWindow = null;
        activePipOwner = null;
    }
}

export function cloneAppStylesInto(targetDoc, sourceDoc = document) {
    if (!targetDoc?.head) return;
    const head = targetDoc.head;
    const base = targetDoc.createElement('base');
    base.href = appDirectoryUrl();
    head.prepend(base);
    sourceDoc.head.querySelectorAll('link, style').forEach((node) => {
        head.appendChild(node.cloneNode(true));
    });
}

export function copyThemeAttributes(sourceDoc, targetDoc) {
    const src = sourceDoc?.documentElement;
    const dst = targetDoc?.documentElement;
    if (!src || !dst) return;
    for (const attr of src.attributes) {
        if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'lang') {
            dst.setAttribute(attr.name, attr.value);
        }
    }
    if (!src.style || !dst.style) return;
    for (let i = 0; i < src.style.length; i++) {
        const name = src.style[i];
        dst.style.setProperty(name, src.style.getPropertyValue(name), src.style.getPropertyPriority(name));
    }
}

export function browserPopupFeatures(width, height) {
    return `popup=yes,width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`;
}

export function openBrowserPopup(url, name, width, height) {
    const features = browserPopupFeatures(width, height);
    const win = window.open(url, name, features);
    if (!win) {
        showAppToast('Pop-out blocked — allow popups for this site');
        return null;
    }
    try {
        win.focus();
    } catch {
        /* ignore */
    }
    return win;
}

export async function requestPipWindow({ width, height, owner, onPageHide }) {
    if (!supportsDocumentPip()) return null;
    if (isPipOccupied()) return null;

    let pipWin;
    try {
        pipWin = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (err) {
        console.warn('[popoutWindows] Picture-in-Picture unavailable:', err);
        return null;
    }
    if (!pipWin?.document) return null;

    registerPipWindow(pipWin, owner);
    cloneAppStylesInto(pipWin.document);
    copyThemeAttributes(document, pipWin.document);
    pipWin.document.documentElement.dataset.popoutMode = 'pip';

    if (onPageHide) {
        pipWin.addEventListener('pagehide', onPageHide);
    }

    return pipWin;
}

export function prepareBlankPopoutDocument(win, bodyClass = 'remote-popout-body') {
    if (!win?.document) return null;
    const doc = win.document;
    cloneAppStylesInto(doc);
    copyThemeAttributes(document, doc);
    doc.documentElement.dataset.popoutMode = 'window';
    doc.body.className = bodyClass;
    doc.body.innerHTML = '';
    return doc;
}

export function windowNameForRemote() {
    return 'magictv-remote';
}

export function remotePopoutSize() {
    const w = shouldUseDocumentPipFor({ type: 'module', id: 'remote' }) ? REMOTE_PIP_W : REMOTE_POPUP_W;
    const h = shouldUseDocumentPipFor({ type: 'module', id: 'remote' }) ? REMOTE_PIP_H : REMOTE_POPUP_H;
    return { w, h };
}
