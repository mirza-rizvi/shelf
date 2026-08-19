import { defineBackground } from 'wxt/utils/define-background';
import {
  ALARM_LIMIT_SWEEP,
  ALARM_ORPHAN_GC,
  ALARM_TRASH_PURGE,
  LIMIT_SWEEP_MINUTES,
} from '../lib/constants';
import type { Command, CommandResult } from '../lib/messaging';
import { parseJsonImport } from '../lib/importExport/importJson';
import { parseOneTabExport } from '../lib/importExport/importOneTab';
import * as repo from '../lib/storage/repo';
import * as journal from '../lib/services/journal';
import * as trash from '../lib/services/trash';
import * as tabLimit from '../lib/services/tabLimit';
import { captureTabs } from '../lib/services/capture';
import { restoreGroup, restoreTab } from '../lib/services/restore';
import * as organization from '../lib/services/organization';

/**
 * Shelf background service worker.
 *
 * MV3 rules honored here:
 *  - every chrome.* listener registered synchronously at top level;
 *  - no module-scope state that matters (ephemeral coordination state lives
 *    in chrome.storage.session; durable state in chrome.storage.local);
 *  - all mutating operations run HERE so a closing popup can't abort them.
 */
export default defineBackground(() => {
  const MENU_SCOPES = [
    ['shelf-save-tab', 'Save this tab', 'tab'],
    ['shelf-save-selected', 'Save highlighted tabs', 'selected'],
    ['shelf-save-group', 'Save this tab group', 'group'],
    ['shelf-save-window', 'Save this window', 'window'],
  ] as const;

  /** Event listeners cannot return promises to Chrome. Always terminate async
   * work here so a transient tab/storage race does not become an unhandled
   * service-worker rejection in chrome://extensions. */
  function runInBackground(task: Promise<unknown>): void {
    void task.catch(() => {});
  }

  // chrome.storage.local is exposed to content scripts by default. Shelf has
  // no content scripts, but lock the store to extension pages + this service
  // worker so a future content script cannot inherit access to saved URLs.
  runInBackground(
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  );

  function installContextMenus(): Promise<void> {
    return chrome.contextMenus.removeAll().then(() => {
      for (const [id, title] of MENU_SCOPES) chrome.contextMenus.create({ id, title, contexts: ['action', 'page'] });
    });
  }

  chrome.contextMenus.onClicked.addListener((info) => {
    const match = MENU_SCOPES.find(([id]) => id === info.menuItemId);
    if (match) runInBackground(handleCommand({ cmd: 'capture', scope: match[2] }));
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-manager') {
      runInBackground(
        ensurePinnedManager().then((id) => id === null ? undefined : chrome.tabs.update(id, { active: true })),
      );
    } else if (command === 'save-window') {
      runInBackground(handleCommand({ cmd: 'capture', scope: 'window' }));
    } else if (command === 'save-selected') {
      runInBackground(handleCommand({ cmd: 'capture', scope: 'selected' }));
    }
  });

  // ---- lifecycle ----------------------------------------------------------

  chrome.runtime.onInstalled.addListener(() => {
    void (async () => {
      await repo.ensureReady(); // seeds fresh installs, runs migrations on update
      await journal.recover();
      await ensureAlarms();
      await ensurePinnedManager();
      await installContextMenus();
    })().catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      // Grace stamp FIRST — migrations/recovery on a large store can take
      // seconds, and the session-restore tab storm must not beat the stamp.
      await tabLimit.markStartup();
      await repo.ensureReady();
      await journal.recover();
      await ensureAlarms();
      await ensurePinnedManager();
    })().catch(() => {});
  });

  async function ensureAlarms(): Promise<void> {
    const settings = await repo.getSettings();
    // Runs on install, on startup and after every saveSettings — the one place
    // that always has fresh settings, so the tab-limit gate rides along.
    tabLimit.noteEnabled(settings.tabLimit.enabled);
    await chrome.alarms.create(ALARM_TRASH_PURGE, { periodInMinutes: 24 * 60 });
    await chrome.alarms.create(ALARM_ORPHAN_GC, { periodInMinutes: 7 * 24 * 60 });
    if (settings.tabLimit.enabled) {
      await chrome.alarms.create(ALARM_LIMIT_SWEEP, { periodInMinutes: LIMIT_SWEEP_MINUTES });
    } else {
      await chrome.alarms.clear(ALARM_LIMIT_SWEEP);
    }
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    void (async () => {
      await repo.ensureReady();
      switch (alarm.name) {
        case ALARM_TRASH_PURGE:
          await trash.purgeExpired();
          break;
        case ALARM_LIMIT_SWEEP:
          await tabLimit.runCheck();
          break;
        case ALARM_ORPHAN_GC: {
          await repo.pruneIndex(); // drop dangling index ids (read path no longer prunes)
          const orphans = await repo.collectOrphanGroupKeys();
          await repo.removeKeys(orphans);
          break;
        }
      }
    })().catch(() => {});
  });

  // ---- tab-limit watcher --------------------------------------------------

  chrome.tabs.onCreated.addListener((tab) => {
    tabLimit.noteTabCreated(tab.id).catch(() => {});
    tabLimit.scheduleCheck();
  });
  chrome.tabs.onAttached.addListener(() => {
    tabLimit.scheduleCheck();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabLimit.forgetTab(tabId).catch(() => {});
  });

  /** A just-created tab reports url: "" until navigation commits (the target
   * sits in pendingUrl), so both fields must be checked or existence checks
   * race tab creation and spawn duplicates. */
  const isManagerTab = (t: chrome.tabs.Tab): boolean =>
    ((t.url || t.pendingUrl) ?? '').startsWith(chrome.runtime.getURL('/manager.html'));

  // Anchor maintenance, one debounced entry point. Fired when a manager tab
  // disappears (close / window close — no API can veto a close, so resurrect)
  // AND when one appears (Ctrl+Shift+T "reopen closed tab", session restore) —
  // the latter is how DUPLICATES sneak in. ensurePinnedManager() handles every
  // case: zero → create, one → re-pin, many → keep the pinned one, close the
  // rest. Debounced because window saves close tabs in bursts.
  let ensureTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleEnsureManager(): void {
    clearTimeout(ensureTimer);
    ensureTimer = setTimeout(() => {
      runInBackground(ensurePinnedManager());
    }, 300);
  }

  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    // A window on its way out (user closed the window, or Shelf was its last
    // tab) must be allowed to die — resurrecting would pin the window open
    // forever. The tab returns with the next window / startup / commit event.
    if (removeInfo.isWindowClosing) return;
    scheduleEnsureManager();
  });

  chrome.windows.onCreated.addListener(() => {
    scheduleEnsureManager();
  });

  // Chrome's tabs.onUpdated event does not accept an event-filter argument.
  // Keep this synchronous guard first so unrelated status/title/favicon/audio
  // updates return before doing manager-tab work.
  const onTabUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ): void => {
    if (changeInfo.url === undefined && changeInfo.pinned === undefined) return;
    if (!isManagerTab(tab)) {
      // The anchor was navigated AWAY in place (user typed a URL into it):
      // no onRemoved ever fires, so this is the only signal. Recreate the
      // anchor; the user's navigated tab is left alone.
      if (tabId === lastManagerTabId && changeInfo.url !== undefined) {
        lastManagerTabId = null;
        scheduleEnsureManager();
      }
      return;
    }
    lastManagerTabId = tabId;
    // Enforce the pin the instant it's removed. Strict `=== false` guard —
    // our own `pinned: true` update can never loop.
    if (changeInfo.pinned === false) {
      void chrome.tabs.update(tabId, { pinned: true }).catch(() => {});
    }
    // A manager tab just committed navigation — possibly a duplicate; dedupe.
    if (changeInfo.url !== undefined) {
      scheduleEnsureManager();
    }
  };

  chrome.tabs.onUpdated.addListener(onTabUpdated);

  /** OneTab-style anchor tab: a pinned manager tab always exists at the far
   * left while the browser runs. Re-pins if the user unpinned it; never
   * steals focus on its own. Returns the tab id, or null if tab creation
   * raced window startup (the next open retries). Single-flight so
   * concurrent callers (startup + open + resurrect) can't double-create. */
  let ensureInFlight: Promise<number | null> | null = null;
  let rerunEnsure = false;
  /** Track the anchor's id so in-place navigation away can be detected. */
  let lastManagerTabId: number | null = null;

  function ensurePinnedManager(): Promise<number | null> {
    if (ensureInFlight) {
      // The in-flight run queried tab state BEFORE this call's trigger —
      // ask it to loop once more so the newest state is re-checked.
      rerunEnsure = true;
      return ensureInFlight;
    }
    ensureInFlight = (async () => {
      let id: number | null = null;
      do {
        rerunEnsure = false;
        id = await doEnsurePinnedManager();
      } while (rerunEnsure);
      return id;
    })().finally(() => {
      ensureInFlight = null;
    });
    return ensureInFlight;
  }

  async function doEnsurePinnedManager(): Promise<number | null> {
    try {
      const managers = (await chrome.tabs.query({})).filter(isManagerTab);
      // Keep the pinned instance. Only PINNED extras are duplicates
      // (Ctrl+Shift+T reopen, session restore racing our startup create) —
      // an unpinned manager tab is one the user opened on purpose; leave it.
      const keeper = managers.find((t) => t.pinned) ?? managers[0];
      for (const extra of managers) {
        if (extra !== keeper && extra.pinned && extra.id !== undefined) {
          await chrome.tabs.remove(extra.id).catch(() => {});
        }
      }
      if (keeper?.id !== undefined) {
        if (!keeper.pinned) await chrome.tabs.update(keeper.id, { pinned: true });
        lastManagerTabId = keeper.id;
        return keeper.id;
      }
      // No manager tab exists. If no windows exist either, the browser is on
      // its way out (macOS stays alive windowless) — creating would force a
      // new window open, forever. onStartup restores the tab next launch.
      const windows = await chrome.windows.getAll({});
      if (windows.length === 0) return null;
      const created = await chrome.tabs.create({
        url: chrome.runtime.getURL('/manager.html'),
        pinned: true,
        index: 0,
        active: false,
      });
      lastManagerTabId = created.id ?? null;
      return created.id ?? null;
    } catch {
      return null;
    }
  }

  /** "Restore in new window" setting: open the target window up front so
   * restored tabs land there. Returns null when the setting is off or the
   * window can't be created (restore falls back to the current window). */
  async function createRestoreWindow(): Promise<{ windowId: number; seedTabId?: number } | null> {
    const settings = await repo.getSettings();
    if (!settings.restoreInNewWindow) return null;
    try {
      const win = await chrome.windows.create({ focused: true });
      if (win?.id === undefined) return null;
      return { windowId: win.id, seedTabId: win.tabs?.[0]?.id };
    } catch {
      return null;
    }
  }

  /** Drop the blank seed tab once real tabs exist; close the window again if
   * nothing was restored (e.g. every URL had a blocked scheme). */
  async function finishRestoreWindow(
    target: { windowId: number; seedTabId?: number } | null,
    restored: number,
  ): Promise<void> {
    if (!target) return;
    if (restored === 0) {
      await chrome.windows.remove(target.windowId).catch(() => {});
      // If the anchor had just been recreated inside that window (its
      // windows.onCreated fired our ensure), it died with it — re-check.
      scheduleEnsureManager();
    } else if (target.seedTabId !== undefined) {
      await chrome.tabs.remove(target.seedTabId).catch(() => {});
    }
  }

  /** Serialize settings read-merge-write cycles (see 'saveSettings'). */
  let settingsQueue: Promise<unknown> = Promise.resolve();
  function enqueueSettingsWrite(fn: () => Promise<void>): Promise<void> {
    const next = settingsQueue.then(fn, fn);
    settingsQueue = next.catch(() => {});
    return next;
  }

  // ---- command router -----------------------------------------------------

  chrome.runtime.onMessage.addListener(
    (message: Command, _sender, sendResponse: (r: CommandResult) => void) => {
      void handleCommand(message)
        .then(sendResponse)
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true; // async response
    },
  );

  async function handleCommand(message: Command): Promise<CommandResult> {
    await repo.ensureReady();
    switch (message.cmd) {
      case 'capture': {
        const settings = await repo.getSettings();
        const capture = await captureTabs(message.scope, {
          closeOriginals: message.closeOriginals ?? settings.captureClosesTabs,
          destinationGroupId: message.destinationGroupId,
          allowDuplicates: message.allowDuplicates,
        });
        return { ok: true, capture };
      }
      case 'restoreTab': {
        const settings = await repo.getSettings();
        const group = await repo.getGroup(message.groupId);
        const tab = group?.tabs.find((t) => t.id === message.tabId);
        if (!group || !tab) return { ok: false, error: 'Tab not found' };
        const restore = await restoreTab(tab);
        if (settings.restoreRemovesFromList && restore.restored > 0) {
          const trashEntryId = await trash.trashTab(message.groupId, message.tabId);
          return { ok: true, restore, trashEntryId };
        }
        return { ok: true, restore };
      }
      case 'restoreGroup': {
        const group = await repo.getGroup(message.groupId);
        if (!group) return { ok: false, error: 'Group not found' };
        // Grace before AND after: the burst of restored tabs must not push
        // the tab limit into evicting the user's OLDEST (pre-existing) tabs.
        await tabLimit.noteBulkOperation();
        const target = await createRestoreWindow();
        const restore = await restoreGroup(group, {
          removeAfter: message.removeAfter,
          windowId: target?.windowId,
        });
        await finishRestoreWindow(target, restore.restored);
        await tabLimit.noteBulkOperation();
        return { ok: true, restore };
      }
      case 'trashGroup': {
        const trashEntryId = await trash.trashGroup(message.groupId);
        return { ok: true, trashEntryId };
      }
      case 'trashTab': {
        const trashEntryId = await trash.trashTab(message.groupId, message.tabId);
        return { ok: true, trashEntryId };
      }
      case 'trashAll': {
        const trashed = await trash.trashAll();
        return { ok: true, trashed };
      }
      case 'emptyTrash': {
        const purged = await trash.purgeAll();
        return { ok: true, purged };
      }
      case 'undoTrash': {
        const okRestore = await trash.restoreFromTrash(message.entryId);
        return okRestore ? { ok: true } : { ok: false, error: 'Trash entry not found' };
      }
      case 'purgeTrash': {
        await trash.purgeTrashEntry(message.entryId);
        return { ok: true };
      }
      case 'removeDuplicates': {
        const removed = await organization.removeDuplicates(message.keep);
        return { ok: true, removed };
      }
      case 'saveSettings': {
        // Partial patch merged onto current state, SERIALIZED through a queue:
        // onMessage dispatches concurrently, so two in-flight patches would
        // otherwise interleave their read-merge-write and drop one.
        await enqueueSettingsWrite(async () => {
          const current = await repo.getSettings();
          await repo.setSettings({
            ...current,
            ...message.settings,
            tabLimit: { ...current.tabLimit, ...message.settings.tabLimit },
          });
        });
        await ensureAlarms(); // the limit sweep follows the enabled toggle
        return { ok: true };
      }
      case 'markExported': {
        await enqueueSettingsWrite(async () => {
          const current = await repo.getSettings();
          await repo.setSettings({ ...current, lastExportAt: Date.now() });
        });
        return { ok: true };
      }
      case 'importGroups': {
        const parsed = parseJsonImport(message.json);
        if (parsed.groups.length === 0 && parsed.errors.length > 0) {
          return { ok: false, error: parsed.errors.join(' ') };
        }
        for (const g of [...parsed.groups].reverse()) {
          await repo.putGroupVerified(g);
          await repo.addGroupToIndex(g.id, 'start');
        }
        return { ok: true, imported: parsed.groups.length };
      }
      case 'importOneTab': {
        const parsed = parseOneTabExport(message.text);
        if (parsed.groups.length === 0) {
          return { ok: false, error: 'No links found in that file.' };
        }
        for (const g of [...parsed.groups].reverse()) {
          await repo.putGroupVerified(g);
          await repo.addGroupToIndex(g.id, 'start');
        }
        return { ok: true, imported: parsed.groups.length };
      }
    }
  }
});
