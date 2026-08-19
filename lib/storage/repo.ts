import type {
  GroupIndex,
  Meta,
  SavedGroup,
  Settings,
  TrashEntry,
} from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import {
  KEY_INDEX,
  KEY_META,
  KEY_SETTINGS,
  KEY_TRASH_INDEX,
  groupKey,
  isGroupKey,
  idFromGroupKey,
  trashKey,
} from './keys';
import { runMigrations } from './migrations';

/**
 * Storage repository. Sharded read/write over chrome.storage.local with
 * write-verify for group shards and index-invariant maintenance.
 *
 * Invariant: the index only ever points at existing shards. Write order for
 * additions is therefore shard-first-then-index; deletions are
 * index-first-then-shard. Dangling index ids are filtered on read; orphan
 * shards are garbage (collected by a periodic sweep).
 */

export class WriteVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteVerifyError';
  }
}

const local = () => chrome.storage.local;

function checksum(group: SavedGroup): number {
  let sum = 0;
  for (const t of group.tabs) sum += t.url.length + t.title.length;
  return sum;
}

// ---------- meta / readiness ----------

export async function getMeta(): Promise<Meta | null> {
  const res = await local().get(KEY_META);
  return (res[KEY_META] as Meta | undefined) ?? null;
}

export async function setMeta(patch: Partial<Meta>): Promise<void> {
  const cur = (await getMeta()) ?? {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    installedAt: Date.now(),
  };
  await local().set({ [KEY_META]: { ...cur, ...patch } });
}

let readyPromise: Promise<void> | null = null;

/**
 * Defensive migration gate. Every context (SW, popup, manager) calls this
 * before touching data; no-ops when schema is current. Covers the
 * SW-killed-mid-update case where onInstalled migrations never finished.
 */
