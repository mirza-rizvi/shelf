import type { SavedGroup, TabItem } from '../types';
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH } from '../constants';
import { isDangerous } from '../urls';

/**
 * Parse OneTab's export format (also our own text export):
 * one "url | title" per line, groups separated by blank lines.
 * Lines without " | " are treated as bare URLs.
 */
export interface TextImportResult {
  groups: SavedGroup[];
  skippedLines: string[];
}

export function parseOneTabExport(text: string): TextImportResult {
  const skippedLines: string[] = [];
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const now = Date.now();
  const groups: SavedGroup[] = [];

  blocks.forEach((block, i) => {
    const tabs: TabItem[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const sep = line.indexOf(' | ');
      const url = (sep === -1 ? line : line.slice(0, sep)).trim().slice(0, MAX_URL_LENGTH);
      const title = (sep === -1 ? line : line.slice(sep + 3)).trim().slice(0, MAX_TITLE_LENGTH) || url;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || isDangerous(url)) {
        skippedLines.push(line);
        continue;
      }
      tabs.push({
        id: crypto.randomUUID(),
        url,
        title,
        pinned: false,
        savedAt: now,
        chromeGroupIdx: null,
      });
    }
    if (tabs.length > 0) {
      groups.push({
        id: crypto.randomUUID(),
        name: `Imported ${i + 1} · ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`,
        createdAt: now,
        updatedAt: now,
        chromeGroups: [],
        tabs,
      });
    }
  });

  return { groups, skippedLines };
}
