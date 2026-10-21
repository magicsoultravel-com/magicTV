# 🎬 magicTV

**Neon-styled TV streaming browser** — Browse and play live channels in a stunning cyberpunk interface.

## ✨ Features

- **🌍 Browse Channels** — Filter by country, search, infinite scroll
- **❤️ Favorites** — Heart channels for quick access
- **📺 Recents** — Auto-tracked watch history
- **⚙️ Settings** — Buffer, multi-screen layout, appearance (themes/fonts/colors), hidden/visited browsers, watch stats
- **📱 Responsive** — Works on mobile, tablet, TV browser, desktop
- **🎨 Themes** — Preset themes with customizable accent, background, border, and text colors
- **🔊 Full Controls** — Play, pause, volume, quality, Picture-in-Picture, fullscreen, Chromecast
- **▶️ YouTube Mode** — Run an embedded YouTube clip on one TV tile; paste a link or pick a saved clip
- **🌐 Web Video** — Paste any page (or direct `.m3u8`/`.mp4`) and play the video behind it on a tile; sniffer + optional proxy, no backend
- **🔗 Share Channels** — Copy a raw stream link or a magicTV deep link that opens the channel on a TV screen
- **💾 Persistent** — localStorage saves favorites, recents, settings
- **🚀 No Build** — Pure JavaScript modules, runs directly in browser

## 🚀 Quick Start

### Using Python (Recommended)
```bash
cd /path/to/magicTV
python3 -m http.server 8000
```
Then open: `http://localhost:8000`

### Using Node.js
```bash
cd /path/to/magicTV
npx http-server -p 8000
```

### Using any HTTP server
Just serve the directory and navigate to `index.html`.

## 🧪 Running Tests

No dependencies — uses Node's built-in test runner (Node 18+).

```bash
cd /path/to/magicTV
npm test            # or: node --test
```

36 tests cover:

| File | Covers |
|------|--------|
| `test/moduleGraph.test.mjs` | **Module-graph integrity** — every local import reachable from `app.js` must resolve (regression test for the empty-page bug) |
| `test/appBoot.test.mjs` | `app.js` imports safely without a DOM + every `el('id')` the app uses exists in `index.html` |
| `test/bootSmoke.test.mjs` | Runs the real `init()` with a DOM stub & mocked offline fetch — asserts the app boots and renders a graceful empty state |
| `test/tvPlayer.test.mjs` | Favorites, favorites metadata, recents (cap 100 default / 0–500 / unlimited, newest-first), buffer-size clamping (5–120s), volume clamping, provider settings |
| `test/tvUtils.test.mjs` | `escapeHtml`, `countryFlagEmoji`, `debounce`, `formatRelativeTime` |
| `test/channelShape.test.mjs` | `channelKey`, `parseChannelKey`, `normalizeChannel`, `migrateFavoriteRef` |
| `test/shareChannel.test.mjs` | Deep-link build/parse round-trip, stream link, `chooseSharedPlayTarget` slot policy (free → center, full → last/fallback) |
| `test/frameCache.test.mjs` | `FrameCache.setFrame`/`getFrame` round-trip, 7-day TTL expiry, per-key remove |
| `test/youtubeLibrary.test.mjs` | Saved-clip library normalization, add/remove/toggle, oEmbed metadata lookup (timeouts, failures) |
| `test/youtubeQueue.test.mjs` | Queue ordering (current → author → library → related → history), dedupe/caps, append-without-index-shift, step/select/retarget, history move-to-front |
| `test/youtubeRelated.test.mjs` | Piped/Invidious payload parsers, provider + attempt ordering, host health cooldown, positive/negative cache TTL, in-flight de-dupe, timeout degradation |
| `test/youtubeChrome.test.mjs` | Prev/next/tray markup contract, tray thumbnails + escaping, `is-youtube` CSS gating, settings markup/bindings |
| `test/mosaicYouTube.test.mjs` | YouTube-mode lifecycle (one live tile, detach/restore, swap) + queue stepping, tray jump, ENDED auto-advance |

## 📁 Project Structure

