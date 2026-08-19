import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroupIndex, SavedGroup, Settings, TrashEntry } from '../lib/types';
import {
  KEY_INDEX,
  KEY_META,
  KEY_SETTINGS,
  KEY_TRASH_INDEX,
  idFromGroupKey,
  isGroupKey,
  isOpKey,
  isTrashKey,
} from '../lib/storage/keys';
import * as repo from '../lib/storage/repo';

/**
 * Read-only live view of Shelf data for UI contexts. Reads storage directly
 * (fast) and refreshes on chrome.storage.onChanged; all writes go through
 * background messages (lib/messaging.ts).
 *
 * Updates are INCREMENTAL: the onChanged payload already carries the new
 * values, so a single group edit patches one array slot instead of re-reading
 * and re-deserializing every shard. Untouched groups keep their object
 * identity, which is what lets GroupCard/TabRow memoize — the manager tab is
 * pinned open for the whole session, so a full re-render per write is the
 * dominant steady-state cost. Anything unrecognized falls back to refresh().
 */
export interface ShelfData {
  groups: SavedGroup[];
  settings: Settings;
  trash: TrashEntry[];
  loading: boolean;
  /** Storage read failed — data is intact, the READ failed. UI must show an
   * error + retry, never an empty state (which reads as data loss). */
  loadError: boolean;
  refresh: () => void;
}

type Changes = Record<string, chrome.storage.StorageChange>;

/** Keys whose writes have no bearing on what the UI shows: the in-flight
 * operation journal (op:*, written and cleared during every capture) and the
 * schema/meta record. Ignoring these keeps a save from triggering a refresh. */
const isIgnorableKey = (k: string) => isOpKey(k) || k === KEY_META;

const isKnownKey = (k: string) =>
  k === KEY_INDEX || k === KEY_SETTINGS || k === KEY_TRASH_INDEX || isGroupKey(k) || isTrashKey(k);

export function useStorageData(): ShelfData {
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  /** Mirror of `groups` readable synchronously inside async appliers, which
   * must not close over a stale render's array. */
  const groupsRef = useRef<SavedGroup[]>([]);
  /** Incremental patches are only meaningful once a full read has landed. */
  const readyRef = useRef(false);

  const applyGroups = useCallback((next: SavedGroup[]) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);

  const refresh = useCallback(() => {
    void (async () => {
      await repo.ensureReady();
      const [g, s, t] = await Promise.all([
        repo.getAllGroups(),
        repo.getSettings(),
        repo.getTrashEntries(),
      ]);
      applyGroups(g);
      setSettingsState(s);
      setTrash(t);
      setLoadError(false);
      setLoading(false);
      readyRef.current = true;
    })().catch(() => {
      // Transient storage failure must not white-screen the page forever.
      readyRef.current = false;
      setLoadError(true);
      setLoading(false);
    });
  }, [applyGroups]);

  /**
   * Rebuild the group list from a batch of changes, reusing existing objects
   * for every group the batch didn't touch. Returns false when the batch can't
   * be applied incrementally and the caller should fall back to refresh().
   */
  const applyGroupChanges = useCallback(
    async (changes: Changes): Promise<boolean> => {
      const groupEntries = Object.entries(changes).filter(([k]) => isGroupKey(k));
      const indexChange = changes[KEY_INDEX];
      if (groupEntries.length === 0 && !indexChange) return true;

      const current = groupsRef.current;
      const byId = new Map(current.map((g) => [g.id, g]));
      for (const [key, change] of groupEntries) {
        const id = idFromGroupKey(key);
        const next = change.newValue as SavedGroup | undefined;
        if (next) byId.set(id, next);
        else byId.delete(id);
      }

      if (indexChange) {
        // The index is authoritative for order and membership.
        const order = (indexChange.newValue as GroupIndex | undefined)?.groupOrder ?? [];
        const missing = order.filter((id) => !byId.has(id));
        if (missing.length > 0) {
          // Batched multi-key read — only the shards we don't already hold.
          const fetched = await repo.getGroups(missing);
          for (const [id, g] of fetched) byId.set(id, g);
        }
        applyGroups(order.filter((id) => byId.has(id)).map((id) => byId.get(id)!));
        return true;
      }

      // No index change in this batch, so a shard we've never seen has no
      // known position — that's an add whose index write hasn't arrived yet.
      const known = new Set(current.map((g) => g.id));
      for (const [key, change] of groupEntries) {
        if (change.newValue !== undefined && !known.has(idFromGroupKey(key))) return false;
      }
      applyGroups(current.filter((g) => byId.has(g.id)).map((g) => byId.get(g.id)!));
      return true;
    },
    [applyGroups],
  );

  const applyChanges = useCallback(
    async (changes: Changes): Promise<void> => {
      const keys = Object.keys(changes);
      if (!readyRef.current || !keys.every(isKnownKey)) {
        refresh();
        return;
      }

      // getSettings() applies the DEFAULT_SETTINGS merge, so read it rather
      // than trusting the raw newValue (which predates any new field).
      if (KEY_SETTINGS in changes) setSettingsState(await repo.getSettings());

      if (KEY_TRASH_INDEX in changes || keys.some(isTrashKey)) {
        setTrash(await repo.getTrashEntries());
      }

      if (!(await applyGroupChanges(changes))) refresh();
    },
    [applyGroupChanges, refresh],
  );

  useEffect(() => {
    refresh();

    let timer: ReturnType<typeof setTimeout> | null = null;
    // Accumulate across the coalescing window so an import's burst of shard
    // writes produces one state update rather than one per shard.
    let pending: Changes = {};
    // Appliers await storage reads; serialize so two flushes can't interleave
    // their read-modify-write of the group list.
    let queue: Promise<unknown> = Promise.resolve();

    const flush = () => {
      timer = null;
      const batch = pending;
      pending = {};
      queue = queue.then(
        () => applyChanges(batch).catch(() => refresh()),
        () => applyChanges(batch).catch(() => refresh()),
      );
    };

    const onChanged = (changes: Changes, area: string) => {
      if (area !== 'local') return;
      let relevant = false;
      for (const [key, change] of Object.entries(changes)) {
        if (isIgnorableKey(key)) continue;
        pending[key] = change;
        relevant = true;
      }
      if (!relevant) return;
      // Coalesce bursts of storage writes into one update.
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 120);
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      if (timer) clearTimeout(timer);
    };
  }, [applyChanges, refresh]);

  return {
    groups,
    settings: settings ?? ({} as Settings),
    trash,
    loading: loading || (settings === null && !loadError),
    loadError,
    refresh,
  };
}
