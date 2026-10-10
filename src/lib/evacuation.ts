import resources from "../../data/flood-resources.json";
import { metresBetween, type LngLat } from "./nearby";
import type { StreetsCollection } from "./sim";

// Barcelona has no evacuation routes for street flooding: the plan is confinement.
// So "what to do" = stay put advice + the named low streets to keep away from + what shut last time.

export const RESOURCES = resources;

export type NamedPlace = { name: string; at: LngLat };

export function closedNear(p: LngLat, maxMetres = 1500): (NamedPlace & { metres: number })[] {
  return resources.closedLastStorm
    .map((c) => ({ name: c.name, at: c.at as LngLat, metres: metresBetween(p, c.at as LngLat) }))
    .filter((c) => c.metres <= maxMetres)
    .sort((a, b) => a.metres - b.metres)
    .slice(0, 3);
}

// Deepest named simulated streets within `radius`, one entry per street name. These are the ones to avoid on foot or by car.
export function streetsToAvoid(streets: StreetsCollection, p: LngLat, radius = 400, minDepth = 0.3): { name: string; depth: number }[] {
  const best = new Map<string, number>();
  for (const f of streets.features) {
    const { name, max_depth_m } = f.properties;
    if (!name || max_depth_m == null || max_depth_m < minDepth) continue;
    const coords = f.geometry.coordinates as LngLat[];
    const mid = coords[Math.floor(coords.length / 2)];
    if (metresBetween(p, mid) > radius) continue;
    if ((best.get(name) ?? 0) < max_depth_m) best.set(name, max_depth_m);
  }
  return [...best].map(([name, depth]) => ({ name, depth })).sort((a, b) => b.depth - a.depth).slice(0, 4);
}
