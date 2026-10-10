#!/usr/bin/env node
// Model hotspots near reported places vs random points.
// Compares secondary-source report points (press/official) with modelled hotspots from the
// bcnflood API, and gives a base rate from seeded random points. Node built-ins only.
//
// Usage:
//   node scripts/reports-vs-model.mjs [--reports data/geojson/proof-oct2026.geojson]
//     [--api http://127.0.0.1:8000] [--run synthetic-demo] [--date 2026-10-03[,2026-10-04]]
//     [--hotspots saved-hotspots.geojson] [--radius 250] [--n 1000] [--seed 42]
//     [--limit 200] [--baseline auto|grid|bbox]
// --hotspots reads a saved /hotspots FeatureCollection instead of calling the API (offline).
// --baseline grid samples inside the run's modelled cells (/runs/{id}/export/geojson,
// min_depth_m=0); bbox samples inside the bbox of the reports; auto tries grid, then bbox.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const R_EARTH_M = 6371008.8;

export function haversineM([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Seeded PRNG (mulberry32): same seed, same baseline.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ringCentroid(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

// Point for any feature: points as-is, polygons by vertex centroid of the outer ring.
export function featurePoint(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates.slice(0, 2);
  if (g.type === "Polygon") return ringCentroid(g.coordinates[0]);
  if (g.type === "MultiPolygon") return ringCentroid(g.coordinates.flatMap((p) => p[0]));
  return null;
}

export function bboxOf(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function randomPointsInBbox([w, s, e, n], count, rng) {
  return Array.from({ length: count }, () => [w + rng() * (e - w), s + rng() * (n - s)]);
}

// Uniform cell pick, then uniform inside that cell's bbox. Cells are equal-area grid squares.
export function randomPointsInCells(cellBboxes, count, rng) {
  return Array.from({ length: count }, () => {
    const b = cellBboxes[Math.floor(rng() * cellBboxes.length)];
    return randomPointsInBbox(b, 1, rng)[0];
  });
}

export function nearest(point, targets) {
  let best = { distanceM: Infinity, index: -1 };
  targets.forEach((t, i) => {
    const d = haversineM(point, t);
    if (d < best.distanceM) best = { distanceM: d, index: i };
  });
  return best;
}

export function shareWithin(points, targets, radiusM) {
  if (!points.length) return NaN;
  return points.filter((p) => nearest(p, targets).distanceM <= radiusM).length / points.length;
}

const clean = (s) => String(s ?? "").replace(/\s*\u2014\s*/g, ": ").replace(/\u2013/g, "-");
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "n/a");

function parseArgs(argv) {
  const a = { reports: "data/geojson/proof-oct2026.geojson", api: "http://127.0.0.1:8000",
    run: "synthetic-demo", date: "2026-10-03", hotspots: null, radius: 250, n: 1000, seed: 42,
    limit: 200, baseline: "auto" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (!(k in a)) throw new Error(`unknown flag --${k}`);
    a[k] = argv[++i];
  }
  for (const k of ["radius", "n", "seed", "limit"]) a[k] = Number(a[k]);
  return a;
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const reportFc = JSON.parse(readFileSync(a.reports, "utf8"));
  const reports = reportFc.features.map((f) => ({ f, p: featurePoint(f) })).filter((r) => r.p);
  if (!reports.length) throw new Error(`no usable report features in ${a.reports}`);

  let hotspots = [], synthetic = null, source;
  if (a.hotspots) {
    const fc = JSON.parse(readFileSync(a.hotspots, "utf8"));
    hotspots = fc.features;
    synthetic = fc.properties?.synthetic ?? null;
    source = `file ${a.hotspots}`;
  } else {
    for (const d of String(a.date).split(",")) {
      const url = `${a.api}/simulations/${encodeURIComponent(a.run)}/hotspots?date=${d}&limit=${a.limit}`;
      const fc = await getJson(url);
      hotspots.push(...fc.features);
      if (fc.properties && "synthetic" in fc.properties) {
        synthetic = (synthetic ?? false) || Boolean(fc.properties.synthetic);
      }
    }
    source = `${a.api} run=${a.run} date=${a.date}`;
  }
  const hs = hotspots.map((f) => ({ f, p: featurePoint(f) })).filter((h) => h.p);
  const kind = synthetic === true ? "SYNTHETIC" : synthetic === false ? "real (non-synthetic)"
    : "UNKNOWN (no synthetic flag in response)";
  const tag = synthetic === false ? "" : `[${synthetic === true ? "SYNTHETIC" : "UNKNOWN RUN KIND"}] `;

  console.log("Model hotspots near reported places vs random points");
  console.log(`Run kind: ${kind}`);
  console.log(`Hotspots: ${hs.length} from ${source}`);
  console.log(`Reports: ${reports.length} from ${a.reports} (secondary sources)`);
  if (!hs.length) {
    console.log(`${tag}No modelled hotspots returned; nothing to compare.`);
    return;
  }

  // Baseline area
  let baseline, baselineLabel;
  const rng = mulberry32(a.seed);
  if (a.baseline !== "bbox" && !a.hotspots) {
    try {
      const d0 = String(a.date).split(",")[0];
      const fc = await getJson(`${a.api}/runs/${encodeURIComponent(a.run)}/export/geojson?date=${d0}&min_depth_m=0`);
      const cells = fc.features.filter((f) => f.geometry?.type === "Polygon")
        .map((f) => bboxOf(f.geometry.coordinates[0]));
      if (cells.length) {
        baseline = randomPointsInCells(cells, a.n, rng);
        baselineLabel = `inside ${cells.length} model grid cells (run ${a.run})`;
      }
    } catch (e) {
      if (a.baseline === "grid") throw e;
    }
  }
  if (!baseline) {
    if (a.baseline === "grid") throw new Error("grid baseline unavailable (use --baseline bbox)");
    const bb = bboxOf(reports.map((r) => r.p));
    baseline = randomPointsInBbox(bb, a.n, rng);
    baselineLabel = `inside report bbox [${bb.map((v) => v.toFixed(4)).join(", ")}]`;
  }

  console.log("");
  console.log("report_id | name | nearest hotspot (date, rank) | distance_m");
  for (const r of reports) {
    const nn = nearest(r.p, hs.map((h) => h.p));
    const hp = hs[nn.index].f.properties ?? {};
    console.log([r.f.properties?.id ?? "?", clean(r.f.properties?.name),
      `${hp.date ?? "?"} #${hp.rank ?? "?"}`, nn.distanceM.toFixed(0)].join(" | "));
  }

  const repShare = shareWithin(reports.map((r) => r.p), hs.map((h) => h.p), a.radius);
  const baseShare = shareWithin(baseline, hs.map((h) => h.p), a.radius);
  const nWithin = Math.round(repShare * reports.length);
  console.log("");
  console.log(`Baseline: ${a.n} random points, seed ${a.seed}, ${baselineLabel}`);
  console.log(`${tag}Reported places within ${a.radius} m of a model hotspot: ${nWithin}/${reports.length} (${pct(repShare)})`);
  console.log(`${tag}Random points within ${a.radius} m of a model hotspot: ${pct(baseShare)}`);
  if (synthetic !== false) {
    console.log(`${tag}Not a finding: the hotspots come from a ${synthetic ? "synthetic" : "unlabelled"} run, not a Barcelona simulation.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`reports-vs-model: ${e.message}`); process.exit(1); });
}
