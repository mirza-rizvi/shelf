import type { SavedChromeTabGroup, SavedGroup, TabGroupColor, TabItem, Workspace } from '../types';
import { CURRENT_SCHEMA_VERSION, INBOX_WORKSPACE_ID } from '../types';
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH } from '../constants';
import { isDangerous } from '../urls';

/**
 * Hand-rolled, hostile-input-safe JSON import validator.
 *
 * Rules: every field type-checked; unknown fields dropped; string lengths
 * clamped; ALL ids regenerated (never trust incoming ids); dangerous URL
 * schemes rejected per-entry; malformed entries skipped with a report,
 * never a thrown batch failure. Prototype-pollution keys are irrelevant
 * because we copy field-by-field onto fresh objects — nothing is spread
 * or merged from the input.
 */

export interface JsonImportResult {
  groups: SavedGroup[];
  skipped: number;
  errors: string[];
  workspaces: Workspace[];
}

const VALID_COLORS: ReadonlySet<string> = new Set([
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
]);

function asString(v: unknown, max: number): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseTab(raw: unknown, now: number, chromeGroupCount: number): TabItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const url = asString(o['url'], MAX_URL_LENGTH)?.trim();
  if (!url || !/^[a-z][a-z0-9+.-]*:/i.test(url) || isDangerous(url)) return null;
  const title = asString(o['title'], MAX_TITLE_LENGTH)?.trim() || url;
  const idxRaw = o['chromeGroupIdx'];
  const chromeGroupIdx =
    typeof idxRaw === 'number' && Number.isInteger(idxRaw) && idxRaw >= 0 && idxRaw < chromeGroupCount
      ? idxRaw
      : null;
  return {
    id: crypto.randomUUID(),
    url,
    title,
    pinned: o['pinned'] === true,
    savedAt: asFiniteNumber(o['savedAt'], now),
    chromeGroupIdx,
  };
}

function parseChromeGroup(raw: unknown): SavedChromeTabGroup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const colorRaw = typeof o['color'] === 'string' ? o['color'] : 'grey';
  return {
    title: asString(o['title'], 256) ?? '',
    color: (VALID_COLORS.has(colorRaw) ? colorRaw : 'grey') as TabGroupColor,
    collapsed: o['collapsed'] === true,
  };
}

export function parseJsonImport(json: string): JsonImportResult {
  const result: JsonImportResult = { groups: [], workspaces: [], skipped: 0, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    result.errors.push('File is not valid JSON.');
    return result;
  }

  // Accept our export envelope or a bare array of groups.
  let rawGroups: unknown;
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>)['groups'])) {
    rawGroups = (parsed as Record<string, unknown>)['groups'];
  } else if (Array.isArray(parsed)) {
    rawGroups = parsed;
  } else {
    result.errors.push('Unrecognized format: expected a Shelf export or an array of groups.');
    return result;
  }

  const envelope = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  if (envelope?.['format'] === 'shelf-export' && typeof envelope['schemaVersion'] === 'number' && envelope['schemaVersion'] > CURRENT_SCHEMA_VERSION) {
    result.errors.push('This backup was made by a newer Shelf version. Update Shelf before importing it.');
    return result;
  }
  const workspaceIdMap = new Map<string, string>();
  if (Array.isArray(envelope?.['workspaces'])) {
    for (const raw of envelope!['workspaces'] as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as Record<string, unknown>;
      const oldId = asString(item['id'], 128);
      const name = asString(item['name'], 128)?.trim();
      if (!oldId || !name || oldId === INBOX_WORKSPACE_ID) continue;
      const id = crypto.randomUUID();
      workspaceIdMap.set(oldId, id);
      result.workspaces.push({ id, name, createdAt: Date.now(), updatedAt: Date.now() });
    }
  }

  const now = Date.now();
  for (const rawGroup of rawGroups as unknown[]) {
    if (typeof rawGroup !== 'object' || rawGroup === null) {
      result.skipped += 1;
      continue;
    }
    const o = rawGroup as Record<string, unknown>;
    const rawChromeGroups = Array.isArray(o['chromeGroups']) ? (o['chromeGroups'] as unknown[]) : [];
    const chromeGroups = rawChromeGroups
      .map(parseChromeGroup)
      .filter((g): g is SavedChromeTabGroup => g !== null)
      .slice(0, 64);

    const rawTabs = Array.isArray(o['tabs']) ? (o['tabs'] as unknown[]) : [];
    const tabs: TabItem[] = [];
    for (const rawTab of rawTabs) {
      const tab = parseTab(rawTab, now, chromeGroups.length);
      if (tab) tabs.push(tab);
      else result.skipped += 1;
    }
    if (tabs.length === 0) {
      if (rawTabs.length > 0) result.errors.push('A group was skipped: no valid tabs.');
      continue;
    }
    result.groups.push({
      id: crypto.randomUUID(),
      name: asString(o['name'], 512)?.trim() || `Imported · ${tabs.length} tabs`,
      createdAt: asFiniteNumber(o['createdAt'], now),
      updatedAt: asFiniteNumber(o['updatedAt'], now),
      chromeGroups,
      tabs,
      workspaceId: workspaceIdMap.get(asString(o['workspaceId'], 128) ?? '') ?? INBOX_WORKSPACE_ID,
    });
  }
  return result;
}
