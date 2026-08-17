import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { restoreGroup, restoreTab } from '../../lib/services/restore';
import type { SavedGroup, TabItem } from '../../lib/types';

function tabItem(id: string, url: string, extra: Partial<TabItem> = {}): TabItem {
  return { id, url, title: `Title ${id}`, pinned: false, savedAt: 1, chromeGroupIdx: null, ...extra };
}

function savedGroup(tabs: TabItem[], extra: Partial<SavedGroup> = {}): SavedGroup {
  return {
    id: 'g1',
    name: 'Group',
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs,
    ...extra,
  };
}

let nextTabId: number;
let createSpy: ReturnType<typeof vi.fn>;
let discardSpy: ReturnType<typeof vi.fn>;
let groupSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  nextTabId = 100;
  createSpy = vi.fn(async () => ({ id: nextTabId++ }) as chrome.tabs.Tab);
  discardSpy = vi.fn(async (id: number) => ({ id }) as chrome.tabs.Tab);
  groupSpy = vi.fn(async () => 555);
  chrome.tabs.create = createSpy as never;
  chrome.tabs.discard = discardSpy as never;
  chrome.tabs.group = groupSpy as never;
  chrome.tabGroups.update = vi.fn(async () => ({})) as never;
  // Commit-wait in discardAll polls tabs.get for a non-empty url.
  chrome.tabs.get = vi.fn(async (id: number) => ({
    id,
    url: 'https://committed.example',
  })) as never;
});

describe('lazy restore (discard-on-restore)', () => {
  it('discards every created tab; GROUPED tabs only after tab-group reconstruction', async () => {
    const group = savedGroup(
      [tabItem('a', 'https://a.com', { chromeGroupIdx: 0 }), tabItem('b', 'https://b.com')],
      { chromeGroups: [{ title: 'Research', color: 'blue', collapsed: false }] },
    );

    const result = await restoreGroup(group, { removeAfter: false });

    expect(result.restored).toBe(2);
    expect(discardSpy.mock.calls.map((c) => c[0]).sort()).toEqual([100, 101]);
    // discard can replace the tab (new id) — the grouped tab (id 100) must be
    // grouped BEFORE it is discarded. Ungrouped tabs may discard earlier.
    const groupedIdx = discardSpy.mock.calls.findIndex((c) => c[0] === 100);
    const groupedDiscardOrder = discardSpy.mock.invocationCallOrder[groupedIdx]!;
    expect(groupSpy.mock.invocationCallOrder[0]!).toBeLessThan(groupedDiscardOrder);
  });

  it('discards each chunk before creating the next (bounds the load spike)', async () => {
    const tabs = Array.from({ length: 12 }, (_, i) => tabItem(`t${i}`, `https://site${i}.com`));

    const result = await restoreGroup(savedGroup(tabs), { removeAfter: false });

    expect(result.restored).toBe(12);
    expect(discardSpy).toHaveBeenCalledTimes(12);
    // TABS_CREATE_CHUNK = 10: the first chunk's discards must land before the
    // 11th create — otherwise a 200-tab restore has 200 pages loading at once.
    const eleventhCreateOrder = createSpy.mock.invocationCallOrder[10]!;
    expect(Math.min(...discardSpy.mock.invocationCallOrder)).toBeLessThan(eleventhCreateOrder);
  });

  it('tolerates discard failures without affecting the restore result', async () => {
    discardSpy.mockRejectedValue(new Error('cannot discard'));
    const result = await restoreGroup(savedGroup([tabItem('a', 'https://a.com')]), {
      removeAfter: false,
    });
    expect(result.restored).toBe(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('tolerates a missing tabs.discard API', async () => {
    chrome.tabs.discard = undefined as never;
    const result = await restoreGroup(savedGroup([tabItem('a', 'https://a.com')]), {
      removeAfter: false,
    });
    expect(result.restored).toBe(1);
  });

  it('restoreTab loads eagerly — a clicked tab is never discarded', async () => {
    const result = await restoreTab(tabItem('a', 'https://a.com'));
    expect(result.restored).toBe(1);
    expect(discardSpy).not.toHaveBeenCalled();
  });

  it('skips the discard when the tab state cannot be read (commit unknown)', async () => {
    chrome.tabs.get = vi.fn(async () => {
      throw new Error('No tab with id');
    }) as never;
    const result = await restoreGroup(savedGroup([tabItem('a', 'https://a.com')]), {
      removeAfter: false,
    });
    expect(result.restored).toBe(1); // restore itself unaffected
    expect(discardSpy).not.toHaveBeenCalled(); // better loading than blank
  });
});

describe('restore targeting', () => {
  it('passes windowId through to every tabs.create call', async () => {
    const group = savedGroup([tabItem('a', 'https://a.com'), tabItem('b', 'https://b.com')]);
    await restoreGroup(group, { removeAfter: false, windowId: 42 });
    expect(createSpy).toHaveBeenCalledTimes(2);
    for (const call of createSpy.mock.calls) {
      expect(call[0]).toMatchObject({ windowId: 42, active: false });
    }
  });

  it('skips blocked schemes without creating tabs', async () => {
    const group = savedGroup([
      tabItem('a', 'javascript:alert(1)'),
      tabItem('b', 'https://ok.com'),
    ]);
    const result = await restoreGroup(group, { removeAfter: false });
    expect(result.restored).toBe(1);
    expect(result.skipped).toEqual([
      { url: 'javascript:alert(1)', title: 'Title a', reason: 'blocked-scheme' },
    ]);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
