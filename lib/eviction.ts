import type { EvalTab } from './types';

/**
 * Pure eviction-candidate selection for the tab-limit feature.
 *
 * Policy is fixed: oldest-first (first-seen time, falling back to
 * last-accessed). Never evicted: the active tab, pinned tabs, audible tabs.
 * Native-grouped tabs ARE evictable — group title/color/collapsed state is
 * snapshotted on save and recreated on restore, so nothing is lost.
 */
export function selectEvictionCandidates(tabs: EvalTab[], excess: number): EvalTab[] {
  if (excess <= 0) return [];
  const eligible = tabs.filter((t) => !t.active && !t.pinned && !t.audible);
  eligible.sort(
    (a, b) =>
      (a.firstSeen ?? a.lastAccessed ?? Infinity) - (b.firstSeen ?? b.lastAccessed ?? Infinity),
  );
  return eligible.slice(0, excess);
}
