import type { Settings, Workspace } from '../../types';
import { CURRENT_SCHEMA_VERSION, INBOX_WORKSPACE_ID } from '../../types';
import { DEFAULT_SETTINGS } from '../../constants';
import { KEY_META, KEY_SETTINGS, KEY_WORKSPACE_INDEX, workspaceKey } from '../keys';

/**
 * Versioned migration runner. Each step commits schemaVersion after it
 * finishes, so an interrupted run resumes where it stopped. A safety
 * snapshot (raw copy under a dedicated key) is written before each step.
 */

type Migration = (raw: Record<string, unknown>) => Promise<void>;

/** v(n) -> migration that upgrades FROM n TO n+1. */
const migrations: Record<number, Migration> = {
  // v1 -> v2: settings collapsed to { theme, restoreRemovesFromList, tabLimit }
  // and the backup-snapshot feature was removed. Must tolerate partial v1 data
  // (the runner may re-invoke this on a resume-from-snapshot).
  1: async (raw) => {
    const old = (raw[KEY_SETTINGS] ?? {}) as Record<string, unknown>;
    const oldLimit = (old.tabLimit ?? {}) as Record<string, unknown>;
    const next: Settings = {
      theme: old.theme === 'light' || old.theme === 'dark' ? old.theme : 'system',
      restoreRemovesFromList: old.restoreRemovesFromList === true,
      savePinnedTabs: false,
      restoreInNewWindow: false,
      captureClosesTabs: true,
      skipDuplicatesOnSave: true,
      excludedDomains: [],
      managerDensity: 'comfortable',
      managerSessionSort: 'manual',
      managerTabSort: 'manual',
      tabLimit: {
        enabled: typeof oldLimit.mode === 'string' && oldLimit.mode !== 'off',
        maxTabs:
          typeof oldLimit.maxTabs === 'number' && Number.isFinite(oldLimit.maxTabs)
            ? Math.max(3, Math.min(500, Math.round(oldLimit.maxTabs)))
            : DEFAULT_SETTINGS.tabLimit.maxTabs,
      },
    };
    await chrome.storage.local.set({ [KEY_SETTINGS]: next });

    // Backup feature removed: drop its shards (literals — key helpers are gone).
    const stale = Object.keys(raw).filter((k) => k.startsWith('backup:'));
    if (raw['backupMeta'] !== undefined) stale.push('backupMeta');
    if (stale.length > 0) await chrome.storage.local.remove(stale);

    // Slim meta to { schemaVersion, installedAt }; the runner bumps the version.
    const m = (raw[KEY_META] ?? {}) as Record<string, unknown>;
    await chrome.storage.local.set({
      [KEY_META]: {
        schemaVersion: 1,
        installedAt:
          typeof m.installedAt === 'number' && Number.isFinite(m.installedAt)
            ? m.installedAt
            : Date.now(),
      },
    });
  },
  // v2 -> v3: additive workspaces + capture defaults. Existing group shards
  // are deliberately untouched; a missing workspaceId resolves to Inbox.
  2: async (raw) => {
    const now = Date.now();
    const stored = (raw[KEY_SETTINGS] ?? {}) as Partial<Settings>;
    const existingInbox = raw[workspaceKey(INBOX_WORKSPACE_ID)] as Workspace | undefined;
    const inbox: Workspace = existingInbox ?? {
      id: INBOX_WORKSPACE_ID,
      name: 'Inbox',
      createdAt: now,
      updatedAt: now,
    };
    await chrome.storage.local.set({
      [KEY_SETTINGS]: {
        ...DEFAULT_SETTINGS,
        ...stored,
        tabLimit: { ...DEFAULT_SETTINGS.tabLimit, ...stored.tabLimit },
        excludedDomains: Array.isArray(stored.excludedDomains)
          ? stored.excludedDomains.filter((v): v is string => typeof v === 'string')
          : [],
      } satisfies Settings,
      [workspaceKey(INBOX_WORKSPACE_ID)]: inbox,
      [KEY_WORKSPACE_INDEX]: raw[KEY_WORKSPACE_INDEX] ?? { workspaceOrder: [INBOX_WORKSPACE_ID], updatedAt: now },
    });
  },
};

async function seedFreshInstall(): Promise<void> {
  const now = Date.now();
  await chrome.storage.local.set({
    [KEY_META]: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      installedAt: now,
    },
    [KEY_SETTINGS]: DEFAULT_SETTINGS,
    [workspaceKey(INBOX_WORKSPACE_ID)]: {
      id: INBOX_WORKSPACE_ID,
      name: 'Inbox',
      createdAt: now,
      updatedAt: now,
    } satisfies Workspace,
    [KEY_WORKSPACE_INDEX]: { workspaceOrder: [INBOX_WORKSPACE_ID], updatedAt: now },
  });
}

export async function runMigrations(): Promise<void> {
  const res = await chrome.storage.local.get(KEY_META);
  const meta = res[KEY_META] as { schemaVersion?: number } | undefined;
  let version = meta?.schemaVersion ?? 0;

  if (version === 0) {
    await seedFreshInstall();
    return;
  }
  if (version === CURRENT_SCHEMA_VERSION) return;
  if (version > CURRENT_SCHEMA_VERSION) {
    // Downgrade (user installed an older build over newer data). Refuse to
    // touch data; the UI reads defensively and never destroys unknown keys.
    return;
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) break; // missing migration — leave data as-is rather than corrupt
    const raw = await chrome.storage.local.get(null);
    await chrome.storage.local.set({ 'migration-snapshot': { fromVersion: version, at: Date.now(), raw } });
    await step(raw);
    version += 1;
    const cur = (await chrome.storage.local.get(KEY_META))[KEY_META] as Record<string, unknown>;
    await chrome.storage.local.set({ [KEY_META]: { ...cur, schemaVersion: version } });
  }
  // Success: drop the working snapshot.
  await chrome.storage.local.remove('migration-snapshot');
}
