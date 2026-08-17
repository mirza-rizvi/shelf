import type { SavedGroup } from './types';

/** Pure search over saved groups. Case-insensitive substring match on
 * group name, tab title, and URL. Multiple whitespace-separated terms AND. */

export interface SearchResult {
  group: SavedGroup;
  /** Matching tab ids; empty when the group matched by name only. */
  matchingTabIds: ReadonlySet<string>;
}

/** Shared instance for the no-query path so every result carries the SAME
 * empty set. Handing GroupCard a fresh Set per render would defeat its memo
 * for every card on every storage write. Read-only by the ReadonlySet type. */
const NO_MATCHES: ReadonlySet<string> = new Set<string>();

export function searchGroups(groups: SavedGroup[], query: string): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return groups.map((group) => ({ group, matchingTabIds: NO_MATCHES }));
  }
  const results: SearchResult[] = [];
  for (const group of groups) {
    const nameHay = group.name.toLowerCase();
    const nameMatches = terms.every((t) => nameHay.includes(t));
    const matchingTabIds = new Set<string>();
    for (const tab of group.tabs) {
      const hay = (tab.title + ' ' + tab.url).toLowerCase();
      if (terms.every((t) => hay.includes(t))) matchingTabIds.add(tab.id);
    }
    if (nameMatches || matchingTabIds.size > 0) {
      results.push({ group, matchingTabIds });
    }
  }
  return results;
}
