# Contributing to NizViewer

Thank you for your interest in contributing to NizViewer! We welcome pull requests, bug reports, and feature requests.

## How to Contribute

1. **Fork the Repository:** Fork [https://github.com/umairhex/nizviewer](https://github.com/umairhex/nizviewer) to your own GitHub account.
2. **Clone the Repo:** Clone it to your local machine.
3. **Install Dependencies:** Run `pnpm install` (or `npm install`) to grab the necessary dev dependencies (like Web-Ext, ESLint, Prettier, and Sharp).
4. **Create a Branch:** Create a feature branch for your work: `git checkout -b feature/my-awesome-feature`.
5. **Make Changes:** Write your code. Make sure your code adheres to the existing architectural styles and DOM parsing strategies.
6. **Test:** Load the unpacked extension into Chrome/Firefox and verify that it works properly on Indeed.
7. **Commit & Push:** Commit your changes with a descriptive message and push to your fork.
8. **Submit a Pull Request:** Open a PR against the `master` branch of the main repository.

## Development Guidelines

- **Minimalist Aesthetic:** UI additions should strictly follow the Vercel Geist design system or Apple minimalist ethos.
- **Performance:** Keep DOM traversals highly optimized using standard `document.querySelector` and `MutationObserver` practices.
- **Privacy:** Do not inject trackers, analytics, or external API calls into the content scripts.

We look forward to reviewing your contributions!
