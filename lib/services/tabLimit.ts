import type { EvalTab } from '../types';
import { LIMIT_DEBOUNCE_MS, STARTUP_GRACE_MS } from '../constants';
import { selectEvictionCandidates } from '../eviction';
import * as repo from '../storage/repo';
import { isSaveworthy, saveTabList } from './capture';

/**
 * Tab-limit watcher. Stateless across SW deaths: ephemeral coordination
 * state (first-seen times, latch, startup timestamp) lives in
 * chrome.storage.session; a periodic alarm sweep backs up the debounce.
 *
 * Behavior is fixed: per-window limit; excess tabs are auto-saved to a
 * shelf (oldest first, active/pinned/audible protected) and closed.
 */

const SESSION_FIRST_SEEN = 'tabFirstSeen';
const SESSION_STARTUP_AT = 'startupAt';
const SESSION_LATCH = 'limitCheckRunning';

/** Latch entries older than this are stale (SW died mid-check) and ignored. */
const LATCH_STALE_MS = 60_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cached `settings.tabLimit.enabled`. The feature is OFF by default, yet
 * onCreated/onRemoved fire for every tab in the browser — without this gate
 * each one costs a storage.session read-modify-write and a service-worker
 * wakeup for bookkeeping nobody will read. `null` means "not known yet"
 * (fresh service worker), which seeds itself on the first event.
 */
let enabledCache: boolean | null = null;

/** Push the current setting in. Called from ensureAlarms(), which already runs
 * on install, on startup, and after every saveSettings — so the toggle
 * propagates immediately with no extra reads. Pass null to forget it and force
 * the next event to re-read (used by tests, and harmless in production). */
export function noteEnabled(enabled: boolean | null): void {
  enabledCache = enabled;
}

/** Seed the cache from storage if this service worker hasn't learned it yet. */
async function isEnabled(): Promise<boolean> {
  enabledCache ??= (await repo.getSettings()).tabLimit.enabled;
  return enabledCache;
}

export async function markStartup(): Promise<void> {
  // Also clear any latch a mid-check SW death left behind last session.
  await chrome.storage.session.remove(SESSION_LATCH);
  await chrome.storage.session.set({ [SESSION_STARTUP_AT]: Date.now() });
}

/** Bulk tab creation ahead (restore): renew the grace window so the limit
 * doesn't evict the user's OLDEST tabs to make room for restored ones.
 * Reuses the startup-grace timestamp — identical semantics, zero new logic.
 * Call before AND after the bulk op (covers the trailing debounce). */
export async function noteBulkOperation(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STARTUP_AT]: Date.now() });
}

/** Serialize firstSeen map writes: onCreated/onRemoved fire per tab, and a
 * 100-tab restore would otherwise run 100 concurrent read-modify-write
 * cycles on the same object, losing most entries. */
let firstSeenQueue: Promise<unknown> = Promise.resolve();
function enqueueFirstSeen(fn: () => Promise<void>): Promise<void> {
  const next = firstSeenQueue.then(fn, fn);
  firstSeenQueue = next.catch(() => {});
  return next;
}

export function noteTabCreated(tabId: number | undefined): Promise<void> {
  if (tabId === undefined || enabledCache === false) return Promise.resolve();
  return enqueueFirstSeen(async () => {
    if (!(await isEnabled())) return;
    const res = await chrome.storage.session.get(SESSION_FIRST_SEEN);
    const map = (res[SESSION_FIRST_SEEN] as Record<string, number> | undefined) ?? {};
    if (map[tabId] === undefined) {
      map[tabId] = Date.now();
      await chrome.storage.session.set({ [SESSION_FIRST_SEEN]: map });
    }
  });
}

