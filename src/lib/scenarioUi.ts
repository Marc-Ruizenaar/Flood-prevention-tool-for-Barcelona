// Plain-language helpers shared by the intro and the scenario planner.
// Names are English i18n keys: components pass them through t() when rendering.
import { haversineM, type ScenariosFile, type Segment } from "./scenarios";

export type RainLevel = { mm: number; name: string };
export type DrainLevel = { mmH: number; name: string };

// People do not think in millimetres, so each model rain level gets a name.
export const RAIN_LEVELS: readonly RainLevel[] = [
  { mm: 25, name: "Moderate rain" },
  { mm: 50, name: "Heavy rain" },
  { mm: 75, name: "Very heavy rain" },
  { mm: 100, name: "Intense storm" },
  { mm: 143, name: "Extreme storm, like 3 Oct" },
];

export const DRAIN_LEVELS: readonly DrainLevel[] = [
  { mmH: 10, name: "Drains blocked" },
  { mmH: 20, name: "Drains normal" },
  { mmH: 30, name: "Drains clear" },
];

export const DEFAULT_DRAIN_MM_H = 20;

// The model level closest to a measured or expected daily rain total.
export function nearestRainLevel(mm: number): RainLevel {
  let best = RAIN_LEVELS[0];
  for (const level of RAIN_LEVELS) if (Math.abs(level.mm - mm) < Math.abs(best.mm - mm)) best = level;
  return best;
}

// Likelihood as a whole percentage, 0 to 100, like a weather app.
export function likelihoodPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
}

export type RiskWord = "high" | "medium" | "low";

export function riskWord(p: number): RiskWord {
  if (p >= 0.6) return "high";
  if (p >= 0.3) return "medium";
  return "low";
}

// Index of the segment nearest to a point, or -1 when the file has none.
export function nearestSegmentIndex(segments: readonly Segment[], lon: number, lat: number): number {
  let best = -1;
  let bestM = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const m = haversineM({ lon, lat }, segments[i]);
    if (m < bestM) {
      bestM = m;
      best = i;
    }
  }
  return best;
}

// True when a point falls inside the box the model was trained on (segment extent plus a small margin).
export function insideStudiedArea(file: ScenariosFile, lon: number, lat: number, marginDeg = 0.002): boolean {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const s of file.segments) {
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
  }
  return lon >= minLon - marginDeg && lon <= maxLon + marginDeg && lat >= minLat - marginDeg && lat <= maxLat + marginDeg;
}
