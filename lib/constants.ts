import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  restoreRemovesFromList: false,
  savePinnedTabs: false, // OneTab-style: window saves leave pinned tabs alone
  restoreInNewWindow: false,
  captureClosesTabs: true,
  skipDuplicatesOnSave: true,
  excludedDomains: [],
  managerDensity: 'comfortable',
  managerSessionSort: 'manual',
  managerTabSort: 'manual',
  tabLimit: {
    enabled: false,
    maxTabs: 25,
  },
};

/** Trash entries older than this are purged by the daily sweep. */
export const TRASH_RETENTION_DAYS = 30;

/** Trailing debounce before a tab-limit check runs. */
export const LIMIT_DEBOUNCE_MS = 2000;
/** Ignore tab events for this long after browser startup (session-restore storm). */
export const STARTUP_GRACE_MS = 30_000;
/** Periodic belt-and-braces sweep for the tab limit. */
export const LIMIT_SWEEP_MINUTES = 1;
/** Journal entries in phase 'writing' older than this are considered crashed. */
export const JOURNAL_STALE_MS = 60_000;
/** Identical save requests within this window are treated as duplicate clicks. */
export const DUPLICATE_SAVE_WINDOW_MS = 3000;
/** Undo toast lifetime. */
export const UNDO_TOAST_MS = 8000;
/** Import sanitizer clamps. */
export const MAX_TITLE_LENGTH = 2048;
export const MAX_URL_LENGTH = 8192;
/** Chunk sizes for bulk tab operations. */
export const TABS_REMOVE_CHUNK = 20;
export const TABS_CREATE_CHUNK = 10;
/** Soft warning threshold for storage use (bytes). */
export const STORAGE_WARN_BYTES = 100 * 1024 * 1024;

export const ALARM_TRASH_PURGE = 'trash-purge';
export const ALARM_LIMIT_SWEEP = 'limit-sweep';
export const ALARM_ORPHAN_GC = 'orphan-gc';
