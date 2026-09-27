import { describe, expect, it } from 'vitest';
import { filterGroups } from '../../lib/search';
import type { SavedGroup } from '../../lib/types';

// docs/TESTING.md's manual check uses a 2,000-tab shelf; keep search usable at
// that size. The bound is deliberately generous so it only trips on a real
// regression (e.g. re-lowercasing every tab per keystroke), not CI jitter.
function makeShelf(sessions: number, tabsPerSession: number): SavedGroup[] {
  return Array.from({ length: sessions }, (_, s) => ({
    id: `g${s}`,
    name: `Session ${s}`,
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: Array.from({ length: tabsPerSession }, (_, t) => ({
      id: `g${s}-t${t}`,
      url: `https://site${t % 97}.example.com/path/${s}/${t}?q=${(s * t) % 13}`,
      title: `Some Reasonably Long Page Title ${t} About Topic ${s % 17}`,
      pinned: false,
      savedAt: 1,
      chromeGroupIdx: null,
    })),
  }));
}

describe('search budget', () => {
  it('handles a burst of keystrokes over 2,000 tabs quickly', () => {
    const groups = makeShelf(40, 50);
    filterGroups(groups, 'x'); // warm-up
    const typed = 'site42 example topic';
    const start = performance.now();
    for (let i = 1; i <= typed.length; i++) filterGroups(groups, typed.slice(0, i));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(250);
  });

  it('reuses the filtered tab array when a keystroke does not change the matches', () => {
    const groups = makeShelf(3, 20);
    const first = filterGroups(groups, 'site1.');
    const second = filterGroups(groups, 'site1.e');
    const pick = (r: ReturnType<typeof filterGroups>, id: string) => r.find((x) => x.group.id === id)!.tabs;
    expect(pick(second, 'g0')).toBe(pick(first, 'g0'));
  });

  it('passes the stored tab array through when no search is active', () => {
    const groups = makeShelf(2, 5);
    const result = filterGroups(groups, '  ');
    expect(result[0]!.tabs).toBe(groups[0]!.tabs);
  });
});
