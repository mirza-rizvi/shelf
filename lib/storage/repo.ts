import type {
  GroupIndex,
  Meta,
  SavedGroup,
  Settings,
  TrashBatch,
  TrashEntry,
  Workspace,
  WorkspaceIndex,
} from '../types';
import { CURRENT_SCHEMA_VERSION, INBOX_WORKSPACE_ID } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import {
  KEY_INDEX,
  KEY_META,
  KEY_SETTINGS,
  KEY_TRASH_INDEX,
  KEY_TRASH_BATCH_INDEX,
  KEY_WORKSPACE_INDEX,
  groupKey,
  isGroupKey,
  idFromGroupKey,
  trashKey,
  trashBatchKey,
  workspaceKey,
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

export function reorderGroups(groupOrder: string[]): Promise<void> {
  return enqueueIndexWrite(async () => {
    const current = await getIndex();
    const existing = await getGroups(current.groupOrder);
    const requested = groupOrder.filter((id) => existing.has(id));
    const omitted = current.groupOrder.filter((id) => existing.has(id) && !requested.includes(id));
    await setIndex({ ...current, groupOrder: [...requested, ...omitted] });
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

// ---------- workspaces ----------

let workspaceQueue: Promise<unknown> = Promise.resolve();
function enqueueWorkspaceWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = workspaceQueue.then(fn, fn);
  workspaceQueue = next.catch(() => {});
  return next;
}

export async function getWorkspaceIndex(): Promise<WorkspaceIndex> {
  const res = await local().get(KEY_WORKSPACE_INDEX);
  return (
    (res[KEY_WORKSPACE_INDEX] as WorkspaceIndex | undefined) ?? {
      workspaceOrder: [INBOX_WORKSPACE_ID],
      updatedAt: 0,
    }
  );
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const key = workspaceKey(id);
  const res = await local().get(key);
  return (res[key] as Workspace | undefined) ?? null;
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const idx = await getWorkspaceIndex();
  const ids = idx.workspaceOrder.includes(INBOX_WORKSPACE_ID)
    ? idx.workspaceOrder
    : [INBOX_WORKSPACE_ID, ...idx.workspaceOrder];
  const res = await local().get(ids.map(workspaceKey));
  const now = Date.now();
  return ids
    .map((id) => res[workspaceKey(id)] as Workspace | undefined)
    .filter((workspace): workspace is Workspace => Boolean(workspace))
    .concat(
      res[workspaceKey(INBOX_WORKSPACE_ID)]
        ? []
        : [{ id: INBOX_WORKSPACE_ID, name: 'Inbox', createdAt: now, updatedAt: now }],
    );
}

export function createWorkspace(name: string): Promise<Workspace> {
  return enqueueWorkspaceWrite(async () => {
    const clean = name.trim().slice(0, 128);
    if (!clean) throw new Error('Workspace name is required');
    const workspaces = await getWorkspaces();
    if (workspaces.some((w) => w.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      throw new Error('A workspace with that name already exists');
    }
    const now = Date.now();
    const workspace: Workspace = { id: crypto.randomUUID(), name: clean, createdAt: now, updatedAt: now };
    const idx = await getWorkspaceIndex();
    await local().set({
      [workspaceKey(workspace.id)]: workspace,
      [KEY_WORKSPACE_INDEX]: {
        workspaceOrder: [...idx.workspaceOrder, workspace.id],
        updatedAt: now,
      } satisfies WorkspaceIndex,
    });
    return workspace;
  });
}

export function renameWorkspace(id: string, name: string): Promise<void> {
  return enqueueWorkspaceWrite(async () => {
    const clean = name.trim().slice(0, 128);
    if (!clean) throw new Error('Workspace name is required');
    const [workspace, workspaces] = await Promise.all([getWorkspace(id), getWorkspaces()]);
    if (!workspace) throw new Error('Workspace not found');
    if (workspaces.some((w) => w.id !== id && w.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      throw new Error('A workspace with that name already exists');
    }
    await local().set({ [workspaceKey(id)]: { ...workspace, name: clean, updatedAt: Date.now() } });
  });
}

export function deleteWorkspaceRecord(id: string): Promise<void> {
  if (id === INBOX_WORKSPACE_ID) return Promise.reject(new Error('Inbox cannot be deleted'));
  return enqueueWorkspaceWrite(async () => {
    const idx = await getWorkspaceIndex();
    await local().set({
      [KEY_WORKSPACE_INDEX]: {
        workspaceOrder: idx.workspaceOrder.filter((workspaceId) => workspaceId !== id),
        updatedAt: Date.now(),
      } satisfies WorkspaceIndex,
    });
    await local().remove(workspaceKey(id));
  });
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  await local().set({ [workspaceKey(workspace.id)]: workspace });
}

export function addWorkspaceToIndex(id: string): Promise<void> {
  return enqueueWorkspaceWrite(async () => {
    const idx = await getWorkspaceIndex();
    if (idx.workspaceOrder.includes(id)) return;
    await local().set({
      [KEY_WORKSPACE_INDEX]: { workspaceOrder: [...idx.workspaceOrder, id], updatedAt: Date.now() } satisfies WorkspaceIndex,
    });
  });
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

export async function putTrashBatch(batch: TrashBatch): Promise<void> {
  const res = await local().get(KEY_TRASH_BATCH_INDEX);
  const order = (res[KEY_TRASH_BATCH_INDEX] as { order: string[] } | undefined)?.order ?? [];
  await local().set({
    [trashBatchKey(batch.id)]: batch,
    [KEY_TRASH_BATCH_INDEX]: { order: order.includes(batch.id) ? order : [batch.id, ...order] },
  });
}

export async function getTrashBatch(id: string): Promise<TrashBatch | null> {
  const key = trashBatchKey(id);
  const res = await local().get(key);
  return (res[key] as TrashBatch | undefined) ?? null;
}

export async function getTrashBatches(): Promise<TrashBatch[]> {
  const res = await local().get(KEY_TRASH_BATCH_INDEX);
  const order = (res[KEY_TRASH_BATCH_INDEX] as { order: string[] } | undefined)?.order ?? [];
  if (order.length === 0) return [];
  const values = await local().get(order.map(trashBatchKey));
  return order
    .map((id) => values[trashBatchKey(id)] as TrashBatch | undefined)
    .filter((batch): batch is TrashBatch => Boolean(batch));
}

export async function deleteTrashBatch(id: string): Promise<void> {
  const res = await local().get(KEY_TRASH_BATCH_INDEX);
  const order = (res[KEY_TRASH_BATCH_INDEX] as { order: string[] } | undefined)?.order ?? [];
  await local().set({ [KEY_TRASH_BATCH_INDEX]: { order: order.filter((batchId) => batchId !== id) } });
  await local().remove(trashBatchKey(id));
}

// ---------- diagnostics ----------

export async function bytesInUse(): Promise<number> {
  return local().getBytesInUse(null);
}

export { idFromGroupKey };
