import { findDuplicateSets } from '../duplicates';
import * as repo from '../storage/repo';
import * as trash from './trash';

/** Global duplicate cleanup. Every removal remains recoverable through Trash.
 * Selection and processing order are unchanged; the doomed pairs are removed
 * with ONE batched trashTabs call instead of a per-tab round-trip. */
export async function removeDuplicates(keep: 'newest' | 'oldest'): Promise<number> {
  const groups = await repo.getAllGroups();
  const doomed: trash.TrashTabItem[] = [];
  for (const duplicate of findDuplicateSets(groups)) {
    const matches = duplicate.locations.sort((a, b) => a.tab.savedAt - b.tab.savedAt);
    const victims = keep === 'oldest' ? matches.slice(1) : matches.slice(0, -1);
    for (const match of victims) {
      doomed.push({ groupId: match.groupId, tabId: match.tab.id });
    }
  }
  const entryIds = await trash.trashTabs(doomed);
  return entryIds.length;
}
