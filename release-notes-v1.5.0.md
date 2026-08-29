## NizViewer v1.5.0

This release makes Indeed job research more reliable, scannable, and easier to understand across landing pages, search results, and direct view-job pages.

### Highlights

- Full job descriptions and technology stacks now load consistently on initial landing-page cards, search results, and direct `/viewjob?jk=...` pages.
- Added explicit queued, loading, partial, complete, failed, and retry states for deep-fetch operations.
- Improved card rendering and refresh handling for dynamically inserted Indeed results.
- New default presentation: Light theme with Always expanded details.
- Job titles, company names, and locations are capped at two lines on result cards for faster scanning.
- Added clearer controls for compact, comfortable, and expanded card density.
- Added copy-visible-fields actions and more descriptive accessible labels.
- Redesigned the feature guide with responsive UX, setup instructions, recovery guidance, FAQ content, canonical metadata, Open Graph tags, and structured data.
- Published the feature guide through the GitHub Pages workflow.
- Kept the extension local-first with browser storage for preferences.

### Validation

- ESLint and web-ext lint pass with no errors.
- Chrome and Firefox extension builds pass.

### Downloads

| Browser | File |
|---------|------|
| Chrome (MV3) | `nizviewer-1.5.0-chrome.zip` |
| Firefox | `nizviewer-1.5.0-firefox.zip` |

### Install

- **Chrome:** Open `chrome://extensions`, enable Developer mode, and load the unpacked extension or upload the ZIP to the Chrome Web Store.
- **Firefox:** Open `about:debugging` → This Firefox → Load Temporary Add-on, or submit the ZIP to AMO.
