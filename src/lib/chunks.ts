import type { FeatureCollection, LineString } from "geojson";

// The flood model runs one area at a time. Each run is a chunk with its own files under
// data/flood/<run-id>/ and an entry in data/flood/index.json. The app loads only the chunks
// that touch the map view, so more areas do not mean a slower first load.

export type Bbox = [number, number, number, number]; // west, south, east, north
// `enabled: false` hides a run without deleting its folder. Missing means enabled.
export type RunChunk = { id: string; days: string[]; bbox: Bbox | null; enabled?: boolean };
export type RunIndex = { runs: RunChunk[] };

// ponytail: fixed cap, nearest chunks win. Tune when a view routinely touches more than this.
export const MAX_CHUNKS = 6;

export function intersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function insideAny(boxes: Bbox[], [x, y]: [number, number]): boolean {
  return boxes.some(([w, s, e, n]) => x >= w && x <= e && y >= s && y <= n);
}

export function unionBox(boxes: (Bbox | null)[]): Bbox | null {
  let out: Bbox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : [...b];
  }
  return out;
}

export function boxAround([x, y]: [number, number], metres: number): Bbox {
  const dy = metres / 110540;
  const dx = metres / (111320 * Math.cos((y * Math.PI) / 180));
  return [x - dx, y - dy, x + dx, y + dy];
}

export function enabledRuns(index: RunIndex): RunChunk[] {
  return index.runs.filter((run) => run.enabled !== false);
}

export function runBoxes(index: RunIndex): Bbox[] {
  return enabledRuns(index).flatMap((run) => (run.bbox ? [run.bbox] : []));
}

/** Chunks with output for `day` that touch `view` (all of them when either side has no box), nearest to the view centre first, capped. */
export function chunksFor(index: RunIndex, day: string, view: Bbox | null): RunChunk[] {
  const forDay = enabledRuns(index).filter((run) => run.days.includes(day));
  if (!view) return forDay.slice(0, MAX_CHUNKS);
  const cx = (view[0] + view[2]) / 2;
  const cy = (view[1] + view[3]) / 2;
  const dist = (b: Bbox) => Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy);
  return forDay
    .filter((run) => !run.bbox || intersects(run.bbox, view))
    .sort((a, b) => (a.bbox ? dist(a.bbox) : -1) - (b.bbox ? dist(b.bbox) : -1))
    .slice(0, MAX_CHUNKS);
}

/** One dashed rectangle per chunk, so people see every simulated area, loaded or not. */
export function boxOutline(boxes: Bbox[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: boxes.map(([w, s, e, n]) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[w, n], [e, n], [e, s], [w, s], [w, n]] },
    })),
  };
}

type Ranked = { properties: { rank: number; score?: { value: number | null } | undefined } };

/** Hotspots from several chunks in one list: deepest score first, ranks renumbered. */
export function mergeRanked<F extends Ranked>(parts: F[][]): F[] {
  const score = (f: F) => f.properties.score?.value ?? -Infinity;
  return parts
    .flat()
    .sort((a, b) => score(b) - score(a) || a.properties.rank - b.properties.rank)
    .map((f, i) => ({ ...f, properties: { ...f.properties, rank: i + 1 } }));
}
