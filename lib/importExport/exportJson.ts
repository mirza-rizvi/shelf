import type { SavedGroup, Settings, Workspace } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';

export interface ShelfExport {
  format: 'shelf-export';
  schemaVersion: number;
  exportedAt: number;
  groups: SavedGroup[];
  settings?: Settings;
  workspaces?: Workspace[];
}

export function buildJsonExport(groups: SavedGroup[], settings?: Settings, workspaces?: Workspace[]): string {
  const payload: ShelfExport = {
    format: 'shelf-export',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    groups,
    ...(settings ? { settings } : {}),
    ...(workspaces ? { workspaces } : {}),
  };
  return JSON.stringify(payload, null, 2);
}
