// Builds signals/gazetteer.json from the Open Data BCN barris file (CC BY 4.0) and the repo's own layers.
// Run once; the output is committed. Inputs are not committed.
//   node scripts/signals-gazetteer.mjs <BarcelonaCiutat_Barris.csv> [barris_atlas.geojson]
// barris CSV: https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id=20170706-districtes-barris
// atlas (optional, adds short-name aliases): Resilience Atlas CARTO table rcc_iu6_danys_propietats (c_barri, n_barri).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { inPolys, norm } from "./signals-lib.mjs";

const [csvPath, atlasPath] = process.argv.slice(2);
if (!csvPath) {
  console.error("usage: node scripts/signals-gazetteer.mjs <barris.csv> [barris_atlas.geojson]");
  process.exit(2);
}

// Minimal CSV parser: quoted fields with embedded commas, "" escapes. Enough for this file.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  const keys = head.map((h) => h.replace(/^﻿/, ""));
  return body.filter((r) => r.length === keys.length).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}

// WKT POLYGON / MULTIPOLYGON -> array of polygons (array of rings of [lon, lat]).
function wkt(s) {
  const polys = [];
  for (const poly of s.split(/\)\s*\)\s*,\s*\(\s*\(/)) {
    polys.push(poly.replace(/^[A-Z ]*\(+|\)+\s*$/g, "").split(/\)\s*,\s*\(/).map((ring) =>
      ring.split(",").map((p) => p.trim().split(/\s+/).map(Number))));
  }
  return polys;
}

// Label point: the grid cell centre inside the barri farthest from its edges (a cheap pole of inaccessibility),
// kept inside the qa bbox. ponytail: 40x40 grid, about 30 m precision; use polylabel if a label lands badly.
function labelPoint(polys) {
  const pts = polys.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.max(Math.min(...ys), 41.3205), Math.min(Math.max(...ys), 41.4795)];
  const segDist = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - ax - t * dx, (py - ay - t * dy) * 1.33); // 1.33: rough lat/lon metre ratio at 41.4N
  };
  let best = null, bestD = -1;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
    const p = [x0 + ((i + 0.5) * (x1 - x0)) / 40, y0 + ((j + 0.5) * (y1 - y0)) / 40];
    if (!inPolys(p, polys)) continue;
    let d = Infinity;
    for (const poly of polys) for (const ring of poly) for (let k = 1; k < ring.length; k++) d = Math.min(d, segDist(p, ring[k - 1], ring[k]));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best.map((v) => +v.toFixed(5));
}

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const barris = {}, districts = {}, geoms = {};
for (const r of rows) {
  geoms[r.codi_barri] = wkt(r.geometria_wgs84);
  districts[r.codi_districte] = r.nom_districte;
  barris[r.codi_barri] = { name: r.nom_barri, district: r.codi_districte, aliases: [], label: labelPoint(geoms[r.codi_barri]), zone_ids: [] };
}
if (atlasPath) {
  for (const f of JSON.parse(readFileSync(atlasPath, "utf8")).features) {
    const b = barris[f.properties.c_barri];
    if (b && norm(f.properties.n_barri) !== norm(b.name)) b.aliases.push(f.properties.n_barri);
  }
}

// Repo zones: every tappable feature id joins each barri that holds one of its vertices.
const walk = (c, visit) => (typeof c?.[0] === "number" ? visit(c) : c?.forEach((x) => walk(x, visit)));
for (const file of readdirSync("data/geojson").filter((n) => n.endsWith(".geojson") && n !== "signals.geojson")) {
  for (const f of JSON.parse(readFileSync(join("data/geojson", file), "utf8")).features) {
    const id = f.properties?.id;
    if (!id || f.properties.tappable === false) continue;
    const hit = new Set();
    walk(f.geometry.coordinates, (p) => { for (const [code, g] of Object.entries(geoms)) if (inPolys(p, g)) hit.add(code); });
    for (const code of hit) if (!barris[code].zone_ids.includes(id)) barris[code].zone_ids.push(id);
  }
}

const out = {
  note: "Place-name gazetteer for the signals pipeline. Built by scripts/signals-gazetteer.mjs. Barri names, codes and polygons: Open Data BCN 20170706-districtes-barris (CC BY 4.0, Barcelona City Council). Aliases: Resilience Atlas rcc_iu6_danys_propietats n_barri. zone_ids: repo data/geojson vertices inside each barri. Never shipped under data/.",
  source_sha256: createHash("sha256").update(readFileSync(csvPath)).digest("hex"),
  districts,
  barris,
};
writeFileSync("signals/gazetteer.json", JSON.stringify(out, null, 1) + "\n");
const zoned = Object.values(barris).filter((b) => b.zone_ids.length).length;
const zoneIds = new Set(Object.values(barris).flatMap((b) => b.zone_ids));
console.log(`gazetteer: ${Object.keys(barris).length} barris, ${Object.keys(districts).length} districts, ${Object.values(barris).reduce((s, b) => s + b.aliases.length, 0)} aliases, ${zoneIds.size} zone ids in ${zoned} barris`);
