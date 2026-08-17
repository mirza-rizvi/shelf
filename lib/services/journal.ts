import type { OpJournalEntry } from '../types';
import { JOURNAL_STALE_MS } from '../constants';
import { isOpKey, opKey } from '../storage/keys';
import { getAllKeys, getIndex } from '../storage/repo';
import { groupKey } from '../storage/keys';

/**
 * In-flight operation journal (crash recovery for save-then-close).
 * Lives in chrome.storage.local — must survive SW death and browser restarts.
 */

export async function put(entry: OpJournalEntry): Promise<void> {
  await chrome.storage.local.set({ [opKey(entry.opId)]: entry });
}

export async function setPhase(opId: string, phase: OpJournalEntry['phase']): Promise<void> {
  const key = opKey(opId);
  const res = await chrome.storage.local.get(key);
  const entry = res[key] as OpJournalEntry | undefined;
  if (entry) await chrome.storage.local.set({ [key]: { ...entry, phase } });
}

export async function remove(opId: string): Promise<void> {
  await chrome.storage.local.remove(opKey(opId));
}

/**
 * Called at every SW start. Safe in both crash phases:
 *  - 'writing' (stale): the shard may exist but tabs were NEVER closed →
 *    deleting an un-indexed orphan shard loses nothing (tabs still open).
 *  - 'written': data is safe on disk and indexed; tabs may or may not have
 *    closed. Do nothing destructive — worst case a duplicate open tab.
 */
export async function recover(): Promise<void> {
  // Runs on every browser start. Ask for key NAMES first and read only the
  // journal entries themselves — the usual case is zero, and pulling the whole
  // store back just to find that out stalls startup on a large shelf.
  const opKeys = (await getAllKeys()).filter(isOpKey);
  if (opKeys.length === 0) return;

  const all = await chrome.storage.local.get(opKeys);
  const now = Date.now();
  const index = await getIndex();
  const indexed = new Set(index.groupOrder);

  for (const [key, value] of Object.entries(all)) {
    const entry = value as OpJournalEntry;
    if (entry.phase === 'writing') {
      if (now - entry.startedAt < JOURNAL_STALE_MS) continue; // maybe still running
      const groupIds = entry.groupIds ?? [entry.groupId];
      if (entry.mode !== 'append') {
        const orphanKeys = groupIds.filter((id) => !indexed.has(id)).map(groupKey);
        if (orphanKeys.length > 0) await chrome.storage.local.remove(orphanKeys);
      }
      await chrome.storage.local.remove(key);
    } else {
      // 'written' — data safe; just clear the journal entry.
      await chrome.storage.local.remove(key);
    }
  }
}
