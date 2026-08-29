# NizViewer search deployment checklist

The repository contains a search-ready static product site in [`site/`](./site/). Code alone cannot make the site rank. The page must be deployed, crawled, indexed, and cited by other relevant sites.

## First deployment

1. Push the changes to the `main` branch.
2. Open **Repository Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Run the **Deploy product site to GitHub Pages** workflow if the push did not start it automatically.
5. Confirm that `https://umairhex.github.io/nizviewer/` returns HTTP 200.

The workflow publishes only the `site` directory. Extension source files and build artifacts are not included in the Pages artifact.

## Indexing

1. Add `https://umairhex.github.io/nizviewer/` as a URL-prefix property in Google Search Console.
2. Submit `https://umairhex.github.io/nizviewer/sitemap.xml`.
3. Request indexing for the canonical homepage after the first successful deployment.
4. Add the site to Bing Webmaster Tools and submit the same sitemap. Bing's index can also support third-party search products.
5. Test the deployed page with Google's Rich Results Test and Schema Markup Validator.

Do not add verification meta tags until the corresponding service provides the exact value. Placeholder verification tokens cause failed ownership checks.

## GitHub Pages robots limitation

This is a project site under `umairhex.github.io/nizviewer/`. The authoritative robots file for that host is `https://umairhex.github.io/robots.txt`, which belongs to the account-level Pages site rather than this repository. It currently returns 404, so it does not block crawlers.

The included `site/robots.txt` documents the intended policy and becomes authoritative if NizViewer moves to its own domain or the domain root. On the current project URL, the page-level `robots` meta tag controls indexability and the sitemap should be submitted directly to search consoles.

## AI search visibility

- Keep OAI-SearchBot, Claude-SearchBot, Claude-User, Googlebot, and other search crawlers unblocked at the hosting and CDN layers.
- Keep the main product facts visible as HTML. Do not move the core explanation behind client-side rendering.
- Keep `llms.txt` accurate, but do not treat it as a substitute for crawlability, useful content, or links. Google states that AI search uses the same core indexing requirements as regular Search and does not require a special AI file or schema.
- Update the visible version, JSON-LD version, sitemap date, and `llms.txt` together when the product changes.

## Authority signals that require publication access

- Set the GitHub repository website field to `https://umairhex.github.io/nizviewer/`.
- Update the Firefox listing and any future Chrome Web Store listing to link to the canonical website and privacy policy.
- Update the Firefox listing for version 1.4.0. Its current text still refers to the older Auto-Scan workflow.
- Add release notes for version 1.4.0 and publish a signed GitHub release.
- Earn relevant references through browser-extension directories, job-search communities, and technical write-ups that explain the date-detection method with real examples.

## License metadata must be resolved

The repository README currently says MIT, the Firefox listing says Mozilla Public License 2.0, and the repository does not contain a `LICENSE` file. The product site's structured data omits a license until the project owner chooses one and adds its complete license text. After that decision, update the README, package metadata, Firefox listing, product page, and JSON-LD to use the same license.

No search engine or AI answer system guarantees placement. These steps make NizViewer eligible, understandable, and easier to cite; rankings still depend on relevance, quality, usage, and external authority.
