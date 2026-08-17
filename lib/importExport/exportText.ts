import type { SavedGroup } from '../types';

/** OneTab-compatible plain text: "url | title" lines, blank line between groups. */
export function buildTextExport(groups: SavedGroup[]): string {
  return groups
    .map((g) => g.tabs.map((t) => `${t.url} | ${t.title}`).join('\n'))
    .join('\n\n');
}
