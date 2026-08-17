import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  forgetTab,
  markStartup,
  noteBulkOperation,
  noteEnabled,
  noteTabCreated,
  runCheck,
} from '../../lib/services/tabLimit';
import * as repo from '../../lib/storage/repo';
import { DEFAULT_SETTINGS, STARTUP_GRACE_MS } from '../../lib/constants';

function fakeTab(id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id,
    url,
    title: `Title ${id}`,
    pinned: false,
    windowId: 1,
    index: id,
    active: false,
    highlighted: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    audible: false,
    groupId: -1,
    ...extra,
  } as chrome.tabs.Tab;
}

async function enableLimit(maxTabs: number) {
  await repo.setSettings({ ...DEFAULT_SETTINGS, tabLimit: { enabled: true, maxTabs } });
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  // Module-scope cache outlives fakeBrowser.reset(); a fresh service worker
  // starts with no knowledge of the setting, so start each test that way too.
  noteEnabled(null);
});

describe('tab limit first-seen bookkeeping', () => {
  it('writes nothing when the limit is disabled', async () => {
    await repo.setSettings(DEFAULT_SETTINGS); // enabled: false

    await noteTabCreated(7);
    await forgetTab(7);

    expect(await chrome.storage.session.get('tabFirstSeen')).toEqual({});
  });

  it('skips storage entirely once it knows the limit is off', async () => {
    noteEnabled(false);
    const getSpy = vi.spyOn(chrome.storage.session, 'get');

    await noteTabCreated(7);
    await forgetTab(7);

    expect(getSpy).not.toHaveBeenCalled();
  });

  it('records and clears first-seen times when the limit is enabled', async () => {
    await enableLimit(3);

    await noteTabCreated(7);
    await noteTabCreated(8);
    const seen = (await chrome.storage.session.get('tabFirstSeen')).tabFirstSeen as Record<
      string,
      number
    >;
    expect(Object.keys(seen).sort()).toEqual(['7', '8']);

    await forgetTab(7);
    const after = (await chrome.storage.session.get('tabFirstSeen')).tabFirstSeen as Record<
      string,
      number
    >;
    expect(Object.keys(after)).toEqual(['8']);
  });
});

describe('tab limit runCheck', () => {
  it('auto-saves exactly the excess oldest tabs and closes them', async () => {
    await enableLimit(3);
    // Deterministic first-seen order: tab 1 oldest … tab 5 newest.
    await chrome.storage.session.set({
      tabFirstSeen: { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 },
    });

    vi.spyOn(chrome.tabs, 'query').mockResolvedValue(
      [1, 2, 3, 4, 5].map((id) => fakeTab(id, `https://site${id}.com`)) as never,
    );
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    await runCheck();

    const groups = await repo.getAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name.startsWith('Auto-saved ·')).toBe(true);
    expect(groups[0]!.tabs.map((t) => t.url).sort()).toEqual([
      'https://site1.com',
      'https://site2.com',
    ]);
    expect(removeSpy).toHaveBeenCalledTimes(2); // one call per evicted tab
    expect(removeSpy.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
  });

  it('protects active, pinned, and audible tabs', async () => {
    await enableLimit(1);
    await chrome.storage.session.set({ tabFirstSeen: { 1: 100, 2: 200, 3: 300, 4: 400 } });
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://active.com', { active: true }),
      fakeTab(2, 'https://pinned.com', { pinned: true }),
      fakeTab(3, 'https://audible.com', { audible: true }),
      fakeTab(4, 'https://evict.com'),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    await runCheck();

    const groups = await repo.getAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://evict.com']);
  });

  it('ignores discarded (unloaded) tabs — restoring a big shelf never triggers eviction', async () => {
    await enableLimit(3);
    await chrome.storage.session.set({
      tabFirstSeen: { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 },
    });
    // 3 loaded tabs (at the limit) + 3 discarded lazy-restored tabs (over it).
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com'),
      fakeTab(2, 'https://b.com'),
      fakeTab(3, 'https://c.com'),
      fakeTab(4, 'https://restored1.com', { discarded: true }),
      fakeTab(5, 'https://restored2.com', { discarded: true }),
      fakeTab(6, 'https://restored3.com', { discarded: true }),
    ] as never);
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    await runCheck();

    expect(await repo.getAllGroups()).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('ignores blank and New Tab pages — they neither count nor get evicted', async () => {
    await enableLimit(2);
    await chrome.storage.session.set({
      tabFirstSeen: { 1: 100, 2: 200, 3: 300, 4: 400 },
    });
    // 2 real tabs (at the limit) + 2 junk tabs (would be "over" if counted).
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com'),
      fakeTab(2, 'https://b.com'),
      fakeTab(3, 'chrome://newtab/'),
      fakeTab(4, ''),
    ] as never);
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    await runCheck();

    expect(await repo.getAllGroups()).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('ignores a stale latch left by a service worker killed mid-check', async () => {
    await enableLimit(3);
    await chrome.storage.session.set({
      limitCheckRunning: Date.now() - 120_000, // stale (> 60 s)
      tabFirstSeen: { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 },
    });
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue(
      [1, 2, 3, 4, 5].map((id) => fakeTab(id, `https://site${id}.com`)) as never,
    );
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    await runCheck();

    expect(await repo.getAllGroups()).toHaveLength(1); // check ran despite the latch
  });

  it('is a no-op when the limit is disabled', async () => {
    await repo.setSettings(DEFAULT_SETTINGS); // enabled: false
    const querySpy = vi.spyOn(chrome.tabs, 'query');
    await runCheck();
    expect(querySpy).not.toHaveBeenCalled();
    expect(await repo.getAllGroups()).toHaveLength(0);
  });

  it('is a no-op inside the startup grace period', async () => {
    await enableLimit(1);
    await markStartup(); // startupAt = now → within STARTUP_GRACE_MS
    expect(STARTUP_GRACE_MS).toBeGreaterThan(0);
    const querySpy = vi.spyOn(chrome.tabs, 'query');
    await runCheck();
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('is a no-op right after a bulk operation (restore grace)', async () => {
    await enableLimit(1);
    await noteBulkOperation(); // restore just ran — don't evict the user's tabs
    const querySpy = vi.spyOn(chrome.tabs, 'query');
    await runCheck();
    expect(querySpy).not.toHaveBeenCalled();
  });
});
