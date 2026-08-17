import { defineConfig } from 'wxt';

// Shelf — privacy-first tab manager.
// Zero host_permissions, zero content scripts, zero network egress.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Visible folder (macOS Finder hides dot-folders in the Load-unpacked picker).
  outDir: 'dist',
  // Explicit imports only — auditable code, no auto-import magic.
  imports: false,
  // Drop Vite's modulepreload fetch polyfill (unneeded on Chrome 121+) so the
  // shipped bundle contains literally zero fetch() calls — auditable zero-egress.
  vite: () => ({
    // React swapped for its API-compatible, much smaller twin. The manager page
    // is PINNED OPEN for the whole browser session, so its runtime is resident
    // memory, not a one-off download — this is the one dependency where size
    // and per-component overhead are paid continuously. Source still imports
    // 'react'; delete this block to go back.
    resolve: {
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react-dom/client': 'preact/compat/client',
        'react-dom/test-utils': 'preact/test-utils',
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
    },
    build: {
      modulePreload: {
        polyfill: false,
        // Chrome discards <link rel="modulepreload"> on extension pages
        // ("cross-world extension resource mismatch") and logs warnings —
        // suppress the tag injection entirely. Chunks load via native ESM.
        resolveDependencies: () => [],
      },
    },
  }),
  manifest: {
    name: 'Shelf — Privacy-First Tab Manager',
    short_name: 'Shelf',
    // Chrome Web Store hard limit: 132 characters.
    description:
      'Save open tabs to a private local list and restore them later. No accounts, no cloud, no tracking — data never leaves this device.',
    // tab.lastAccessed (oldest-first eviction fallback) requires Chrome 121+.
    minimum_chrome_version: '121',
    permissions: [
      'tabs',
      'storage',
      'unlimitedStorage',
      'alarms',
      'tabGroups',
      'favicon',
      'contextMenus',
    ],
    commands: {
      'save-window': { suggested_key: { default: 'Alt+Shift+S' }, description: 'Save the current window' },
      'save-selected': { description: 'Save highlighted tabs' },
      'open-manager': { suggested_key: { default: 'Alt+Shift+O' }, description: 'Open Shelf' },
    },
    incognito: 'not_allowed',
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
