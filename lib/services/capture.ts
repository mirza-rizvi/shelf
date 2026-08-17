import type {
  CaptureResult,
  SavedChromeTabGroup,
  SavedGroup,
  TabGroupColor,
  TabItem,
} from '../types';
import { DUPLICATE_SAVE_WINDOW_MS, TABS_REMOVE_CHUNK } from '../constants';
import { INBOX_WORKSPACE_ID } from '../types';
import { canonicalUrl, matchesExcludedDomain } from '../duplicates';
import * as repo from '../storage/repo';
import * as journal from './journal';

/**
 * Capture service — runs in the background service worker only.
 *
 * Data-loss invariant (write-verify-close): tabs are closed ONLY after the
 * saved group has been written to storage and read back verified. If the SW
 * dies mid-operation the journal recovery path guarantees the worst case is
 * a duplicate (tab saved AND still open) — never a lost tab.
 */

export type CaptureScope =
  | 'window'
  | 'all-windows'
  | 'tab'
  | 'left'
  | 'right'
  | 'group'
  | 'selected'
  | 'others';

export interface CaptureOptions {
  closeOriginals: boolean;
  windowId?: number; // for scope 'window'; defaults to current window
  workspaceId?: string;
  destinationGroupId?: string;
  allowDuplicates?: boolean;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const SCOPE_LABELS: Record<CaptureScope, string> = {
  window: 'Window',
  'all-windows': 'All windows',
  tab: 'Tab',
  left: 'Left tabs',
  right: 'Right tabs',
  group: 'Tab group',
  selected: 'Selected tabs',
  others: 'Other tabs',
};

function formatGroupName(tabCount: number, scope: CaptureScope): string {
  const date = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${SCOPE_LABELS[scope]} · ${date} · ${tabCount} tab${tabCount === 1 ? '' : 's'}`;
}

async function queryScope(scope: CaptureScope, windowId?: number): Promise<chrome.tabs.Tab[]> {
  if (scope === 'all-windows') return chrome.tabs.query({});
  if (scope === 'tab') return chrome.tabs.query({ active: true, currentWindow: true });
  if (scope === 'selected') {
    // Tabs the user highlighted in the tab strip (always includes the active tab).
    return chrome.tabs.query({ currentWindow: true, highlighted: true });
  }
  const windowTabs =
    windowId !== undefined
      ? await chrome.tabs.query({ windowId })
      : await chrome.tabs.query({ currentWindow: true });
  if (scope === 'left' || scope === 'right') {
    // OneTab-style: everything on one side of the active tab. Pinned tabs are
    // skipped — Chrome pins always sit leftmost, so "left" would eat them.
    const active = windowTabs.find((t) => t.active);
    if (!active) return [];
    return windowTabs.filter(
      (t) =>
        !t.active &&
        !t.pinned &&
        (scope === 'left' ? t.index < active.index : t.index > active.index),
    );
  }
  if (scope === 'group') {
    // The active tab's native tab group; nothing if it isn't in one.
    const active = windowTabs.find((t) => t.active);
    if (!active || active.groupId === undefined || active.groupId === -1) return [];
    return windowTabs.filter((t) => t.groupId === active.groupId);
  }
  if (scope === 'others') {
    return windowTabs.filter((t) => !t.active);
  }
  return windowTabs;
}

const ownOrigin = () => chrome.runtime.getURL('');

/** A tab's real destination: `url` once committed, `pendingUrl` while loading. */
export const resolveTabUrl = (t: chrome.tabs.Tab): string => t.url || t.pendingUrl || '';

/** Pages with nothing worth saving (and mostly nothing restorable). Covers
 * every New Tab flavor Chrome reports: legacy chrome://newtab/, the modern
 * chrome://new-tab-page/ WebUI host, and chrome-search:// local NTPs. */
const UNSAVEABLE_PREFIXES = [
  'about:blank', // exact, #fragment, or ?query
  'chrome://newtab',
  'chrome://new-tab-page',
  'chrome-search://',
  'devtools://',
  'view-source:',
  'blob:',
];

/** Worth saving = has a real destination and isn't an empty page or Shelf's own UI.
 * Guards every save path — blank entries in the list are always a bug. */
export function isSaveworthy(t: chrome.tabs.Tab): boolean {
  const u = resolveTabUrl(t);
  if (u === '') return false;
  if (UNSAVEABLE_PREFIXES.some((p) => u.startsWith(p))) return false;
  // Guard against a pathological empty origin — ''.startsWith('') is true
  // for every url and would silently make NOTHING saveworthy.
  const origin = ownOrigin();
  return origin === '' || !u.startsWith(origin);
}

/** Duplicate-click guard: identical (scope, windowId) captures within 3 s are dropped. */
let lastCapture: { key: string; at: number } | null = null;

export async function captureTabs(
  scope: CaptureScope,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  await repo.ensureReady();

  // Key the duplicate-click guard on the REAL window id — a literal 'cur'
  // would swallow a legit save in window B right after saving window A.
  let windowKey: string | number = 'all';
  if (scope !== 'all-windows') {
    try {
      windowKey = opts.windowId ?? (await chrome.windows.getCurrent()).id ?? 'cur';
    } catch {
      windowKey = opts.windowId ?? 'cur';
    }
  }
  const dupKey = `${scope}:${windowKey}:${opts.closeOriginals}:${opts.workspaceId ?? ''}:${opts.destinationGroupId ?? ''}`;
  const now = Date.now();
  if (lastCapture && lastCapture.key === dupKey && now - lastCapture.at < DUPLICATE_SAVE_WINDOW_MS) {
    return { groupId: null, saved: 0, closed: 0, failures: 0 };
  }
  lastCapture = { key: dupKey, at: now };

  const settings = await repo.getSettings();
  const rawTabs = await queryScope(scope, opts.windowId);
  // Drop Shelf's own pages, New Tab pages, about:blank, and url-less tabs;
  // still-loading tabs are kept (their target lives in pendingUrl).
  let tabs = rawTabs.filter(isSaveworthy);
  tabs = tabs.filter((tab) => !matchesExcludedDomain(resolveTabUrl(tab), settings.excludedDomains));
  // Pinned-tab setting applies to whole-window-ish saves only: left/right
  // always skip pinned, and 'tab'/'selected'/'group' are explicit picks.
  if (scope === 'window' || scope === 'all-windows' || scope === 'others') {
    if (!settings.savePinnedTabs) tabs = tabs.filter((t) => !t.pinned);
  }
  if (tabs.length === 0) {
    return { groupId: null, saved: 0, closed: 0, failures: 0 };
  }

  if (scope === 'all-windows' && !opts.destinationGroupId) {
    return saveWindowGroups(tabs, opts);
  }

  return saveTabList(tabs, scope, opts);
}

async function filterDuplicateCandidates(
  candidates: chrome.tabs.Tab[],
  existing: TabItem[],
  allowDuplicates: boolean,
): Promise<{ tabs: chrome.tabs.Tab[]; skipped: number }> {
  if (allowDuplicates) return { tabs: candidates, skipped: 0 };
  const seen = new Set(existing.map((tab) => canonicalUrl(tab.url)));
  const tabs: chrome.tabs.Tab[] = [];
  let skipped = 0;
  for (const tab of candidates) {
    const key = canonicalUrl(resolveTabUrl(tab));
    if (seen.has(key)) {
      skipped += 1;
    } else {
      seen.add(key);
      tabs.push(tab);
    }
  }
  return { tabs, skipped };
}

async function buildGroup(
  candidates: chrome.tabs.Tab[],
  scope: CaptureScope | 'tab-limit',
  workspaceId: string,
): Promise<SavedGroup> {
  const nativeGroupIds = [...new Set(candidates.map((t) => t.groupId).filter((g) => g !== -1 && g !== undefined))] as number[];
  const chromeGroups: SavedChromeTabGroup[] = [];
  const groupIdxByNativeId = new Map<number, number>();
  for (const nativeId of nativeGroupIds) {
    try {
      const g = await chrome.tabGroups.get(nativeId);
      groupIdxByNativeId.set(nativeId, chromeGroups.length);
      chromeGroups.push({ title: g.title ?? '', color: g.color as TabGroupColor, collapsed: g.collapsed });
    } catch {
      // Group vanished mid-capture; save its tabs ungrouped.
    }
  }
  const savedAt = Date.now();
  const tabs: TabItem[] = candidates.map((t) => ({
    id: crypto.randomUUID(),
    url: resolveTabUrl(t),
    title: t.title || t.url || 'Untitled',
    pinned: t.pinned ?? false,
    savedAt,
    chromeGroupIdx: t.groupId !== undefined && t.groupId !== -1
      ? (groupIdxByNativeId.get(t.groupId) ?? null)
      : null,
  }));
  const group: SavedGroup = {
    id: crypto.randomUUID(),
    workspaceId,
    name: formatGroupName(tabs.length, scope === 'tab-limit' ? 'window' : scope),
    createdAt: savedAt,
    updatedAt: savedAt,
    chromeGroups,
    tabs,
  };
  if (scope === 'tab-limit') group.name = `Auto-saved · ${group.name}`;
  return group;
}

async function closeCapturedTabs(candidates: chrome.tabs.Tab[], shouldClose: boolean): Promise<{ closed: number; failures: number }> {
  if (!shouldClose) return { closed: 0, failures: 0 };
  const tabIds = candidates.map((tab) => tab.id).filter((id): id is number => id !== undefined);
  let closed = 0;
  let failures = 0;
  for (const ids of chunk(tabIds, TABS_REMOVE_CHUNK)) {
    const results = await Promise.allSettled(ids.map((id) => chrome.tabs.remove(id)));
    for (const result of results) result.status === 'fulfilled' ? closed++ : failures++;
  }
  return { closed, failures };
}

async function saveWindowGroups(tabs: chrome.tabs.Tab[], opts: CaptureOptions): Promise<CaptureResult> {
  const settings = await repo.getSettings();
  const byWindow = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (tab.windowId === undefined) continue;
    const list = byWindow.get(tab.windowId) ?? [];
    list.push(tab);
    byWindow.set(tab.windowId, list);
  }
  const accepted: chrome.tabs.Tab[] = [];
  let skippedDuplicates = 0;
  const groups: SavedGroup[] = [];
  for (const windowTabs of byWindow.values()) {
    const filtered = await filterDuplicateCandidates(
      windowTabs,
      [],
      opts.allowDuplicates ?? !settings.skipDuplicatesOnSave,
    );
    skippedDuplicates += filtered.skipped;
    if (filtered.tabs.length === 0) continue;
    accepted.push(...filtered.tabs);
    groups.push(await buildGroup(filtered.tabs, 'window', opts.workspaceId ?? INBOX_WORKSPACE_ID));
  }
  if (groups.length === 0) return { groupId: null, groupIds: [], saved: 0, closed: 0, failures: 0, skippedDuplicates };
  const opId = crypto.randomUUID();
  await journal.put({ opId, type: 'save-close', groupId: groups[0]!.id, groupIds: groups.map((g) => g.id), mode: 'create', tabIds: accepted.map((t) => t.id!).filter(Boolean), phase: 'writing', startedAt: Date.now() });
  try {
    await repo.putGroupsVerified(groups);
    await repo.addGroupsToIndex(groups.map((g) => g.id), 'start');
    await journal.setPhase(opId, 'written');
  } catch (error) {
    await journal.remove(opId);
    await chrome.storage.local.remove(groups.map((g) => `group:${g.id}`));
    throw error;
  }
  const close = await closeCapturedTabs(accepted, opts.closeOriginals);
  await journal.remove(opId);
  return { groupId: groups[0]!.id, groupIds: groups.map((g) => g.id), saved: accepted.length, ...close, skippedDuplicates };
}

/** Save a specific tab list (used by capture and by the tab-limit automation). */
export async function saveTabList(
  candidates: chrome.tabs.Tab[],
  scope: CaptureScope | 'tab-limit',
  opts: CaptureOptions,
): Promise<CaptureResult> {
  // Belt for direct callers (tab-limit, hub): blank tabs are never stored,
  // and since the close set below equals the saved set, never closed either.
  candidates = candidates.filter(isSaveworthy);
  if (candidates.length === 0) {
    return { groupId: null, saved: 0, closed: 0, failures: 0 };
  }

  const settings = await repo.getSettings();
  candidates = candidates.filter((tab) => !matchesExcludedDomain(resolveTabUrl(tab), settings.excludedDomains));
  if (candidates.length === 0) return { groupId: null, saved: 0, closed: 0, failures: 0 };
  const destination = opts.destinationGroupId ? await repo.getGroup(opts.destinationGroupId) : null;
  const filtered = await filterDuplicateCandidates(
    candidates,
    destination?.tabs ?? [],
    opts.allowDuplicates ?? !settings.skipDuplicatesOnSave,
  );
  candidates = filtered.tabs;
  if (candidates.length === 0) {
    return { groupId: destination?.id ?? null, saved: 0, closed: 0, failures: 0, skippedDuplicates: filtered.skipped };
  }
  const captured = await buildGroup(candidates, scope, opts.workspaceId ?? destination?.workspaceId ?? INBOX_WORKSPACE_ID);
  const group: SavedGroup = destination
    ? {
        ...destination,
        chromeGroups: [...destination.chromeGroups, ...captured.chromeGroups],
        tabs: [
          ...destination.tabs,
          ...captured.tabs.map((tab) => ({
            ...tab,
            chromeGroupIdx: tab.chromeGroupIdx === null ? null : tab.chromeGroupIdx + destination.chromeGroups.length,
          })),
        ],
        updatedAt: Date.now(),
      }
    : captured;

  const savedAt = Date.now();

  const tabIds = candidates.map((t) => t.id!).filter((id) => id !== undefined);
  const opId = crypto.randomUUID();
  await journal.put({
    opId,
    type: 'save-close',
    groupId: group.id,
    mode: destination ? 'append' : 'create',
    tabIds,
    phase: 'writing',
    startedAt: savedAt,
  });

  try {
    // The load-bearing write: verified before anything is closed.
    await repo.putGroupVerified(group);
  } catch (err) {
    await journal.remove(opId);
    if (destination) await repo.putGroup(destination);
    else await chrome.storage.local.remove(`group:${group.id}`);
    throw err;
  }

  if (!destination) await repo.addGroupToIndex(group.id, 'start');
  await journal.setPhase(opId, 'written');

  const { closed, failures } = await closeCapturedTabs(candidates, opts.closeOriginals);

  await journal.remove(opId);
  return { groupId: group.id, saved: candidates.length, closed, failures, skippedDuplicates: filtered.skipped };
}
