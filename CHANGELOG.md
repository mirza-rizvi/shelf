# Changelog

All notable changes to Shelf will be documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added a recoverable **Delete all** action with an in-extension confirmation modal showing the affected session and tab counts.

### Changed

- Simplified the manager to one flat session list with search as its only persistent control.
- Moved JSON backup, Shelf/OneTab import, duplicate cleanup, privacy information, and help into Settings.
- Reduced session and tab actions to restore and recoverable delete.
- Added a verified schema-v4 migration that safely flattens existing workspace-aware data.

### Removed

- Workspaces, domain filtering, sorting modes, density controls, bulk selection, drag ordering, and secondary action menus.
- Plain-text export, global restore/delete actions, and the separate Help page.

## [1.0.0] - 2026-08-18

### Added

- Privacy-first local tab capture for a tab, selection, tab group, window, or all windows.
- Verified save-before-close flow with crash recovery, undo, and 30-day trash.
- Workspaces, sessions, search, domain filtering, sorting, compact mode, multi-select, and drag-and-drop organization.
- Duplicate prevention and recoverable duplicate cleanup.
- Individual, selected, session, and all-session restore behavior with native Chrome tab-group preservation.
- Versioned JSON backup/import, text export, and OneTab import.
- Keyboard commands, context-menu actions, dark mode, and an optional per-window tab limit.

[Unreleased]: https://github.com/mirza-rizvi/shelf/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mirza-rizvi/shelf/releases/tag/v1.0.0
