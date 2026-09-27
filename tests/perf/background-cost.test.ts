import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { DEFAULT_SETTINGS } from '../../lib/constants';
import { KEY_META, KEY_SETTINGS } from '../../lib/storage/keys';
import { CURRENT_SCHEMA_VERSION } from '../../lib/types';

// Guardrails: every chrome.* listener wakes the service worker, and every
// alarm is a recurring wakeup. Adding either must be a deliberate change to
// these allowlists, not a side effect.
const ALLOWED_LISTENERS = [
  'alarms.onAlarm',
  'commands.onCommand',
  'contextMenus.onClicked',
  'runtime.onInstalled',
  'runtime.onMessage',
  'runtime.onStartup',
  'tabs.onAttached',
  'tabs.onCreated',
  'tabs.onRemoved',
  'tabs.onUpdated',
  'windows.onCreated',
].sort();

const ALLOWED_ALARMS = ['limit-sweep', 'orphan-gc', 'trash-purge'];
const MIN_ALARM_PERIOD_MINUTES = 5;

const NAMESPACES = [
  'alarms', 'bookmarks', 'commands', 'contextMenus', 'downloads', 'history', 'idle',
  'management', 'notifications', 'permissions', 'runtime', 'storage', 'tabGroups', 'tabs',
  'webNavigation', 'webRequest', 'windows',
] as const;

type Listener = (...args: never[]) => unknown;
const captured = new Map<string, Listener[]>();

function spyAllEvents(): void {
  captured.clear();
  const api = chrome as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const ns of NAMESPACES) {
    const target = api[ns];
    if (!target) continue;
    for (const [name, value] of Object.entries(target)) {
      const event = value as { addListener?: (fn: Listener) => void } | undefined;
      if (!name.startsWith('on') || typeof event?.addListener !== 'function') continue;
      const key = `${ns}.${name}`;
      vi.spyOn(event as { addListener: (fn: Listener) => void }, 'addListener').mockImplementation((fn: Listener) => {
        captured.set(key, [...(captured.get(key) ?? []), fn]);
      });
    }
  }
}

function fire(key: string, ...args: unknown[]): void {
  for (const fn of captured.get(key) ?? []) (fn as (...a: unknown[]) => unknown)(...args);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  vi.spyOn(chrome.storage.local, 'setAccessLevel').mockResolvedValue();
  spyAllEvents();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('service-worker wakeup budget', () => {
  it('registers only allowlisted chrome event listeners', () => {
    background.main?.();
    expect([...captured.keys()].sort()).toEqual(ALLOWED_LISTENERS);
  });

  it('does not scan every tab when an ordinary tab closes', async () => {
    const query = vi.spyOn(chrome.tabs, 'query');
    background.main?.();
    // Let the worker learn the anchor id first, as it does at startup.
    fire('tabs.onUpdated', 1, { pinned: true }, {
      id: 1, url: chrome.runtime.getURL('/manager.html'), pinned: true, windowId: 1,
    });
    await vi.runAllTimersAsync();
    query.mockClear();

    fire('tabs.onRemoved', 42, { windowId: 1, isWindowClosing: false });
    await vi.advanceTimersByTimeAsync(1000);

    expect(query).not.toHaveBeenCalled();
  });

  it('still repairs the anchor when the Shelf tab itself closes', async () => {
    const query = vi.spyOn(chrome.tabs, 'query');
    background.main?.();
    fire('tabs.onUpdated', 1, { pinned: true }, {
      id: 1, url: chrome.runtime.getURL('/manager.html'), pinned: true, windowId: 1,
    });
    await vi.runAllTimersAsync();
    query.mockClear();

    fire('tabs.onRemoved', 1, { windowId: 1, isWindowClosing: false });
    await vi.advanceTimersByTimeAsync(1000);

    expect(query).toHaveBeenCalled();
  });

  it('keeps every alarm allowlisted and no more frequent than every 5 minutes', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 1 },
      [KEY_SETTINGS]: { ...DEFAULT_SETTINGS, tabLimit: { enabled: true, maxTabs: 25 } },
    });
    const create = vi.spyOn(chrome.alarms, 'create');
    background.main?.();
    fire('runtime.onInstalled', { reason: 'install' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(create).toHaveBeenCalled();
    for (const [name, info] of create.mock.calls as unknown as [string, chrome.alarms.AlarmCreateInfo][]) {
      expect(ALLOWED_ALARMS).toContain(name);
      expect(info.periodInMinutes ?? Infinity).toBeGreaterThanOrEqual(MIN_ALARM_PERIOD_MINUTES);
    }
  });

  it('does not re-create alarms that already exist with the same period', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 1 },
      [KEY_SETTINGS]: DEFAULT_SETTINGS,
    });
    const create = vi.spyOn(chrome.alarms, 'create');
    background.main?.();
    fire('runtime.onInstalled', { reason: 'install' });
    await vi.advanceTimersByTimeAsync(1000);
    const firstRun = create.mock.calls.length;
    expect(firstRun).toBeGreaterThan(0);

    fire('runtime.onStartup');
    await vi.advanceTimersByTimeAsync(1000);
    expect(create.mock.calls.length).toBe(firstRun);
  });
});
