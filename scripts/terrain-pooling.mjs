#!/usr/bin/env node
// Terrain pooling diagnostic for the Barcelona metro.
//
// Reads the ICGC 5 m terrain model (terrain-RGB tiles, zoom 12), coarsens it
// to ~150 m cells, fills depressions with priority-flood and classifies each
// cell by depression depth and slope. Output is a small RGBA PNG overlay plus
// a JSON meta file. Terrain only: no rain, no drains, not a simulation.
//
// Built-ins only. Tiles are cached under the scratchpad so reruns are offline.
//
//   node scripts/terrain-pooling.mjs

import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { inflateSync, deflateSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "data");

const TILE_URL = "https://geoserveis.icgc.cat/servei/catalunya/contextmaps-terreny-5m-rgb/wmts/{z}/{x}/{y}.png";
const Z = 12;
const TILE = 512; // the ICGC WMTS serves 512 px tiles at z12 (verified on decode)
const BOUNDS = { west: 1.9, south: 41.2, east: 2.4, north: 41.62 }; // same as data/relief.json
const CACHE_DIR = process.env.TERRAIN_TILE_CACHE
  || "/private/tmp/claude-501/-Users-magickappa-Code-hackathon-barcelona/e66d09f6-769a-41f4-a106-b040bec418fa/scratchpad/tiles";
const TARGET_CELL_METERS = 150;
const CONCURRENCY = 4;

const THRESHOLDS = {
  seaElevationMeters: 0.5, // cells below this are sea or outside the model
  depressionHighMeters: 0.5,
  depressionModerateMeters: 0.2,
  depressionLowMeters: 0.05,
  flatSlope: 0.01, // m/m, central-difference gradient magnitude
  lowlandMeters: 15, // flat lowland: slope < flatSlope and elevation < lowlandMeters
};

const CLASSES = {
  low: { alpha: 70, rgb: [43, 108, 176], rule: "depression >= 0.05 m, or flat lowland (slope < 0.01 and elevation < 15 m)" },
  moderate: { alpha: 120, rgb: [43, 108, 176], rule: "depression >= 0.2 m" },
  high: { alpha: 175, rgb: [43, 108, 176], rule: "depression >= 0.5 m" },
};

// ---------- Web Mercator helpers ----------
const n = 2 ** Z;
const d2r = Math.PI / 180;
function lonToPx(lon) { return ((lon + 180) / 360) * n * TILE; }
function latToPx(lat) {
  const s = Math.sin(lat * d2r);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE;
}
function pxToLon(px) { return (px / (n * TILE)) * 360 - 180; }
function pxToLat(py) {
  const y = 0.5 - py / (n * TILE);
  return (Math.atan(Math.sinh(y * 2 * Math.PI)) / d2r);
}

