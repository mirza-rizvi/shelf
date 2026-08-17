import { describe, expect, it } from 'vitest';
import { parseJsonImport } from './importJson';
import { buildJsonExport } from './exportJson';
import type { SavedGroup } from '../types';

const validGroup: SavedGroup = {
  id: 'orig-id',
  name: 'My shelf',
  createdAt: 111,
  updatedAt: 222,
  chromeGroups: [{ title: 'Research', color: 'blue', collapsed: false }],
  tabs: [
    { id: 'orig-tab', url: 'https://a.com', title: 'A', pinned: true, savedAt: 5, chromeGroupIdx: 0 },
    { id: 'orig-tab2', url: 'https://b.com', title: 'B', pinned: false, savedAt: 5, chromeGroupIdx: null },
  ],
};

describe('parseJsonImport', () => {
  it('round-trips our own export format', () => {
    const json = buildJsonExport([validGroup]);
    const r = parseJsonImport(json);
    expect(r.errors).toEqual([]);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g.name).toBe('My shelf');
    expect(g.tabs).toHaveLength(2);
    expect(g.chromeGroups[0]!.color).toBe('blue');
    expect(g.tabs[0]!.pinned).toBe(true);
  });

  it('regenerates all ids', () => {
    const r = parseJsonImport(buildJsonExport([validGroup]));
    expect(r.groups[0]!.id).not.toBe('orig-id');
    expect(r.groups[0]!.tabs[0]!.id).not.toBe('orig-tab');
  });

  it('accepts a bare array of groups', () => {
    const r = parseJsonImport(JSON.stringify([validGroup]));
    expect(r.groups).toHaveLength(1);
  });

  it('rejects non-JSON and wrong shapes with errors, never throws', () => {
    expect(parseJsonImport('{{{').errors.length).toBeGreaterThan(0);
    expect(parseJsonImport('"a string"').errors.length).toBeGreaterThan(0);
    expect(parseJsonImport('42').errors.length).toBeGreaterThan(0);
  });

  it('skips hostile tabs: dangerous urls, wrong types, missing url', () => {
    const hostile = JSON.stringify({
      groups: [
        {
          name: 'x',
          tabs: [
            { url: 'javascript:alert(1)', title: 'evil' },
            { url: 12345, title: 'not-a-string' },
            { title: 'no url' },
            { url: 'https://fine.com', title: 'ok' },
          ],
        },
      ],
    });
    const r = parseJsonImport(hostile);
    expect(r.groups[0]!.tabs).toHaveLength(1);
    expect(r.groups[0]!.tabs[0]!.url).toBe('https://fine.com');
    expect(r.skipped).toBe(3);
  });

  it('ignores prototype-pollution keys safely', () => {
    const hostile = JSON.stringify({
      groups: [
        {
          name: 'x',
          __proto__: { hacked: true },
          constructor: { prototype: { hacked: true } },
          tabs: [{ url: 'https://a.com', title: 'a', __proto__: { hacked: true } }],
        },
      ],
    });
    const r = parseJsonImport(hostile);
    expect(r.groups).toHaveLength(1);
    expect(({} as Record<string, unknown>)['hacked']).toBeUndefined();
    expect((r.groups[0] as unknown as Record<string, unknown>)['hacked']).toBeUndefined();
  });

  it('clamps oversized strings', () => {
    const r = parseJsonImport(
      JSON.stringify({ groups: [{ name: 'n'.repeat(10_000), tabs: [{ url: 'https://a.com/' + 'p'.repeat(20_000), title: 't'.repeat(20_000) }] }] }),
    );
    expect(r.groups[0]!.name.length).toBeLessThanOrEqual(512);
    expect(r.groups[0]!.tabs[0]!.url.length).toBeLessThanOrEqual(8192);
    expect(r.groups[0]!.tabs[0]!.title.length).toBeLessThanOrEqual(2048);
  });

  it('nullifies out-of-range chromeGroupIdx', () => {
    const r = parseJsonImport(
      JSON.stringify({ groups: [{ name: 'x', chromeGroups: [], tabs: [{ url: 'https://a.com', title: 'a', chromeGroupIdx: 5 }] }] }),
    );
    expect(r.groups[0]!.tabs[0]!.chromeGroupIdx).toBeNull();
  });

  it('coerces invalid tab-group colors to grey', () => {
    const r = parseJsonImport(
      JSON.stringify({ groups: [{ name: 'x', chromeGroups: [{ title: 'g', color: 'neon', collapsed: 'yes' }], tabs: [{ url: 'https://a.com', title: 'a' }] }] }),
    );
    expect(r.groups[0]!.chromeGroups[0]!.color).toBe('grey');
    expect(r.groups[0]!.chromeGroups[0]!.collapsed).toBe(false);
  });
});
