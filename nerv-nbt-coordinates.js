#!/usr/bin/env node
"use strict";

/*
 * Reads Minecraft NBT structure files and prints every block's original
 * coordinates plus Nerv Printer-style normalized map coordinates.
 *
 * Usage:
 *   node nerv-nbt-coordinates.js schematic.zip
 *   node nerv-nbt-coordinates.js schematic.zip --top-layer
 *   node nerv-nbt-coordinates.js schematic.zip --csv coordinates.csv
 *
 * Supports .nbt (GZIP or raw) and ZIP archives containing .nbt files.
 * No external npm packages are required.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const input = process.argv[2];
const onlyTop = process.argv.includes("--top-layer");
const csvIndex = process.argv.indexOf("--csv");
const csvFile = csvIndex >= 0 ? process.argv[csvIndex + 1] : null;

if (!input) {
  console.error("Usage: node nerv-nbt-coordinates.js <file.nbt|archive.zip> [--top-layer] [--csv output.csv]");
  process.exit(1);
}
if (csvIndex >= 0 && !csvFile) {
  console.error("Missing CSV filename after --csv.");
  process.exit(1);
}

function unzipEntries(filePath) {
  const b = fs.readFileSync(filePath);
  let eocd = -1;
  for (let i = Math.max(0, b.length - 65557); i <= b.length - 22; i++) {
    if (b.readUInt32LE(i) === 0x06054b50) eocd = i;
  }
  if (eocd < 0) throw new Error("Not a valid ZIP (EOCD not found).");

  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) throw new Error("Invalid ZIP directory entry.");
    const method = b.readUInt16LE(off + 10);
    const compressedSize = b.readUInt32LE(off + 20);
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const localOffset = b.readUInt32LE(off + 42);
    const name = b.toString("utf8", off + 46, off + 46 + nameLen);

    if (!name.endsWith("/") && name.toLowerCase().endsWith(".nbt")) {
      if (b.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid local ZIP header: " + name);
      const localNameLen = b.readUInt16LE(localOffset + 26);
      const localExtraLen = b.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = b.subarray(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error("Unsupported ZIP compression method " + method);
      entries.push({ name, data });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decompressNbt(buffer) {
  return buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;
}

class NBTReader {
  constructor(buffer) { this.b = buffer; this.i = 0; }
  need(n) { if (this.i + n > this.b.length) throw new Error("Unexpected end of NBT."); }
  u8() { this.need(1); return this.b.readUInt8(this.i++); }
  i8() { this.need(1); return this.b.readInt8(this.i++); }
  i16() { this.need(2); const v = this.b.readInt16BE(this.i); this.i += 2; return v; }
  u16() { this.need(2); const v = this.b.readUInt16BE(this.i); this.i += 2; return v; }
  i32() { this.need(4); const v = this.b.readInt32BE(this.i); this.i += 4; return v; }
  i64() { this.need(8); const v = this.b.readBigInt64BE(this.i); this.i += 8; return v.toString(); }
  f32() { this.need(4); const v = this.b.readFloatBE(this.i); this.i += 4; return v; }
  f64() { this.need(8); const v = this.b.readDoubleBE(this.i); this.i += 8; return v; }
  str() {
    const n = this.u16(); this.need(n);
    const s = this.b.toString("utf8", this.i, this.i + n); this.i += n; return s;
  }
  payload(type) {
    switch (type) {
      case 1: return this.i8();
      case 2: return this.i16();
      case 3: return this.i32();
      case 4: return this.i64();
      case 5: return this.f32();
      case 6: return this.f64();
      case 7: {
        const n = this.i32(); this.need(n);
        const v = this.b.subarray(this.i, this.i + n); this.i += n; return v;
      }
      case 8: return this.str();
      case 9: {
        const typeOfItems = this.u8(), n = this.i32(), list = [];
        for (let i = 0; i < n; i++) list.push(this.payload(typeOfItems));
        return list;
      }
      case 10: {
        const obj = {};
        while (true) {
          const tag = this.u8();
          if (tag === 0) break;
          obj[this.str()] = this.payload(tag);
        }
        return obj;
      }
      case 11: {
        const n = this.i32(), list = [];
        for (let i = 0; i < n; i++) list.push(this.i32());
        return list;
      }
      case 12: {
        const n = this.i32(), list = [];
        for (let i = 0; i < n; i++) list.push(this.i64());
        return list;
      }
      default: throw new Error("Unknown NBT tag type " + type);
    }
  }
  readRoot() {
    if (this.u8() !== 10) throw new Error("NBT root is not a compound.");
    const rootName = this.str();
    return { rootName, root: this.payload(10) };
  }
}

function getRows(entry) {
  const { root } = new NBTReader(decompressNbt(entry.data)).readRoot();
  const palette = root.palette || root.blocks?.palette || [];
  const blockList = Array.isArray(root.blocks) ? root.blocks : [];
  const parsed = [];
  let minX = Infinity, maxZ = -Infinity, maxY = -Infinity;

  for (const block of blockList) {
    if (!Array.isArray(block?.pos) || !Number.isInteger(block.state)) continue;
    const [x, y, z] = block.pos.map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;
    minX = Math.min(minX, x);
    maxZ = Math.max(maxZ, z);
    maxY = Math.max(maxY, y);
    parsed.push({ x, y, z, state: block.state });
  }
  if (!parsed.length) return [];

  // Nerv Printer map-grid normalization convention:
  const zOffset = maxZ - 127;
  return parsed.map(block => {
    const paletteEntry = palette[block.state] || {};
    const name = paletteEntry.Name || paletteEntry.name || "palette_state_" + block.state;
    return {
      file: entry.name,
      block: name,
      state: block.state,
      nbtX: block.x, nbtY: block.y, nbtZ: block.z,
      printerX: block.x - minX,
      printerY: block.y,
      printerZ: block.z - zOffset,
      topLayer: block.y === maxY,
      properties: JSON.stringify(paletteEntry.Properties || paletteEntry.properties || {})
    };
  }).filter(row => !onlyTop || row.topLayer);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const ext = path.extname(input).toLowerCase();
const entries = ext === ".zip"
  ? unzipEntries(input)
  : ext === ".nbt"
    ? [{ name: path.basename(input), data: fs.readFileSync(input) }]
    : (() => { throw new Error("Input must be a .nbt or .zip file."); })();

const rows = [];
for (const entry of entries) {
  try { rows.push(...getRows(entry)); }
  catch (error) { console.error("Skipped " + entry.name + ": " + error.message); }
}

if (csvFile) {
  const columns = ["file", "block", "state", "nbtX", "nbtY", "nbtZ", "printerX", "printerY", "printerZ", "topLayer", "properties"];
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map(key => csvEscape(row[key])).join(","));
  fs.writeFileSync(csvFile, lines.join("\n") + "\n");
  console.log("Wrote " + rows.length + " block records to " + csvFile);
} else {
  for (const row of rows) {
    console.log(row.block + " | NBT x=" + row.nbtX + " y=" + row.nbtY + " z=" + row.nbtZ +
      " | printer x=" + row.printerX + " y=" + row.printerY + " z=" + row.printerZ +
      (row.topLayer ? " | TOP MAP LAYER" : ""));
  }
  console.log("\nTotal block records: " + rows.length);
}
