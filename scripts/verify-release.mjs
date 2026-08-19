import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unpackedDir = join(root, 'dist', 'chrome-mv3');
const packagePath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');
const manifestPath = join(unpackedDir, 'manifest.json');
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function filesUnder(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
      else errors.push(`Unexpected non-file release entry: ${relative(root, absolute)}`);
    }
  };
  visit(directory);
  return result.sort();
}

function archiveName(path) {
  return relative(unpackedDir, path).split(sep).join('/');
}

function pngDimensions(path) {
  const png = readFileSync(path);
  check(
    png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `${relative(root, path)} is not a valid PNG`,
  );
  return png.length >= 24
    ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    : { width: 0, height: 0 };
}

function checkPng(path, width, height) {
  try {
    const actual = pngDimensions(path);
    check(
      actual.width === width && actual.height === height,
      `${relative(root, path)} must be ${width}x${height}, got ${actual.width}x${actual.height}`,
    );
  } catch (error) {
    errors.push(`Cannot read ${relative(root, path)}: ${error.message}`);
  }
}

function findEndOfCentralDirectory(zip) {
  const signature = 0x06054b50;
  const earliest = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= earliest; offset -= 1) {
    if (zip.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function readZipEntries(path) {
  const zip = readFileSync(path);
  const eocd = findEndOfCentralDirectory(zip);
  check(eocd >= 0, 'Release ZIP has no valid end-of-central-directory record');
  if (eocd < 0) return { zip, entries: [] };

  const disk = zip.readUInt16LE(eocd + 4);
  const centralDisk = zip.readUInt16LE(eocd + 6);
  const entriesOnDisk = zip.readUInt16LE(eocd + 8);
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  check(disk === 0 && centralDisk === 0 && entriesOnDisk === entryCount, 'Multi-disk ZIP files are not supported');
  check(centralOffset + centralSize <= eocd, 'Release ZIP central directory is malformed');

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
      errors.push(`Release ZIP central entry ${index + 1} is malformed`);
      break;
    }
    const flags = zip.readUInt16LE(offset + 8);
    const compression = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > zip.length) {
      errors.push(`Release ZIP central entry ${index + 1} has an invalid filename`);
      break;
    }
    entries.push({
      name: zip.subarray(nameStart, nameEnd).toString('utf8'),
      size,
      compressedSize,
      flags,
      compression,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  check(offset === centralOffset + centralSize, 'Release ZIP central-directory size does not match its entries');
  return { zip, entries };
}

const pkg = readJson(packagePath);
const packageLock = readJson(packageLockPath);
const manifest = readJson(manifestPath);
const zipPath = join(root, 'dist', `${pkg.name}-${pkg.version}-chrome.zip`);

check(pkg.version === packageLock.packages?.['']?.version, 'package.json and package-lock.json versions differ');
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(manifest.version === pkg.version, 'Built manifest version must match package.json');
check(manifest.name === 'Shelf — Privacy-First Tab Manager', 'Built manifest has an unexpected extension name');
check(manifest.short_name === 'Shelf', 'Built manifest has an unexpected short name');
check(
  typeof manifest.description === 'string' && Array.from(manifest.description).length <= 132,
  'Manifest description must be no more than 132 characters',
);
check(Number.parseInt(manifest.minimum_chrome_version, 10) >= 121, 'Minimum Chrome version must be 121 or newer');
check(manifest.incognito === 'not_allowed', 'Incognito access must remain disabled');
check(
  manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self';",
  'Extension-page CSP must allow scripts and objects from self only',
);

const approvedPermissions = [
  'alarms',
  'contextMenus',
  'favicon',
  'storage',
  'tabGroups',
  'tabs',
  'unlimitedStorage',
];
const actualPermissions = [...(manifest.permissions ?? [])].sort();
check(
  JSON.stringify(actualPermissions) === JSON.stringify(approvedPermissions),
  `Permissions changed: expected ${approvedPermissions.join(', ')}, got ${actualPermissions.join(', ')}`,
);
for (const field of [
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
  'content_scripts',
  'externally_connectable',
  'sandbox',
]) {
  check(manifest[field] === undefined, `Manifest must not contain ${field}`);
}

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
].filter((value) => typeof value === 'string');
for (const path of referencedFiles) {
  try {
    check(statSync(join(unpackedDir, path)).isFile(), `Manifest reference is not a file: ${path}`);
  } catch {
    errors.push(`Manifest references a missing file: ${path}`);
  }
}

for (const size of [16, 32, 48, 128]) {
  checkPng(join(root, 'public', 'icon', `${size}.png`), size, size);
  checkPng(join(unpackedDir, 'icon', `${size}.png`), size, size);
  try {
    check(
      readFileSync(join(root, 'public', 'icon', `${size}.png`)).equals(
        readFileSync(join(unpackedDir, 'icon', `${size}.png`)),
      ),
      `Built ${size}px icon differs from public/icon/${size}.png`,
    );
  } catch {
    // Missing/read errors are already reported by checkPng.
  }
}
checkPng(join(root, 'store-assets', '1-manager-light.png'), 1280, 800);
checkPng(join(root, 'store-assets', '2-manager-dark.png'), 1280, 800);
checkPng(join(root, 'store-assets', '3-settings.png'), 1280, 800);
checkPng(join(root, 'store-assets', 'promo-tile-440x280.png'), 440, 280);

const builtFiles = filesUnder(unpackedDir);
const allowedExtensions = new Set(['.css', '.html', '.js', '.json', '.png']);
const forbiddenPatterns = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\.sendBeacon\s*\(/, 'sendBeacon()'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function'],
];
const allowedRemotePrefixes = ['http://www.w3.org/'];

for (const path of builtFiles) {
  const name = archiveName(path);
  check(allowedExtensions.has(extname(name)), `Unexpected release file type: ${name}`);
  check(!name.endsWith('.map'), `Source map must not ship: ${name}`);
  check(!name.split('/').some((part) => part.startsWith('.')), `Dotfile must not ship: ${name}`);
  check(!name.split('/').includes('node_modules'), `node_modules must not ship: ${name}`);

  if (!['.js', '.html', '.css'].includes(extname(name))) continue;
  const source = readFileSync(path, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    check(!pattern.test(source), `${name} contains forbidden runtime surface ${label}`);
  }
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>\\)]+/g)) {
    check(
      allowedRemotePrefixes.some((prefix) => match[0].startsWith(prefix)),
      `${name} contains a remote URL: ${match[0]}`,
    );
  }
  if (extname(name) === '.html') {
    for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const src = match[1];
      check(!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//'), `${name} loads a remote script: ${src}`);
      const localPath = src.replace(/^\//, '');
      try {
        check(statSync(join(unpackedDir, localPath)).isFile(), `${name} references a missing script: ${src}`);
      } catch {
        errors.push(`${name} references a missing script: ${src}`);
      }
    }
  }
}

