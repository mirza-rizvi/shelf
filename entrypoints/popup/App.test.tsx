import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
