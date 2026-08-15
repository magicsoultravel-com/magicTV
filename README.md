# 🎬 magicTV

**Neon-styled TV streaming browser** — Browse and play live channels in a stunning cyberpunk interface.

## ✨ Features

- **🌍 Browse Channels** — Filter by country, search, infinite scroll
- **❤️ Favorites** — Heart channels for quick access
- **📺 Recents** — Auto-tracked watch history
- **⚙️ Settings** — Buffer size, offline channel filter, volume control, text size, tile width
- **📱 Responsive** — Works on mobile, tablet, TV browser, desktop
- **🎨 Neon Design** — Cyan/magenta cyberpunk aesthetics
- **🔊 Full Controls** — Play, pause, volume, quality, Picture-in-Picture, fullscreen
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
| `test/tvPlayer.test.mjs` | Favorites, favorites metadata, recents (cap 20, newest-first), buffer-size clamping (5–120s), volume clamping, provider settings |
| `test/tvUtils.test.mjs` | `escapeHtml`, `countryFlagEmoji`, `debounce`, `formatRelativeTime` |
| `test/channelShape.test.mjs` | `channelKey`, `parseChannelKey`, `normalizeChannel`, `migrateFavoriteRef` |
| `test/frameCache.test.mjs` | `FrameCache.setFrame`/`getFrame` round-trip, 7-day TTL expiry, per-key remove |

## 📁 Project Structure

```
magicTV/
├── index.html              # App shell & layout
├── css/
│   ├── base.tv.css        # Core styles & theme variables
│   └── tv-landing.css     # Landing page layout & components
├── js/
│   ├── app.js             # Main app logic (tabs, events, state)
│   ├── tvPlayer.js        # HLS player state machine (extracted)
│   ├── tvUtils.js         # Helpers (flags, HTML escape, etc.)
│   ├── tvHls.js           # HLS.js library loader (CDN + SRI)
│   ├── tvPip.js           # Picture-in-Picture support
│   ├── toast.js           # Bridge re-export → ui/toast.js
│   ├── icons.js           # Bridge re-export → ui/icons.js
│   ├── clipboard.js       # Bridge re-export → ui/clipboard.js
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

### Favorites & Recents
- **Favorite Button** — Use ★ on the player controls while a channel is playing
- **Auto-tracked** — Recents tab fills as you watch
- **Persistent** — Data saved to localStorage

### Settings
- **Buffer Size** — Adjust for your network (5-30 seconds)
- **Volume** — Per-session or system audio control
- **Appearance** (🎨):
  - **Text Size** — Scales UI text everywhere (50%–112% of default; rem-based)
  - **Tile Width** — Adjust channel card width (100px–300px)
  - **↺** — Reset text size and tile width to defaults

## 🔌 Data Source

**iptv-org API** — Free, public, community-maintained TV channel catalog
- ~10,000+ channels worldwide
- Daily updates
- No authentication required

## 💾 Storage

- **localStorage** — Favorites, recents, settings (same keys as magiclists for compatibility)
- **IndexedDB** — Catalog + frame cache (manual refresh; frames TTL 7 days)

## 🎨 Color Scheme

| Variable | Color | Use |
|----------|-------|-----|
| `--tv-primary` | `#00FFFF` | Cyan neon accents |
| `--tv-secondary` | `#FF00FF` | Magenta accents |
| `--tv-bg` | `#0a0e27` | Dark navy background |
| `--tv-accent` | `#00FF88` | Neon green (future use) |

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

## 🚧 Known Limitations (MVP)

- Player inline in page (no auto-fullscreen on play — user must click fullscreen manually)
- No HLS stream stats dashboard yet
- No multi-provider support yet (iptv-org only)
- Catalog has no real offline-health signal (channels without a URL are simply omitted)
- Mobile volume control hidden on small screens

## 📦 Next Steps (Post-MVP)

- [ ] Search channels by name within country
- [ ] Playlist (.m3u) import
- [ ] Chromecast support
- [ ] Dark/Light theme toggle
- [ ] Keyboard navigation (d-pad emulation for TVs)
- [ ] EPG (Electronic Program Guide)
- [ ] Custom provider import
- [ ] PWA installation

## 📝 License

MIT — Use, modify, redistribute freely.

---

**Made with 🌈 neon cyberpunk vibes** ✨