export function forgetTab(tabId: number): Promise<void> {
  // Disabled means nothing was ever recorded, so there is nothing to forget.
  if (enabledCache === false) return Promise.resolve();
  return enqueueFirstSeen(async () => {
    if (!(await isEnabled())) return;
    const res = await chrome.storage.session.get(SESSION_FIRST_SEEN);
    const map = (res[SESSION_FIRST_SEEN] as Record<string, number> | undefined) ?? {};
    if (map[tabId] !== undefined) {
      delete map[tabId];
      await chrome.storage.session.set({ [SESSION_FIRST_SEEN]: map });
    }
  });
}

/** Trailing debounce. If the SW dies before it fires, the next tab event or
 * the minute sweep alarm re-arms the check — nothing is lost. */
export function scheduleCheck(): void {
  // Don't hold the service worker awake for a check that would bail anyway.
  if (enabledCache === false) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runCheck().catch(() => {}); // saveTabList can throw WriteVerifyError
  }, LIMIT_DEBOUNCE_MS);
}

async function toEvalTabs(tabs: chrome.tabs.Tab[]): Promise<EvalTab[]> {
  const res = await chrome.storage.session.get(SESSION_FIRST_SEEN);
  const firstSeen = (res[SESSION_FIRST_SEEN] as Record<string, number> | undefined) ?? {};
  return tabs
    .filter((t) => t.id !== undefined)
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      index: t.index,
      active: t.active,
      pinned: t.pinned,
      audible: t.audible ?? false,
      groupId: t.groupId ?? -1,
      lastAccessed: (t as { lastAccessed?: number }).lastAccessed,
      firstSeen: firstSeen[t.id!],
      url: t.url || t.pendingUrl || '',
    }));
}

/** Module-scope in-flight guard: the debounce timer and the sweep alarm live
 * in the same SW, and the session latch alone is check-then-set (TOCTOU) —
 * two entrants could each save the same excess into two shelves. */
let checkInFlight: Promise<void> | null = null;

export function runCheck(): Promise<void> {
  checkInFlight ??= doRunCheck().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

async function doRunCheck(): Promise<void> {
  const { tabLimit } = await repo.getSettings();
  enabledCache = tabLimit.enabled; // authoritative read — keep the gate honest
  if (!tabLimit.enabled) return;

  // Session-restore grace period.
  const sess = await chrome.storage.session.get([SESSION_STARTUP_AT, SESSION_LATCH]);
  const startupAt = (sess[SESSION_STARTUP_AT] as number | undefined) ?? 0;
  if (Date.now() - startupAt < STARTUP_GRACE_MS) return;
  // Timestamp latch: a stale one (SW killed mid-check, finally never ran)
  // must not disable the limit for the rest of the session.
  const latchAt = sess[SESSION_LATCH] as number | undefined;
  if (latchAt !== undefined && Date.now() - latchAt < LATCH_STALE_MS) return;
  await chrome.storage.session.set({ [SESSION_LATCH]: Date.now() });

  try {
    // The limit counts LOADED, saveable tabs only: discarded tabs (lazy-
    // restored or unloaded by Chrome's memory saver) use minimal memory, and blank/
    // New Tab pages have nothing worth saving — neither is counted or evicted.
    const allTabs = (await chrome.tabs.query({})).filter((t) => !t.discarded && isSaveworthy(t));

    for (const scopeTabs of groupByWindow(allTabs).values()) {
      const excess = scopeTabs.length - tabLimit.maxTabs;
      if (excess <= 0) continue;

      const candidates = selectEvictionCandidates(await toEvalTabs(scopeTabs), excess);
      if (candidates.length === 0) continue;

      const candidateTabs = scopeTabs.filter((t) => candidates.some((c) => c.id === t.id));
      await saveTabList(candidateTabs, 'tab-limit', { closeOriginals: true });
    }
  } finally {
    await chrome.storage.session.remove(SESSION_LATCH);
  }
}

function groupByWindow(tabs: chrome.tabs.Tab[]): Map<number, chrome.tabs.Tab[]> {
  const map = new Map<number, chrome.tabs.Tab[]>();
  for (const t of tabs) {
    const list = map.get(t.windowId) ?? [];
    list.push(t);
    map.set(t.windowId, list);
  }
  return map;
}