```
magicTV/
├── index.html              # App shell & layout
├── css/
│   ├── base.tv.css         # Core styles & theme variables
│   ├── tv-clock.css         # Header clock widget styles
│   ├── tv-landing.css       # @import hub — loads components in cascade order
│   └── components/          # Per-domain stylesheets (split via scripts/split-css.py)
│       ├── boot-screen.css  # Boot cover, test card, toast system, app skeleton
│       ├── layout.css       # Header, bottom tabs, filter/sort toolbar, splitter
│       ├── catalog.css      # Channel/country grids, tiles, visited accents, favorites
│       ├── mosaic.css       # Active-tile indicators, mosaic grid, free layout
│       ├── player.css       # Player slots, playback surfaces, swap animations, controls
│       ├── settings.css     # Settings panels, appearance controls, responsive tweaks
│       ├── modals.css       # Channel picker modal, tab-bar popups
│       ├── youtube.css      # YouTube tile embed + clip picker overlay
│       ├── webstream.css    # Web Video chrome, page iframe tiles + picker
│       ├── remote.css       # Aggregator → remote/*.css (shell, shapes, panel, textures, pickers)
│       └── remote/          # Remote module parts (shell, shapes, panel, textures, pickers)
├── js/
│   ├── app.js             # Main app logic (tabs, events, state)
│   ├── tvPlayer.js        # HLS player state machine (extracted)
│   ├── tvUtils.js         # Helpers (flags, HTML escape, etc.)
│   ├── tvHls.js           # HLS.js library loader (CDN + SRI)
│   ├── tvPip.js           # Picture-in-Picture support
│   ├── toast.js           # Bridge re-export → ui/toast.js
│   ├── icons.js           # Bridge re-export → ui/icons.js
│   ├── clipboard.js       # Bridge re-export → ui/clipboard.js
│   ├── mosaic/             # MultiView mixins (playback, persist, chrome, youtube, webstream)
│   ├── youtube/
│   │   ├── youtubeLinks.js    # URL/id/thumb helpers (pure)
│   │   ├── youtubeApi.js      # Lazy IFrame API loader
│   │   ├── youtubeLibrary.js  # Saved clips + oEmbed metadata
│   │   ├── youtubeQueue.js    # Tile play queue + watch history (pure/storage)
│   │   ├── youtubeRelated.js  # Piped → Invidious related lookup, cache + host health
│   │   └── youtubePlayer.js   # playerInstance-compatible embed adapter
│   ├── webstream/
│   │   ├── webStreamLinks.js    # Media/page URL helpers, synthetic channel (pure)
│   │   ├── webStreamResolver.js # Resolution ladder: direct → scrape → proxy → embed
│   │   ├── webStreamSniffer.js  # Bookmarklet + postMessage + pasted-URL fallback
│   │   ├── webStreamLoader.js   # hls.js loader that rewrites requests via a proxy
│   │   ├── webStreamLibrary.js  # Saved pages/streams (localStorage)
│   │   ├── webShield.js         # Embed page shield: sandbox + permission policy (pure)
│   │   └── webPagePlayer.js     # Last-resort iframe embed helpers
│   ├── tvProviders/
│   │   ├── registry.js    # Provider abstraction
│   │   ├── channelShape.js # Channel data model
│   │   └── iptvOrgTv.js   # iptv-org API provider
│   ├── storage/
│   │   ├── indexedDbStore.js # IndexedDB catalog caching
│   │   └── frameCache.js  # Thumbnail frame cache
│   └── ui/
│       ├── icons.js       # SVG icon constants
│       ├── toast.js       # Toast notifications
│       └── clipboard.js   # Copy to clipboard
├── test/                  # Node built-in test suite
└── assets/
│   └── brand/
│       └── icon-tv.svg    # Neon TV icon
└── README.md
```

## 🎮 Usage

### Browsing
1. **Select Country** — Click a country tile to browse channels
2. **Search** — Use search box to filter countries
3. **Infinite scroll** — Channels load automatically as you scroll down

### Playing
1. **Click Channel** — Inline video player appears
2. **Controls** — Play/Pause, Volume, Quality (when available), PiP, Fullscreen
3. **Resume** — "Now Playing" card shows last watched; click Resume to continue

### YouTube mode (one tile)
Hover a TV tile and press the **YouTube** button (rounded play glyph) to paste a `youtube.com` / `youtu.be` link or pick a saved clip. Clips are remembered in a local library (`magictv_youtube_library_v1`).

