import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SavedGroup } from '../lib/types';
import { GroupCard } from './GroupCard';

function makeGroup(urls: string[]): SavedGroup {
  return {
    id: 'g1',
    name: 'Shelf one',
    createdAt: 1,
    updatedAt: 1,
    chromeGroups: [],
    tabs: urls.map((url, i) => ({
      id: `t${i}`,
      url,
      title: `Title ${i}`,
      pinned: false,
      savedAt: 1,
      chromeGroupIdx: null,
    })),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

// vitest runs without globals, so RTL's auto-cleanup hook never registers.
afterEach(cleanup);

describe('GroupCard rendering', () => {
  it('renders a row per tab with its hostname', () => {
    render(
      <GroupCard
        group={makeGroup(['https://a.example.com/x', 'https://b.example.com/y'])}
      />,
    );

    expect(document.querySelectorAll('.tab-row')).toHaveLength(2);
    expect(screen.getByText('a.example.com')).toBeDefined();
    expect(screen.getByText('b.example.com')).toBeDefined();
  });

  it('marks unrestorable URLs blocked (copy-only)', () => {
    render(
      <GroupCard
        group={makeGroup(['javascript:alert(1)', 'https://ok.example.com/'])}
      />,
    );

    expect(document.querySelectorAll('.tab-row.blocked')).toHaveLength(1);
  });

  it('shows only matching tabs while a search is active', () => {
    const group = makeGroup(['https://a.com/', 'https://b.com/', 'https://c.com/']);
    render(
      <GroupCard group={group} tabs={[group.tabs[1]!]} />,
    );

    expect(document.querySelectorAll('.tab-row')).toHaveLength(1);
    expect(screen.getByText('1 of 3')).toBeDefined();
  });

  it('caps a pathological shelf at 300 mounted rows behind a "show all"', { timeout: 30_000 }, () => {
    const urls = Array.from({ length: 420 }, (_, i) => `https://site${i}.example/`);
    render(
      <GroupCard group={makeGroup(urls)} />,
    );

    expect(document.querySelectorAll('.tab-row')).toHaveLength(300);
    // The full count is still reported, so nothing looks lost.
    expect(screen.getByText('420 tabs')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show all 420 tabs' })).toBeDefined();
  });

  it('drops the tab rows entirely while collapsed', () => {
    render(
      <GroupCard
        group={makeGroup(['https://a.com/', 'https://b.com/'])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse session' }));
    expect(document.querySelectorAll('.tab-row')).toHaveLength(0);
  });

  it('uses one fixed row layout with the full URL available on hover', () => {
    const group = makeGroup(['https://example.com/full/path']);
    render(<GroupCard group={group} />);
    expect(document.querySelector('.tab-url')).toBeNull();
    expect(document.querySelector('.tab-info')?.getAttribute('title')).toBe('https://example.com/full/path');
  });

  it('shows only restore and recoverable delete actions, with no selection or drag UI', () => {
    render(<GroupCard group={makeGroup(['https://a.com/'])} />);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(document.querySelector('.group-card')?.hasAttribute('draggable')).toBe(false);
    expect(document.querySelector('.tab-row')?.hasAttribute('draggable')).toBe(false);
  });
});
