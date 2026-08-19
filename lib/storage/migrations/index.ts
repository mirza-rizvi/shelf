import type { Settings } from '../../types';
import { CURRENT_SCHEMA_VERSION } from '../../types';
import { DEFAULT_SETTINGS } from '../../constants';
import { KEY_META, KEY_SETTINGS } from '../keys';

/** Versioned, resumable storage migrations with a pre-step safety snapshot. */
type Migration = (raw: Record<string, unknown>) => Promise<void>;

const LEGACY_WORKSPACE_INDEX = 'workspaceIndex';
const LEGACY_TRASH_BATCH_INDEX = 'trashBatchIndex';
const legacyWorkspaceKey = (id: string) => `workspace:${id}`;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function currentSettings(value: unknown): Settings {
  const stored = asRecord(value);
  const limit = asRecord(stored['tabLimit']);
  const maxTabs = typeof limit['maxTabs'] === 'number' && Number.isFinite(limit['maxTabs'])
    ? Math.max(3, Math.min(500, Math.round(limit['maxTabs'])))
    : DEFAULT_SETTINGS.tabLimit.maxTabs;
  const lastExportAt = typeof stored['lastExportAt'] === 'number' && Number.isFinite(stored['lastExportAt'])
    ? stored['lastExportAt']
    : undefined;

  return {
    theme: stored['theme'] === 'light' || stored['theme'] === 'dark' ? stored['theme'] : 'system',
    restoreRemovesFromList: stored['restoreRemovesFromList'] === true,
    savePinnedTabs: stored['savePinnedTabs'] === true,
    restoreInNewWindow: stored['restoreInNewWindow'] === true,
    captureClosesTabs: stored['captureClosesTabs'] !== false,
    skipDuplicatesOnSave: stored['skipDuplicatesOnSave'] !== false,
    excludedDomains: Array.isArray(stored['excludedDomains'])
      ? stored['excludedDomains'].filter((item): item is string => typeof item === 'string')
      : [],
    ...(lastExportAt === undefined ? {} : { lastExportAt }),
    tabLimit: { enabled: limit['enabled'] === true, maxTabs },
  };
}

function withoutWorkspace(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const { workspaceId: _workspaceId, ...group } = value as Record<string, unknown>;
  return group;
}

function withoutWorkspaceTrash(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const { batchId: _batchId, ...entry } = value as Record<string, unknown>;
  return { ...entry, group: withoutWorkspace(entry['group']) };
}

function groupFingerprint(value: unknown): string | null {
  const group = asRecord(value);
  const tabs = group['tabs'];
  if (!Array.isArray(tabs)) return null;
  let checksum = 0;
  for (const value of tabs) {
    const tab = asRecord(value);
    checksum += typeof tab['url'] === 'string' ? tab['url'].length : 0;
    checksum += typeof tab['title'] === 'string' ? tab['title'].length : 0;
  }
  return `${String(group['id'])}:${tabs.length}:${checksum}`;
}

