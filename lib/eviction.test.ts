import { describe, expect, it } from 'vitest';
import { selectEvictionCandidates } from './eviction';
import type { EvalTab } from './types';

function tab(partial: Partial<EvalTab> & { id: number }): EvalTab {
  return {
    windowId: 1,
    index: partial.id,
    active: false,
    pinned: false,
    audible: false,
    groupId: -1,
    lastAccessed: partial.id * 1000,
    firstSeen: partial.id * 1000,
    url: `https://site${partial.id}.com`,
    ...partial,
  };
}

describe('selectEvictionCandidates protections', () => {
  it('never selects the active tab', () => {
    const tabs = [tab({ id: 1, active: true, firstSeen: 0 }), tab({ id: 2 }), tab({ id: 3 })];
    const out = selectEvictionCandidates(tabs, 3);
    expect(out.map((t) => t.id)).not.toContain(1);
  });
  it('protects pinned tabs', () => {
    const tabs = [tab({ id: 1, pinned: true }), tab({ id: 2 })];
    expect(selectEvictionCandidates(tabs, 2).map((t) => t.id)).toEqual([2]);
  });
  it('protects audible tabs', () => {
    const tabs = [tab({ id: 1, audible: true }), tab({ id: 2 })];
    expect(selectEvictionCandidates(tabs, 2).map((t) => t.id)).toEqual([2]);
  });
  it('grouped tabs are evictable (fidelity preserved by capture/restore)', () => {
    const tabs = [tab({ id: 1, groupId: 7 }), tab({ id: 2 })];
    expect(selectEvictionCandidates(tabs, 2).map((t) => t.id)).toEqual([1, 2]);
  });
  it('returns empty for zero or negative excess', () => {
    expect(selectEvictionCandidates([tab({ id: 1 })], 0)).toEqual([]);
    expect(selectEvictionCandidates([tab({ id: 1 })], -2)).toEqual([]);
  });
});

describe('oldest-first order', () => {
  it('picks earliest firstSeen first', () => {
    const tabs = [
      tab({ id: 1, firstSeen: 100 }),
      tab({ id: 2, firstSeen: 300 }),
      tab({ id: 3, firstSeen: 200 }),
    ];
    expect(selectEvictionCandidates(tabs, 2).map((t) => t.id)).toEqual([1, 3]);
  });
  it('falls back to lastAccessed when firstSeen is missing', () => {
    const tabs = [
      tab({ id: 1, firstSeen: undefined, lastAccessed: 50 }),
      tab({ id: 2, firstSeen: 100 }),
    ];
    expect(selectEvictionCandidates(tabs, 1).map((t) => t.id)).toEqual([1]);
  });
  it('tabs with neither timestamp sort last', () => {
    const tabs = [
      tab({ id: 1, firstSeen: undefined, lastAccessed: undefined }),
      tab({ id: 2, firstSeen: 100 }),
    ];
    expect(selectEvictionCandidates(tabs, 1).map((t) => t.id)).toEqual([2]);
  });
});
