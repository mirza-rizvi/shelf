import { INBOX_WORKSPACE_ID } from '../types';
import * as repo from '../storage/repo';
import * as trash from './trash';

export async function deleteWorkspace(workspaceId: string): Promise<number> {
  if (workspaceId === INBOX_WORKSPACE_ID) throw new Error('Inbox cannot be deleted');
  const workspace = await repo.getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const groups = (await repo.getAllGroups()).filter((group) => group.workspaceId === workspaceId);
  let trashed = 0;
  const batchId = crypto.randomUUID();
  const entryIds: string[] = [];
  for (const group of groups) {
    const entryId = await trash.trashGroup(group.id, batchId);
    if (entryId) { entryIds.push(entryId); trashed += 1; }
  }
  await repo.putTrashBatch({ id: batchId, kind: 'workspace', deletedAt: Date.now(), entryIds, workspace });
  await repo.deleteWorkspaceRecord(workspaceId);
  return trashed;
}

export async function restoreWorkspace(batchId: string): Promise<number> {
  const batch = await repo.getTrashBatch(batchId);
  if (!batch?.workspace) throw new Error('Workspace recovery record not found');
  await repo.putWorkspace(batch.workspace);
  await repo.addWorkspaceToIndex(batch.workspace.id);
  let restored = 0;
  for (const entryId of batch.entryIds) if (await trash.restoreFromTrash(entryId)) restored += 1;
  await repo.deleteTrashBatch(batchId);
  return restored;
}
