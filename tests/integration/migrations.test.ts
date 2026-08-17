import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { runMigrations } from '../../lib/storage/migrations';
import type { Settings } from '../../lib/types';
import { CURRENT_SCHEMA_VERSION } from '../../lib/types';
import { KEY_META, KEY_SETTINGS } from '../../lib/storage/keys';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('runMigrations', () => {
  it('seeds a fresh install with current schema version and default settings', async () => {
    await runMigrations();
    const res = await chrome.storage.local.get([KEY_META, KEY_SETTINGS]);
    expect((res[KEY_META] as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res[KEY_SETTINGS]).toBeDefined();
  });

  it('is a no-op when already at the current version', async () => {
    await runMigrations();
    const before = await chrome.storage.local.get(null);
    await runMigrations();
    const after = await chrome.storage.local.get(null);
    expect(after).toEqual(before);
  });

  it('refuses to touch data written by a NEWER schema (downgrade safety)', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION + 5, installedAt: 1 },
      'group:future': { some: 'future-format' },
    });
    await runMigrations();
    const res = await chrome.storage.local.get(null);
    expect((res[KEY_META] as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
    expect(res['group:future']).toEqual({ some: 'future-format' });
  });
});

describe('v1 -> v2 migration', () => {
  const v1Settings = {
    theme: 'dark',
    restoreRemovesFromList: true,
    restoreInNewWindow: true,
    dedupeOnSave: true,
    managerPinned: false,
    openOnStartup: true,
    confirmations: { 'save-window': { enabled: false } },
    tabLimit: {
      mode: 'notify',
      maxTabs: 40,
      scope: 'global',
      eviction: 'lru',
      allowPinned: true,
      allowAudible: false,
      allowGrouped: false,
      excludedDomains: ['example.com'],
    },
    trashRetentionDays: 7,
    backups: { enabled: true, intervalHours: 12, maxSnapshots: 5, exportReminderDays: 14 },
    onboardingDone: true,
  };

  async function seedV1(settings: unknown = v1Settings, extra: Record<string, unknown> = {}) {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: 1, installedAt: 12345, lastBackupAt: 99, lastExportAt: 88 },
      [KEY_SETTINGS]: settings,
      ...extra,
    });
  }

  it('maps tabLimit mode off -> disabled', async () => {
    await seedV1({ ...v1Settings, tabLimit: { ...v1Settings.tabLimit, mode: 'off' } });
    await runMigrations();
    const s = (await chrome.storage.local.get(KEY_SETTINGS))[KEY_SETTINGS] as Settings;
    expect(s.tabLimit.enabled).toBe(false);
  });

  it('maps every non-off mode -> enabled, carries and clamps maxTabs', async () => {
    for (const mode of ['notify', 'confirm', 'auto-save-excess', 'auto-save-window']) {
      fakeBrowser.reset();
      await seedV1({ ...v1Settings, tabLimit: { ...v1Settings.tabLimit, mode, maxTabs: 1000 } });
      await runMigrations();
      const s = (await chrome.storage.local.get(KEY_SETTINGS))[KEY_SETTINGS] as Settings;
      expect(s.tabLimit.enabled).toBe(true);
      expect(s.tabLimit.maxTabs).toBe(500); // clamped
    }
  });

  it('carries theme + restoreRemovesFromList, drops all removed fields', async () => {
    await seedV1();
    await runMigrations();
    const s = (await chrome.storage.local.get(KEY_SETTINGS))[KEY_SETTINGS] as Record<string, unknown>;
    expect(s.theme).toBe('dark');
    expect(s.restoreRemovesFromList).toBe(true);
    expect(Object.keys(s).sort()).toEqual([
      'captureClosesTabs',
      'excludedDomains',
      'managerDensity',
      'managerSessionSort',
      'managerTabSort',
      'restoreInNewWindow',
      'restoreRemovesFromList',
      'savePinnedTabs',
      'skipDuplicatesOnSave',
      'tabLimit',
      'theme',
    ]);
    expect(Object.keys(s.tabLimit as object).sort()).toEqual(['enabled', 'maxTabs']);
  });

  it('removes backup shards but leaves groups, trash, and index alone', async () => {
    await seedV1(v1Settings, {
      'backup:0': { createdAt: 1 },
      'backup:1': { createdAt: 2 },
      backupMeta: { slots: 2 },
      'group:g1': { id: 'g1' },
      'trash:t1': { id: 't1' },
      index: { groupOrder: ['g1'], updatedAt: 1 },
    });
    await runMigrations();
    const res = await chrome.storage.local.get(null);
    expect(res['backup:0']).toBeUndefined();
    expect(res['backup:1']).toBeUndefined();
    expect(res['backupMeta']).toBeUndefined();
    expect(res['group:g1']).toEqual({ id: 'g1' });
    expect(res['trash:t1']).toEqual({ id: 't1' });
    expect(res['index']).toEqual({ groupOrder: ['g1'], updatedAt: 1 });
  });

  it('rewrites meta to the slim shape, preserving installedAt', async () => {
    await seedV1();
    await runMigrations();
    const meta = (await chrome.storage.local.get(KEY_META))[KEY_META] as Record<string, unknown>;
    expect(meta).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 12345 });
  });

  it('survives partial v1 settings (missing tabLimit) without crashing', async () => {
    await seedV1({ theme: 'light' });
    await runMigrations();
    const s = (await chrome.storage.local.get(KEY_SETTINGS))[KEY_SETTINGS] as Settings;
    expect(s).toEqual({
      theme: 'light',
      restoreRemovesFromList: false,
      savePinnedTabs: false,
      restoreInNewWindow: false,
      captureClosesTabs: true,
      skipDuplicatesOnSave: true,
      excludedDomains: [],
      managerDensity: 'comfortable',
      managerSessionSort: 'manual',
      managerTabSort: 'manual',
      tabLimit: { enabled: false, maxTabs: 25 },
    });
  });

  it('cleans up the migration snapshot on success', async () => {
    await seedV1();
    await runMigrations();
    const res = await chrome.storage.local.get('migration-snapshot');
    expect(res['migration-snapshot']).toBeUndefined();
  });
});
