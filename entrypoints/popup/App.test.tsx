import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CURRENT_SCHEMA_VERSION } from '../../lib/types';
import { DEFAULT_SETTINGS } from '../../lib/constants';
import { KEY_META, KEY_SETTINGS } from '../../lib/storage/keys';
import App from './App';

beforeEach(() => fakeBrowser.reset());
afterEach(() => cleanup());

describe('popup save actions', () => {
  it('labels the directional saves above/below when the tab strip layout is vertical', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 1 },
      [KEY_SETTINGS]: { ...DEFAULT_SETTINGS, tabStripLayout: 'vertical' },
    });

    render(<App />);

    // findByRole awaits the popup's asynchronous settings load.
    expect(await screen.findByRole('button', { name: 'Save tabs above' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save tabs below' })).toBeTruthy();
    // The four primary actions only; "More save options" stays collapsed.
    const primary = document.querySelector<HTMLDivElement>('.popup > .popup-actions');
    expect(primary).toBeTruthy();
    const actions = within(primary as HTMLElement).getAllByRole('button');
    expect(actions.map((b) => b.textContent)).toEqual([
      'Save this tab',
      'Save tabs above',
      'Save tabs below',
      'Save this window',
    ]);

    expect(screen.queryByRole('button', { name: 'Save tabs to the left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save tabs to the right' })).toBeNull();
  });

  it('keeps the left/right labels by default (missing or malformed settings)', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 1 },
      [KEY_SETTINGS]: { ...DEFAULT_SETTINGS, tabStripLayout: 'diagonal' },
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Save tabs to the left' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save tabs to the right' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save tabs above' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save tabs below' })).toBeNull();
  });
});

describe('popup load budget', () => {
  it('reads no saved sessions until "More save options" is opened', async () => {
    await chrome.storage.local.set({
      [KEY_META]: { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: 1 },
      [KEY_SETTINGS]: DEFAULT_SETTINGS,
      index: { groupOrder: ['g1'], updatedAt: 1 },
      'group:g1': { id: 'g1', name: 'Research', createdAt: 1, updatedAt: 1, tabs: [], chromeGroups: [] },
    });
    const get = vi.spyOn(chrome.storage.local, 'get');

    render(<App />);
    await screen.findByRole('button', { name: 'Save this tab' });
    const readKeys = get.mock.calls.flatMap(([keys]) => (Array.isArray(keys) ? keys : [keys]));
    expect(readKeys.some((k) => typeof k === 'string' && k.startsWith('group:'))).toBe(false);

    const details = document.querySelector<HTMLDetailsElement>('details.popup-more')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByRole('option', { name: 'Research' })).toBeTruthy();
  });
});