const { zip, entries } = readZipEntries(zipPath);
const seenEntries = new Set();
for (const entry of entries) {
  check(!seenEntries.has(entry.name), `Release ZIP contains duplicate entry: ${entry.name}`);
  seenEntries.add(entry.name);
  check(entry.name !== '' && !entry.name.endsWith('/'), `Release ZIP contains a directory entry: ${entry.name}`);
  check(!entry.name.startsWith('/') && !entry.name.includes('\\'), `Release ZIP has an unsafe path: ${entry.name}`);
  check(
    !entry.name.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.')),
    `Release ZIP has an unsafe or hidden path: ${entry.name}`,
  );
  check((entry.flags & 1) === 0, `Release ZIP entry is encrypted: ${entry.name}`);
  check(entry.compression === 0 || entry.compression === 8, `Release ZIP entry uses unexpected compression: ${entry.name}`);
}

const expectedEntries = new Map(builtFiles.map((path) => [archiveName(path), statSync(path).size]));
check(seenEntries.has('manifest.json'), 'manifest.json must be at the root of the release ZIP');
check(![...seenEntries].some((name) => name !== 'manifest.json' && name.endsWith('/manifest.json')), 'Release ZIP must not wrap the extension in a parent directory');
check(entries.length === expectedEntries.size, 'Release ZIP file count differs from the unpacked build');
for (const entry of entries) {
  check(expectedEntries.has(entry.name), `Release ZIP contains an unexpected file: ${entry.name}`);
  check(expectedEntries.get(entry.name) === entry.size, `Release ZIP size differs for ${entry.name}`);
}
for (const name of expectedEntries.keys()) {
  check(seenEntries.has(name), `Release ZIP is missing ${name}`);
}

if (errors.length > 0) {
  console.error(`\nRelease verification failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const unpackedBytes = builtFiles.reduce((sum, path) => sum + statSync(path).size, 0);
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const checksumPath = `${zipPath}.sha256`;
  writeFileSync(checksumPath, `${sha256}  ${basename(zipPath)}\n`);
  console.log('\nRelease verification passed.');
  console.log(`Version: ${pkg.version}`);
  console.log(`Files: ${entries.length}`);
  console.log(`Unpacked: ${(unpackedBytes / 1024).toFixed(2)} kB`);
  console.log(`ZIP: ${(zip.length / 1024).toFixed(2)} kB`);
  console.log(`SHA-256: ${sha256}`);
  console.log(`Checksum: ${relative(root, checksumPath)}`);
}
