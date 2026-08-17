import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { captureTabs, saveTabList } from '../../lib/services/capture';
import { DEFAULT_SETTINGS } from '../../lib/constants';
import { WriteVerifyError } from '../../lib/storage/repo';
import * as repo from '../../lib/storage/repo';

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
    groupId: -1,
    ...extra,
  } as chrome.tabs.Tab;
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('saveTabList (write-verify-close)', () => {
  it('saves tabs, indexes the group, closes originals, clears journal', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);
    const tabs = [fakeTab(1, 'https://a.com'), fakeTab(2, 'https://b.com', { pinned: true })];

    const result = await saveTabList(tabs, 'window', { closeOriginals: true });

    expect(result.saved).toBe(2);
    expect(result.closed).toBe(2);
    expect(result.failures).toBe(0);
    const groups = await repo.getAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(groups[0]!.tabs[1]!.pinned).toBe(true);
    expect(removeSpy).toHaveBeenCalled();
    // Journal must be clean after success.
    const all = await chrome.storage.local.get(null);
    expect(Object.keys(all).filter((k) => k.startsWith('op:'))).toHaveLength(0);
  });

  it('NEVER closes tabs when the storage write cannot be verified', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);
    // Simulate a corrupted write: set() succeeds but the shard never lands.
    const origSet = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      const filtered = Object.fromEntries(
        Object.entries(items).filter(([k]) => !k.startsWith('group:')),
      );
      if (Object.keys(filtered).length > 0) await origSet(filtered);
    });

    const tabs = [fakeTab(1, 'https://a.com')];
    await expect(saveTabList(tabs, 'window', { closeOriginals: true })).rejects.toThrow(WriteVerifyError);

    expect(removeSpy).not.toHaveBeenCalled(); // the invariant
    expect(await repo.getAllGroups()).toHaveLength(0);
  });

  it('keeps tabs open when closeOriginals is false', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);
    const result = await saveTabList([fakeTab(1, 'https://a.com')], 'window', { closeOriginals: false });
    expect(result.saved).toBe(1);
    expect(result.closed).toBe(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('counts per-tab close failures without losing the saved data', async () => {
    vi.spyOn(chrome.tabs, 'remove').mockRejectedValue(new Error('tab already closed'));
    const result = await saveTabList([fakeTab(1, 'https://a.com')], 'window', { closeOriginals: true });
    expect(result.saved).toBe(1);
    expect(result.failures).toBe(1);
    expect(await repo.getAllGroups()).toHaveLength(1);
  });

  it('preserves native tab-group metadata by index, not by id', async () => {
    vi.spyOn(chrome.tabGroups, 'get').mockResolvedValue({
      id: 77,
      title: 'Research',
      color: 'blue',
      collapsed: false,
      windowId: 1,
    } as chrome.tabGroups.TabGroup as never);

    const tabs = [fakeTab(1, 'https://a.com', { groupId: 77 }), fakeTab(2, 'https://b.com')];
    await saveTabList(tabs, 'window', { closeOriginals: false });

    const groups = await repo.getAllGroups();
    expect(groups[0]!.chromeGroups).toEqual([{ title: 'Research', color: 'blue', collapsed: false }]);
    expect(groups[0]!.tabs[0]!.chromeGroupIdx).toBe(0);
    expect(groups[0]!.tabs[1]!.chromeGroupIdx).toBeNull();
  });

  it("'tab-limit' scope labels the group 'Auto-saved'", async () => {
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);
    const result = await saveTabList([fakeTab(9, 'https://solo.com')], 'tab-limit', { closeOriginals: true });
    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Auto-saved ·')).toBe(true);
  });

  it("'tab' scope saves only the active tab, labeled 'Tab'", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(3, 'https://active.com', { active: true }),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('tab', { closeOriginals: true });

    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Tab ·')).toBe(true);
    expect(groups[0]!.tabs[0]!.url).toBe('https://active.com');
  });

  const sidesFixture = [
    fakeTab(0, 'https://pinned.com', { index: 0, pinned: true }),
    fakeTab(1, 'https://a.com', { index: 1 }),
    fakeTab(2, 'https://b.com', { index: 2 }),
    fakeTab(3, 'https://active.com', { index: 3, active: true }),
    fakeTab(4, 'https://c.com', { index: 4 }),
  ];

  it("'left' scope saves tabs left of active, skipping pinned and active", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue(sidesFixture as never);
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('left', { closeOriginals: true });

    expect(result.saved).toBe(2);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Left tabs ·')).toBe(true);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(removeSpy.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
  });

  it("'right' scope saves tabs right of active only", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue(sidesFixture as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('right', { closeOriginals: true });

    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Right tabs ·')).toBe(true);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://c.com']);
  });

  it("'right' scope with nothing to the right saves nothing and closes nothing", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com', { index: 0 }),
      fakeTab(2, 'https://active.com', { index: 1, active: true }),
    ] as never);
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    // Distinct windowId so the duplicate-click guard (keyed on scope+window)
    // can't mask the empty-result path after the previous 'right' test.
    const result = await captureTabs('right', { closeOriginals: true, windowId: 99 });

    expect(result.saved).toBe(0);
    expect(result.groupId).toBeNull();
    expect(await repo.getAllGroups()).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("'group' scope saves only the active tab's tab group", async () => {
    vi.spyOn(chrome.tabGroups, 'get').mockResolvedValue({
      id: 77,
      title: 'Work',
      color: 'blue',
      collapsed: false,
      windowId: 1,
    } as chrome.tabGroups.TabGroup as never);
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com', { groupId: 77 }),
      fakeTab(2, 'https://b.com', { groupId: 77, active: true }),
      fakeTab(3, 'https://c.com'),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('group', { closeOriginals: true });

    expect(result.saved).toBe(2);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Tab group ·')).toBe(true);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  it("'group' scope with an ungrouped active tab saves nothing", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com', { active: true }),
      fakeTab(2, 'https://b.com'),
    ] as never);
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('group', { closeOriginals: true, windowId: 88 });

    expect(result.saved).toBe(0);
    expect(result.groupId).toBeNull();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("'selected' scope saves the highlighted tabs", async () => {
    const querySpy = vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com', { highlighted: true }),
      fakeTab(2, 'https://b.com', { highlighted: true, active: true }),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('selected', { closeOriginals: true });

    expect(result.saved).toBe(2);
    expect(querySpy).toHaveBeenCalledWith({ currentWindow: true, highlighted: true });
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Selected tabs ·')).toBe(true);
  });

  it("'others' scope saves all but the active tab, dropping pinned by default", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://pin.com', { pinned: true }),
      fakeTab(2, 'https://active.com', { active: true }),
      fakeTab(3, 'https://c.com'),
      fakeTab(4, 'https://d.com'),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('others', { closeOriginals: true });

    expect(result.saved).toBe(2);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.name.startsWith('Other tabs ·')).toBe(true);
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://c.com', 'https://d.com']);
  });

  it("'window' scope excludes pinned tabs by default (savePinnedTabs off)", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com'),
      fakeTab(2, 'https://pin.com', { pinned: true }),
    ] as never);

    const result = await captureTabs('window', { closeOriginals: false, windowId: 55 });

    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com']);
  });

  it("'window' scope includes pinned tabs when savePinnedTabs is on", async () => {
    await repo.ensureReady();
    await repo.setSettings({ ...DEFAULT_SETTINGS, savePinnedTabs: true });
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com'),
      fakeTab(2, 'https://pin.com', { pinned: true }),
    ] as never);

    const result = await captureTabs('window', { closeOriginals: false, windowId: 56 });

    expect(result.saved).toBe(2);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://pin.com']);
  });

  it("'tab' scope saves a pinned active tab even with savePinnedTabs off (default)", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(3, 'https://pinned-active.com', { active: true, pinned: true }),
    ] as never);

    const result = await captureTabs('tab', { closeOriginals: false });

    expect(result.saved).toBe(1);
  });

  it('never saves blank pages: chrome://newtab and about:blank are skipped', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'chrome://newtab/'),
      fakeTab(2, 'about:blank'),
      fakeTab(4, 'chrome://new-tab-page/'), // modern NTP WebUI host
      fakeTab(5, 'about:blank#frag'),
      fakeTab(6, 'chrome-search://local-ntp/local-ntp.html'),
      fakeTab(3, 'https://real.com'),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('window', { closeOriginals: true, windowId: 61 });

    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://real.com']);
  });

  it('saves still-loading tabs via pendingUrl instead of dropping them', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, '', { pendingUrl: 'https://loading.com' } as Partial<chrome.tabs.Tab>),
      fakeTab(2, 'https://done.com'),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('window', { closeOriginals: true, windowId: 62 });

    expect(result.saved).toBe(2);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.tabs.map((t) => t.url).sort()).toEqual([
      'https://done.com',
      'https://loading.com',
    ]);
  });

  it('saveTabList (tab-limit/hub path) drops url-less candidates: never stored, never closed', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await saveTabList([fakeTab(1, '')], 'tab-limit', { closeOriginals: true });

    expect(result.saved).toBe(0);
    expect(result.groupId).toBeNull();
    expect(await repo.getAllGroups()).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('captureTabs saves the current window and skips extension pages', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://a.com'),
      fakeTab(2, chrome.runtime.getURL('/manager.html')),
    ] as never);
    vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await captureTabs('window', { closeOriginals: true, windowId: 1 });

    expect(result.saved).toBe(1);
    const groups = await repo.getAllGroups();
    expect(groups[0]!.tabs.map((t) => t.url)).toEqual(['https://a.com']);
  });

  it('saves tabs ungrouped when the native group vanished mid-capture', async () => {
    vi.spyOn(chrome.tabGroups, 'get').mockRejectedValue(new Error('No group with id'));
    const tabs = [fakeTab(1, 'https://a.com', { groupId: 77 })];
    await saveTabList(tabs, 'window', { closeOriginals: false });
    const groups = await repo.getAllGroups();
    expect(groups[0]!.chromeGroups).toEqual([]);
    expect(groups[0]!.tabs[0]!.chromeGroupIdx).toBeNull();
  });

  it("'all-windows' creates one session per source window", async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      fakeTab(1, 'https://one.example', { windowId: 10 }),
      fakeTab(2, 'https://two.example', { windowId: 20 }),
    ] as never);
    const result = await captureTabs('all-windows', { closeOriginals: false });
    expect(result.saved).toBe(2);
    expect(result.groupIds).toHaveLength(2);
    const groups = await repo.getAllGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.tabs.length)).toEqual([1, 1]);
  });

  it('appends to an existing session and skips duplicate URLs by default', async () => {
    const first = await saveTabList([fakeTab(1, 'https://same.example')], 'window', { closeOriginals: false });
    const second = await saveTabList(
      [fakeTab(2, 'https://SAME.example/'), fakeTab(3, 'https://new.example')],
      'window',
      { closeOriginals: false, destinationGroupId: first.groupId! },
    );
    expect(second.saved).toBe(1);
    expect(second.skippedDuplicates).toBe(1);
    expect((await repo.getGroup(first.groupId!))!.tabs.map((tab) => tab.url)).toEqual([
      'https://same.example', 'https://new.example',
    ]);
  });

  it('never stores or closes excluded domains, including the tab-limit path', async () => {
    await repo.ensureReady();
    await repo.setSettings({ ...DEFAULT_SETTINGS, excludedDomains: ['private.example'] });
    const removeSpy = vi.spyOn(chrome.tabs, 'remove').mockResolvedValue(undefined as never);
    const result = await saveTabList([
      fakeTab(1, 'https://private.example/inbox'),
      fakeTab(2, 'https://safe.example'),
    ], 'tab-limit', { closeOriginals: true });
    expect(result.saved).toBe(1);
    expect((await repo.getAllGroups())[0]!.tabs[0]!.url).toBe('https://safe.example');
    expect(removeSpy).toHaveBeenCalledWith(2);
    expect(removeSpy).not.toHaveBeenCalledWith(1);
  });
});
