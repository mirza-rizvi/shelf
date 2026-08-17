import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SavedGroup } from '../../lib/types';
import * as repo from '../../lib/storage/repo';
import { groupKey, KEY_INDEX } from '../../lib/storage/keys';

function makeGroup(id: string, urls: string[]): SavedGroup {
  return {
    id,
    name: `Group ${id}`,
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: urls.map((url, i) => ({
      id: `${id}-t${i}`,
      url,
      title: url,
      pinned: false,
      savedAt: 1,
      chromeGroupIdx: null,
    })),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('repo sharding', () => {
  it('putGroupVerified stores and reads back a shard', async () => {
    const g = makeGroup('g1', ['https://a.com', 'https://b.com']);
    await repo.putGroupVerified(g);
    expect(await repo.getGroup('g1')).toEqual(g);
  });

  it('addGroupToIndex prepends and getAllGroups returns display order', async () => {
    const g1 = makeGroup('g1', ['https://a.com']);
    const g2 = makeGroup('g2', ['https://b.com']);
    await repo.putGroupVerified(g1);
    await repo.addGroupToIndex('g1');
    await repo.putGroupVerified(g2);
    await repo.addGroupToIndex('g2');
    const all = await repo.getAllGroups();
    expect(all.map((g) => g.id)).toEqual(['g2', 'g1']);
  });

  it('getAllGroups filters dangling index entries WITHOUT writing (read-only)', async () => {
    const g1 = makeGroup('g1', ['https://a.com']);
    await repo.putGroupVerified(g1);
    await chrome.storage.local.set({
      [KEY_INDEX]: { groupOrder: ['ghost', 'g1'], updatedAt: 1 },
    });
    const all = await repo.getAllGroups();
    expect(all.map((g) => g.id)).toEqual(['g1']);
    // Runs in UI contexts too — must never write back a possibly-stale index.
    const index = await repo.getIndex();
    expect(index.groupOrder).toEqual(['ghost', 'g1']);
  });

  it('pruneIndex drops dangling ids (GC path)', async () => {
    await repo.putGroupVerified(makeGroup('g1', ['https://a.com']));
    await chrome.storage.local.set({
      [KEY_INDEX]: { groupOrder: ['ghost', 'g1'], updatedAt: 1 },
    });
    await repo.pruneIndex();
    expect((await repo.getIndex()).groupOrder).toEqual(['g1']);
  });

  it('concurrent index additions never lose a group (serialized writes)', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
    await Promise.all(ids.map((id) => repo.putGroupVerified(makeGroup(id, ['https://x.com']))));
    // Fire all index additions at once — the read-modify-write cycles must
    // serialize or losers vanish (and would later be GC'd permanently).
    await Promise.all(ids.map((id) => repo.addGroupToIndex(id)));
    const index = await repo.getIndex();
    expect([...index.groupOrder].sort()).toEqual(ids);
  });

  it('deleteGroup removes from index first, then the shard', async () => {
    const g1 = makeGroup('g1', ['https://a.com']);
    await repo.putGroupVerified(g1);
    await repo.addGroupToIndex('g1');
    await repo.deleteGroup('g1');
    expect((await repo.getIndex()).groupOrder).toEqual([]);
    expect(await repo.getGroup('g1')).toBeNull();
  });

  it('collectOrphanGroupKeys finds unindexed shards', async () => {
    await repo.putGroupVerified(makeGroup('indexed', ['https://a.com']));
    await repo.addGroupToIndex('indexed');
    await repo.putGroupVerified(makeGroup('orphan', ['https://b.com']));
    const orphans = await repo.collectOrphanGroupKeys();
    expect(orphans).toEqual([groupKey('orphan')]);
  });

  describe('getAllKeys', () => {
    it('uses storage.local.getKeys when available', async () => {
      const getKeys = vi.fn<() => Promise<string[]>>().mockResolvedValue(['meta', 'group:x']);
      const getSpy = vi.spyOn(chrome.storage.local, 'get');
      Object.assign(chrome.storage.local, { getKeys });

      expect(await repo.getAllKeys()).toEqual(['meta', 'group:x']);
      // The whole point: never deserialize the store to list its keys.
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('falls back to get(null) when getKeys is missing or throws', async () => {
      await repo.putGroupVerified(makeGroup('a', ['https://a.com']));
      Object.assign(chrome.storage.local, {
        getKeys: () => Promise.reject(new Error('not implemented')),
      });

      expect(await repo.getAllKeys()).toContain(groupKey('a'));
    });
  });

  it('settings merge fills missing nested fields with defaults', async () => {
    await chrome.storage.local.set({ settings: { theme: 'dark', tabLimit: { enabled: true } } });
    const s = await repo.getSettings();
    expect(s.theme).toBe('dark');
    expect(s.tabLimit.enabled).toBe(true);
    expect(s.tabLimit.maxTabs).toBe(25); // default filled in
    expect(s.restoreRemovesFromList).toBe(false);
  });
});
