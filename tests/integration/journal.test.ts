import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { OpJournalEntry, SavedGroup } from '../../lib/types';
import * as journal from '../../lib/services/journal';
import * as repo from '../../lib/storage/repo';
import { groupKey, opKey } from '../../lib/storage/keys';

const group: SavedGroup = {
  id: 'g1',
  name: 'g',
  createdAt: 1,
  updatedAt: 1,
  chromeGroups: [],
  tabs: [{ id: 't', url: 'https://a.com', title: 'a', pinned: false, savedAt: 1, chromeGroupIdx: null }],
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('journal.recover', () => {
  it('deletes orphan shard for a stale writing-phase entry (tabs were never closed)', async () => {
    const entry: OpJournalEntry = {
      opId: 'op1',
      type: 'save-close',
      groupId: 'g1',
      tabIds: [1, 2],
      phase: 'writing',
      startedAt: Date.now() - 120_000,
    };
    await chrome.storage.local.set({ [opKey('op1')]: entry, [groupKey('g1')]: group });
    await journal.recover();
    expect(await repo.getGroup('g1')).toBeNull();
    expect((await chrome.storage.local.get(opKey('op1')))[opKey('op1')]).toBeUndefined();
  });

  it('leaves a fresh writing-phase entry alone (operation may still be running)', async () => {
    const entry: OpJournalEntry = {
      opId: 'op1',
      type: 'save-close',
      groupId: 'g1',
      tabIds: [1],
      phase: 'writing',
      startedAt: Date.now(),
    };
    await chrome.storage.local.set({ [opKey('op1')]: entry, [groupKey('g1')]: group });
    await journal.recover();
    expect(await repo.getGroup('g1')).not.toBeNull();
    expect((await chrome.storage.local.get(opKey('op1')))[opKey('op1')]).toBeDefined();
  });

  it('never deletes an indexed shard even for stale writing entries', async () => {
    await repo.putGroupVerified(group);
    await repo.addGroupToIndex('g1');
    const entry: OpJournalEntry = {
      opId: 'op1',
      type: 'save-close',
      groupId: 'g1',
      tabIds: [1],
      phase: 'writing',
      startedAt: Date.now() - 120_000,
    };
    await chrome.storage.local.set({ [opKey('op1')]: entry });
    await journal.recover();
    expect(await repo.getGroup('g1')).not.toBeNull();
  });

  it('clears written-phase entries without touching data', async () => {
    await repo.putGroupVerified(group);
    await repo.addGroupToIndex('g1');
    const entry: OpJournalEntry = {
      opId: 'op1',
      type: 'save-close',
      groupId: 'g1',
      tabIds: [1],
      phase: 'written',
      startedAt: Date.now() - 120_000,
    };
    await chrome.storage.local.set({ [opKey('op1')]: entry });
    await journal.recover();
    expect(await repo.getGroup('g1')).not.toBeNull();
    expect((await chrome.storage.local.get(opKey('op1')))[opKey('op1')]).toBeUndefined();
  });
});
