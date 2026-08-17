/**
 * Shelf data model. Everything persists to chrome.storage.local (sharded —
 * see lib/storage/keys.ts). Pure types only: no chrome.* imports here.
 */

export const CURRENT_SCHEMA_VERSION = 3;
export const INBOX_WORKSPACE_ID = 'inbox';

/** Colors mirror chrome.tabGroups.Color (stable string union, safe to persist). */
export type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

export interface TabItem {
  id: string; // uuid
  url: string;
  title: string;
  pinned: boolean;
  savedAt: number; // epoch ms
  /** Index into SavedGroup.chromeGroups; null = not in a native tab group. */
  chromeGroupIdx: number | null;
}

/** Native Chrome tab-group metadata. Native group IDs are session-scoped — never persisted. */
export interface SavedChromeTabGroup {
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

/** One saved list entry ("shelf"). Stored as its own shard: group:<id>. */
export interface SavedGroup {
  id: string; // uuid
  name: string;
  createdAt: number;
  updatedAt: number;
  chromeGroups: SavedChromeTabGroup[];
  tabs: TabItem[]; // display + restore order
  /** Missing on legacy v1/v2 shards; missing always resolves to Inbox. */
  workspaceId?: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceIndex {
  workspaceOrder: string[];
  updatedAt: number;
}

export interface TabLimitSettings {
  enabled: boolean;
  maxTabs: number;
}

export type ManagerDensity = 'comfortable' | 'compact';
export type ManagerSessionSort = 'manual' | 'newest' | 'oldest' | 'name' | 'tab-count';
export type ManagerTabSort = 'manual' | 'title' | 'domain' | 'newest' | 'oldest';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  /** false (default): restoring keeps the entry on the shelf. */
  restoreRemovesFromList: boolean;
  /** false (default): window/all-window saves leave pinned tabs alone. */
  savePinnedTabs: boolean;
  /** false (default): groups restore into the current window. */
  restoreInNewWindow: boolean;
  /** true (default): capture frees memory by closing only after verification. */
  captureClosesTabs: boolean;
  /** Skip canonical-URL duplicates within the incoming/destination session. */
  skipDuplicatesOnSave: boolean;
  /** Normalized host names. A rule also matches that host's subdomains. */
  excludedDomains: string[];
  managerDensity: ManagerDensity;
  managerSessionSort: ManagerSessionSort;
  managerTabSort: ManagerTabSort;
  /** Updated after a successful user-initiated JSON/text export. */
  lastExportAt?: number;
  /** Per-window limit; excess tabs auto-save to a shelf (oldest first). */
  tabLimit: TabLimitSettings;
}

export interface TrashEntry {
  id: string; // uuid (trash entry id, not the group id)
  deletedAt: number;
  /** What was deleted; single-tab deletions are wrapped in a 1-tab group. */
  kind: 'group' | 'tab';
  group: SavedGroup;
  /** Links entries created by one bulk/workspace operation. */
  batchId?: string;
}

export interface TrashBatch {
  id: string;
  kind: 'bulk-tabs' | 'workspace';
  deletedAt: number;
  entryIds: string[];
  workspace?: Workspace;
}

/** Crash-recovery journal entry for save-then-close operations. */
export interface OpJournalEntry {
  opId: string;
  type: 'save-close';
  groupId: string;
  /** Multi-window captures can create several verified sessions atomically. */
  groupIds?: string[];
  /** Append recovery must never delete the pre-existing destination shard. */
  mode?: 'create' | 'append';
  tabIds: number[];
  phase: 'writing' | 'written';
  startedAt: number;
}

export interface Meta {
  schemaVersion: number;
  installedAt: number;
}

export interface GroupIndex {
  groupOrder: string[];
  updatedAt: number;
}

/** Result of a capture (save) operation, reported back to the UI. */
export interface CaptureResult {
  groupId: string | null;
  groupIds?: string[];
  saved: number;
  closed: number;
  failures: number;
  skippedDuplicates?: number;
}

/** Result of a restore operation. */
export interface RestoreResult {
  restored: number;
  skipped: { url: string; title: string; reason: string }[];
}

/** Minimal tab shape used by pure eviction logic (subset of chrome.tabs.Tab). */
export interface EvalTab {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  groupId: number; // -1 = ungrouped
  lastAccessed: number | undefined;
  firstSeen: number | undefined;
  url: string;
}
