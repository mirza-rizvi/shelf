import type { CaptureResult, RestoreResult, Settings, TabLimitSettings } from './types';
import type { CaptureScope } from './services/capture';

/** Partial settings update; tabLimit merges field-wise too. */
export type SettingsPatch = Partial<Omit<Settings, 'tabLimit'>> & {
  tabLimit?: Partial<TabLimitSettings>;
};

/**
 * Typed runtime messaging. All MUTATING operations run in the background
 * service worker — a popup closing mid-operation can never abort a save.
 * UI contexts read storage directly (read-only) and react to
 * chrome.storage.onChanged for live updates.
 */

export type Command =
  | {
      cmd: 'capture';
      scope: CaptureScope;
      closeOriginals?: boolean;
      destinationGroupId?: string;
      allowDuplicates?: boolean;
    }
  | { cmd: 'restoreTab'; groupId: string; tabId: string }
  | { cmd: 'restoreGroup'; groupId: string; removeAfter: boolean }
  | { cmd: 'trashGroup'; groupId: string }
  | { cmd: 'trashTab'; groupId: string; tabId: string }
  | { cmd: 'trashAll' }
  | { cmd: 'emptyTrash' }
  | { cmd: 'undoTrash'; entryId: string }
  | { cmd: 'purgeTrash'; entryId: string }
  | { cmd: 'removeDuplicates'; keep: 'newest' | 'oldest' }
  | { cmd: 'saveSettings'; settings: SettingsPatch }
  | { cmd: 'markExported' }
  | { cmd: 'importGroups'; json: string }
  | { cmd: 'importOneTab'; text: string };

export type CommandResult =
  | {
      ok: true;
      capture?: CaptureResult;
      restore?: RestoreResult;
      trashEntryId?: string | null;
      trashed?: number;
      imported?: number;
      removed?: number;
      purged?: number;
    }
  | { ok: false; error: string };

/** Map internal/Chrome error strings to something a person can act on.
 * Unknown messages pass through untouched. */
function friendlyError(message: string): string {
  if (message.includes('Write verification')) {
    return "Couldn't verify the save, so your tabs were left open. Try again.";
  }
  if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
    return 'Shelf just updated — reload this page and try again.';
  }
  return message;
}

export function sendCmd(command: Command): Promise<CommandResult> {
  return chrome.runtime
    .sendMessage(command)
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }))
    .then((res: CommandResult) => (res.ok ? res : { ok: false, error: friendlyError(res.error) }));
}
