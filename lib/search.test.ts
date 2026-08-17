import { describe, expect, it } from 'vitest';
import { searchGroups } from './search';
import type { SavedGroup } from './types';

const groups: SavedGroup[] = [
  {
    id: 'g1',
    name: 'Work research',
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: [
      { id: 'a', url: 'https://github.com/wxt-dev/wxt', title: 'WXT framework', pinned: false, savedAt: 1, chromeGroupIdx: null },
      { id: 'b', url: 'https://react.dev/', title: 'React docs', pinned: false, savedAt: 1, chromeGroupIdx: null },
    ],
  },
  {
    id: 'g2',
    name: 'Recipes',
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: [
      { id: 'c', url: 'https://cooking.example/pasta', title: 'Best pasta', pinned: false, savedAt: 1, chromeGroupIdx: null },
    ],
  },
];

describe('searchGroups', () => {
  it('empty query returns all groups with no tab highlights', () => {
    const r = searchGroups(groups, '  ');
    expect(r).toHaveLength(2);
    expect(r[0]!.matchingTabIds.size).toBe(0);
  });
  it('matches tab title and url case-insensitively', () => {
    const r = searchGroups(groups, 'REACT');
    expect(r).toHaveLength(1);
    expect([...r[0]!.matchingTabIds]).toEqual(['b']);
  });
  it('matches group name even when no tabs match', () => {
    const r = searchGroups(groups, 'recipes');
    expect(r).toHaveLength(1);
    expect(r[0]!.group.id).toBe('g2');
  });
  it('multiple terms AND together', () => {
    expect(searchGroups(groups, 'wxt github')).toHaveLength(1);
    expect(searchGroups(groups, 'wxt pasta')).toHaveLength(0);
  });
});