- Only **one** tile can run YouTube at a time — choosing it on another tile moves the embed there and releases the previous tile back to its TV channel.
- The embedded player keeps its own seek/volume/quality controls; the tile's ▶ / ⏹ / mute / volume / fullscreen buttons drive it too.
- The embed is contain-fit like a TV `<video>`: the whole 16:9 player stays visible, so YouTube's own control bar is never cropped or magnified.
- **Drag from the grab handle** — the embed swallows pointer events on its own surface, so a YouTube tile is moved by the grip icon at the left of its hover chrome (hover the tile to reveal it); the edge handles still resize it and a plain click raises the tile.
- **Swap with main** works on a YouTube tile — the embed is re-created on the other screen at the same clip, playhead and mute/volume, while the TV stream moves across untouched (the iframe has to reload, so it buffers for a moment). The channel YouTube displaced follows the embed, and Rotate/TV Travel leave the embed on its own screen.
- Cast, pop-out/PiP, favourite and Bank are unavailable on a YouTube tile (a cross-origin embed can't be captured or cast).
- Press the button again (or pick a channel on that tile) to leave YouTube mode and return to the channel that was there before.

#### Next / previous + related tray
Every YouTube tile gets a **⏮ / queue / ⏭** group in its hover strip (shown only while the tile is in YouTube mode), with the thumbnail tray sliding out above it.

- The queue is built locally and instantly: **current clip → the same channel from your saved clips → the rest of your saved clips → related videos → watch history**. Prev/next therefore works offline.
- **Related videos** are fetched from public, key-less APIs — **Piped** first (`api.piped.private.coffee`, `pipedapi.ducks.party`), **Invidious** as fallback. Both answer with CORS `*`; InnerTube's `next` endpoint rejects browser preflights and the Data API v3 dropped `relatedToVideoId`, so neither is used.
- Suggestions are **appended at the tail only**, so the live index never moves mid-video. Thumbnails always come from `i.ytimg.com` (instance proxies and signed URLs expire).
- Different clip = `loadVideoById()` on the live iframe (no teardown), so mute/volume/play intent carry across and the switch is instant.
- Hovering the group slides out the **thumbnail tray**; the middle button pins it open and clicking a card jumps to that clip. Edge tiles clamp the tray inwards so it never leaves the screen.
- **ENDED auto-advances** to the next entry when *Auto-play next video* is on.
- Related lookups cache for 6 h (misses for 15 min), de-dupe concurrent requests, and remember failing hosts (2 failures → 10 min cooldown, healthy hosts tried first) so a dead instance never costs a timeout twice.
- Settings → **YouTube** turns related lookup on/off, picks the provider, sets a custom Invidious instance, toggles auto-play, and clears watch history (`magictv_youtube_history_v1` + `magictv_youtube_queue_v1`). Saved clips are untouched.

### Web Video (any page or direct link)
Hover a TV tile, then hover the **YouTube** button to slide out the **globe** button (Web Video). Paste any page URL — magicTV looks for the video behind it — or a direct `.m3u8` / `.mp4` link, which plays immediately.

- **Resolution ladder** (all client-side, no backend):
  1. The pasted URL is already a media file → plays at once.
  2. magicTV `fetch`es the page and scans its HTML for `<video>`/`<source>`/`src`/`file`/`contentUrl`/`og:video`/JSON blobs.
  3. Sites that block cross-origin reads are retried through your optional proxy template (`…?url={url}`).
  4. Still blocked → **Sniff**: drag the *magicTV Sniff* bookmarklet to your bookmarks bar, open the page, press play there, click the bookmark. It reports the `.m3u8`/`.mp4` URLs the page itself requested back to the picker (`postMessage`, plus a clipboard copy as fallback). A paste box accepts the report or any URL list.
  5. No media but an embeddable player → **Embed the page** (iframe fallback).
  6. DRM pages (Widevine / PlayReady / FairPlay) are refused with an explanation.
- **Media mode is a real TV tile**: the resolved URL plays through the normal player, so play / stop / mute / volume / fullscreen / PiP / pop-out / persistence all work, including multiple Web Video tiles at once.
- **Chrome differences**: favourite and Bank are hidden; Cast only appears for direct, non-proxied media URLs. In embed mode the tile keeps play (reload), stop, mute, fullscreen, drag and the **shield** button — and nothing is painted over the page (no centre ■/▶ slate: the page itself is the picture).
- **Mute on a page tile**: the tray's mute glyph behaves like a normal TV tile — it flips the tile's mute flag and its slide-out offers **Mute other TVs** / **Mute all**, which always work on the other tiles. The page's *own* audio is only reachable when the page is same-origin, so a remote embed keeps its sound and magicTV says “Embedded pages keep their own sound”; the mute state is remembered, so a same-origin page comes back muted after ▶ / reload.
- **Page shield (embed mode)**: a cross-origin iframe is a black box — magicTV cannot remove the page's scripts, block its subresource/ad requests, or touch in-player/stitched ads. What it *can* do is deny the capabilities nuisance ads rely on. Hover or focus the **shield** button (next to fullscreen) and the three levels slide out above the strip — **Off / Basic / Strict**, with the live one lit; clicking the glyph itself cycles basic → strict → off. Each change re-navigates the page (sandbox flags only apply at navigation) and is remembered on that saved page.

  | Level | Sandbox tokens | Denies |
  | --- | --- | --- |
  | **Off** | *(none)* | nothing — the page behaves like a normal tab (escape hatch for OAuth/pop-up logins) |
  | **Basic** *(default)* | `allow-scripts allow-same-origin allow-forms allow-presentation` | pop-ups and new-tab ads, top-navigation hijacks, downloads, `alert()`/`confirm()` scams |
  | **Strict** | `allow-scripts allow-same-origin allow-presentation` + `referrerpolicy="no-referrer"` | the above plus forms (fake logins / cross-tile submits) and referrer leakage |

  `allow-scripts` + `allow-same-origin` stay on purpose: the frame is cross-origin (so it cannot reach magicTV's window) and nearly every player needs its real origin for cookies and `localStorage`. Camera, microphone, geolocation, payment, USB/serial/HID/MIDI, `clipboard-write` and `display-capture` stay denied at every level via the `allow` policy. Set the global default under *Advanced — proxy & page shield* in the picker; a shield change on a tile is stored with that page, so replaying it later keeps the fix. An **Off** tile shows a small “Shield off” badge.
- **Media mode is the ad-free path**: it fetches only the resolved stream, never the page around it, so the page's ad/tracker requests never happen at all. The shield is the best effort available *after* you fall back to embedding.
- **Persistence**: each tile saves its `pageUrl` plus the last stream URL that worked (or the embed URL). Reload restores the tile paused; ▶ attaches fresh. Signed URLs expire — use **Stop & Play** (the ⏹▶ popout under Play) to re-scan the page and start the new stream, or turn the globe off and reopen the picker to pick the saved entry.
- **Proxy is optional and user-supplied** — magicTV ships none. Enter it under *Advanced — proxy & page shield* in the picker (stored as `webStreamProxyTemplate` in the state blob, with a `webStreamProxyPlayback` toggle that routes manifest + segment requests through it via an hls.js custom loader). Templates support `{url}` and `{url_encoded}`.
- Web Video tiles never write `webstream:` keys into history, Recents or `lastChannelKey`; the previous TV channel comes back when you turn Web Video off (press the globe again).

Manual checklist after changes:

1. Paste `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` → tile plays, play/stop/mute/volume work, reload restores paused.
2. Paste a page that embeds an HLS player (CORS-friendly) → resolves and plays without the sniffer.
3. Paste a CORS-blocked page → status points at the sniffer; run the bookmarklet → candidates appear; click one → plays.
4. Choose *Embed the page instead* → iframe fills the tile with no grey ■ slate on top of it, ▶ reloads it, ■ blanks it, ⛶ fullscreens the wrapper, and the tray still shows mute with its **Mute other TVs / Mute all** slide-out (a remote page keeps its own sound and the tile says so).
5. Turn the globe off → the previous TV channel returns; Recents/history show no `webstream:` entries.
6. Add a proxy template → a blocked page resolves through it; enable *Play through the proxy* → HLS still plays (proxy loader).
7. Embed a pop-up-heavy page, hover its shield button → **Off / Basic / Strict** slide out with the live level lit; pick **Basic** → no new tabs, no download prompts, dialogs are blocked; pick **Strict** → the page's forms stop submitting; pick **Off** → it behaves like a normal tab and the tile shows the “Shield off” badge. Each change reloads the embed.
8. Reload magicTV → the embed tile replays with the shield level you last chose for that page.

### Favorites & Recents
- **Favorite Button** — Use ★ on the player controls while a channel is playing
- **Auto-tracked** — Recents tab fills as you watch
- **Persistent** — Data saved to localStorage

### Sharing a channel
While a channel is playing, the magic remote shows two share buttons (next to ★):

- **Copy stream link** — copies the raw HLS `url_resolved` for the focused channel.
- **Copy magicTV link** — copies a deep link the recipient opens in magicTV:
  `index.html?ch=iptv-org%3ACNBC&name=CNBC&country=us`

Opening a magicTV deep link resolves the channel from the active catalog and plays it on a TV screen — the first free screen (only the single TV for a clean recipient), or the **last screen** when every screen is already full. It routes through normal playback, so it lands in Recents like any other watch. No share URL survives these deep links; only the channel *key* is in the URL.

### Settings
Open via the remote/browser **Settings** tab (`#settings-panel`):

- **Clock** — Clock style
- **Playback** — Buffer size (5–120s), max recents / previous channels (0–500 or unlimited)
- **Transitions** — Channel-switch and catalog view transitions (default: Random)
- **Appearance** — Theme, font, color groups, text size (default 75%), tile/list width (default 120px), active-tile (default Wave), visited accents (default Accent 2 / undistinguished), remote opacity & idle fade, remote texture, live preview; **Reset to defaults** under the preview
- **Hidden / Visited Channels** — Browse and restore/remove entries by country
- **Most watched** — Collapsible watch-time stats with refresh/clear
- **Storage** — Counts and quota estimate
- **About** — Version

Volume and catalog layout (tiles/list) live on the player chrome / catalog toolbar, not in this panel. Screen add/remove is on the remote mosaic controls. With 2+ screens the remote also shows **Rotate TVs** — every channel shifts to the next screen (TV 1 → 2 → … → last → 1) while the pictures travel between the tiles.

## 🔌 Data Source

**iptv-org API** — Free, public, community-maintained TV channel catalog
- ~10,000+ channels worldwide
- Daily updates
- No authentication required

## 💾 Storage

- **localStorage** — Favorites, recents, settings under isolated `magictv_*` keys (separate from magiclists)
- **Web Video library** — `magictv_webstream_library_v1` (saved pages/streams; proxy template + playback toggle live in the state blob)
- **IndexedDB** — `magictv_cache_db` for catalog + frame cache (manual refresh; frames TTL 7 days)

## 🎨 Color Scheme

| Variable | Color | Use |
|----------|-------|-----|
| `--tv-main-1` / `--tv-primary` | `#00FFFF` | Primary accent (alias kept) |
| `--tv-main-2` / `--tv-accent` | `#00FF88` | Secondary accent |
| `--tv-main-3` / `--tv-secondary` | `#FF00FF` | Tertiary accent |
| `--tv-bg` | `#0a0e27` | Dark navy background |

## ⌨️ Keyboard Shortcuts

- `Esc` — Close player / return to browse
- `Space` — Play/Pause (when focused on video)
- `F` — Fullscreen (standard browser behavior)
- `M` — Mute (standard browser behavior)

## 🐛 Debugging

Open browser console after the app loads:
```javascript
import { TvPlayer } from './js/tvPlayer.js';
import { TvProviderRegistry } from './js/tvProviders/registry.js';
```
(Or inspect `TvPlayer` / network activity from the Sources panel — there is no global `window.magicTV`.)

## 🚧 Known Limitations

- Player inline in page (no auto-fullscreen on play — user must click fullscreen manually)
- No HLS stream stats dashboard yet
- No multi-provider support yet (iptv-org only)
- Catalog has no real offline-health signal (channels without a URL are simply omitted)
- Mobile volume control hidden on small screens

### Web Video limits (by design — everything runs in the browser)

| Limit | What it means |
| --- | --- |
| DRM | Widevine / PlayReady / FairPlay streams cannot play outside their own app; magicTV refuses them and says so. |
| CORS | Most large sites block cross-origin page reads. The sniffer (bookmarklet in the page's own tab) or your own proxy template is the way around it. |
| Cross-origin iframes | The embed fallback cannot list the iframe's internal media URLs, cannot seek, and cannot read its cookies. |
| Ads inside an embedded player | The page shield can only deny capabilities (pop-ups, downloads, dialogs, forms, referrer); it cannot strip pre-roll/stitched ads or block the page's own ad requests. Media mode — which requests only the resolved stream — is the reliable ad-free path. |
| Referer / UA / cookie-bound CDNs | Some streams only answer the site that owns them. They fail even when the URL is found (no proxy → no spoofed headers). |
| Signed URLs | Tokens expire; a restored tile may need a fresh resolve via the picker/sniff panel. |
| Mixed content | `http://` media on the `https://` magicTV page is blocked by the browser. |
| Thumbnails | Freeze-frame snaps of a `webstream:`/proxied source are skipped (canvas tainting); the tile keeps its name. |

## 📦 Next Steps

- [ ] Playlist (.m3u) import
- [ ] Keyboard navigation (d-pad emulation for TVs)
- [ ] Custom provider import
- [ ] PWA installation

## 📝 License

MIT — Use, modify, redistribute freely.

---

**Made with 🌈 neon cyberpunk vibes** ✨
