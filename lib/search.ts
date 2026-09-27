import type { SavedGroup, TabItem } from './types';

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

/** Lowercased "title url" per tab, cached per group object. Stored groups are
 * replaced, never mutated (useStorageData patches by swapping objects), so a
 * cached entry can't go stale and a keystroke no longer re-lowercases every
 * saved tab. WeakMap lets replaced groups be collected. */
const haystackCache = new WeakMap<SavedGroup, string[]>();

function haystacksFor(group: SavedGroup): string[] {
  let hays = haystackCache.get(group);
  if (!hays) {
    hays = group.tabs.map((tab) => (tab.title + ' ' + tab.url).toLowerCase());
    haystackCache.set(group, hays);
  }
  return hays;
}

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
    const hays = haystacksFor(group);
    for (let i = 0; i < group.tabs.length; i++) {
      if (terms.every((t) => hays[i]!.includes(t))) matchingTabIds.add(group.tabs[i]!.id);
    }
    if (nameMatches || matchingTabIds.size > 0) {
      results.push({ group, matchingTabIds });
    }
  }
  return results;
}

export interface FilteredGroup {
  group: SavedGroup;
  /** Tabs to render: the matches, or every tab when the group matched by name
   * or no search is active. */
  tabs: TabItem[];
}

/** Last filtered array per group, so a keystroke that leaves a group's
 * matches unchanged hands GroupCard the same array and its memo holds. */
const filteredCache = new WeakMap<SavedGroup, TabItem[]>();

export function filterGroups(groups: SavedGroup[], query: string): FilteredGroup[] {
  const searchActive = query.trim().length > 0;
  return searchGroups(groups, query).map(({ group, matchingTabIds }) => {
    if (!searchActive || matchingTabIds.size === 0) return { group, tabs: group.tabs };
    const previous = filteredCache.get(group);
    if (previous && previous.length === matchingTabIds.size && previous.every((tab) => matchingTabIds.has(tab.id))) {
      return { group, tabs: previous };
    }
    const tabs = group.tabs.filter((tab) => matchingTabIds.has(tab.id));
    filteredCache.set(group, tabs);
    return { group, tabs };
  });
}
