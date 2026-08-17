import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SavedGroup } from '../../lib/types';
import * as repo from '../../lib/storage/repo';
import * as trash from '../../lib/services/trash';

function makeGroup(id: string, count: number): SavedGroup {
  return {
    id,
    name: `Group ${id}`,
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: Array.from({ length: count }, (_, i) => ({
      id: `${id}-t${i}`,
      url: `https://site${i}.com`,
      title: `Tab ${i}`,
      pinned: false,
      savedAt: 1,
      chromeGroupIdx: null,
    })),
  };
}

async function seed(id: string, count = 2): Promise<SavedGroup> {
  const g = makeGroup(id, count);
  await repo.putGroupVerified(g);
  await repo.addGroupToIndex(id);
  return g;
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('trash service', () => {
  it('trashGroup moves the group out of the live set and is restorable', async () => {
    await seed('g1');
    const entryId = await trash.trashGroup('g1');
    expect(entryId).not.toBeNull();
    expect(await repo.getAllGroups()).toHaveLength(0);
    expect(await repo.getTrashEntries()).toHaveLength(1);

    const ok = await trash.restoreFromTrash(entryId!);
    expect(ok).toBe(true);
    const groups = await repo.getAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tabs).toHaveLength(2);
    expect(await repo.getTrashEntries()).toHaveLength(0);
  });

  it('purgeAll empties the trash permanently without touching live shelves', async () => {
    await seed('g1');
    await seed('g2');
    await seed('keep');
    await trash.trashGroup('g1');
    await trash.trashGroup('g2');
    expect(await repo.getTrashEntries()).toHaveLength(2);

    const purged = await trash.purgeAll();

    expect(purged).toBe(2);
    expect(await repo.getTrashEntries()).toHaveLength(0);
    const all = await chrome.storage.local.get(null);
    expect(Object.keys(all).filter((k) => k.startsWith('trash:'))).toHaveLength(0);
    expect((await repo.getAllGroups()).map((g) => g.id)).toEqual(['keep']);
  });

  it('trashTab removes one tab; deleting the last tab removes the group', async () => {
    await seed('g1', 2);
    await trash.trashTab('g1', 'g1-t0');
    let g = await repo.getGroup('g1');
    expect(g!.tabs.map((t) => t.id)).toEqual(['g1-t1']);

    await trash.trashTab('g1', 'g1-t1');
    g = await repo.getGroup('g1');
    expect(g).toBeNull();
    expect(await repo.getTrashEntries()).toHaveLength(2);
  });

  it('purgeExpired drops only entries older than retention', async () => {
    await seed('g1');
    await seed('g2');
    const oldId = await trash.trashGroup('g1');
    const newId = await trash.trashGroup('g2');
    // Age the first entry by 40 days.
    const entries = await repo.getTrashEntries();
    const oldEntry = entries.find((e) => e.id === oldId)!;
    await chrome.storage.local.set({
      [`trash:${oldId}`]: { ...oldEntry, deletedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 },
    });

    const purged = await trash.purgeExpired();
    expect(purged).toBe(1);
    const remaining = await repo.getTrashEntries();
    expect(remaining.map((e) => e.id)).toEqual([newId]);
  });
});
