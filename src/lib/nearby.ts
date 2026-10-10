import type { Feature, Point } from "geojson";
import type { FloodClass, StreetProps, StreetsCollection } from "./sim";

export type LngLat = [number, number];

// Plain words for each flood class, for people who do not think in metres.
export const DEPTH_WORDS: Record<FloodClass, string> = {
  dry: "dry",
  low: "ankle-deep",
  moderate: "up to mid-shin",
  high: "around knee height",
  severe: "above the knee",
};

// ponytail: flat-earth metres, fine at city scale (error well under 1% across Barcelona).
function toMetres([lon, lat]: LngLat, origin: LngLat): [number, number] {
  return [(lon - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180), (lat - origin[1]) * 110540];
}

export function metresBetween(a: LngLat, b: LngLat): number {
  const [x, y] = toMetres(b, a);
  return Math.hypot(x, y);
}

function metresToLine(p: LngLat, line: LngLat[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toMetres(line[i - 1], p);
    const [bx, by] = toMetres(line[i], p);
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function insideExtent(extent: [number, number, number, number] | null, [lon, lat]: LngLat): boolean {
  if (!extent) return false;
  const [w, s, e, n] = extent;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

// The deepest simulated street within `radius` metres; nearest wins a tie. Null when no street is that close.
export function worstStreetNear(
  streets: StreetsCollection,
  p: LngLat,
  radius = 100,
): { street: StreetProps; metres: number } | null {
  let best: { street: StreetProps; metres: number } | null = null;
  for (const feature of streets.features) {
    const metres = metresToLine(p, feature.geometry.coordinates as LngLat[]);
    if (metres > radius) continue;
    const depth = feature.properties.max_depth_m ?? 0;
    const bestDepth = best?.street.max_depth_m ?? 0;
    if (!best || depth > bestDepth || (depth === bestDepth && metres < best.metres)) {
      best = { street: feature.properties, metres };
    }
  }
  return best;
}

export function nearestPoint<T extends Feature>(features: T[], p: LngLat, maxMetres: number): { feature: T; metres: number } | null {
  let best: { feature: T; metres: number } | null = null;
  for (const feature of features) {
    if (feature.geometry?.type !== "Point") continue;
    const metres = metresBetween(p, (feature.geometry as Point).coordinates as LngLat);
    if (metres <= maxMetres && (!best || metres < best.metres)) best = { feature, metres };
  }
  return best;
}
