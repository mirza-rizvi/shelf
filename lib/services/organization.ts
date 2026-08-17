import { canonicalUrl } from '../duplicates';
import { INBOX_WORKSPACE_ID, type SavedGroup, type TabItem } from '../types';
import * as repo from '../storage/repo';
import * as trash from './trash';

export async function duplicateGroup(groupId: string): Promise<string> {
  const source = await repo.getGroup(groupId);
  if (!source) throw new Error('Group not found');
  const now = Date.now();
  const copy: SavedGroup = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
    tabs: source.tabs.map((tab) => ({ ...tab, id: crypto.randomUUID(), savedAt: now })),
  };
  await repo.putGroupVerified(copy);
  await repo.addGroupToIndex(copy.id, 'start');
  return copy.id;
}

export async function moveGroup(groupId: string, workspaceId: string): Promise<void> {
  const [group, workspace] = await Promise.all([repo.getGroup(groupId), repo.getWorkspace(workspaceId)]);
  if (!group) throw new Error('Group not found');
  if (!workspace && workspaceId !== INBOX_WORKSPACE_ID) throw new Error('Workspace not found');
  await repo.putGroup({ ...group, workspaceId, updatedAt: Date.now() });
}

export async function reorderTabs(groupId: string, tabIds: string[]): Promise<void> {
  const group = await repo.getGroup(groupId);
  if (!group) throw new Error('Group not found');
  const byId = new Map(group.tabs.map((tab) => [tab.id, tab]));
  const requested = tabIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const omitted = group.tabs.filter((tab) => !tabIds.includes(tab.id));
  await repo.putGroup({ ...group, tabs: [...requested, ...omitted], updatedAt: Date.now() });
}

export async function moveTabs(
  items: { groupId: string; tabId: string }[],
  destinationGroupId?: string,
  workspaceId = INBOX_WORKSPACE_ID,
): Promise<{ groupId: string; moved: number }> {
  const unique = new Map(items.map((item) => [`${item.groupId}:${item.tabId}`, item]));
  const sourceIds = [...new Set([...unique.values()].map((item) => item.groupId))];
  const sources = await repo.getGroups(sourceIds);
  const moved: TabItem[] = [];
  for (const item of unique.values()) {
    const tab = sources.get(item.groupId)?.tabs.find((candidate) => candidate.id === item.tabId);
    if (tab) moved.push(tab);
  }
  if (moved.length === 0) throw new Error('No tabs found');
  const destination = destinationGroupId ? await repo.getGroup(destinationGroupId) : null;
  if (destinationGroupId && !destination) throw new Error('Destination session not found');
  const transferable = destination
    ? moved.filter((tab) => !destination.tabs.some((existing) => existing.id === tab.id))
    : moved;
  if (transferable.length === 0) throw new Error('Those tabs are already in that session');
  const now = Date.now();
  const target: SavedGroup = destination
    ? { ...destination, tabs: [...destination.tabs, ...transferable.map((tab) => ({ ...tab, chromeGroupIdx: null }))], updatedAt: now }
    : {
        id: crypto.randomUUID(),
        workspaceId,
        name: `Moved tabs · ${new Date(now).toLocaleString()}`,
        createdAt: now,
        updatedAt: now,
        chromeGroups: [],
        tabs: transferable.map((tab) => ({ ...tab, chromeGroupIdx: null })),
      };
  await repo.putGroupVerified(target);
  if (!destination) await repo.addGroupToIndex(target.id, 'start');
  for (const sourceId of sourceIds) {
    if (sourceId === target.id) continue;
    const source = sources.get(sourceId);
    if (!source) continue;
    const movingIds = new Set([...unique.values()].filter((item) => item.groupId === sourceId).map((item) => item.tabId));
    const remaining = source.tabs.filter((tab) => !movingIds.has(tab.id));
    if (remaining.length === 0) await repo.deleteGroup(sourceId);
    else await repo.putGroup({ ...source, tabs: remaining, updatedAt: now });
  }
  return { groupId: target.id, moved: transferable.length };
}

export async function trashSelected(items: { groupId: string; tabId: string }[]): Promise<number> {
  let count = 0;
  for (const item of items) if (await trash.trashTab(item.groupId, item.tabId)) count += 1;
  return count;
}

export async function removeDuplicates(groupIds: string[] | undefined, keep: 'newest' | 'oldest'): Promise<number> {
  const groups = groupIds?.length ? [...(await repo.getGroups(groupIds)).values()] : await repo.getAllGroups();
  const occurrences = new Map<string, { group: SavedGroup; tab: TabItem }[]>();
  for (const group of groups) for (const tab of group.tabs) {
    const key = canonicalUrl(tab.url);
    const list = occurrences.get(key) ?? [];
    list.push({ group, tab });
    occurrences.set(key, list);
  }
  let removed = 0;
  for (const matches of occurrences.values()) {
    if (matches.length < 2) continue;
    matches.sort((a, b) => a.tab.savedAt - b.tab.savedAt);
    const doomed = keep === 'oldest' ? matches.slice(1) : matches.slice(0, -1);
    for (const match of doomed) if (await trash.trashTab(match.group.id, match.tab.id)) removed += 1;
  }
  return removed;
}
