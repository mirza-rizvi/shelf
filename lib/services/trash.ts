import type { SavedGroup, TrashEntry } from '../types';
import { TRASH_RETENTION_DAYS } from '../constants';
import * as repo from '../storage/repo';

/**
 * Trash + undo. Every destructive action on saved data routes through here so
 * it can be reversed. Entries are purged after TRASH_RETENTION_DAYS.
 */

/** Move a whole saved group to trash. Returns the trash entry id (for undo). */
export async function trashGroup(groupId: string): Promise<string | null> {
  const group = await repo.getGroup(groupId);
  if (!group) return null;
  const entry: TrashEntry = {
    id: crypto.randomUUID(),
    deletedAt: Date.now(),
    kind: 'group',
    group,
  };
  // Trash shard first (data preserved), then remove from live set.
  await repo.putTrashEntry(entry);
  await repo.deleteGroup(groupId);
  return entry.id;
}

/** Move a single tab out of a group into trash (wrapped as a 1-tab group). */
export async function trashTab(groupId: string, tabId: string): Promise<string | null> {
  const group = await repo.getGroup(groupId);
  if (!group) return null;
  const tab = group.tabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const remaining = group.tabs.filter((t) => t.id !== tabId);
  const entry: TrashEntry = {
    id: crypto.randomUUID(),
    deletedAt: Date.now(),
    kind: 'tab',
    group: { ...group, id: crypto.randomUUID(), tabs: [tab], updatedAt: Date.now() },
  };
  await repo.putTrashEntry(entry);

  if (remaining.length === 0) {
    await repo.deleteGroup(groupId);
  } else {
    await repo.putGroup({ ...group, tabs: remaining, updatedAt: Date.now() });
  }
  return entry.id;
}

export interface TrashTabItem {
  groupId: string;
  tabId: string;
}

/**
 * Batched trashTab: creates the same one-tab TrashEntry objects and IDs as
 * repeated trashTab calls, processed in input order against an in-memory copy
 * of each affected group (fetched once). Missing groups/tabs are skipped,
 * exactly like repeated trashTab calls. Trash shards and remaining live
 * groups land BEFORE emptied groups leave the index — a failure before the
 * live-group writes leaves the originals intact.
 */
export async function trashTabs(items: readonly TrashTabItem[]): Promise<string[]> {
  if (items.length === 0) return [];
  const groups = await repo.getGroups([...new Set(items.map((i) => i.groupId))]);
  const current = new Map<string, SavedGroup>();
  const emptied = new Set<string>();
  const survivors = new Set<string>();
  const entries: TrashEntry[] = [];

  for (const { groupId, tabId } of items) {
    const group = current.get(groupId) ?? groups.get(groupId);
    if (!group) continue;
    const tab = group.tabs.find((t) => t.id === tabId);
    if (!tab) continue;

    const remaining = group.tabs.filter((t) => t.id !== tabId);
    current.set(groupId, { ...group, tabs: remaining, updatedAt: Date.now() });
    if (remaining.length === 0) {
      emptied.add(groupId);
      survivors.delete(groupId);
    } else {
      survivors.add(groupId);
    }
    entries.push({
      id: crypto.randomUUID(),
      deletedAt: Date.now(),
      kind: 'tab',
      group: { ...group, id: crypto.randomUUID(), tabs: [tab], updatedAt: Date.now() },
    });
  }
  if (entries.length === 0) return [];

  // Trash data first — every entry stays independently restorable even if a
  // live-group write below fails (worst case: tab saved AND still on the shelf).
  await repo.putTrashEntries(entries);
  await repo.putGroups([...survivors].map((id) => current.get(id)!));
  await repo.deleteGroups([...emptied]);
  return entries.map((e) => e.id);
}

/** Move every live session to Trash. Each session remains independently recoverable. */
export async function trashAll(): Promise<number> {
  const groups = await repo.getAllGroups();
  if (groups.length === 0) return 0;
  // One recoverable group-kind entry per live session; trash shards and the
  // trash index land before the live index drops the groups.
  const entries: TrashEntry[] = groups.map((group) => ({
    id: crypto.randomUUID(),
    deletedAt: Date.now(),
    kind: 'group',
    group,
  }));
  await repo.putTrashEntries(entries);
  await repo.deleteGroups(groups.map((g) => g.id));
  return entries.length;
}

/** Restore a trash entry back onto the shelf. Reads the indexed shard only. */
export async function restoreFromTrash(entryId: string): Promise<boolean> {
  const entry = await repo.getTrashEntry(entryId);
  if (!entry) return false;

  const existing = await repo.getGroup(entry.group.id);
  if (existing) {
    // Same-id group re-created meanwhile (rare): merge tabs instead of clobbering.
    await repo.putGroup({
      ...existing,
      tabs: [...existing.tabs, ...entry.group.tabs],
      updatedAt: Date.now(),
    });
  } else {
    await repo.putGroupVerified(entry.group);
    await repo.addGroupToIndex(entry.group.id, 'start');
  }
  await repo.deleteTrashEntry(entryId);
  return true;
}

export async function purgeTrashEntry(entryId: string): Promise<void> {
  await repo.deleteTrashEntry(entryId);
}

/** Empty the trash entirely — permanent, confirmed by the UI beforehand. */
export async function purgeAll(): Promise<number> {
  const idx = await repo.getTrashIndex();
  const entries = await repo.getTrashEntriesByIds(idx.order);
  await repo.deleteTrashEntries([...entries.keys()]);
  return entries.size;
}

/** Alarm handler: drop entries older than retention. */
export async function purgeExpired(): Promise<number> {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await repo.getTrashEntries();
  const expired = entries.filter((e) => e.deletedAt < cutoff).map((e) => e.id);
  await repo.deleteTrashEntries(expired);
  return expired.length;
}
