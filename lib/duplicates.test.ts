import { describe, expect, it } from 'vitest';
import { canonicalUrl, findDuplicateSets, matchesExcludedDomain } from './duplicates';
import type { SavedGroup, TabItem } from './types';

const tab = (id: string, url: string, savedAt = 1): TabItem => ({
  id,
  url,
  title: id,
  pinned: false,
  savedAt,
  chromeGroupIdx: null,
});

const group = (id: string, tabs: TabItem[]): SavedGroup => ({
  id,
  name: id,
  createdAt: 1,
  updatedAt: 1,
  chromeGroups: [],
  tabs,
});

describe('canonical URL duplicate policy', () => {
  it('normalizes host/default port but preserves query and fragment', () => {
    expect(canonicalUrl('HTTPS://EXAMPLE.COM:443/a?q=1#one')).toBe('https://example.com/a?q=1#one');
    expect(canonicalUrl('https://example.com/a?q=1#one')).not.toBe(
      canonicalUrl('https://example.com/a?q=1#two'),
    );
  });

  it('matches a domain and its subdomains, not suffix lookalikes', () => {
    expect(matchesExcludedDomain('https://docs.example.com/a', ['example.com'])).toBe(true);
    expect(matchesExcludedDomain('https://notexample.com/a', ['example.com'])).toBe(false);
  });

  it('reports duplicate locations across groups', () => {
    const sets = findDuplicateSets([
      group('one', [tab('a', 'https://example.com')]),
      group('two', [tab('b', 'https://EXAMPLE.com/')]),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.locations.map((location) => location.groupId)).toEqual(['one', 'two']);
  });
});
