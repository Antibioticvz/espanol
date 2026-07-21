#!/usr/bin/env node
// Strip the alpha channel from an 8-bit RGBA PNG, producing a plain RGB PNG.
// Needed because the App Store rejects iOS app icons that carry an alpha
// channel, but our SVG->PNG rasterizer (qlmanage QuickLook thumbnails)
// always emits RGBA, and `sips` has no flag to drop the channel.
//
// Zero npm dependencies: uses only Node's built-in zlib for inflate/deflate,
// with a hand-rolled CRC32 + PNG scanline filter (un)reconstruction.
//
// Usage: node strip-alpha.mjs <in.png> <out.png>
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: strip-alpha.mjs <in.png> <out.png>");
  process.exit(1);
}

const buf = readFileSync(inPath);
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");

// --- parse chunks ---
let offset = 8;
let ihdr = null;
const idatParts = [];
while (offset < buf.length) {
  const len = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + len);
  if (type === "IHDR") ihdr = data;
  else if (type === "IDAT") idatParts.push(data);
  else if (type === "IEND") break;
  offset += 12 + len;
}
if (!ihdr) throw new Error("no IHDR");

const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const bitDepth = ihdr.readUInt8(8);
const colorType = ihdr.readUInt8(9);
const interlace = ihdr.readUInt8(12);
if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
if (interlace !== 0) throw new Error("interlaced PNG not supported");
if (colorType !== 6 && colorType !== 2) {
  throw new Error(`unsupported color type ${colorType} (expected 6=RGBA or 2=RGB)`);
}
if (colorType === 2) {
  console.log("already RGB (no alpha) - copying as-is");
  writeFileSync(outPath, buf);
  process.exit(0);
}

const srcBpp = 4; // RGBA
const dstBpp = 3; // RGB
const rowBytesSrc = width * srcBpp;
const rowBytesDst = width * dstBpp;

const raw = inflateSync(Buffer.concat(idatParts));
if (raw.length !== (rowBytesSrc + 1) * height) {
  throw new Error(`unexpected raw size ${raw.length}, expected ${(rowBytesSrc + 1) * height}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Unfilter every scanline to get raw RGBA rows (PNG scanlines are each
// delta-encoded against the previous row using one of 5 filter types).
const rows = [];
let prevRow = Buffer.alloc(rowBytesSrc, 0);
let pos = 0;
for (let y = 0; y < height; y++) {
  const filterType = raw[pos];
  pos += 1;
  const filt = raw.subarray(pos, pos + rowBytesSrc);
  pos += rowBytesSrc;
  const recon = Buffer.alloc(rowBytesSrc);
  for (let x = 0; x < rowBytesSrc; x++) {
    const a = x >= srcBpp ? recon[x - srcBpp] : 0;
    const b = prevRow[x];
    const c = x >= srcBpp ? prevRow[x - srcBpp] : 0;
    let v = filt[x];
    switch (filterType) {
      case 0: break;
      case 1: v = (v + a) & 0xff; break;
      case 2: v = (v + b) & 0xff; break;
      case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
      case 4: v = (v + paeth(a, b, c)) & 0xff; break;
      default: throw new Error(`bad filter type ${filterType} at row ${y}`);
    }
    recon[x] = v;
  }
  rows.push(recon);
  prevRow = recon;
}

// Sanity check: warn if the source actually uses partial transparency, since
// dropping the channel here does NOT composite against a background - it
// just discards it. Fine for flat, fully-opaque icon art (our case).
let minAlpha = 255;
for (const row of rows) {
  for (let x = 3; x < rowBytesSrc; x += 4) {
    if (row[x] < minAlpha) minAlpha = row[x];
  }
}
if (minAlpha < 255) {
  console.warn(`WARNING: source has partial transparency (min alpha ${minAlpha}); output will look wrong.`);
}

// Build new raw buffer: RGB rows, filter type 0 (None) for every line.
const newRaw = Buffer.alloc((rowBytesDst + 1) * height);
let outPos = 0;
for (let y = 0; y < height; y++) {
  newRaw[outPos] = 0;
  outPos += 1;
  const row = rows[y];
  for (let x = 0, o = 0; x < rowBytesSrc; x += 4, o += 3) {
    newRaw[outPos + o] = row[x];
    newRaw[outPos + o + 1] = row[x + 1];
    newRaw[outPos + o + 2] = row[x + 2];
  }
  outPos += rowBytesDst;
}

const newIdatData = deflateSync(newRaw, { level: 9 });

// --- CRC32 (standard PNG/zip polynomial); Node's zlib has no public crc32 ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const newIhdr = Buffer.alloc(13);
newIhdr.writeUInt32BE(width, 0);
newIhdr.writeUInt32BE(height, 4);
newIhdr.writeUInt8(8, 8);
newIhdr.writeUInt8(2, 9); // color type 2 = RGB, no alpha
newIhdr.writeUInt8(0, 10);
newIhdr.writeUInt8(0, 11);
newIhdr.writeUInt8(0, 12);

const out = Buffer.concat([
  SIG,
  makeChunk("IHDR", newIhdr),
  makeChunk("IDAT", newIdatData),
  makeChunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${out.length} bytes), color type 2 (RGB, no alpha)`);
