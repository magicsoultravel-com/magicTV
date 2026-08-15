/** @module {"owns":"magicTV icon constants - subset of magiclists"} */

export const CARD_ICONS = {
    star: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 1.8l1.4 2.8 3.1.5-2.3 2.1.6 3.1L6 8.6l-2.8 1.7.6-3.1-2.3-2.1 3.1-.5L6 1.8z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    starFilled: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 1.8l1.4 2.8 3.1.5-2.3 2.1.6 3.1L6 8.6l-2.8 1.7.6-3.1-2.3-2.1 3.1-.5L6 1.8z" fill="currentColor" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    /** Large tile hover fav — thin outline so it stays light at 20px. */
    tileStar: '<svg viewBox="0 0 12 12" width="20" height="20" focusable="false" aria-hidden="true"><path d="M6 1.8l1.4 2.8 3.1.5-2.3 2.1.6 3.1L6 8.6l-2.8 1.7.6-3.1-2.3-2.1 3.1-.5L6 1.8z" fill="none" stroke="currentColor" stroke-width="0.45" stroke-linejoin="round"/></svg>',
    tileStarFilled: '<svg viewBox="0 0 12 12" width="20" height="20" focusable="false" aria-hidden="true"><path d="M6 1.8l1.4 2.8 3.1.5-2.3 2.1.6 3.1L6 8.6l-2.8 1.7.6-3.1-2.3-2.1 3.1-.5L6 1.8z" fill="currentColor" stroke="none"/></svg>',
    close: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    chevronRight: '<svg viewBox="0 0 12 12" width="9" height="9" focusable="false"><path d="M4.8 3.2 7.6 6 4.8 8.8" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronDown: '<svg viewBox="0 0 12 12" width="9" height="9" focusable="false"><path d="M3.2 4.8 6 7.6 8.8 4.8" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    /** Prohibition / “no signal” road-sign for failed tile frame grabs. */
    prohibited: '<svg viewBox="0 0 12 12" width="18" height="18" focusable="false" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M3.1 3.1l5.8 5.8" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>',
    /** Queued / not yet capturing — simple hourglass. */
    waiting: '<svg viewBox="0 0 12 12" width="16" height="16" focusable="false" aria-hidden="true"><path d="M3.2 2.2h5.6M3.2 9.8h5.6M3.6 2.2 8.4 6 3.6 9.8M8.4 2.2 3.6 6 8.4 9.8" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    /** Capture in flight — arc spinner (CSS rotates the element). */
    loading: '<svg viewBox="0 0 12 12" width="16" height="16" focusable="false" aria-hidden="true"><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="18 10" opacity="0.95"/></svg>',
};

export const ACTION_ICONS = {
    play: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3 2v8l6-4-6-4z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.5" y="2" width="1.5" height="8" fill="currentColor"/><rect x="8" y="2" width="1.5" height="8" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>',
    link: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.4 6.6c1.1-1.1 1.1-2.9 0-4M7.6 5.4c1.1 1.1 1.1 2.9 0 4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/><path d="M4.4 6.6L3.2 5.4M7.8 7.2 8.8 8.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    pictureInPicture: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.5" y="3.2" width="6.3" height="4.8" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.85"/><path d="M7 4 10.6 1.4M10.6 1.4H8.6M10.6 1.4V3.4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pictureInPictureExit: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.5" y="3.2" width="6.3" height="4.8" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.85"/><path d="M9.2 2.2 4.8 6.6M6.8 6.6H4.8V4.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    expand: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    collapse: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fullscreenEnter: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 2.4h2.8M2.4 2.4v2.8M9.6 2.4H6.8M9.6 2.4v2.8M2.4 9.6h2.8M2.4 9.6V6.8M9.6 9.6H6.8M9.6 9.6V6.8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    fullscreenExit: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.2 4.2H2.8M4.2 4.2V2.8M7.8 4.2h1.4M7.8 4.2V2.8M4.2 7.8H2.8M4.2 7.8v1.4M7.8 7.8h1.4M7.8 7.8v1.4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
};