// ---------- tile fetching ----------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function fetchTile(x, y) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${Z}-${x}-${y}.png`);
  if (existsSync(file) && statSync(file).size > 0) return readFileSync(file);
  const url = TILE_URL.replace("{z}", Z).replace("{x}", x).replace("{y}", y);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    try {
      const res = await fetch(url, { headers: { "user-agent": "barcelona-next-rain terrain-pooling (node)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      let buf = Buffer.from(await res.arrayBuffer());
      // Node fetch decompresses gzip bodies itself. Belt and braces: if the
      // body still carries a gzip header, inflate it here.
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      if (!buf.subarray(0, 8).equals(PNG_SIG)) {
        throw new Error(`Not a PNG (first bytes ${buf.subarray(0, 8).toString("hex")}) from ${url}`);
      }
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      if (/Not a PNG/.test(String(e))) break;
    }
  }
  throw lastErr;
}

async function pool(items, worker, limit) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ---------- PNG decode ----------
function crcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("bad PNG signature");
  let pos = 8;
  let width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType} (need RGB or RGBA)`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length !== (stride + 1) * height) throw new Error("unexpected IDAT length");
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = y ? dst - stride : -1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = prev >= 0 ? out[prev + x] : 0;
      const c = prev >= 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let v = raw[src + x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      out[dst + x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

// ---------- PNG encode (RGBA, filter 0) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePngRgba(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- priority flood ----------
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return [topK, topV];
  }
}

function priorityFlood(elev, sea, w, h) {
  const filled = new Float64Array(elev);
  const seen = new Uint8Array(w * h);
  const heap = new MinHeap();
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (sea[i] || x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      seen[i] = 1;
      heap.push(filled[i], i);
    }
  }
  while (heap.size) {
    const [lvl, i] = heap.pop();
    const x = i % w, y = (i / w) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < w - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - w);
    if (y < h - 1) nb.push(i + w);
    for (const j of nb) {
      if (seen[j]) continue;
      seen[j] = 1;
      if (filled[j] < lvl) filled[j] = lvl;
      heap.push(filled[j], j);
    }
  }
  return filled;
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const x0 = Math.floor(lonToPx(BOUNDS.west) / TILE);
  const x1 = Math.floor(lonToPx(BOUNDS.east) / TILE);
  const y0 = Math.floor(latToPx(BOUNDS.north) / TILE);
  const y1 = Math.floor(latToPx(BOUNDS.south) / TILE);
  const tiles = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) tiles.push([tx, ty]);
  console.log(`z${Z} tiles x ${x0}..${x1}, y ${y0}..${y1} (${tiles.length} tiles)`);

  const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
  const W = cols * TILE, H = rows * TILE;
  const mosaic = new Float32Array(W * H);

  let fetched = 0;
  await pool(tiles, async ([tx, ty]) => {
    const buf = await fetchTile(tx, ty);
    const png = decodePng(buf);
    if (png.width !== TILE || png.height !== TILE) throw new Error(`tile ${tx}/${ty} is ${png.width}x${png.height}`);
    const ox = (tx - x0) * TILE, oy = (ty - y0) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const p = (y * TILE + x) * png.bpp;
        const r = png.data[p], g = png.data[p + 1], b = png.data[p + 2];
        mosaic[(oy + y) * W + ox + x] = -10000 + (r * 65536 + g * 256 + b) * 0.1;
      }
    }
    fetched++;
    if (fetched % 10 === 0 || fetched === tiles.length) console.log(`  decoded ${fetched}/${tiles.length}`);
  }, CONCURRENCY);

  // Crop to bounds in pixel space (relative to the mosaic origin).
  const originPx = x0 * TILE, originPy = y0 * TILE;
  const cropX0 = Math.floor(lonToPx(BOUNDS.west)) - originPx;
  const cropX1 = Math.ceil(lonToPx(BOUNDS.east)) - originPx;
  const cropY0 = Math.floor(latToPx(BOUNDS.north)) - originPy;
  const cropY1 = Math.ceil(latToPx(BOUNDS.south)) - originPy;

  // Coarsen. Real metres per z12 pixel at the centre latitude.
  const midLat = (BOUNDS.north + BOUNDS.south) / 2;
  const mPerPx = (40075016.686 * Math.cos(midLat * d2r)) / (n * TILE);
  const cellPx = Math.max(1, Math.round(TARGET_CELL_METERS / mPerPx));
  const cellMeters = +(cellPx * mPerPx).toFixed(1);
  const gw = Math.floor((cropX1 - cropX0) / cellPx);
  const gh = Math.floor((cropY1 - cropY0) / cellPx);
  console.log(`${mPerPx.toFixed(2)} m/px, cell ${cellPx}x${cellPx} px = ${cellMeters} m, grid ${gw}x${gh}`);

  // Exact bounds of the coarse grid, from the pixel crop.
  const gridPx0 = originPx + cropX0, gridPx1 = gridPx0 + gw * cellPx;
  const gridPy0 = originPy + cropY0, gridPy1 = gridPy0 + gh * cellPx;
  const bounds = [pxToLon(gridPx0), pxToLat(gridPy1), pxToLon(gridPx1), pxToLat(gridPy0)].map((v) => +v.toFixed(6));

  const elev = new Float64Array(gw * gh);
  const sea = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0;
      for (let dy = 0; dy < cellPx; dy++) {
        const row = (cropY0 + gy * cellPx + dy) * W + cropX0 + gx * cellPx;
        for (let dx = 0; dx < cellPx; dx++) sum += mosaic[row + dx];
      }
      const e = sum / (cellPx * cellPx);
      elev[gy * gw + gx] = e;
      if (e < THRESHOLDS.seaElevationMeters) sea[gy * gw + gx] = 1;
    }
  }

  const filled = priorityFlood(elev, sea, gw, gh);

  const counts = { low: 0, moderate: 0, high: 0, none: 0, sea: 0 };
  const rgba = Buffer.alloc(gw * gh * 4);
  const [cr, cg, cb] = CLASSES.low.rgb;
  const classOf = new Uint8Array(gw * gh); // 0 none, 1 low, 2 moderate, 3 high, 4 sea
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      if (sea[i]) { counts.sea++; classOf[i] = 4; continue; }
      const dep = filled[i] - elev[i];
      const xl = elev[gx > 0 ? i - 1 : i], xr = elev[gx < gw - 1 ? i + 1 : i];
      const yu = elev[gy > 0 ? i - gw : i], yd = elev[gy < gh - 1 ? i + gw : i];
      const dxSpan = (gx > 0 ? 1 : 0) + (gx < gw - 1 ? 1 : 0);
      const dySpan = (gy > 0 ? 1 : 0) + (gy < gh - 1 ? 1 : 0);
      const sx = dxSpan ? (xr - xl) / (dxSpan * cellMeters) : 0;
      const sy = dySpan ? (yd - yu) / (dySpan * cellMeters) : 0;
      const slope = Math.hypot(sx, sy);
      let cls = null;
      if (dep >= THRESHOLDS.depressionHighMeters) cls = "high";
      else if (dep >= THRESHOLDS.depressionModerateMeters) cls = "moderate";
      else if (dep >= THRESHOLDS.depressionLowMeters || (slope < THRESHOLDS.flatSlope && elev[i] < THRESHOLDS.lowlandMeters)) cls = "low";
      if (!cls) { counts.none++; continue; }
      counts[cls]++;
      classOf[i] = cls === "low" ? 1 : cls === "moderate" ? 2 : 3;
      const o = i * 4;
      rgba[o] = cr; rgba[o + 1] = cg; rgba[o + 2] = cb; rgba[o + 3] = CLASSES[cls].alpha;
    }
  }

  // Sanity checks.
  const probe = { lon: 2.1705, lat: 41.3846, name: "La Rambla / Raval" };
  const pgx = Math.floor((lonToPx(probe.lon) - gridPx0) / cellPx);
  const pgy = Math.floor((latToPx(probe.lat) - gridPy0) / cellPx);
  const pi = pgy * gw + pgx;
  if (pgx < 0 || pgy < 0 || pgx >= gw || pgy >= gh) throw new Error("probe outside grid");
  if (sea[pi]) throw new Error(`${probe.name} classified as sea (elev ${elev[pi].toFixed(2)} m)`);
  const land = counts.low + counts.moderate + counts.high + counts.none;
  const flaggedShare = (counts.low + counts.moderate + counts.high) / land;
  if (flaggedShare < 0.02 || flaggedShare > 0.4) {
    throw new Error(`flagged share ${(flaggedShare * 100).toFixed(1)} % is outside 2..40 %`);
  }
  console.log(`${probe.name}: elev ${elev[pi].toFixed(1)} m, depression ${(filled[pi] - elev[pi]).toFixed(2)} m, class ${["none", "low", "moderate", "high", "sea"][classOf[pi]]}`);
  console.log(`counts`, counts, `flagged ${(flaggedShare * 100).toFixed(1)} % of land`);

  const png = encodePngRgba(gw, gh, rgba);
  if (png.length > 100 * 1024) throw new Error(`PNG is ${png.length} bytes, over 100 KB`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "terrain-pooling.png"), png);

  const meta = {
    kind: "terrain_diagnostic",
    label: "Where terrain pools water",
    source: "ICGC 5 m terrain model (terrain-RGB tiles, zoom 12)",
    sourceUrl: "https://www.icgc.cat/",
    image: "terrain-pooling.png",
    bounds,
    cellMeters,
    classes: CLASSES,
    thresholds: THRESHOLDS,
    method: `Priority-flood sink filling on ~${Math.round(cellMeters)} m cells gives the depression depth (filled minus original elevation) and a central-difference slope per cell; cells are classed by depth, with flat lowland added at the low tier. Terrain shape only, no rain, no drainage and no runoff: a diagnostic of where ground can hold water, not a simulation of flooding.`,
    counts,
    generated: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "terrain-pooling.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`wrote data/terrain-pooling.png (${png.length} bytes) and data/terrain-pooling.json in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`bounds`, bounds, `cellMeters ${cellMeters}`);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
