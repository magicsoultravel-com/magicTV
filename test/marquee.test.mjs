import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readCssWithImports } from './helpers/readCssWithImports.mjs';
import {
    marqueeInnerHtml,
    measureMarqueeHost,
    setMarqueeText,
    applyMarquee
} from '../js/ui/marquee.js';

const css = readCssWithImports(join(process.cwd(), 'css/components/settings.css'));
const armedRule = css.match(/\.is-marquee\s*\{[^}]*\}/)?.[0] || '';
const trackRule = css.match(/\.is-marquee \.marquee-track\s*\{[^}]*\}/)?.[0] || '';
const keyframes = css.match(/@keyframes marquee-dup\s*\{[\s\S]*?\n\}/)?.[0] || '';

/** Minimal DOM stand-ins — layout metrics come from the fixture, not a browser. */
function makeText(width) {
    const attrs = {};
    return {
        width,
        attrs,
        getBoundingClientRect() {
            return { width: this.width };
        },
        cloneNode() {
            return makeText(this.width);
        },
        setAttribute(name, value) {
            attrs[name] = value;
        },
        remove() {}
    };
}

function makeTrack(textNode) {
    const children = [textNode];
    return {
        children,
        querySelector(sel) {
            if (sel.includes('aria-hidden')) {
                return children.find((node) => node.attrs['aria-hidden'] !== 'true') || null;
            }
            return children[0] || null;
        },
        querySelectorAll(sel) {
            if (sel.includes('aria-hidden')) {
                return children.filter((node) => node.attrs['aria-hidden'] === 'true');
            }
            return children.slice();
        },
        appendChild(node) {
            children.push(node);
            return node;
        }
    };
}

function makeHost({ width = 100, textWidth = 220, tile = null } = {}) {
    const text = makeText(textWidth);
    const track = makeTrack(text);
    const classes = new Set();
    const vars = {};
    const host = {
        isConnected: true,
        clientWidth: width,
        style: {
            setProperty(name, value) {
                vars[name] = value;
            }
        },
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        getBoundingClientRect() {
            return { width };
        },
        querySelector(sel) {
            return sel.includes('marquee-track') ? track : null;
        },
        closest() {
            return tile;
        },
        matches() {
            return false;
        }
    };
    return { host, track, classes, vars };
}

afterEach(() => {
    delete globalThis.window;
});

describe('marquee arming', () => {
    it('arms and publishes the measured overflow for a clipped name', () => {
        const { host, track, classes, vars } = makeHost({ width: 100, textWidth: 220 });
        assert.equal(measureMarqueeHost(host), 'armed');
        assert.equal(classes.has('is-marquee'), true);
        assert.equal(track.children.length, 2);
        assert.equal(track.children[1].attrs['aria-hidden'], 'true');
        assert.equal(vars['--marquee-shift'], '-120px');
        assert.match(vars['--marquee-duration'], /^\d+(\.\d+)?s$/);
    });

    it('leaves a name that fits alone (keeps the CSS ellipsis)', () => {
        const { host, track, classes } = makeHost({ width: 200, textWidth: 190 });
        assert.equal(measureMarqueeHost(host), 'fits');
        assert.equal(classes.has('is-marquee'), false);
        assert.equal(track.children.length, 1);
    });

    it('ignores sub-pixel overflow', () => {
        const { host, classes } = makeHost({ width: 100, textWidth: 101 });
        assert.equal(measureMarqueeHost(host), 'fits');
        assert.equal(classes.has('is-marquee'), false);
    });

    it('defers a host with no layout box so it can be re-measured on reveal', () => {
        const { host, classes } = makeHost({ width: 0, textWidth: 220 });
        assert.equal(measureMarqueeHost(host), 'deferred');
        assert.equal(classes.has('is-marquee'), false);
    });

    it('never arms when the user asked for reduced motion', () => {
        globalThis.window = { matchMedia: () => ({ matches: true }) };
        const { host, classes } = makeHost({ width: 100, textWidth: 220 });
        assert.equal(measureMarqueeHost(host), 'reduced');
        assert.equal(classes.has('is-marquee'), false);
    });

    it('skips labels that were never wrapped in a track', () => {
        const host = { classList: { add() {}, remove() {} }, querySelector: () => null };
        assert.equal(measureMarqueeHost(host), 'skip');
        assert.equal(measureMarqueeHost(null), 'skip');
    });

    it('floors the cycle duration for barely overflowing names', () => {
        const { host, vars } = makeHost({ width: 100, textWidth: 104 });
        assert.equal(measureMarqueeHost(host), 'armed');
        assert.equal(vars['--marquee-duration'], '4s');
    });
});

