# Shelf Architecture

Chrome MV3 extension. WXT + TypeScript + Vite, with React-compatible source compiled against lightweight Preact. Zero host permissions, zero content scripts, zero network egress.

## Layout

```
entrypoints/
  background.ts        # service worker — ALL mutations happen here
  popup/               # primary + advanced capture scopes and destinations
  manager/             # full-page UI (hash routes: #/ #/settings #/trash)
components/            # shared React (GroupCard, Toast, Favicon, hooks)
lib/
  types.ts             # data model + CURRENT_SCHEMA_VERSION
  urls|search|eviction|duplicates.ts # PURE logic — no chrome.*, unit-tested
  storage/keys.ts      # storage key layout
  storage/repo.ts      # sharded read/write, write-verify, index invariants
  storage/migrations/  # versioned, resumable migration runner
  services/            # capture, restore, tabLimit, trash, journal
  importExport/        # JSON + OneTab-text parsers (hostile-input safe)
  messaging.ts         # typed Command union, UI → background
```

**Rule:** pure modules take plain data in/out; `services/` + `repo.ts` touch `chrome.*` and are tested against `@webext-core/fake-browser` (via `wxt/testing`).

## Storage layout (chrome.storage.local)

| Key | Contents |
|---|---|
| `meta` | `{ schemaVersion, installedAt }` |
| `index` | `{ groupOrder: string[], updatedAt }` — display order |
| `group:<uuid>` | one `SavedGroup` shard per saved list |
| `settings` | `Settings` (deep-merged over defaults on read) |
| `trashIndex`, `trash:<uuid>` | trash entries (sharded like groups) |
| `op:<uuid>` | in-flight operation journal (crash recovery) |

`chrome.storage.session` (ephemeral, safe to lose): tab first-seen times, tab-limit latch, startup timestamp.

**Sharding rationale:** one key per group means saves and deletes rewrite only that shard plus the small index — never the whole dataset. `storage.onChanged` diffs stay cheap; UI refresh is coalesced.

**List derivation:** the manager preserves stored session/tab order and applies only text search through the pure `search` module. Collapse state is ephemeral. The page deliberately has no workspace, filter, sorting, density, bulk-selection, or drag state.

Shelf deliberately retains sharded `chrome.storage.local` instead of adding IndexedDB/Dexie. The current data shape is naturally document-sharded, storage is background-safe and transactional per `set()`, and this avoids a second persistence layer plus runtime dependency. Large lists are bounded with offscreen rendering and per-session row caps.

**Index invariant:** the index only points at existing shards. Additions write shard→index; deletions write index→shard. Dangling index ids are filtered and pruned on read; orphan shards are collected by a weekly alarm.

## The data-loss invariant (write-verify-close)

`capture.saveTabList()`:

1. journal `{phase:'writing', groupId/groupIds, mode, tabIds}`
2. write group shard; **read it back and verify** (id, tab count, checksum) — any mismatch throws and nothing closes
3. prepend to index; journal `phase:'written'`
4. only now close tabs (chunked `Promise.allSettled`; individual failures tolerated)
5. delete journal entry

`journal.recover()` runs at every SW start:
- stale `'writing'` entry → tabs were never closed; delete the un-indexed orphan shard (loses nothing).
- `'written'` entry → data is safe; clear the entry; worst case a tab is both saved and still open.

**Worst crash outcome anywhere in the pipeline is a duplicate, never a lost tab.**

All-window capture creates one session per source window and verifies the full shard batch before closing any source tab. Appends journal as `mode:'append'`, so crash recovery can never delete a pre-existing destination session.

## MV3 service-worker rules honored

- Every `chrome.*` listener registered synchronously at the SW top level.
- No load-bearing module state; config re-read from storage inside every handler. (Two deliberate ephemera: the debounce timer — re-armed by the next event or the 60 s sweep alarm if the SW dies — and a duplicate-click guard.)
- Long-lived scheduling via `chrome.alarms` (trash purge, limit sweep, orphan GC), re-asserted on `onInstalled`/`onStartup`.
- All mutating operations execute in the background via typed messages, so a closing popup can never abort a save. UI reads storage directly (read-only) and re-renders on `storage.onChanged`.

## Anchor tab (pinned manager)

A pinned `manager.html` tab always exists at the far left — it IS the product surface, OneTab-style. Four trigger paths feed one debounced `ensurePinnedManager()` pass (all in `entrypoints/background.ts`):

