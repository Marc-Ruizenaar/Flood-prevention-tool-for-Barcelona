/**
 * Slim the bundled flood streets and build data/flood/index.json.
 *
 * Each run under data/flood/<run-id>/ is one simulated area (a chunk). The API repeats
 * method text, units and quality strings on every street segment, which is ~80 % of the
 * bytes. This moves those to the collection, keeps only the fields the app reads, and
 * rounds coordinates to 6 decimals (~10 cm). Idempotent: run it as often as you like.
 *
 * Run: npm run slim:flood   (sync-flood-fixtures runs it for you)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "data", "flood");
const KEEP = ["segment_id", "name", "max_depth_m", "minutes_above_0.10m", "minutes_above_0.30m", "flood_class"];
const HOIST = ["uncertainty_status", "data_quality", "aggregation_method", "units", "kind"];

const round6 = (v) => Math.round(v * 1e6) / 1e6;
// Depths to the millimetre and minutes to the minute: the model is not finer than that.
const trim = (key, v) =>
  typeof v !== "number" ? v : key === "max_depth_m" ? Math.round(v * 1000) / 1000 : Math.round(v);

export function slimStreets(fc) {
  const first = fc.features[0]?.properties ?? {};
  const properties = { ...(fc.properties ?? {}) };
  for (const key of HOIST) if (properties[key] == null && first[key] != null) properties[key] = first[key];
  const features = fc.features.map((f) => ({
    type: "Feature",
    id: f.id ?? f.properties.segment_id,
    geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates.map(([x, y]) => [round6(x), round6(y)]) },
    properties: Object.fromEntries(KEEP.filter((k) => k in f.properties).map((k) => [k, trim(k, f.properties[k])])),
  }));
  return { type: "FeatureCollection", properties, features };
}

export function bboxOf(fc, into = [Infinity, Infinity, -Infinity, -Infinity]) {
  for (const f of fc.features) {
    for (const [x, y] of f.geometry.coordinates) {
      into[0] = Math.min(into[0], x); into[1] = Math.min(into[1], y);
      into[2] = Math.max(into[2], x); into[3] = Math.max(into[3], y);
    }
  }
  return into;
}

function main() {
  // Steph's switch: `enabled: false` on an index entry survives a rebuild, so a run can stay on disk but off the map.
  const indexPath = join(ROOT, "index.json");
  const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")).runs ?? [] : [];
  const enabledOf = new Map(previous.map((run) => [run.id, run.enabled]));
  const runs = [];
  for (const id of readdirSync(ROOT).sort()) {
    const dir = join(ROOT, id, "streets");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const days = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const path = join(dir, file);
      const before = statSync(path).size;
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const slim = slimStreets(raw);
      if (slim.features.length !== raw.features.length || slim.features.some((f) => !f.properties.flood_class)) {
        throw new Error(`slim-flood: ${path} lost features or flood_class`);
      }
      writeFileSync(path, `${JSON.stringify(slim)}\n`);
      bboxOf(slim, bbox);
      days.push(file.slice(0, -5));
      console.log(`${id}/streets/${file}: ${(before / 1024).toFixed(0)} KB -> ${(statSync(path).size / 1024).toFixed(0)} KB`);
    }
    if (!days.length || !Number.isFinite(bbox[0])) continue;
    const run = { id, days, bbox: bbox.map((v) => round6(v)) };
    if (enabledOf.get(id) === false) run.enabled = false;
    runs.push(run);
  }
  writeFileSync(indexPath, `${JSON.stringify({ runs }, null, 2)}\n`);
  console.log(`wrote data/flood/index.json (${runs.length} chunk${runs.length === 1 ? "" : "s"})`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
