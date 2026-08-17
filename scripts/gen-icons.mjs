// Generates Shelf's PNG icons (16/32/48/128) with zero image dependencies:
// draws a rounded square with shelf lines into a raw RGBA buffer and encodes
// a minimal PNG using node's zlib. Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icon');
mkdirSync(outDir, { recursive: true });

const TEAL = [15, 118, 110, 255]; // #0f766e
const CREAM = [247, 246, 243, 255]; // #f7f6f3

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centered box. */
function roundedRectAlpha(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  const insideCore = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (!insideCore) return 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= r - 0.7) return 1;
  if (d >= r + 0.7) return 0;
  return (r + 0.7 - d) / 1.4; // ~antialiased edge
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const pad = size * 0.06;
  const r = size * 0.22;
  // Background rounded square (teal).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectAlpha(x + 0.5, y + 0.5, pad, pad, size - pad, size - pad, r);
      if (a > 0) {
        const i = (y * size + x) * 4;
        buf[i] = TEAL[0];
        buf[i + 1] = TEAL[1];
        buf[i + 2] = TEAL[2];
        buf[i + 3] = Math.round(255 * a);
      }
    }
  }
  // Two shelf boards (cream horizontal bars) with items on top.
  const barH = Math.max(1, size * 0.09);
  const barX0 = size * 0.22;
  const barX1 = size * 0.78;
  const shelves = [size * 0.42, size * 0.68];
  const items = [
    // [centerX, width, heightAboveShelf] per shelf
    [
      [0.32, 0.1, 0.14],
      [0.47, 0.09, 0.11],
      [0.63, 0.12, 0.16],
    ],
    [
      [0.36, 0.12, 0.14],
      [0.58, 0.1, 0.12],
    ],
  ];
  const putRect = (x0, y0, x1, y1, color) => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const covX = Math.min(x + 1, x1) - Math.max(x, x0);
        const covY = Math.min(y + 1, y1) - Math.max(y, y0);
        if (covX <= 0 || covY <= 0) continue;
        const a = Math.min(1, covX) * Math.min(1, covY);
        const i = (y * size + x) * 4;
        if (buf[i + 3] === 0) continue; // stay inside the tile
        buf[i] = Math.round(color[0] * a + buf[i] * (1 - a));
        buf[i + 1] = Math.round(color[1] * a + buf[i + 1] * (1 - a));
        buf[i + 2] = Math.round(color[2] * a + buf[i + 2] * (1 - a));
      }
    }
  };
  shelves.forEach((sy, si) => {
    putRect(barX0, sy, barX1, sy + barH, CREAM);
    for (const [cx, w, h] of items[si]) {
      const x0 = (cx - w / 2) * size;
      const x1 = (cx + w / 2) * size;
      putRect(x0, sy - h * size, x1, sy - size * 0.01, CREAM);
    }
  });
  return encodePng(size, size, buf);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `${size}.png`), drawIcon(size));
  console.log(`wrote public/icon/${size}.png`);
}
