## NizViewer v1.6.0

Adds a card layout built for third-party page scrapers, and fixes the export gaps found while reviewing that flow.

### Scraper-friendly cards

Generic DOM scrapers create one column per repeated element, so a job's technology stack arrived spread across a dozen `nizviewer-tech-pill` columns. The new **Scraper-friendly cards** toggle, under **Scraping** in the popup, replaces the pill layout with one line per field.

- The whole grouped stack lands in a single cell, for example `Languages: JavaScript, TypeScript | Frontend: React, HTML`.
- Every enabled field renders on every card, empty ones included, so columns line up across rows.
- Field labels are CSS generated content, so they are announced by screen readers but stay out of the scraped value.
- Off by default; the pill layout is unchanged when it is off.

### Fixes

- Age limit and gender are now included when copying and exporting jobs. Both were toggleable and shown on cards, but never reached the CSV or the clipboard.
- CSV export no longer revokes its download URL in the same tick as the click, which could cancel the download, and attaches the anchor for Firefox.
- The scraper block honours the same per-field preferences as the CSV export and shares its date parsing, so a malformed cached date yields an empty cell rather than raw text.
- The scraper block follows the density and narrow-viewport rules that the pill layout already used.
- Empty placeholder rows are hidden from assistive technology; populated rows keep their labels.

### Notes

- The CSV gains two columns, Age Limit and Gender, when those fields are enabled.
- While scraper-friendly cards are on, the mailto and phone links are hidden, because conditional elements would shift a scraper's columns. The addresses stay visible as text.
- Technology categories hidden in preferences stay out of the scraper block, matching the pill layout; the CSV still exports the full stack.

### Validation

- ESLint passes with no errors, and web-ext lint passes on the Firefox build.
- Verified in Chrome against the shipped sources: columns stay identical across full, empty, and partial jobs; preferences gate the block exactly as they gate the CSV; labels render but stay out of `innerText`.

### Downloads

| Browser      | File                          |
| ------------ | ----------------------------- |
| Chrome (MV3) | `nizviewer-1.6.0-chrome.zip`  |
| Firefox      | `nizviewer-1.6.0-firefox.zip` |

### Install

- **Chrome:** Open `chrome://extensions`, enable Developer mode, and load the unpacked extension or upload the ZIP to the Chrome Web Store.
- **Firefox:** Open `about:debugging` → This Firefox → Load Temporary Add-on, or submit the ZIP to AMO.
