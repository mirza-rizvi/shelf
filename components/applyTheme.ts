import type { Settings } from '../lib/types';
import { KEY_SETTINGS } from '../lib/storage/keys';

/**
 * Apply the stored theme before first paint and keep it in sync. 'system'
 * removes the override so prefers-color-scheme rules win.
 */
export async function applyThemeEarly(): Promise<void> {
  try {
    const res = await chrome.storage.local.get(KEY_SETTINGS);
    const theme = (res[KEY_SETTINGS] as Partial<Settings> | undefined)?.theme ?? 'system';
    setThemeAttribute(theme);
  } catch {
    // default to system
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY_SETTINGS]) return;
    const next = (changes[KEY_SETTINGS].newValue as Partial<Settings> | undefined)?.theme ?? 'system';
    setThemeAttribute(next);
  });
}

export function setThemeAttribute(theme: 'system' | 'light' | 'dark'): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
