# Shelf — Product Requirements Document

**Product:** Shelf — a privacy-first tab manager for Chrome (Manifest V3)
**Version:** 1.0.0 · **Status:** implemented MVP

> **Initial public release (2026-08-18) — useful, not bloated.** Includes local workspaces, advanced capture scopes/destinations, save-without-closing, duplicate prevention/cleanup, multi-select bulk actions, native drag reorder, context-menu actions, keyboard commands, excluded domains, versioned workspace-aware export/import, and recoverable workspace deletion. These features require no cloud service, content script, host permission, analytics, or persistent background process.

> **URL-list usability pass (2026-08-17).** Added comfortable/compact rows, exact-hostname filtering, independent session/tab sorting, filtered select-all, controlled collapse/expand-all, clearer primary restore actions, and overflow menus for secondary actions. These are presentational/local preference changes with no new permissions or dependencies.

## 1. Problem

Users accumulate dozens-to-hundreds of open tabs, hurting focus and memory use. OneTab (~2M users) popularized "collapse tabs into a list", but its research profile shows sustained, unresolved failures its users complain about publicly (2023–2026):

1. **Data-loss anxiety** — users need verified persistence, recoverable deletion, and portable backups rather than one opaque list with no recovery workflow.
2. **Destructive one-click with no confirmation and no undo** — accidental toolbar clicks close every tab; restore behavior removes items by default.
3. **Unverifiable privacy** — closed source; "share as web page" uploads URLs to the vendor's server with no expiry/revocation; favicons leak browsing domains to Google's favicon service.
4. **No native tab-group support** — Chrome tab groups are flattened, six years after they shipped.
5. **Sync promised for years, never shipped** (out of scope for Shelf v1, but explains churn).

Chrome now natively covers the *memory* half of this problem (Memory Saver) and part of organization (saved tab groups, with a silent cap and no export). The unoccupied position: **durable, private, portable tab storage with no account and no server**.

## 2. Product principles

- Privacy by default: zero network egress, zero analytics, no accounts. Verifiable in DevTools.
- Local-first: everything in `chrome.storage.local`; export files are the user's own.
- No destructive action without user control: explicit close choices, confirmations where appropriate, undo, trash, and user-owned backups.
- Simple before feature-rich; minimum permissions; no dashboards or gamification.

## 3. Users

- **Tab hoarders** who keep hundreds of tabs "for later".
- **Privacy-conscious users** burned by extension scandals (Great Suspender, Stylish, DataSpii).
- **OneTab refugees** after data loss or the v2 UI regression (import path provided).

## 4. Feature requirements (MoSCoW)

### MVP — implemented
- Save tabs: this tab / current window / highlighted tabs / native tab group / left / right / all except active / all windows. Capture is available from the popup, context menu, and keyboard commands.
- Save into a new session or append to an existing session, with optional close-after-save. All-window capture creates one session per source window.
- Write-verify-close: tabs close only after saved data is verified on disk.
- Restore: single tab, whole group, everything; default keeps items on the shelf; optional restore-and-remove (goes to trash, undoable).
- Preserve Chrome native tab groups (title, color, collapsed) across save/restore.
- Workspace → session → tab organization, including create/rename/delete workspace and recoverable workspace deletion.
- Delete tab/session → local 30-day trash + undo.
- Rename/duplicate sessions; split or merge through multi-select Move; reorder sessions and tabs with native drag-and-drop.
- Search across group names, tab titles, URLs (`/` shortcut).
- Filter the active workspace by exact hostname; sort sessions and tabs without rewriting manual order; switch between comfortable and compact rows.
- Duplicate removal across the current view or all data; optional duplicate prevention while saving.
- Export: versioned JSON (workspaces included) and OneTab-compatible text. Import: both, with hostile-input validation and future-version refusal.
- Simple optional per-window tab limit: oldest excess tabs auto-save; active, pinned, audible, unloaded, and excluded-domain tabs are protected.
- Versioned schema with resumable migrations and downgrade safety.
- Popup + full-page manager; light/dark/system theme; keyboard accessible.
- Manager opens as a pinned leftmost tab (OneTab-style).
- Bulk actions: select across sessions → Restore / Move to session or workspace / Copy URLs / Delete.
- Zero network egress, no account, no sync, no content scripts, and no host permissions.

### Post-MVP — add only with demonstrated value
1. Session favorite/archive/notes/tags.
2. Faster indexed search only if measured datasets make the current lazy UI insufficient.
3. Per-tab protection, optional local export reminders, and additional importers.
4. Local-only smart grouping/name suggestions, disabled by default.
5. Firefox support behind the browser API adapter.
6. Optional end-to-end encrypted sync only after the local product is proven; never enabled by default.

### Could have (later)
- Firefox port (WXT supports it), Edge listing.
- Local encrypted export (password-protected file).
- Optional sync via user-owned storage (e.g., their Google Drive) — only if it can be E2E-encrypted and off by default.

### Not planned
- Cloud sharing ("share as web page") — the OneTab feature that uploads URLs to a server. Clipboard copy instead.
- Accounts, subscriptions, telemetry, ads.
- Tab suspension/memory management — Chrome Memory Saver owns this.
- Content scripts of any kind.

## 5. User flows

1. **Save a window:** popup → choose workspace/destination and whether to close → "Save this window" → tabs written + verified → requested tabs close → manager shows the session; toast confirms.
2. **Restore:** manager → click a tab (opens, stays on shelf) or "Restore" (whole group) or "Restore & remove" (group → trash, undoable).
3. **Accidental delete:** Delete → toast "Moved to trash — Undo" (8 s) → or Trash page → "Put back" any time within retention.
4. **Tab limit:** user enables a per-window limit → excess loaded tabs are saved and closed oldest-first; active, pinned, audible, and excluded-domain tabs remain open.
5. **Migration from OneTab:** OneTab → Export URLs → Shelf manager → Import → groups appear; nothing uploaded anywhere.
6. **Disaster recovery:** import a previously exported JSON (snapshot feature removed in v0.3).

## 6. Known limitations (documented honestly)

- **Uninstalling the extension deletes its local data** — a Chrome platform rule. The current mitigation is a clear warning in the README/privacy policy and user-initiated JSON export.
- **Unsaved form data cannot be detected** without content scripts (which Shelf deliberately does not use). `tabs.remove()` bypasses `beforeunload`. Mitigation: closing after capture is an explicit popup choice, the active tab is never auto-moved, and the tab limit defaults off.
- **Restricted pages** (`chrome://`, other extensions' pages) are saved but may refuse to reopen; they render as copy-URL entries when blocked.
- No cross-device sync in v1 (deliberate: no server, no account).

## 7. Success criteria

- A saved shelf survives: browser restart, extension update, SW termination mid-save (verified by tests), storage-full write failure (tabs stay open).
- Zero network requests in DevTools on all extension pages.
- 2,000 saved tabs render and search smoothly (offscreen cards use content-visibility).
- Every destructive action is reversible for the retention window.
