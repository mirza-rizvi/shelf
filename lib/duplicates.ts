import type { SavedGroup, TabItem } from './types';

/** Conservative identity: URL parsing normalizes scheme/host/default ports,
 * while path, query ordering/values and hash remain significant. */
export function canonicalUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value.trim();
  }
}

export function normalizedHost(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return '';
  }
}

export function matchesExcludedDomain(url: string, excludedDomains: readonly string[]): boolean {
  const host = normalizedHost(url);
  if (!host) return false;
  return excludedDomains.some((raw) => {
    const rule = raw.trim().replace(/^\.+|\.+$/g, '').toLocaleLowerCase();
    return rule !== '' && (host === rule || host.endsWith(`.${rule}`));
  });
}

export interface DuplicateLocation {
  groupId: string;
  groupName: string;
  tab: TabItem;
}

export interface DuplicateSet {
  canonicalUrl: string;
  locations: DuplicateLocation[];
}

export function findDuplicateSets(groups: readonly SavedGroup[]): DuplicateSet[] {
  const byUrl = new Map<string, DuplicateLocation[]>();
  for (const group of groups) {
    for (const tab of group.tabs) {
      const key = canonicalUrl(tab.url);
      const list = byUrl.get(key) ?? [];
      list.push({ groupId: group.id, groupName: group.name, tab });
      byUrl.set(key, list);
    }
  }
  return [...byUrl.entries()]
    .filter(([, locations]) => locations.length > 1)
    .map(([url, locations]) => ({ canonicalUrl: url, locations }))
    .sort((a, b) => b.locations.length - a.locations.length || a.canonicalUrl.localeCompare(b.canonicalUrl));
}
