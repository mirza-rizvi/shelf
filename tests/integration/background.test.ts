import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';

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