/** v(n) -> migration that upgrades FROM n TO n+1. */
const migrations: Record<number, Migration> = {
  // v1 -> v2: collapse legacy settings and remove automatic backup shards.
  1: async (raw) => {
    const old = asRecord(raw[KEY_SETTINGS]);
    const oldLimit = asRecord(old['tabLimit']);
    await chrome.storage.local.set({
      [KEY_SETTINGS]: {
        theme: old['theme'] === 'light' || old['theme'] === 'dark' ? old['theme'] : 'system',
        restoreRemovesFromList: old['restoreRemovesFromList'] === true,
        savePinnedTabs: false,
        restoreInNewWindow: false,
        captureClosesTabs: true,
        skipDuplicatesOnSave: true,
        excludedDomains: [],
        managerDensity: 'comfortable',
        managerSessionSort: 'manual',
        managerTabSort: 'manual',
        tabLimit: {
          enabled: typeof oldLimit['mode'] === 'string' && oldLimit['mode'] !== 'off',
          maxTabs:
            typeof oldLimit['maxTabs'] === 'number' && Number.isFinite(oldLimit['maxTabs'])
              ? Math.max(3, Math.min(500, Math.round(oldLimit['maxTabs'])))
              : DEFAULT_SETTINGS.tabLimit.maxTabs,
        },
      },
    });

    const stale = Object.keys(raw).filter((key) => key.startsWith('backup:'));
    if (raw['backupMeta'] !== undefined) stale.push('backupMeta');
    if (stale.length > 0) await chrome.storage.local.remove(stale);

    const meta = asRecord(raw[KEY_META]);
    await chrome.storage.local.set({
      [KEY_META]: {
        schemaVersion: 1,
        installedAt:
          typeof meta['installedAt'] === 'number' && Number.isFinite(meta['installedAt'])
            ? meta['installedAt']
            : Date.now(),
      },
    });
  },

  // v2 -> v3: retained so old installations can traverse the historical
  // workspace schema before v4 safely flattens it.
  2: async (raw) => {
    const now = Date.now();
    const stored = asRecord(raw[KEY_SETTINGS]);
    await chrome.storage.local.set({
      [KEY_SETTINGS]: {
        ...DEFAULT_SETTINGS,
        ...stored,
        tabLimit: { ...DEFAULT_SETTINGS.tabLimit, ...asRecord(stored['tabLimit']) },
      },
      [legacyWorkspaceKey('inbox')]: raw[legacyWorkspaceKey('inbox')] ?? {
        id: 'inbox', name: 'Inbox', createdAt: now, updatedAt: now,
      },
      [LEGACY_WORKSPACE_INDEX]: raw[LEGACY_WORKSPACE_INDEX] ?? {
        workspaceOrder: ['inbox'], updatedAt: now,
      },
    });
  },

  // v3 -> v4: one flat session list. Session and tab payloads are rewritten
  // and verified before obsolete workspace metadata is removed.
  3: async (raw) => {
    const writes: Record<string, unknown> = { [KEY_SETTINGS]: currentSettings(raw[KEY_SETTINGS]) };
    const rewrittenKeys: string[] = [];

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('group:')) {
        writes[key] = withoutWorkspace(value);
        rewrittenKeys.push(key);
      } else if (key.startsWith('trash:')) {
        writes[key] = withoutWorkspaceTrash(value);
        rewrittenKeys.push(key);
      }
    }

    await chrome.storage.local.set(writes);
    if (rewrittenKeys.length > 0) {
      const stored = await chrome.storage.local.get(rewrittenKeys);
      for (const key of rewrittenKeys) {
        const before = key.startsWith('trash:') ? asRecord(raw[key])['group'] : raw[key];
        const after = key.startsWith('trash:') ? asRecord(stored[key])['group'] : stored[key];
        if (groupFingerprint(before) !== groupFingerprint(after)) {
          throw new Error(`Migration verification failed for ${key}`);
        }
      }
    }

    const obsolete = Object.keys(raw).filter((key) =>
      key === LEGACY_WORKSPACE_INDEX ||
      key === LEGACY_TRASH_BATCH_INDEX ||
      key.startsWith('workspace:') ||
      key.startsWith('trashBatch:'),
    );
    if (obsolete.length > 0) await chrome.storage.local.remove(obsolete);
  },
};

async function seedFreshInstall(): Promise<void> {
  await chrome.storage.local.set({
    [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: Date.now() },
    [KEY_SETTINGS]: DEFAULT_SETTINGS,
  });
}

export async function runMigrations(): Promise<void> {
  const result = await chrome.storage.local.get(KEY_META);
  const meta = result[KEY_META] as { schemaVersion?: number } | undefined;
  let version = meta?.schemaVersion ?? 0;

  if (version === 0) {
    await seedFreshInstall();
    return;
  }
  if (version === CURRENT_SCHEMA_VERSION || version > CURRENT_SCHEMA_VERSION) return;

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) break;
    const raw = await chrome.storage.local.get(null);
    await chrome.storage.local.set({ 'migration-snapshot': { fromVersion: version, at: Date.now(), raw } });
    await step(raw);
    version += 1;
    const current = asRecord((await chrome.storage.local.get(KEY_META))[KEY_META]);
    await chrome.storage.local.set({ [KEY_META]: { ...current, schemaVersion: version } });
  }
  await chrome.storage.local.remove('migration-snapshot');
}
