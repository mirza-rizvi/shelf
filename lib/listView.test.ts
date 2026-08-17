import { describe, expect, it } from 'vitest';
import { buildDomainOptions, deriveListView, reconcileSelection, toggleSelection } from './listView';
import type { SavedGroup } from './types';

const group = (id: string, name: string, createdAt: number, urls: string[]): SavedGroup => ({
  id, name, createdAt, updatedAt: createdAt, chromeGroups: [],
  tabs: urls.map((url, index) => ({ id: `${id}-${index}`, url, title: `${name} ${index}`, pinned: false, savedAt: createdAt + index, chromeGroupIdx: null })),
});

const groups = [
  group('b', 'Beta', 20, ['https://two.test/b', 'https://one.test/z']),
  group('a', 'Alpha', 10, ['https://one.test/a']),
];

describe('list view derivation', () => {
  it('builds domain counts in count/name order', () => {
    expect(buildDomainOptions(groups)).toEqual([
      { host: 'one.test', count: 2 }, { host: 'two.test', count: 1 },
    ]);
  });

  it('composes search and exact-domain filtering', () => {
    const result = deriveListView(groups, 'beta', 'one.test', 'manual', 'manual');
    expect(result).toHaveLength(1);
    expect(result[0]!.tabs.map((tab) => tab.url)).toEqual(['https://one.test/z']);
  });

  it('sorts sessions and tabs without mutating source order', () => {
    const result = deriveListView(groups, '', '', 'name', 'domain');
    expect(result.map((item) => item.group.id)).toEqual(['a', 'b']);
    expect(result[1]!.tabs.map((tab) => tab.url)).toEqual(['https://one.test/z', 'https://two.test/b']);
    expect(groups.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('handles 10,000 tabs while returning the exact matching subset', () => {
    const large = group('large', 'Large', 1, Array.from({ length: 10_000 }, (_, index) => `https://d${index % 10}.test/${index}`));
    expect(deriveListView([large], '', 'd7.test', 'manual', 'newest')[0]!.tabs).toHaveLength(1_000);
  });

  it('toggles only matching keys and prunes deleted tabs', () => {
    const selected = toggleSelection(new Set(['hidden:key']), ['a:a-0'], true);
    expect([...selected]).toEqual(['hidden:key', 'a:a-0']);
    expect([...reconcileSelection(selected, groups)]).toEqual(['a:a-0']);
    expect([...toggleSelection(selected, ['a:a-0'], false)]).toEqual(['hidden:key']);
  });
});
