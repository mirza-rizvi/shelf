import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ToastProvider } from '../../../components/Toast';
import type { ShelfData } from '../../../components/useStorageData';
import { DEFAULT_SETTINGS } from '../../../lib/constants';
import { Home } from './Home';

const data: ShelfData = {
  groups: [{
    id: 'g1', name: 'Research', createdAt: 1, updatedAt: 1, chromeGroups: [],
    tabs: [
      { id: 't1', url: 'https://docs.example.com/a', title: 'Docs', pinned: false, savedAt: 1, chromeGroupIdx: null },
      { id: 't2', url: 'https://news.example.com/b', title: 'News', pinned: false, savedAt: 2, chromeGroupIdx: null },
    ],
  }],
  settings: DEFAULT_SETTINGS,
  trash: [],
  loading: false,
  loadError: false,
  refresh: () => {},
};

beforeEach(() => fakeBrowser.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Home', () => {
  it('shows only search and recoverable delete-all as page-level controls', () => {
    render(<ToastProvider><Home data={data} /></ToastProvider>);
    const search = screen.getByRole('searchbox', { name: 'Search saved tabs' });
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Compact')).toBeNull();
    expect(screen.queryByText('Collapse all')).toBeNull();
    fireEvent.change(search, { target: { value: 'docs.example.com' } });
    expect(document.querySelectorAll('.tab-row')).toHaveLength(1);
  });

  it('requires modal confirmation before deleting every session', async () => {
    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');
    sendMessage.mockResolvedValue({ ok: true, trashed: 1 } as never);
    render(<ToastProvider><Home data={data} /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete all sessions?' });
    expect(within(dialog).getByText(/move 1 session containing 2 tabs to Trash/i)).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    const reopened = screen.getByRole('alertdialog', { name: 'Delete all sessions?' });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Delete all' }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ cmd: 'trashAll' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('closes the confirmation modal on Escape or backdrop click without deleting', () => {
    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');
    render(<ToastProvider><Home data={data} /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Delete all sessions?' });
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    dialog = screen.getByRole('alertdialog', { name: 'Delete all sessions?' });
    fireEvent.click(dialog);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('prevents duplicate delete-all requests while the first one is running', async () => {
    let resolveMessage: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveMessage = resolve;
    });
    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');
    sendMessage.mockReturnValue(pending as never);
    render(<ToastProvider><Home data={data} /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete all sessions?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete all' });
    fireEvent.click(confirm);

    const busyButton = within(dialog).getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    fireEvent.click(busyButton);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => resolveMessage({ ok: true, trashed: 1 }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('focuses search with the slash shortcut', () => {
    render(<ToastProvider><Home data={data} /></ToastProvider>);
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search saved tabs' }));
  });
});
