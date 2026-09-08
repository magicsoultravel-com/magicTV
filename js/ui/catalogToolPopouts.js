/**
 * Catalog tool popouts (filter / category / sort).
 * Portaled to document.body so footer overflow never clips them.
 */

const HOME = new WeakMap();

function stashHome(panel) {
    if (HOME.has(panel)) return;
    HOME.set(panel, {
        parent: panel.parentNode,
        next: panel.nextSibling
    });
}

function restoreHome(panel) {
    const home = HOME.get(panel);
    if (!home?.parent) return;
    if (home.next && home.next.parentNode === home.parent) {
        home.parent.insertBefore(panel, home.next);
    } else {
        home.parent.appendChild(panel);
    }
    HOME.delete(panel);
}

function clearInlinePosition(panel) {
    panel.style.position = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.transform = '';
    panel.style.width = '';
    panel.style.minWidth = '';
    panel.style.maxWidth = '';
    panel.style.zIndex = '';
}

/**
 * @param {HTMLElement | null | undefined} panel
 * @param {HTMLElement | null | undefined} anchorBtn
 */
export function openCatalogToolPopout(panel, anchorBtn) {
    if (!panel || !anchorBtn) return;
    stashHome(panel);
    const rect = anchorBtn.getBoundingClientRect();
    const gap = 6;
    const minW = Math.max(176, rect.width);
    const maxW = Math.min(288, Math.floor(window.innerWidth * 0.72));
    const width = Math.min(Math.max(minW, 200), maxW);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const bottom = Math.max(8, window.innerHeight - rect.top + gap);

    document.body.appendChild(panel);
    panel.classList.add('is-catalog-tool-popout', 'is-visible');
    panel.style.position = 'fixed';
    panel.style.left = `${Math.round(left)}px`;
    panel.style.bottom = `${Math.round(bottom)}px`;
    panel.style.top = 'auto';
    panel.style.right = 'auto';
    panel.style.transform = 'none';
    panel.style.width = `${width}px`;
    panel.style.minWidth = `${width}px`;
    panel.style.maxWidth = `${maxW}px`;
    panel.style.zIndex = '10050';
}

/**
 * @param {HTMLElement | null | undefined} panel
 */
export function closeCatalogToolPopout(panel) {
    if (!panel) return;
    panel.classList.remove('is-visible');
    if (panel.classList.contains('is-catalog-tool-popout')) {
        clearInlinePosition(panel);
        panel.classList.remove('is-catalog-tool-popout');
        restoreHome(panel);
    }
}

/**
 * @param  {...(HTMLElement | null | undefined)} panels
 */
export function closeAllCatalogToolPopouts(...panels) {
    for (const panel of panels) closeCatalogToolPopout(panel);
}

export function isCatalogToolPopoutEventTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
        target.closest('.tv-tab-popup')
        || target.closest('.is-catalog-tool-popout')
        || target.closest('.tv-tab--filter-input')
        || target.closest('.tv-tab--category')
        || target.closest('.tv-tab--sort')
        || target.closest('#sort-dir-btn')
    );
}
