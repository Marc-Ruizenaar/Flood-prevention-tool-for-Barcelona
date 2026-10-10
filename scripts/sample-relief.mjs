import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LAYER = "model-elevacions-terreny-amb-lidar-25cm-2022";
const SHADE = "model-elevacions-terreny-ombrejat-amb-lidar-25cm-2022";
const WMS = "https://geoserveis.icgc.cat/servei/catalunya/elevacions-territorial/wms";
const SPAN = 250;
const BOUNDS = { west: 1.9, south: 41.2, east: 2.4, north: 41.62 };

const DIRS = [
  ["north", 0, 1],
  ["northeast", 1, 1],
  ["east", 1, 0],
  ["southeast", 1, -1],
  ["south", 0, -1],
  ["southwest", -1, -1],
  ["west", -1, 0],
  ["northwest", -1, 1],
];

function mercator(lon, lat) {
  const radius = 6378137;
  const x = (lon * radius * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * radius;
  return [x, y];
}

function walk(value, visit) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }
  for (const item of value) walk(item, visit);
}

function placeOf(geometry) {
  if (geometry.type === "Point") return geometry.coordinates;
  const xs = [];
  const ys = [];
  walk(geometry.coordinates, (lon, lat) => {
    xs.push(lon);
    ys.push(lat);
  });
  const lon = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const lat = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  return [lon, lat];
}

function shift(lon, lat, east, north) {
  const diagonal = east !== 0 && north !== 0;
  const metres = diagonal ? SPAN / Math.SQRT2 : SPAN;
  const latRad = (lat * Math.PI) / 180;
  return [
    lon + (east * metres) / (111320 * Math.cos(latRad)),
    lat + (north * metres) / 111320,
  ];
}

async function elevation(lon, lat) {
  const pad = 0.0004;
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=${LAYER}&QUERY_LAYERS=${LAYER}&STYLES=` +
    `&INFO_FORMAT=application/json&CRS=EPSG:4326` +
    `&BBOX=${lat - pad},${lon - pad},${lat + pad},${lon + pad}` +
    `&WIDTH=101&HEIGHT=101&I=50&J=50`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const body = await response.json();
      const raw = body.features?.[0]?.properties?.Elevació;
      const metres = Number(raw);
      if (!Number.isFinite(metres)) throw new Error(`no elevation at ${lat}, ${lon}`);
      return metres;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

async function hillshade() {
  const [west, south] = mercator(BOUNDS.west, BOUNDS.south);
  const [east, north] = mercator(BOUNDS.east, BOUNDS.north);
  const width = 1800;
  const height = Math.round((width * (north - south)) / (east - west));
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&LAYERS=${SHADE}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&SRS=EPSG:3857` +
    `&WIDTH=${width}&HEIGHT=${height}` +
    `&BBOX=${west},${south},${east},${north}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`hillshade ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("image")) throw new Error(`hillshade content-type ${type}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync("data/relief-hillshade.png", bytes);
  console.log(`hillshade ${width}x${height} ${(bytes.length / 1024).toFixed(0)} KB`);
}

const features = [];
for (const file of readdirSync("data/geojson")) {
  if (!file.endsWith(".geojson")) continue;
  const json = JSON.parse(readFileSync(join("data/geojson", file), "utf8"));
  for (const feature of json.features) {
    if (feature.properties?.tappable === false) continue;
    const id = feature.properties?.id;
    if (typeof id !== "string") continue;
    features.push({ id, at: placeOf(feature.geometry) });
  }
}

await hillshade();

const relief = {};
await pool(features, 6, async ({ id, at }) => {
  const [lon, lat] = at;
  const centre = await elevation(lon, lat);
  const around = [];
  for (const [name, east, north] of DIRS) {
    const [nlon, nlat] = shift(lon, lat, east, north);
    around.push({ name, metres: await elevation(nlon, nlat) });
  }
  const lowest = around.reduce((best, item) => (item.metres < best.metres ? item : best));
  const fall = centre - lowest.metres;
  relief[id] = {
    meters: Math.round(centre),
    fallMeters: Math.round(fall),
    spanMeters: SPAN,
    toward: lowest.name,
    at: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
  };
  console.log(
    `${id.padEnd(28)} ${String(relief[id].meters).padStart(4)} m   fall ${String(relief[id].fallMeters).padStart(4)} m ${lowest.name}`,
  );
});

const ordered = Object.fromEntries(Object.entries(relief).sort(([a], [b]) => a.localeCompare(b)));
const payload = {
  sourceUrl:
    "https://www.icgc.cat/en/Geoinformation-and-Maps/Online-services-Geoservices/WMS-and-WCS-Elevations/WMS-Territorial-elevations",
  model: "AMB lidar terrain model, 2022",
  spanMeters: SPAN,
  bounds: [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north],
  image: "relief-hillshade.png",
  places: ordered,
};
writeFileSync("data/relief.json", `${JSON.stringify(payload, null, 2)}\n`);
const compressed = spawnSync(
  "python3",
  [
    "-c",
    [
      "from PIL import Image",
      "im = Image.open('data/relief-hillshade.png').convert('RGBA')",
      "w, h = im.size",
      "fade = 96",
      "px = im.load()",
      "for y in range(h):",
      "    yf = min(y, h - 1 - y) / fade",
      "    for x in range(w):",
      "        f = min(yf, min(x, w - 1 - x) / fade, 1)",
      "        if f >= 1: continue",
      "        r, g, b, a = px[x, y]",
      "        px[x, y] = (r, g, b, int(a * max(f, 0)))",
      "q = im.quantize(colors=32, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)",
      "q.save('data/relief-hillshade.png', optimize=True)",
    ].join("\n"),
  ],
  { stdio: "inherit" },
);
if (compressed.status !== 0) console.warn("hillshade left uncompressed; pillow quantize failed");
console.log(`wrote ${Object.keys(ordered).length} readings`);
