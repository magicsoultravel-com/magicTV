/**
 * hls.js loader that routes manifest + segment requests through a user-supplied
 * proxy template (`https://my-proxy/?url={url}`).
 *
 * hls.js resolves relative segment URIs against the *proxied* manifest URL, so
 * the loader keeps the last unwrapped URL and re-resolves relative requests
 * against it before proxying again.
 */
import { applyProxyTemplate, normalizeProxyTemplate } from './webStreamLinks.js';

const RAW_TOKEN = '__MTV_RAW_URL__';
const ENC_TOKEN = '__MTV_ENC_URL__';

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reverse `applyProxyTemplate`: recover the original URL from a proxied one.
 * @param {string} template
 * @param {string} url
 * @returns {string} original URL or ''
 */
export function unwrapProxyUrl(template, url) {
    const tpl = normalizeProxyTemplate(template);
    if (!tpl || typeof url !== 'string' || !url) return '';
    let pattern = tpl
        .replace(/\{url_encoded\}/g, ENC_TOKEN)
        .replace(/\{url\}/g, RAW_TOKEN);
    pattern = escapeRegex(pattern)
        .split(escapeRegex(RAW_TOKEN)).join('(.+?)')
        .split(escapeRegex(ENC_TOKEN)).join('(.+?)');
    const match = new RegExp(`^${pattern}$`).exec(url);
    if (!match) return '';
    const value = match[1] || '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Decide what URL the loader should request for one hls.js request.
 * @param {object} params
 * @param {string} params.url            URL hls.js asked for (absolute or relative)
 * @param {string} params.template       proxy template
 * @param {string} [params.lastOriginal] original URL of the last playlist
 * @returns {{ url: string, original: string }}
 */
export function rewriteRequestUrl({ url, template, lastOriginal = '' }) {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) return { url: raw, original: '' };
    if (/^(blob|data):/i.test(raw)) return { url: raw, original: '' };

    const unwrapped = unwrapProxyUrl(template, raw);
    if (unwrapped) return { url: raw, original: unwrapped };

    let absolute = '';
    if (/^https?:/i.test(raw)) {
        absolute = raw;
    } else if (lastOriginal) {
        try {
            absolute = new URL(raw, lastOriginal).toString();
        } catch {
            return { url: raw, original: '' };
        }
    } else {
        // No known original base — leave it to hls.js rather than invent one.
        return { url: raw, original: '' };
    }
    if (!/^https?:/i.test(absolute)) return { url: raw, original: '' };
    const proxied = applyProxyTemplate(template, absolute);
    return { url: proxied || absolute, original: absolute };
}

/**
 * Build an hls.js custom loader class bound to one proxy template.
 * @param {any} Hls hls.js namespace (needs DefaultConfig.loader or XhrLoader)
 * @param {string} template
 * @returns {any | null}
 */
export function createProxyLoader(Hls, template) {
    const tpl = normalizeProxyTemplate(template);
    if (!Hls || !tpl) return null;
    const Base = Hls.DefaultConfig?.loader || Hls.XhrLoader;
    if (typeof Base !== 'function') return null;

    return class WebStreamProxyLoader extends Base {
        constructor(config) {
            super(config);
            this._lastOriginal = '';
        }

        load(context, config, callbacks) {
            const rewritten = rewriteRequestUrl({
                url: context?.url,
                template: tpl,
                lastOriginal: this._lastOriginal
            });
            if (rewritten.original) this._lastOriginal = rewritten.original;
            if (context && rewritten.url) context.url = rewritten.url;
            return super.load(context, config, callbacks);
        }
    };
}

/**
 * Merge the proxy loader into a base hls.js config (no-op without a template).
 * @param {object} config
 * @param {{ Hls?: any, proxyTemplate?: string }} opts
 * @returns {object}
 */
export function withProxyLoader(config, { Hls, proxyTemplate = '' } = {}) {
    const Loader = createProxyLoader(Hls, proxyTemplate);
    if (!Loader) return config;
    return { ...config, loader: Loader };
}
