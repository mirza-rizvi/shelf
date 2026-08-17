/** chrome.storage.local key layout. Sharded: one key per group/trash entry. */

export const KEY_META = 'meta';
export const KEY_INDEX = 'index';
export const KEY_SETTINGS = 'settings';
export const KEY_TRASH_INDEX = 'trashIndex';
export const KEY_WORKSPACE_INDEX = 'workspaceIndex';
export const KEY_TRASH_BATCH_INDEX = 'trashBatchIndex';

export const groupKey = (id: string) => `group:${id}`;
export const trashKey = (id: string) => `trash:${id}`;
export const opKey = (opId: string) => `op:${opId}`;
export const workspaceKey = (id: string) => `workspace:${id}`;
export const trashBatchKey = (id: string) => `trashBatch:${id}`;

export const isGroupKey = (k: string) => k.startsWith('group:');
export const isTrashKey = (k: string) => k.startsWith('trash:');
export const isOpKey = (k: string) => k.startsWith('op:');
export const isWorkspaceKey = (k: string) => k.startsWith('workspace:');
export const isTrashBatchKey = (k: string) => k.startsWith('trashBatch:');

export const idFromGroupKey = (k: string) => k.slice('group:'.length);
export const idFromTrashKey = (k: string) => k.slice('trash:'.length);
