import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ToastProvider } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import { DEFAULT_SETTINGS } from '../../../lib/constants';
import { Home } from './Home';

const data: ShelfData = {
  groups: [{
    id: 'g1', name: 'Research', workspaceId: 'inbox', createdAt: 1, updatedAt: 1, chromeGroups: [],
    tabs: [
      { id: 't1', url: 'https://docs.example.com/a', title: 'Docs', pinned: false, savedAt: 1, chromeGroupIdx: null },
      { id: 't2', url: 'https://news.example.com/b', title: 'News', pinned: false, savedAt: 2, chromeGroupIdx: null },
    ],
  }],
  settings: DEFAULT_SETTINGS,
  trash: [],
  trashBatches: [],
  workspaces: [{ id: 'inbox', name: 'Inbox', createdAt: 1, updatedAt: 1 }],
  loading: false,
  loadError: false,
  refresh: () => {},
};

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

describe('Home URL-list controls', () => {
  it('shows domain/sort/density controls and selects matching results only', () => {
    render(<ToastProvider><Home data={data} /></ToastProvider>);
    expect(screen.getByRole('combobox', { name: 'Filter by domain' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Sort sessions' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Sort tabs' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDefined();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by domain' }), { target: { value: 'docs.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select results (1)' }));
    expect(screen.getByText('1 selected')).toBeDefined();
    expect(document.querySelectorAll('.tab-row')).toHaveLength(1);
  });

  it('collapses and expands all visible sessions', () => {
    render(<ToastProvider><Home data={data} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(document.querySelectorAll('.tab-row')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(document.querySelectorAll('.tab-row')).toHaveLength(2);
  });
});
