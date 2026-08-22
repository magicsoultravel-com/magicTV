/**
 * Normalize channel / display names for fuzzy EPG matching.
 * @param {string} name
 */
export function normalizeName(name) {
    if (!name || typeof name !== 'string') return '';
    return name
        .toLowerCase()
        .replace(/&amp;/g, '&')
        .replace(/['']/g, '')
        .replace(/\b(hd|sd|uhd|4k|tv|channel|international)\b/gi, ' ')
        .replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} higher = better match
 */
export function scoreNameMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 100;
    if (nb.startsWith(na) || na.startsWith(nb)) return 80;
    if (nb.includes(na) || na.includes(nb)) return 60;
    const aw = new Set(na.split(' ').filter(Boolean));
    const bw = new Set(nb.split(' ').filter(Boolean));
    let overlap = 0;
    for (const w of aw) if (bw.has(w)) overlap++;
    if (overlap >= 2) return 40 + overlap * 5;
    if (overlap === 1 && aw.size <= 2) return 30;
    return 0;
}

/**
 * @typedef {{ id: string, names: string[] }} ChannelIndexEntry
 */

/**
 * @param {string} channelName
 * @param {ChannelIndexEntry[]} index
 * @returns {{ id: string, matchedName: string, score: number }|null}
 */
export function matchChannelByName(channelName, index) {
    if (!channelName || !index?.length) return null;
    let best = null;
    let bestScore = 0;
    for (const entry of index) {
        for (const name of entry.names || []) {
            const score = scoreNameMatch(channelName, name);
            if (score > bestScore) {
                bestScore = score;
                best = { id: entry.id, matchedName: name, score };
            }
        }
    }
    return bestScore >= 30 ? best : null;
}