describe('marquee markup helpers', () => {
    it('escapes the name inside track/text spans', () => {
        const html = marqueeInnerHtml('<e> & "quoted"');
        assert.match(html, /^<span class="marquee-track"><span class="marquee-text">/);
        assert.match(html, /&lt;e&gt; &amp; &quot;quoted&quot;/);
        assert.equal(html.includes('<e>'), false);
    });

    it('setMarqueeText rebuilds the track and measures the host', () => {
        const { host, track, classes } = makeHost({ width: 100, textWidth: 220 });
        setMarqueeText(host, 'Station');
        assert.equal(track.children.length, 2);
        assert.equal(classes.has('is-marquee'), true);
    });

    it('applyMarquee tolerates roots without a host list', () => {
        assert.doesNotThrow(() => applyMarquee({}));
        assert.doesNotThrow(() => applyMarquee(null));
    });
});

describe('marquee CSS contract', () => {
    it('scrolls by the JS-measured overflow, not a fixed percentage', () => {
        assert.ok(keyframes, 'marquee-dup keyframes missing');
        assert.match(keyframes, /translateX\(var\(--marquee-shift/);
        assert.equal(keyframes.includes('translateX(-50%)'), false);
    });

    it('drives the cycle duration from --marquee-duration', () => {
        assert.ok(trackRule, '.is-marquee .marquee-track rule missing');
        assert.match(trackRule, /animation:\s*marquee-dup\s+var\(--marquee-duration/);
        assert.equal(/animation:\s*marquee-dup\s+\d/.test(trackRule), false);
        assert.match(trackRule, /display:\s*flex/);
    });

    it('clips rather than ellipsises an armed label', () => {
        assert.ok(armedRule, '.is-marquee rule missing');
        assert.match(armedRule, /text-overflow:\s*clip/);
        assert.match(armedRule, /overflow:\s*hidden/);
    });
});

describe('marquee reveal handling', () => {
    const observers = [];

    before(() => {
        globalThis.requestAnimationFrame = (fn) => fn();
        globalThis.IntersectionObserver = class {
            constructor(cb, opts) {
                this.cb = cb;
                this.opts = opts;
                this.targets = new Set();
                observers.push(this);
            }
            observe(target) { this.targets.add(target); }
            unobserve(target) { this.targets.delete(target); }
            trigger(entry) { this.cb([entry], this); }
        };
        globalThis.ResizeObserver = class {
            constructor(cb) { this.cb = cb; this.targets = new Set(); }
            observe(target) { this.targets.add(target); }
            unobserve(target) { this.targets.delete(target); }
        };
    });

    after(() => {
        delete globalThis.requestAnimationFrame;
        delete globalThis.IntersectionObserver;
        delete globalThis.ResizeObserver;
    });

    /** `content-visibility: auto` tile — the observer target, not the label. */
    function makeTile(host) {
        return {
            querySelectorAll: () => [host],
            querySelector: () => null,
            matches: () => false
        };
    }

    it('re-measures a deferred label once its tile scrolls in', () => {
        const { host, classes, vars } = makeHost({ width: 0, textWidth: 300 });
        const tile = makeTile(host);
        host.closest = () => tile;

        applyMarquee({ querySelectorAll: () => [host] });
        assert.equal(classes.has('is-marquee'), false);
        const io = observers.find((observer) => observer.targets.has(tile));
        assert.ok(io, 'tile should be observed for visibility');

        host.clientWidth = 120;
        io.trigger({ target: tile, isIntersecting: true });
        assert.equal(classes.has('is-marquee'), true);
        assert.equal(vars['--marquee-shift'], '-180px');
        assert.equal(io.targets.has(tile), false);
    });

    it('stops retrying when a visible label never gets a layout box', () => {
        const { host, classes } = makeHost({ width: 0, textWidth: 300 });
        const tile = makeTile(host);
        host.closest = () => tile;

        applyMarquee({ querySelectorAll: () => [host] });
        const io = observers.find((observer) => observer.targets.has(tile));
        let reveals = 0;
        while (io.targets.has(tile) && reveals < 10) {
            reveals += 1;
            io.trigger({ target: tile, isIntersecting: true });
        }
        assert.equal(reveals, 3);
        assert.equal(classes.has('is-marquee'), false);
    });
});
