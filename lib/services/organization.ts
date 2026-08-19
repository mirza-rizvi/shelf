import { findDuplicateSets } from '../duplicates';
import * as repo from '../storage/repo';
import * as trash from './trash';

/** Global duplicate cleanup. Every removal remains recoverable through Trash. */
export async function removeDuplicates(keep: 'newest' | 'oldest'): Promise<number> {
  const groups = await repo.getAllGroups();
  let removed = 0;
  for (const duplicate of findDuplicateSets(groups)) {
    const matches = duplicate.locations.sort((a, b) => a.tab.savedAt - b.tab.savedAt);
    const doomed = keep === 'oldest' ? matches.slice(1) : matches.slice(0, -1);
    for (const match of doomed) {
      if (await trash.trashTab(match.groupId, match.tab.id)) removed += 1;
    }
  }
  return removed;
}
