# NizViewer

A browser extension for Chrome and Firefox that enriches Indeed job listings with extracted metadata — posting date, salary, shift schedule, work setup, experience requirements, tech stack, benefits, and more — displayed as compact badges directly on the search feed.

---

## Features

- **Date Badges** — Real post date extracted from API responses, not Indeed's vague "30+ days ago"
- **Salary & Comp** — Inline salary range where available
- **Shift Schedule** — Night / Day / Mid / Rotating / Remote shift classification
- **Work Setup** — Remote / Hybrid / Onsite badge on every card
- **Experience** — Years required, parsed from job descriptions
- **Tech Stack** — Key technologies mentioned in the listing
- **Benefits & Perks** — Retirement, insurance, and allowance signals
- **Auto-Scan** — One-click batch scanner with a real-time progress bar; reads each card without opening new tabs
- **Feed Filter Bar** — Sticky filter bar above the job list; click any badge to instantly filter the feed
- **Contextual Popup** — Settings only shown when on an Indeed feed; empty state on all other pages

---

## Supported Sites

Works on all regional Indeed domains including `.com`, `.ca`, `.co.uk`, `.com.pk`, `.co.in`, `.com.au`, `.fr`, `.de`, `.nl`, `.com.sg`, and `.ae`.

---

## Requirements

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Node.js | **24 LTS** (Krypton) | v20 is EOL as of April 2026 |
| pnpm | **11.x** | `corepack enable && corepack prepare pnpm@latest --activate` |
| Chrome / Edge / Brave | 88+ | MV3 mandatory on Chrome Web Store since August 31, 2026 |
| Firefox | 128+ (ESR) | MV3 supported since Firefox 109; both MV2 and MV3 accepted on AMO |

---

## Installation (Development)

```bash
# 1. Clone
git clone https://github.com/umairhex/nizviewer.git
cd nizviewer

# 2. Install dev dependencies
pnpm install
```

---

## Load in Browser (Unpacked)

### Chrome / Edge / Brave

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the project root folder (where `manifest.json` lives)

### Firefox

```bash
# Hot-reload dev session
pnpm run start:firefox
```

Or load manually:

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the project root

---

## Build (Production Zip)

```bash
# Firefox and general build
pnpm run build

# Chrome build (strips browser_specific_settings at build time — optional, see note below)
pnpm run build:chrome
```

Output: `web-ext-artifacts/nizviewer-1.0.0.zip`

> **Chrome Store note:** The `browser_specific_settings` key in `manifest.json` is Firefox-only. Chrome does not recognise it and will show a dashboard **warning** (informational only — it does **not** block publication). You can safely ignore it or use `pnpm run build:chrome` to strip it at build time.

---

## Lint & Format

```bash
# ESLint + web-ext lint
pnpm run lint

# Prettier
pnpm run format
```

---

## Project Structure

```
nizviewer/
├── manifest.json            # Extension manifest (MV3)
├── background.js            # Service worker — opens features page on install
├── content.js               # Main content script — badge rendering, filter bar, auto-scan
├── popup.html               # Extension popup
├── popup.js                 # Popup logic — settings, cache management
├── styles.css               # Injected styles for badges, filter bar, scan button
├── features.html            # Welcome / feature overview page
├── icons/                   # Extension icons (16, 48, 128px)
└── scripts/
    ├── browser-polyfill.js  # Cross-browser API normalisation + default prefs schema
    ├── pageHook.js          # Injected page script — intercepts fetch for job date extraction
    └── techKeywords.js      # Tech keyword classifier
```

---

## How It Works

1. `pageHook.js` is injected into the page context and intercepts `window.fetch` to capture raw Indeed API responses
2. Extracted job metadata is `postMessage`-d back to `content.js`
3. `content.js` caches results in `chrome.storage.local` and renders badge wrappers on each job card
4. The popup pushes preference changes live to all open Indeed tabs via `chrome.tabs.sendMessage` — no page reload required

---

## Store Submission

See [`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md) for the full step-by-step guide for Chrome Web Store and Firefox AMO, including versioning, pre-submission checklist, and signing.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License

MIT
