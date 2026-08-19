import type { SavedGroup, Settings } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';

export interface ShelfExport {
  format: 'shelf-export';
  schemaVersion: number;
  exportedAt: number;
  groups: SavedGroup[];
  settings?: Settings;
}

export function buildJsonExport(groups: SavedGroup[], settings?: Settings): string {
  const payload: ShelfExport = {
    format: 'shelf-export',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    groups,
    ...(settings ? { settings } : {}),
  };
  return JSON.stringify(payload, null, 2);
}