export function ensureReady(): Promise<void> {
  readyPromise ??= (async () => {
    await runMigrations();
  })().catch((err: unknown) => {
    // Never memoize failure — a transient storage error would otherwise brick
    // every command until the service worker is recycled. Next call retries.
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

// ---------- index ----------

/** Serialize index read-modify-write cycles. Concurrent saves (popup capture
 * vs tab-limit auto-save vs import) would otherwise interleave get→set and
 * drop a group from the index — invisible in the UI, then permanently deleted
 * by the weekly orphan GC. All index writers run in the one SW context, so a
 * module-scope queue fully serializes them. */
let indexQueue: Promise<unknown> = Promise.resolve();
function enqueueIndexWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = indexQueue.then(fn, fn);
  indexQueue = next.catch(() => {});
  return next;
}

export async function getIndex(): Promise<GroupIndex> {
  const res = await local().get(KEY_INDEX);
  return (res[KEY_INDEX] as GroupIndex | undefined) ?? { groupOrder: [], updatedAt: 0 };
}

export async function setIndex(index: GroupIndex): Promise<void> {
  await local().set({ [KEY_INDEX]: { ...index, updatedAt: Date.now() } });
}

// ---------- groups ----------

export async function getGroup(id: string): Promise<SavedGroup | null> {
  const key = groupKey(id);
  const res = await local().get(key);
  return (res[key] as SavedGroup | undefined) ?? null;
}

export async function getGroups(ids: string[]): Promise<Map<string, SavedGroup>> {
  if (ids.length === 0) return new Map();
  const res = await local().get(ids.map(groupKey));
  const map = new Map<string, SavedGroup>();
  for (const id of ids) {
    const g = res[groupKey(id)] as SavedGroup | undefined;
    if (g) map.set(id, g);
  }
  return map;
}

/**
 * All groups in display order. Filters dangling index entries for the RESULT
 * only — strictly read-only. (It runs in UI contexts too; writing a pruned
 * index from there could clobber a group the SW just added. Actual pruning
 * happens in pruneIndex(), called by the weekly GC alarm.)
 */
export async function getAllGroups(): Promise<SavedGroup[]> {
  const index = await getIndex();
  const map = await getGroups(index.groupOrder);
  return index.groupOrder.filter((id) => map.has(id)).map((id) => map.get(id)!);
}

/** Drop index ids whose shards are gone. SW-only (GC alarm), serialized. */
export function pruneIndex(): Promise<void> {
  return enqueueIndexWrite(async () => {
    const index = await getIndex();
    const map = await getGroups(index.groupOrder);
    const present = index.groupOrder.filter((id) => map.has(id));
    if (present.length !== index.groupOrder.length) {
      await setIndex({ ...index, groupOrder: present });
    }
  });
}

/** Plain write (no verify) — for renames/reorders where data already existed. */
export async function putGroup(group: SavedGroup): Promise<void> {
  await local().set({ [groupKey(group.id)]: group });
}

/**
 * Write-verify: set, read back, compare. Used before anything destructive
 * (closing tabs) depends on the write having really landed on disk.
 */
export async function putGroupVerified(group: SavedGroup): Promise<void> {
  await local().set({ [groupKey(group.id)]: group });
  const back = await getGroup(group.id);
  if (!back || back.id !== group.id || back.tabs.length !== group.tabs.length || checksum(back) !== checksum(group)) {
    throw new WriteVerifyError(`Write verification failed for group ${group.id}`);
  }
}

/** Batch write-verify used by all-window capture. Nothing may close unless
 * every shard survived a single storage write and the readback check. */
export async function putGroupsVerified(groups: SavedGroup[]): Promise<void> {
  if (groups.length === 0) return;
  await local().set(Object.fromEntries(groups.map((group) => [groupKey(group.id), group])));
  const back = await getGroups(groups.map((group) => group.id));
  for (const group of groups) {
    const stored = back.get(group.id);
    if (
      !stored ||
      stored.tabs.length !== group.tabs.length ||
      checksum(stored) !== checksum(group)
    ) {
      throw new WriteVerifyError(`Write verification failed for group ${group.id}`);
    }
  }
}

/** Adds a group shard then prepends it to the index (shard-first order). */
export function addGroupToIndex(groupId: string, position: 'start' | 'end' = 'start'): Promise<void> {
  return enqueueIndexWrite(async () => {
    const index = await getIndex();
    if (index.groupOrder.includes(groupId)) return;
    const groupOrder =
      position === 'start' ? [groupId, ...index.groupOrder] : [...index.groupOrder, groupId];
    await setIndex({ ...index, groupOrder });
  });
}

/** Add several verified shards in one serialized index update. */
export function addGroupsToIndex(
  groupIds: string[],
  position: 'start' | 'end' = 'start',
): Promise<void> {
  return enqueueIndexWrite(async () => {
    const index = await getIndex();
    const fresh = groupIds.filter((id) => !index.groupOrder.includes(id));
    if (fresh.length === 0) return;
    const groupOrder =
      position === 'start' ? [...fresh, ...index.groupOrder] : [...index.groupOrder, ...fresh];
    await setIndex({ ...index, groupOrder });
  });
}

/** Index-first delete; shard removal after. */
export function deleteGroup(id: string): Promise<void> {
  return enqueueIndexWrite(async () => {
    const index = await getIndex();
    await setIndex({ ...index, groupOrder: index.groupOrder.filter((g) => g !== id) });
    await local().remove(groupKey(id));
  });
}

/**
 * Every key in the store, WITHOUT their values. `get(null)` would answer the
 * same question by deserializing the entire store — megabytes on a large
 * shelf, for a list of strings. getKeys() landed in Chrome 130 and the
 * manifest still supports 121, so it's feature-detected.
 */
export async function getAllKeys(): Promise<string[]> {
  const area = local() as typeof chrome.storage.local & { getKeys?: () => Promise<string[]> };
  if (typeof area.getKeys === 'function') {
    try {
      return await area.getKeys();
    } catch {
      // Present but non-functional (stubs, forks, test doubles) — fall back.
    }
  }
  return Object.keys(await local().get(null));
}

/** Orphan shards = group keys not referenced by the index. */
export async function collectOrphanGroupKeys(): Promise<string[]> {
  const [index, keys] = await Promise.all([getIndex(), getAllKeys()]);
  const referenced = new Set(index.groupOrder.map(groupKey));
  return keys.filter((k) => isGroupKey(k) && !referenced.has(k));
}

export async function removeKeys(keys: string[]): Promise<void> {
  if (keys.length > 0) await local().remove(keys);
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const res = await local().get(KEY_SETTINGS);
  const stored = res[KEY_SETTINGS] as Partial<Settings> | undefined;
  // Deep-ish merge so new settings fields get defaults after updates.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    tabLimit: { ...DEFAULT_SETTINGS.tabLimit, ...stored?.tabLimit },
  };
}

export async function setSettings(settings: Settings): Promise<void> {
  await local().set({ [KEY_SETTINGS]: settings });
}

// ---------- trash ----------

export async function getTrashIndex(): Promise<{ order: string[] }> {
  const res = await local().get(KEY_TRASH_INDEX);
  return (res[KEY_TRASH_INDEX] as { order: string[] } | undefined) ?? { order: [] };
}

export async function setTrashIndex(idx: { order: string[] }): Promise<void> {
  await local().set({ [KEY_TRASH_INDEX]: idx });
}

export async function getTrashEntries(): Promise<TrashEntry[]> {
  const idx = await getTrashIndex();
  if (idx.order.length === 0) return [];
  const res = await local().get(idx.order.map(trashKey));
  const entries: TrashEntry[] = [];
  const present: string[] = [];
  for (const id of idx.order) {
    const e = res[trashKey(id)] as TrashEntry | undefined;
    if (e) {
      entries.push(e);
      present.push(id);
    }
  }
  if (present.length !== idx.order.length) await setTrashIndex({ order: present });
  return entries;
}

export async function putTrashEntry(entry: TrashEntry): Promise<void> {
  await local().set({ [trashKey(entry.id)]: entry });
  const idx = await getTrashIndex();
  if (!idx.order.includes(entry.id)) {
    await setTrashIndex({ order: [entry.id, ...idx.order] });
  }
}

export async function deleteTrashEntry(id: string): Promise<void> {
  const idx = await getTrashIndex();
  await setTrashIndex({ order: idx.order.filter((t) => t !== id) });
  await local().remove(trashKey(id));
}

// ---------- diagnostics ----------

export async function bytesInUse(): Promise<number> {
  return local().getBytesInUse(null);
}

export { idFromGroupKey };
