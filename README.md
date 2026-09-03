# NizViewer: Indeed job date and metadata viewer

NizViewer is a free browser extension for Chrome and Firefox that shows the real Indeed job posting date and extracts salary, shift schedule, work setup, experience requirements, technology stack, benefits, and other useful details. It displays a compact summary directly on landing-page cards, search results, and individual job pages.

[Official website](https://umairhex.github.io/nizviewer/) · [Firefox add-on](https://addons.mozilla.org/en-US/firefox/addon/nizviewer-indeed-job-dates/) · [Privacy policy](./PRIVACY.md)

---

## Features

- **Date Badges** — Real post date extracted from API responses, not Indeed's vague "30+ days ago"
- **Salary & Comp** — Inline salary range where available
- **Shift Schedule** — Night / Day / Mid / Rotating / Remote shift classification
- **Work Setup** — Remote / Hybrid / Onsite badge on every card
- **Experience** — Years required, parsed from job descriptions
- **Tech Stack** — Key technologies mentioned in the listing
- **Benefits & Perks** — Retirement, insurance, and allowance signals
- **Reliable Full Details** — Landing, search, and standalone job pages load full descriptions without requiring a card click
- **Compact, Expandable Cards** — Primary details stay scannable while secondary fields and source notes remain available on demand
- **Search Tools** — Filter by technology, work setup, posting age, salary availability, and experience; sort extracted results
- **Bulk Workflows** — Copy visible rows and export CSV for follow-up research
- **Scraper-Friendly Cards** — Optional layout that renders one line per field, so third-party page scrapers capture the whole tech stack as a single column instead of one column per pill
- **Application Contacts** — Detects email addresses and phone numbers included in job application instructions
- **Accessible Feedback** — Full, partial, pending, and failed states with visible retry controls and screen-reader announcements
- **Personalisation** — Field selection, density, theme, age thresholds, and technology-category visibility
- **Contextual Popup** — Settings are available on Indeed landing, search, and job-detail pages

---

## Supported Sites

Works on all regional Indeed domains including `.com`, `.ca`, `.co.uk`, `.com.pk`, `.co.in`, `.com.au`, `.fr`, `.de`, `.nl`, `.com.sg`, and `.ae`.

---

## Requirements

| Tool                  | Minimum Version      | Notes                                                             |
| --------------------- | -------------------- | ----------------------------------------------------------------- |
| Node.js               | **24 LTS** (Krypton) | v20 is EOL as of April 2026                                       |
| pnpm                  | **11.x**             | `corepack enable && corepack prepare pnpm@latest --activate`      |
| Chrome / Edge / Brave | 88+                  | MV3 mandatory on Chrome Web Store since August 31, 2026           |
| Firefox               | 128+ (ESR)           | MV3 supported since Firefox 109; both MV2 and MV3 accepted on AMO |

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

Output: `web-ext-artifacts/nizviewer-1.4.0.zip`

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
├── content.js               # Main content script — badge rendering
├── popup.html               # Extension popup
├── popup.js                 # Popup logic — settings, cache management
├── styles.css               # Injected styles for badges
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
3. Landing and search-result cards whose initial payload only contains a snippet are enriched from their full job-detail pages with bounded concurrency and retries
4. Standalone `/viewjob?jk=...` pages are parsed from their loaded job description and receive the same metadata panel
5. `content.js` caches results in `chrome.storage.local` and renders badge wrappers on each job card
6. The popup pushes preference changes live to all open Indeed tabs via `chrome.tabs.sendMessage` — no page reload required

## How NizViewer finds the Indeed posting date

NizViewer reads structured job data and network responses that Indeed already sends to the browser. It associates the publication timestamp with the listing's job key and shows the calendar date on the matching card. When a card contains only a short snippet, NizViewer requests the public `/viewjob?jk=...` page on the same Indeed domain and parses the complete description.

The extension reports full, partial, pending, and failed states. It does not replace a missing value with a guess. Always confirm important details in the original posting.

## Public website and search discovery

The static product site in [`site/`](./site/) contains the canonical product description, software structured data, crawler rules, sitemap, and a concise machine-readable summary. The GitHub Pages workflow publishes that directory after changes reach `main`.

To activate the first deployment, select **GitHub Actions** under **Repository Settings → Pages → Build and deployment**. Then submit `https://umairhex.github.io/nizviewer/sitemap.xml` to Google Search Console and Bing Webmaster Tools.

---

## Store Submission

See [`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md) for the full step-by-step guide for Chrome Web Store and Firefox AMO, including versioning, pre-submission checklist, and signing.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License

The repository does not currently contain a license file. The project owner must reconcile the MIT reference previously shown here with the Mozilla Public License 2.0 selected on the Firefox listing before publishing definitive license metadata.
