import type { TrashEntry } from '../types';
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

/** Move every live session to Trash. Each session remains independently recoverable. */
export async function trashAll(): Promise<number> {
  const groups = await repo.getAllGroups();
  let trashed = 0;
  for (const group of groups) {
    if (await trashGroup(group.id)) trashed += 1;
  }
  return trashed;
}

/** Restore a trash entry back onto the shelf. */
export async function restoreFromTrash(entryId: string): Promise<boolean> {
  const entries = await repo.getTrashEntries();
  const entry = entries.find((e) => e.id === entryId);
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
  const entries = await repo.getTrashEntries();
  for (const e of entries) {
    await repo.deleteTrashEntry(e.id);
  }
  return entries.length;
}

/** Alarm handler: drop entries older than retention. */
export async function purgeExpired(): Promise<number> {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await repo.getTrashEntries();
  let purged = 0;
  for (const e of entries) {
    if (e.deletedAt < cutoff) {
      await repo.deleteTrashEntry(e.id);
      purged += 1;
    }
  }
  return purged;
}
