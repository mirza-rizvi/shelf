import { normalizedHost } from './duplicates';
import { searchGroups } from './search';
import type { ManagerSessionSort, ManagerTabSort, SavedGroup, TabItem } from './types';

export interface DomainOption {
  host: string;
  count: number;
}

export interface ListViewGroup {
  group: SavedGroup;
  tabs: TabItem[];
}

export function toggleSelection(current: ReadonlySet<string>, keys: string[], select: boolean): Set<string> {
  const next = new Set(current);
  for (const key of keys) select ? next.add(key) : next.delete(key);
  return next;
}

export function reconcileSelection(current: ReadonlySet<string>, groups: SavedGroup[]): Set<string> {
  const live = new Set<string>();
  for (const group of groups) for (const tab of group.tabs) live.add(`${group.id}:${tab.id}`);
  return new Set([...current].filter((key) => live.has(key)));
}

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function buildDomainOptions(groups: SavedGroup[]): DomainOption[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const tab of group.tabs) {
      const host = normalizedHost(tab.url);
      if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts].map(([host, count]) => ({ host, count })).sort(
    (a, b) => b.count - a.count || compareText(a.host, b.host),
  );
}

function sortTabs(tabs: TabItem[], sort: ManagerTabSort): TabItem[] {
  if (sort === 'manual') return tabs;
  return tabs.map((tab, index) => ({ tab, index })).sort((a, b) => {
    let result = 0;
    if (sort === 'title') result = compareText(a.tab.title, b.tab.title);
    else if (sort === 'domain') {
      result = compareText(normalizedHost(a.tab.url), normalizedHost(b.tab.url)) || compareText(a.tab.title, b.tab.title);
    } else if (sort === 'newest') result = b.tab.savedAt - a.tab.savedAt;
    else result = a.tab.savedAt - b.tab.savedAt;
    return result || a.index - b.index;
  }).map(({ tab }) => tab);
}

export function deriveListView(
  groups: SavedGroup[],
  query: string,
  domain: string,
  sessionSort: ManagerSessionSort,
  tabSort: ManagerTabSort,
): ListViewGroup[] {
  const searchActive = query.trim().length > 0;
  const searched = searchGroups(groups, query);
  const visible = searched.flatMap(({ group, matchingTabIds }) => {
    let tabs = searchActive && matchingTabIds.size > 0
      ? group.tabs.filter((tab) => matchingTabIds.has(tab.id))
      : group.tabs;
    if (domain) tabs = tabs.filter((tab) => normalizedHost(tab.url) === domain);
    return tabs.length > 0 ? [{ group, tabs: sortTabs(tabs, tabSort) }] : [];
  });
  if (sessionSort === 'manual') return visible;
  return visible.map((item, index) => ({ item, index })).sort((a, b) => {
    let result = 0;
    if (sessionSort === 'newest') result = b.item.group.createdAt - a.item.group.createdAt;
    else if (sessionSort === 'oldest') result = a.item.group.createdAt - b.item.group.createdAt;
    else if (sessionSort === 'name') result = compareText(a.item.group.name, b.item.group.name);
    else result = b.item.group.tabs.length - a.item.group.tabs.length;
    return result || a.index - b.index;
  }).map(({ item }) => item);
}
