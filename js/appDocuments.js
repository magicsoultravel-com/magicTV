/** Multi-document element lookup for module popouts. */

/** @type {Set<Document>} */
const extraDocuments = new Set();

export function registerAppDocument(doc) {
    if (doc && doc !== document) extraDocuments.add(doc);
}

export function unregisterAppDocument(doc) {
    extraDocuments.delete(doc);
}

export function forEachAppDocument(fn) {
    for (const doc of extraDocuments) fn(doc);
}

/** Search the main document then any registered popout documents. */
export function getAppElementById(id) {
    if (!id) return null;
    const main = document.getElementById(id);
    if (main) return main;
    for (const doc of extraDocuments) {
        try {
            const found = doc.getElementById(id);
            if (found) return found;
        } catch {
            /* detached document */
        }
    }
    return null;
}

export function queryAllInApp(selector) {
    const out = [];
    if (typeof document !== 'undefined') {
        out.push(...document.querySelectorAll(selector));
    }
    for (const doc of extraDocuments) {
        try {
            out.push(...doc.querySelectorAll(selector));
        } catch {
            /* ignore */
        }
    }
    return out;
}

export function getAppDocumentForElement(node) {
    return node?.ownerDocument || document;
}

export function getAppBodyForElement(anchor) {
    return getAppDocumentForElement(anchor).body || document.body;
}

export function getAppWindowForElement(anchor) {
    return getAppDocumentForElement(anchor).defaultView || window;
}
