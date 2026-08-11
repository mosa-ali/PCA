// Generates simple placeholder PWA icons (solid background + a rounded
// "shield" glyph approximation via a lighter inset square) as raw PNGs.
// No external dependencies -- hand-rolls a minimal PNG encoder so this
// script has zero install footprint. Placeholder only: swap for real
// brand assets before shipping.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, bg, fg, maskable) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const margin = maskable ? Math.round(size * 0.2) : Math.round(size * 0.14);
  const inset = margin + Math.round(size * 0.1);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const isFg = x > inset && x < size - inset && y > inset && y < size - inset;
      const color = isFg ? fg : bg;
      const px = rowStart + 1 + x * 4;
      raw[px] = color[0];
      raw[px + 1] = color[1];
      raw[px + 2] = color[2];
      raw[px + 3] = 255;
    }
  }
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const bg = [0x1d, 0x4f, 0x4a]; // brand teal
const fg = [0xe8, 0xf5, 0xf3]; // light glyph

writeFileSync(join(outDir, 'icon-192.png'), makePng(192, bg, fg, false));
writeFileSync(join(outDir, 'icon-512.png'), makePng(512, bg, fg, false));
writeFileSync(join(outDir, 'icon-512-maskable.png'), makePng(512, bg, fg, true));

console.log('Generated placeholder PWA icons in', outDir);
