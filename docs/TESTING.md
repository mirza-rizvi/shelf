# Shelf Test Plan

## Automated (run: `npm test` — currently 17 files and 129 tests; trust the runner if this count changes)

### Unit (pure logic, no browser)
- `lib/urls.test.ts` — restore allowlist (incl. `javascript:`/`data:` rejection).
- `lib/eviction.test.ts` — protections (active/pinned/audible), grouped-tabs-evictable, oldest-first ordering with fallbacks.
- `lib/search.test.ts` — case-insensitivity, AND-terms, group-name matches.
- `lib/duplicates.test.ts` — canonical URL comparison, excluded-domain matching, and cross-session duplicate locations.
- `lib/listView.test.ts` — workspace/domain filtering, independent sorting, and a 10,000-tab performance fixture.
- `lib/importExport/importOneTab.test.ts` — real-format fixtures, CRLF, bare URLs, pipes in titles, dangerous-line skipping.
- `lib/importExport/importJson.test.ts` — round-trip fidelity, id regeneration, prototype-pollution immunity, clamps, type confusion, out-of-range indexes.

### Components and manager behavior
- `components/GroupCard.test.tsx` — safe URL rendering, selection, row caps, restore actions, and menu behavior.
- `components/useStorageData.test.tsx` — initial storage reads and coalesced updates after local-storage changes.
- `entrypoints/manager/pages/Home.test.tsx` — workspace/list controls and top-level manager interactions.

### Integration (fake chrome via `wxt/testing`)
- `tests/integration/repo.test.ts` — shard round-trip, index ordering, dangling-entry pruning, orphan detection, settings deep-merge.
- `tests/integration/journal.test.ts` — crash recovery in both phases; never deletes indexed shards; leaves fresh in-flight ops alone.
- `tests/integration/capture.test.ts` — **the invariant: `tabs.remove` is never called when write verification fails**; tab-group metadata persisted by index; per-tab close failures tolerated.
- `tests/integration/trash.test.ts` — trash/restore/purge lifecycle; last-tab deletion removes group.
- `tests/integration/restore.test.ts` — lazy restore (discard after group reconstruction, failures tolerated, missing API tolerated); windowId targeting; blocked-scheme skipping.
- `tests/integration/tabLimit.test.ts` — over-limit auto-save of oldest excess; protections; disabled + startup-grace no-ops.
- `tests/integration/migrations.test.ts` — fresh seed, idempotence, downgrade refusal, full v1→v2 settings migration + backup-key cleanup.

## Manual browser checklist (before each release)

Load: `npm run build` → `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome-mv3`.

### Cold load
- [ ] DevTools console on popup + manager: zero errors, zero CSP violations.
- [ ] **Network tab on every Shelf page: zero requests** (the headline claim).

### Core round-trip
- [ ] Popup shows four primary buttons in order: Save this tab · Save tabs to the left · Save tabs to the right · Save this window, plus the secondary save scopes under “More save options”.
- [ ] Create a window with named/colored tab groups + one pinned tab → popup "Save this window" → tabs close only after the shelf appears (manager has no save buttons — popup only).
- [ ] Popup "Save this tab" → only the active tab shelved + closed ("Tab ·" shelf).
- [ ] Popup "Save tabs to the left/right" → only that side of the active tab is saved; pinned tabs and the active tab stay open; an empty side shows "Nothing to save."
- [ ] “More save options” supports highlighted tabs, the active native tab group, all other tabs, and all windows; workspace, destination session, and close-after-save choices are honored.
- [ ] Help nav link in the Shelf tab → #/help page renders.
- [ ] Restore group → order, pinned state, group names/colors identical; entry stays on shelf (default).
- [ ] Click a single saved tab → it opens AND loads the page (not blank, not unloaded).
- [ ] Restore a group → tabs open UNLOADED (grey in Chrome Task Manager, ~0 MB each) with correct titles/URLs, and load on first click — never blank.
- [ ] "Restore groups into a new window" setting → group opens in a fresh window with no leftover blank New Tab; single-tab restore stays in the current window.
- [ ] "Include pinned tabs when saving a window" off → window/all-window saves skip pinned tabs; "Save this tab" on a pinned tab still saves it.
- [ ] Restore & remove → group moves to Trash → Undo toast restores it.
- [ ] "Remove tabs from shelf after restoring" setting → restore moves the entry to trash.

