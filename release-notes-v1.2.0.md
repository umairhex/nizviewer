## NizViewer v1.2.0

Advanced Indeed Job Data Viewer — shows job count, manual deep-fetch capability, and adds freshness dates to job badges without opening new tabs.

### Downloads

| Browser | File |
|---------|------|
| Chrome (MV3) | `nizviewer-1.2.0-chrome.zip` |
| Firefox | `nizviewer-1.2.0-firefox.zip` |

### Install

- **Chrome:** chrome://extensions → Developer mode → Load unpacked → select the unzipped folder, or upload the zip to the Chrome Web Store.
- **Firefox:** about:debugging → This Firefox → Load Temporary Add-on, or submit the zip to AMO.

### Highlights

- **Code Bloat Audit & Refactor**: Completely removed redundant regex parsing logic between the background scripts and the content scripts, resulting in a cleaner, faster, and more maintainable codebase.
- Streamlined settings and popup logic
- Resolved minor linting warnings and optimized error handling
- Single Source of Truth architecture for all data extraction
- Cross-browser MV3 manifest (Chrome service worker + Firefox background script)
