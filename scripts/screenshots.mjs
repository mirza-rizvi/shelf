// Generates Chrome Web Store screenshots (1280×800) and a 440×280 promo tile
// by driving the system Chrome with the built extension loaded.
// Prereq (once): npx playwright install chromium
// Run: npm run build && node scripts/screenshots.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/** Unpacked extension IDs are deterministic: first 16 bytes of
 * sha256(absolute path), each nibble mapped to a–p. */
function unpackedExtensionId(absPath) {
  const hash = createHash('sha256').update(absPath, 'utf8').digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'dist', 'chrome-mv3');
const outDir = join(root, 'store-assets');
mkdirSync(outDir, { recursive: true });

const now = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function tab(id, url, title, savedAt, pinned = false, chromeGroupIdx = null) {
  return { id, url, title, pinned, savedAt, chromeGroupIdx };
}

const demoGroups = [
  {
    id: 'demo-1',
    name: 'Window · Aug 3, 11:24 AM · 8 tabs',
    createdAt: now - 2 * HOUR,
    updatedAt: now - 2 * HOUR,
    chromeGroups: [{ title: 'Research', color: 'blue', collapsed: false }],
    tabs: [
      tab('t1', 'https://developer.chrome.com/docs/extensions', 'Chrome Extensions documentation', now - 2 * HOUR, false, 0),
      tab('t2', 'https://developer.mozilla.org/en-US/docs/Web/API', 'Web APIs | MDN', now - 2 * HOUR, false, 0),
      tab('t3', 'https://en.wikipedia.org/wiki/Tab_(interface)', 'Tab (interface) - Wikipedia', now - 2 * HOUR),
      tab('t4', 'https://news.ycombinator.com/', 'Hacker News', now - 2 * HOUR),
      tab('t5', 'https://github.com/wxt-dev/wxt', 'wxt-dev/wxt: Next-gen Web Extension Framework', now - 2 * HOUR),
      tab('t6', 'https://react.dev/learn', 'Quick Start – React', now - 2 * HOUR),
      tab('t7', 'https://www.typescriptlang.org/docs/', 'TypeScript Documentation', now - 2 * HOUR),
      tab('t8', 'https://vite.dev/guide/', 'Getting Started | Vite', now - 2 * HOUR, true),
    ],
  },
  {
    id: 'demo-2',
    name: 'Trip planning',
    createdAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY,
    chromeGroups: [],
    tabs: [
      tab('t9', 'https://en.wikipedia.org/wiki/Kyoto', 'Kyoto - Wikipedia', now - 3 * DAY),
      tab('t10', 'https://www.japan-guide.com/e/e2158.html', 'Kyoto Travel Guide', now - 3 * DAY),
      tab('t11', 'https://www.seat61.com/japan.htm', 'Train travel in Japan | The Man in Seat 61', now - 3 * DAY),
      tab('t12', 'https://www.xe.com/currencyconverter/', 'Currency Converter | Xe', now - 3 * DAY),
    ],
  },
  {
    id: 'demo-3',
    name: 'Weekend reading',
    createdAt: now - 9 * DAY,
    updatedAt: now - 9 * DAY,
    chromeGroups: [],
    tabs: [
      tab('t13', 'https://www.gutenberg.org/ebooks/1342', 'Pride and Prejudice by Jane Austen', now - 9 * DAY),
      tab('t14', 'https://longreads.com/', 'Longreads: The best longform stories on the web', now - 9 * DAY),
      tab('t15', 'https://paulgraham.com/articles.html', 'Essays - Paul Graham', now - 9 * DAY),
    ],
  },
];

const seed = {
  meta: { schemaVersion: 4, installedAt: now - 30 * DAY },
  index: { groupOrder: ['demo-1', 'demo-2', 'demo-3'], updatedAt: now - 2 * HOUR },
  'group:demo-1': demoGroups[0],
  'group:demo-2': demoGroups[1],
  'group:demo-3': demoGroups[2],
};

const userDataDir = join(tmpdir(), `shelf-shots-${Date.now()}`);
// Branded Chrome 137+ removed --load-extension; Playwright's Chromium keeps it.
// channel:'chromium' selects full Chromium (new headless) — the headless shell
// doesn't support extensions.
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

try {
  // Prefer the live service worker's origin; fall back to the deterministic id.
  let extId = null;
  for (let i = 0; i < 20 && !extId; i++) {
    const [sw] = context.serviceWorkers();
    if (sw) extId = new URL(sw.url()).host;
    else await new Promise((r) => setTimeout(r, 250));
  }
  extId ??= unpackedExtensionId(extPath);
  const managerUrl = `chrome-extension://${extId}/manager.html`;
  console.log('extension id:', extId);

  const page = await context.newPage();
  await page.goto(managerUrl, { waitUntil: 'domcontentloaded' });
  // Seed demo shelves, then reload for a clean render.
  await page.evaluate(async (data) => {
    await chrome.storage.local.set(data);
  }, seed);

  const shoot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, name) });
    console.log('wrote store-assets/' + name);
  };

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${managerUrl}#/`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'networkidle' });
  await shoot('1-manager-light.png');

  await page.emulateMedia({ colorScheme: 'dark' });
  await shoot('2-manager-dark.png');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${managerUrl}#/settings`, { waitUntil: 'domcontentloaded' });
  // Show the tab-limit section expanded (checkbox reveals the max-tabs field).
  await page.check('#limit-enabled').catch(() => {});
  await page.waitForTimeout(300);
  await shoot('3-settings.png');

  // Promo tile 440×280.
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`
    <style>
      html,body{margin:0;height:100%;}
      .tile{width:440px;height:280px;background:#0f766e;display:flex;flex-direction:column;
        align-items:center;justify-content:center;font-family:-apple-system,'Segoe UI',sans-serif;gap:10px;}
      h1{color:#f7f6f3;font-size:44px;margin:0;letter-spacing:-0.5px;}
      p{color:#c9e7e3;font-size:16px;margin:0;}
      img{width:72px;height:72px;border-radius:16px;}
    </style>
    <div class="tile">
      <img src="data:image/png;base64,${readFileSync(join(root, 'public/icon/128.png')).toString('base64')}">
      <h1>Shelf</h1>
      <p>Save your tabs. Keep your privacy.</p>
    </div>`);
  await tile.waitForTimeout(300);
  await tile.screenshot({ path: join(outDir, 'promo-tile-440x280.png') });
  console.log('wrote store-assets/promo-tile-440x280.png');
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
