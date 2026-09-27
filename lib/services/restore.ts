import type { RestoreResult, SavedGroup, TabItem } from '../types';
import { TABS_CREATE_CHUNK } from '../constants';
import { isDangerous, isRestorable } from '../urls';
import * as trash from './trash';

/**
 * Restore service. Never lets one bad URL abort a batch (Promise.allSettled),
 * refuses dangerous schemes, and recreates native tab groups from persisted
 * title/color/collapsed metadata.
 */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** How long to wait for a restored tab's navigation to commit before
 * leaving it loading instead of discarding it. */
const COMMIT_WAIT_MS = 2000;

/**
 * Tracks navigation commits for tabs created during one restore. Discarding
 * before the navigation has COMMITTED drops the pending URL and the tab
 * reopens blank, so each tab is discarded only once its url is set (commit
 * happens long before the page finishes loading, so the RAM win survives).
 *
 * One tabs.onUpdated listener, attached before the first tabs.create so no
 * commit can slip past, replaces per-tab tabs.get polling. Call dispose()
 * when the restore finishes.
 */
function createCommitWatcher() {
  const committed = new Set<number>();
  const waiters = new Map<number, (committedInTime: boolean) => void>();
  const onUpdated = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void => {
    if (!changeInfo.url) return;
    committed.add(tabId);
    waiters.get(tabId)?.(true);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);

  return {
    /** Record a url already present on the tab tabs.create returned. */
    note(tab: chrome.tabs.Tab): void {
      if (tab.id !== undefined && tab.url) committed.add(tab.id);
    },
    /** Resolves true once the tab has committed, false after the timeout. */
    wait(tabId: number): Promise<boolean> {
      if (committed.has(tabId)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(tabId);
          resolve(false);
        }, COMMIT_WAIT_MS);
        waiters.set(tabId, (committedInTime) => {
          clearTimeout(timer);
          waiters.delete(tabId);
          resolve(committedInTime);
        });
      });
    },
    dispose(): void {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      // Anything still waiting never committed: leave it loading, not blank.
      for (const release of [...waiters.values()]) release(false);
    },
  };
}

type CommitWatcher = ReturnType<typeof createCommitWatcher>;

/** Unload freshly restored tabs so they cost ~0 RAM until first click
 * (OneTab's "save memory" behavior for group restores). discard() rejects on
 * active tabs and can replace the tab object (new id) — call it only after
 * tab-group reconstruction, and ignore all failures. A tab that hasn't
 * committed within COMMIT_WAIT_MS is left loading rather than blanked. */
async function discardAll(tabIds: number[], watcher: CommitWatcher): Promise<void> {
  if (typeof chrome.tabs.discard !== 'function') return;
  await Promise.allSettled(
    tabIds.map(async (id) => {
      if (await watcher.wait(id)) await chrome.tabs.discard(id);
    }),
  );
}

export async function restoreTab(item: TabItem, windowId?: number): Promise<RestoreResult> {
  if (isDangerous(item.url) || !isRestorable(item.url)) {
    return { restored: 0, skipped: [{ url: item.url, title: item.title, reason: 'blocked-scheme' }] };
  }
  try {
    // Single-tab restore loads eagerly: the user clicked THIS tab to read it,
    // and an instant discard can race the navigation commit → blank tab.
    await chrome.tabs.create({ url: item.url, active: false, pinned: item.pinned, windowId });
    return { restored: 1, skipped: [] };
  } catch {
    return { restored: 0, skipped: [{ url: item.url, title: item.title, reason: 'create-failed' }] };
  }
}

export interface RestoreGroupOptions {
  removeAfter: boolean;
  /** Restore into this window instead of the current one. */
  windowId?: number;
}

export async function restoreGroup(
  group: SavedGroup,
  opts: RestoreGroupOptions,
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, skipped: [] };
  const restoredItemIds: string[] = [];

  // Pinned first so pinned ordering is preserved, then the rest in order.
  const ordered = [...group.tabs.filter((t) => t.pinned), ...group.tabs.filter((t) => !t.pinned)];

  // Track created tab ids per native-group index for group reconstruction.
  const createdByGroupIdx = new Map<number, number[]>();
  const watcher = createCommitWatcher();
  try {

    for (const batch of chunk(ordered, TABS_CREATE_CHUNK)) {
      const chunkUngrouped: number[] = [];
      const settled = await Promise.allSettled(
        batch.map(async (item) => {
          if (isDangerous(item.url) || !isRestorable(item.url)) {
            throw new Error('blocked-scheme');
          }
          const tab = await chrome.tabs.create({
            url: item.url,
            active: false,
            pinned: item.pinned,
            windowId: opts.windowId,
          });
          watcher.note(tab);
          return { item, tab };
        }),
      );
      settled.forEach((r, i) => {
        const item = batch[i]!;
        if (r.status === 'fulfilled') {
          result.restored += 1;
          restoredItemIds.push(item.id);
          const tabId = r.value.tab.id;
          if (tabId !== undefined) {
            if (item.chromeGroupIdx !== null) {
              const list = createdByGroupIdx.get(item.chromeGroupIdx) ?? [];
              list.push(tabId);
              createdByGroupIdx.set(item.chromeGroupIdx, list);
            } else {
              chunkUngrouped.push(tabId);
            }
          }
        } else {
          result.skipped.push({
            url: item.url,
            title: item.title,
            reason: r.reason instanceof Error ? r.reason.message : 'create-failed',
          });
        }
      });
      // Unload this chunk before creating the next: a 200-tab restore must not
      // have all 200 pages loading at once. Grouped tabs wait until after
      // chrome.tabs.group (discard can replace the tab and change its id).
      await discardAll(chunkUngrouped, watcher);
    }

    // Recreate native tab groups.
    for (const [idx, tabIds] of createdByGroupIdx) {
      const meta = group.chromeGroups[idx];
      if (!meta || tabIds.length === 0) continue;
      try {
        const newGroupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
        await chrome.tabGroups.update(newGroupId, {
          title: meta.title,
          color: meta.color,
          collapsed: meta.collapsed,
        });
      } catch {
        // Grouping is best-effort; tabs are already restored.
      }
    }

    // Chunked: a 200-tab grouped shelf must not discard 200 tabs at once.
    for (const ids of chunk([...createdByGroupIdx.values()].flat(), TABS_CREATE_CHUNK)) {
      await discardAll(ids, watcher);
    }
  } finally {
    watcher.dispose();
  }

  if (opts.removeAfter && result.restored > 0) {
    // Remove only successfully restored entries. A blocked or failed URL must
    // remain saved so "restore and remove" can never silently lose it.
    if (restoredItemIds.length === group.tabs.length) await trash.trashGroup(group.id);
    else await trash.trashTabs(restoredItemIds.map((tabId) => ({ groupId: group.id, tabId })));
  }

  return result;
}