1. Lifecycle: `onInstalled`/`onStartup` run the ensure directly.
2. `tabs.onRemoved` → 300 ms debounced ensure. Skipped entirely when `removeInfo.isWindowClosing` — a dying window must be allowed to die (the tab returns via the other triggers).
3. `windows.onCreated` → ensure — this is what brings the anchor back after its window closed.
4. `tabs.onUpdated`: (a) `changeInfo.pinned === false` on the manager → instant re-pin (strict `=== false`, can't self-loop); (b) `changeInfo.url` commit on a manager tab → ensure/dedupe pass (catches Ctrl+Shift+T reopens); (c) the tracked manager tab id navigating AWAY from `manager.html` → ensure (in-place navigation fires no onRemoved).

`ensurePinnedManager()` itself: single-flight with a rerun flag (a trigger during an in-flight run forces one more pass on fresh state); matches `url` **or** `pendingUrl` (a just-created tab reports `url: ""` until commit); keeps the pinned instance and closes only PINNED extras (an unpinned manager tab was opened on purpose); refuses to create when zero windows exist (macOS windowless Chrome — creating would force a window open forever).

Capture filters own-origin pages, and the limiter excludes them, so no Shelf feature can ever close this tab. **Do not "simplify" any of the four trigger paths — each covers a distinct user action.**

## Tab-limit watcher

`tabs.onCreated/onAttached/onRemoved` → note first-seen (session storage, writes serialized through a promise queue — burst events would otherwise lose entries) → 2 s trailing debounce → `runCheck()`:
grace window 30 s (session-restore storm at startup; also renewed around every restore via `noteBulkOperation()` so a big restore can't evict the user's oldest tabs) → module in-flight guard + timestamp latch (stale >60 s ignored — a SW killed mid-check must not disable the limit) → count **loaded, saveworthy** tabs per window (discarded tabs cost ~0 RAM; blank/New Tab pages have nothing worth saving — neither is counted or evicted) → pure `selectEvictionCandidates()` (oldest first; active/pinned/audible always protected) → auto-save the excess via the same write-verify-close path.

## Native tab groups

`TabGroup.id` is session-scoped, so Shelf persists `{title, color, collapsed}` plus a per-tab index into that array. Restore recreates groups with `tabs.group()` + `tabGroups.update()`; a group that vanishes mid-capture degrades to ungrouped tabs.

## Restore safety

Scheme allowlist (`http`, `https`, `file`, `about`, `chrome`); `javascript:`/`data:`/`vbscript:` are never opened (copy-only in UI). Every `tabs.create` is individually caught; one restricted URL never aborts a batch.

**Lazy restore (group restores only):** restored tabs are `chrome.tabs.discard`ed so they cost ~0 RAM until clicked — but only AFTER their navigation commits (poll `tab.url` up to 20×100 ms; on timeout skip the discard — discarding pre-commit blanks the tab). Single-tab restore loads eagerly: the user clicked that tab to read it. Ungrouped tabs discard per creation chunk (bounds the load spike); grouped tabs only after `tabs.group()` runs (discard can replace the tab id), also chunked.

## Migrations

`meta.schemaVersion` gates everything. Fresh installs seed the current version. Upgrades run step-by-step and commit the version only after each transform, so a service-worker stop can safely resume. Newer-than-current data (a downgrade) is left untouched. `repo.ensureReady()` is called defensively from every context, so a missed `onInstalled` cannot strand data.

Schema v4 removed the short-lived workspace and view-preference layers. Its migration strips only workspace references, verifies every live and trashed group by id/tab-count/checksum, and then removes obsolete workspace/batch keys. Older workspace-aware JSON backups remain importable as flat sessions.

## Dependency justification

| Dependency | Why |
|---|---|
| `wxt` (exact version) | MV3 scaffolding, SW bundling, HMR, store zip; future Firefox path |
| `react`, `react-dom`, `preact` | React API/types with Preact aliased into the shipped bundle for lower resident memory |
| dev: `vitest`, `@testing-library/react`, `jsdom`, `@types/chrome` | Tests + types |

Deliberately excluded: zod (hand-rolled auditable import validator), react-router (30-line hash hook), uuid (`crypto.randomUUID`), CSS frameworks, icon fonts (inline glyphs).
