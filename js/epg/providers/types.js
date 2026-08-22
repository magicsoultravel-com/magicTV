/** @typedef {'ok'|'miss'|'no-source'|'error'|'cors-blocked'} EpgStatus */

/**
 * @typedef {Object} EpgResult
 * @property {EpgStatus} status
 * @property {import('../xmltvParser.js').Programme[]} [programmes]
 * @property {import('../xmltvParser.js').Programme} [current]
 * @property {import('../xmltvParser.js').Programme} [next]
 * @property {string} [source]
 * @property {string} [matchedName]
 * @property {string} [message]
 * @property {string[]} [tried]
 */

/**
 * @typedef {Object} EpgProvider
 * @property {string} id
 * @property {(channel: object) => boolean} supports
 * @property {(channel: object, opts?: { dayOffset?: number, nowMs?: number }) => Promise<EpgResult>} resolveProgrammes
 */

/** @param {string} channelKey */
export function mappingKey(channelKey, providerId) {
    return `${channelKey}:${providerId}`;
}
