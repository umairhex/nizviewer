# NizViewer — Store Submission Guide

> **Verified:** August 13, 2026 against Chrome Web Store policy, Firefox Extension Workshop, and npm registry.

---

## Prerequisites

```bash
# Node.js 24 LTS (Krypton) — v20 is EOL since April 2026
node -v

# Install pnpm via Corepack (recommended)
corepack enable
corepack prepare pnpm@latest --activate

# Install dev dependencies
pnpm install
```

---

## What Gets Shipped

Only these files are included in the final zip:

```
manifest.json
background.js
content.js
popup.html
popup.js
styles.css
features.html
icons/
  nizviewer-16.png
  nizviewer-48.png
  nizviewer-128.png
scripts/
  browser-polyfill.js
  pageHook.js
  techKeywords.js
```

---

## Build

```bash
# Validate before submitting
pnpm run lint

# Build per-browser packages (same cross-browser manifest.json)
pnpm run build:chrome
# -> web-ext-artifacts/nizviewer-1.0.0-chrome.zip

pnpm run build:firefox
# -> web-ext-artifacts/nizviewer-1.0.0-firefox.zip
```

---

## Chrome Web Store

> **Important:** As of **August 31, 2026**, the Chrome Web Store no longer accepts MV2 extensions. NizViewer is already MV3-compliant.

### Key policy requirements (MV3)

- All JavaScript must be bundled in the package — no remotely hosted code
- Background context must be a **service worker** (no persistent background pages)
- No `eval()` or dynamic code execution

### About `browser_specific_settings`

The `browser_specific_settings` key in `manifest.json` is a Firefox-only field. Chrome does **not** recognise it but treats it as an unrecognised key — this shows an informational **warning** in the developer dashboard only. It does **not** block publication.

If you prefer a clean build, `pnpm run build:chrome` and `pnpm run build:firefox` package the same cross-browser `manifest.json`: Firefox uses `background.scripts`, Chrome uses `background.service_worker` (Chrome 121+ ignores the extra key), and Chrome shows only an informational warning for `browser_specific_settings`.

### Submission steps

1. Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **Add new item**
3. Upload `web-ext-artifacts/nizviewer-1.0.0-chrome.zip`
4. Fill in store listing:
   - **Category:** Productivity
   - **Description:** clear, honest, matches extension behaviour
   - **Screenshots:** at least 1 (1280×800 or 640×400)
   - **Privacy policy:** required if collecting any data (NizViewer stores data locally only)
5. First-time: pay the one-time **$5 developer registration fee**
6. Submit for review

**Review timeline:**

- Simple changes: a few hours to a few days
- New extensions or broad permission changes: up to several weeks
- If waiting > 3 weeks, contact support via the dashboard — do **not** cancel and resubmit (it resets your queue position)

---

## Firefox Add-ons (AMO)

Firefox supports both MV2 and MV3. Mozilla has no plans to deprecate MV2, but MV3 is recommended for new extensions.

### Test locally first

```bash
pnpm run start:firefox
```

This launches a temporary Firefox profile with the extension hot-loaded.

### About `gecko.id` and `strict_min_version`

The `id` field inside `browser_specific_settings.gecko` is **mandatory** for AMO submissions. Without it, AMO cannot process the extension.

`strict_min_version: "128.0"` targets the current Firefox ESR (Extended Support Release) baseline — the recommended floor for new MV3 extensions. Firefox 128 ESR was released June 2024 and represents the widest stable install base.

### Data collection disclosure (mandatory since Nov 3, 2025)

All **new** AMO submissions must include:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "your-ext@example.com",
    "strict_min_version": "128.0",
    "data_collection_permissions": {
      "required": ["none"]
    }
  }
}
```

NizViewer already includes this block.

### Submission — Listed (recommended)

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Click **Submit a New Add-on -> On this site**
3. Upload `web-ext-artifacts/nizviewer-1.0.0-firefox.zip`
4. When prompted for source code, upload the same zip (it is already unminified — satisfies AMO's source requirement)
5. Category: **Search Tools**
6. Submit — review takes 1–7 days for new add-ons

### Submission — Self-distributed (unlisted)

1. Go to [AMO Submit](https://addons.mozilla.org/developers/addon/submit/distribution)
2. Choose **On your own**
3. Upload the zip — AMO signs it and returns a `.xpi`
4. Distribute the `.xpi` from your GitHub Releases page

---

## Versioning

Bump the version in **three places** before each release:

| File            | Field                           |
| --------------- | ------------------------------- |
| `manifest.json` | `"version": "1.0.0"`            |
| `package.json`  | `"version": "1.0.0"`            |
| `popup.html`    | `v1.x.x` in the header `<span>` |

Then rebuild:

```bash
pnpm run build:chrome && pnpm run build:firefox
# -> web-ext-artifacts/nizviewer-<version>-chrome.zip
# -> web-ext-artifacts/nizviewer-<version>-firefox.zip
```

---

## Pre-Submission Checklist

- [ ] `pnpm run lint` passes with zero errors
- [ ] Popup opens on an Indeed search feed and shows the correct job count
- [ ] Auto-Scan completes without opening new tabs
- [ ] Badge freshness dates are correct
- [ ] `manifest.json` version matches `package.json`
- [ ] Icons exist at 16, 48, and 128px
- [ ] No `console.log` or debug output in production files
- [ ] `gecko.id` is set in `manifest.json`
- [ ] `data_collection_permissions` block is present in `manifest.json`