### Crash safety
- [ ] `chrome://serviceworker-internals` → stop Shelf's SW immediately after clicking save → no tab loss (worst case: saved AND still open).
- [ ] Fill storage / kill mid-write scenarios covered by automated tests.

### Scale
- [ ] Import a 2,000-tab JSON → scroll + search stay usable; Chrome Task Manager memory for the Shelf tab stays modest (offscreen cards use content-visibility).

### Tab limit
- [ ] Enable, limit 5 → open a 6th tab → after the ~2 s debounce the oldest non-protected tab is auto-saved to an "Auto-saved" shelf and closed.
- [ ] Restart browser with 10 tabs restored → no false trigger (30 s startup grace).
- [ ] Audible tab, pinned tab, active tab never auto-moved.
- [ ] Unloaded tabs don't count: with limit 5, restore a 20-tab shelf → nothing is auto-saved (restored tabs are discarded).

### Manager tab (always-pinned anchor)
- [ ] Install / browser startup → pinned Shelf tab appears at the far left WITHOUT stealing focus.
- [ ] Close the Shelf tab, then Ctrl/Cmd+Shift+T (reopen closed tab) → exactly ONE Shelf tab remains within ~1 s (duplicate deduped).
- [ ] Unpin the tab manually → it snaps back pinned immediately; drag it into another window → re-pins there.
- [ ] Close the tab directly (✕ / middle-click) → it reappears pinned (leftmost, unfocused) within ~1 s.
- [ ] Close Shelf when it's the window's ONLY tab → window closes normally, no resurrect fight.
- [ ] Close the whole window containing Shelf → no immediate resurrect; open a NEW window → Shelf tab reappears pinned there.
- [ ] Close the tab, then open a new window immediately → exactly ONE pinned Shelf tab (no pendingUrl-race duplicate).
- [ ] macOS: close the LAST window → Chrome stays windowless, no new window spawns; reopening Chrome brings the pinned tab back.
- [ ] Save all tabs (bulk close) → exactly one manager tab afterwards, no duplicates.
- [ ] Quit Chrome → next startup brings it back (no zombie windows).

### Confirmations
- [ ] More → "Delete all shelves…" asks with shelf/tab counts; Cancel is a no-op; OK moves every shelf to Trash (recoverable).
- [ ] More → "Restore everything…" asks with the total tab count before opening anything.
- [ ] Trash "Delete forever…" and "Empty trash…" both ask with "cannot be undone" wording; Cancel is a no-op.

### Export / import
- [ ] Export JSON + export text; re-import both; import a real OneTab export.

### Manager page
- [ ] Stats strip shows shelf/tab counts, MB stored, and the "est." memory line; hidden when the shelf is empty. Shelf list fills the page width.

### Edge cases
- [ ] Open several links and save the window while they're still loading → all saved with their real URLs (pendingUrl), zero blank entries.
- [ ] Save a window containing New Tab pages / about:blank → those are skipped, never saved.
- [ ] Save window containing `chrome://settings` → saves; restore skips gracefully with per-tab notice; `javascript:` import line renders copy-only.
- [ ] Double-click save button rapidly → one shelf, not two.
- [ ] Popup closed immediately after clicking save → save still completes (background-owned).
- [ ] Light/dark/system theme switch applies without reload on all pages.

### Accessibility
- [ ] Full keyboard pass: save → search (`/`) → restore → delete → undo toast reachable; visible focus everywhere; screen reader announces toasts (aria-live).

### Settings
- [ ] Toggle two settings checkboxes in quick succession → both stick (partial-patch saves, no stale overwrite).

### Upgrade / reinstall
- [ ] Upgrade schema v1 and v2 fixtures to schema v3 → sessions remain intact, the Inbox workspace is created, settings are deep-merged, legacy backup keys are removed, and existing choices are preserved.
- [ ] Uninstall → reinstall → import previously exported JSON → full fidelity.
