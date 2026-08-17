import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SavedGroup } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/constants';
import * as repo from '../lib/storage/repo';
import * as journal from '../lib/services/journal';
import { useStorageData } from './useStorageData';

function makeGroup(id: string, urls: string[]): SavedGroup {
  return {
    id,
    name: `Shelf ${id}`,
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: urls.map((url, i) => ({
      id: `${id}-t${i}`,
      url,
      title: `Title ${i}`,
      pinned: false,
      savedAt: 1,
      chromeGroupIdx: null,
    })),
  };
}

async function seed(...groups: SavedGroup[]) {
  for (const g of groups) {
    await repo.putGroup(g);
    await repo.addGroupToIndex(g.id, 'end');
  }
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

afterEach(cleanup);

describe('useStorageData', () => {
  it('loads groups, settings and trash on mount', async () => {
    await seed(makeGroup('a', ['https://a.com/']), makeGroup('b', ['https://b.com/']));

    const { result } = renderHook(() => useStorageData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(result.current.settings.tabLimit.enabled).toBe(DEFAULT_SETTINGS.tabLimit.enabled);
  });

  it('ignores journal writes entirely', async () => {
    await seed(makeGroup('a', ['https://a.com/']));
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const spy = vi.spyOn(repo, 'getAllGroups');
    // Exactly what a capture writes and clears around the destructive step.
    await journal.put({
      opId: 'op1',
      type: 'save-close',
      groupId: 'a',
      tabIds: [1],
      phase: 'writing',
      startedAt: 1,
    });
    await journal.remove('op1');

    await new Promise((r) => setTimeout(r, 250));
    expect(spy).not.toHaveBeenCalled();
  });

  it('patches one shard without re-reading the others', async () => {
    const a = makeGroup('a', ['https://a.com/']);
    await seed(a, makeGroup('b', ['https://b.com/']));
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const groupsSpy = vi.spyOn(repo, 'getGroups');
    const allSpy = vi.spyOn(repo, 'getAllGroups');
    const untouched = result.current.groups[1]!;

    await repo.putGroup({ ...a, name: 'Renamed' });

    await waitFor(() => expect(result.current.groups[0]!.name).toBe('Renamed'));
    // Untouched group keeps its identity — this is what makes memo() work.
    expect(result.current.groups[1]).toBe(untouched);
    expect(allSpy).not.toHaveBeenCalled();
    expect(groupsSpy).not.toHaveBeenCalled();
  });

  it('applies deletions and reorders from the index', async () => {
    await seed(
      makeGroup('a', ['https://a.com/']),
      makeGroup('b', ['https://b.com/']),
      makeGroup('c', ['https://c.com/']),
    );
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await repo.deleteGroup('b');

    await waitFor(() => expect(result.current.groups.map((g) => g.id)).toEqual(['a', 'c']));
  });

  it('picks up a newly added group in index order', async () => {
    await seed(makeGroup('a', ['https://a.com/']));
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await repo.putGroupVerified(makeGroup('z', ['https://z.com/']));
    await repo.addGroupToIndex('z', 'start');

    await waitFor(() => expect(result.current.groups.map((g) => g.id)).toEqual(['z', 'a']));
  });

  it('reflects settings and trash changes', async () => {
    await seed(makeGroup('a', ['https://a.com/']));
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await repo.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await waitFor(() => expect(result.current.settings.theme).toBe('dark'));

    await repo.putTrashEntry({
      id: 'x',
      deletedAt: 1,
      kind: 'group',
      group: makeGroup('gone', ['https://gone.com/']),
    });
    await waitFor(() => expect(result.current.trash.map((t) => t.id)).toEqual(['x']));
  });

  it('falls back to a full refresh for unrecognized keys', async () => {
    await seed(makeGroup('a', ['https://a.com/']));
    const { result } = renderHook(() => useStorageData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const allSpy = vi.spyOn(repo, 'getAllGroups');
    await chrome.storage.local.set({ somethingNew: 1 });

    await waitFor(() => expect(allSpy).toHaveBeenCalled());
  });
});
