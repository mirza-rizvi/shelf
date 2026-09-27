# Changelog

All notable changes to Shelf will be documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Added a public README hero and product screenshot gallery covering session management, dark mode, and settings.
- Updated React and React DOM to 19.3.0, including their matching type definitions.
- Updated the Chrome extension API type definitions to 0.2.9.
- Updated Playwright Core to 1.63.0.
- Reduced Shelf's background work: closing an ordinary tab no longer scans every open tab, the popup no longer loads every saved session when it opens, and the optional tab-limit check runs every 5 minutes instead of every minute.
- Made search smoother on large shelves: typing no longer re-scans every saved title from scratch or redraws sessions whose results did not change.
- Lowered the always-open Shelf tab's memory use: deleted sessions now load only while the Trash page is open.
- Added performance guardrails: tests that fail when new background listeners or frequent alarms are added, and a release size budget for the extension's scripts.

## [1.0.0] - 2026-08-18

### Added

- Privacy-first local tab capture for a tab, selection, tab group, window, or all windows.
- Verified save-before-close flow with crash recovery, undo, and 30-day trash.
- A fast, flat session list with search across session names, titles, and URLs.
- Duplicate prevention and recoverable duplicate cleanup.
- Individual and session restore behavior with native Chrome tab-group preservation.
- Versioned JSON backup/import and OneTab import.
- Keyboard commands, context-menu actions, dark mode, and an optional per-window tab limit.
- Recoverable **Delete all**, duplicate cleanup, and batched storage operations for large shelves.
- A dependency-free Chrome Web Store release verifier shared by local development and CI.
- Trusted-context-only local extension storage and documented privacy safeguards.

[Unreleased]: https://github.com/mirza-rizvi/shelf/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mirza-rizvi/shelf/releases/tag/v1.0.0
