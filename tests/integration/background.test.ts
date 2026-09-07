import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import * as repo from '../../lib/storage/repo';

function startBackground(): void {
  expect(background.main).toBeTypeOf('function');
  background.main?.();
}

function managerTab(id: number): chrome.tabs.Tab {
  return {
    id,
    url: chrome.runtime.getURL('/manager.html'),
    title: 'Shelf',
    pinned: true,
    windowId: 1,
    index: 0,
    active: false,
    highlighted: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  } as chrome.tabs.Tab;
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  vi.spyOn(chrome.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
  vi.spyOn(chrome.commands.onCommand, 'addListener').mockImplementation(() => {});
  vi.spyOn(chrome.tabs.onAttached, 'addListener').mockImplementation(() => {});
  vi.spyOn(chrome.storage.local, 'setAccessLevel').mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('background listener registration', () => {
  it('restricts saved data to trusted extension contexts', () => {
    const setAccessLevel = vi.mocked(chrome.storage.local.setAccessLevel);

    startBackground();

    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('registers tabs.onUpdated without an unsupported event filter', () => {
    const addListener = vi.spyOn(chrome.tabs.onUpdated, 'addListener');

    startBackground();

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener.mock.calls[0]).toHaveLength(1);
  });

  it('ignores unrelated tab updates inside the listener', () => {
    const addListener = vi.spyOn(chrome.tabs.onUpdated, 'addListener');
    const update = vi.spyOn(chrome.tabs, 'update');

    startBackground();
    const listener = addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');

    listener?.(7, { status: 'complete' }, managerTab(7));

    expect(update).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('background import commands', () => {
  it('imports JSON with session order matching the parsed input', async () => {
    const addListener = vi.spyOn(chrome.runtime.onMessage, 'addListener');
    startBackground();
    const handler = addListener.mock.calls[0]![0];
    const groups = Array.from({ length: 5 }, (_, i) => ({
      name: `S ${i}`,
      tabs: [{ url: `https://s${i}.example/`, title: `S${i}` }],
    }));
    const result = await new Promise<{ imported: number }>((resolve) => {
      void handler({ cmd: 'importGroups', json: JSON.stringify({ format: 'shelf-export', schemaVersion: 4, groups }) }, {}, (r: { imported: number }) => resolve(r));
    });
    expect(result.imported).toBe(5);
    const all = await repo.getAllGroups();
    expect(all.map((g) => g.name)).toEqual(['S 0', 'S 1', 'S 2', 'S 3', 'S 4']);
  });

  it('imports OneTab text preserving input order and count', async () => {
    const addListener = vi.spyOn(chrome.runtime.onMessage, 'addListener');
    startBackground();
    const handler = addListener.mock.calls[0]![0];
    const text = Array.from({ length: 4 }, (_, i) => `https://t${i}.example/ | T${i}`).join('\n\n');
    const result = await new Promise<{ imported: number }>((resolve) => {
      void handler({ cmd: 'importOneTab', text }, {}, (r: { imported: number }) => resolve(r));
    });
    expect(result.imported).toBe(4);
    const all = await repo.getAllGroups();
    expect(all.map((g) => g.tabs[0]!.url)).toEqual([
      'https://t0.example/', 'https://t1.example/', 'https://t2.example/', 'https://t3.example/',
    ]);
  });
});
