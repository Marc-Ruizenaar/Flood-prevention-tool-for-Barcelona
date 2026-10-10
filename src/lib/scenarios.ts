import type { ZoneMap } from "../types";
import type { Loaded } from "./sim";

/* Types: exactly the contract in docs/ml-scenarios-contract.md. */

export type TrustLevel = "low" | "medium" | "high";

export type Confusion = { tp: number; fp: number; fn: number; tn: number };

export type ClassMetrics = {
  n: number;
  threshold: number; // probability cut used for the matrix
  confusion: Confusion;
  accuracy: number; // 0..1
  baseline_accuracy: number; // accuracy of always predicting the majority class ("always dry")
  balanced_accuracy: number;
  precision: number; // NaN is not allowed in JSON: use null when undefined
  recall: number;
  f1: number;
  roc_auc: number | null;
  brier: number;
  calibration: { bin: [number, number]; mean_predicted: number; observed_rate: number; n: number }[];
};

export type RealWorldCheck = {
  n_points: number; // reported places inside the model box (RESCCUE + T10 + proof)
  radius_m: number; // 150 or 300
  hits: number; // points within radius_m of a top-10 predicted area
  hit_rate: number;
  random_rate: number; // same test for 3000 random points inside the box, seed 42
  lift: number | null; // hit_rate / random_rate
};

export type ReliabilityBin = {
  from: number;
  to: number;
  predicted_mean: number | null; // null when the bin is empty
  observed_rate: number | null;
  n: number;
};

/** v2: how far the shown percentages can be trusted, measured on streets the calibrator never saw. */
export type Reliability = {
  bins: ReliabilityBin[]; // after calibration, 5 equal-width bins
  bins_raw: ReliabilityBin[]; // before calibration
  brier_before: number;
  brier_after: number;
  at_70: ReliabilityBin | null; // the 60 to 80% bin, or null when the model rarely says it
  sentence: string; // plain English
};

export type Calibration = {
  method: string; // "isotonic"
  fitted_on: string;
  n: number;
  note: string;
  bands?: { medium: number; high: number }; // risk words: medium from `medium`, high from `high`
};

export type ScenariosFile = {
  version: 1 | 2;
  kind: "ml_scenario";
  caveat: string;
  generated_at: string; // ISO time
  model: {
    type: string;
    features: string[];
    feature_importance: { feature: string; importance: number }[];
    label_definition: string;
    trained_storms: number;
    trained_rain_mm: [number, number];
    secondary_labels: string;
    excluded_rows: string;
    calibration?: Calibration; // v2 only
  };
  metrics: {
    spatial_cv: ClassMetrics; // 500 m blocks, out of fold, both days
    leave_one_storm_out: {
      train_2026_10_02_test_2026_10_03: ClassMetrics;
      train_2026_10_03_test_2026_10_02: ClassMetrics;
    };
    real_world: RealWorldCheck[]; // 150 m and 300 m
    reliability?: Reliability; // v2 only
    calibrated_confusion?: ClassMetrics; // v2 only, matrix at the threshold on the calibrated scores
  };
  trust: {
    level: TrustLevel;
    rules: { rule: string; passed: boolean; value: number | string | null }[];
    reasons: string[]; // plain English, one per failed rule
  };
  improvements: string[]; // ranked, plain English
  segments: { id: string; name: string; lon: number; lat: number; elev_m: number }[];
  scenarios: {
    id: string; // e.g. "r50_d20"
    rain_mm: number; // 25 | 50 | 75 | 100 | 143
    drainage_mm_h: number; // 10 | 20 | 30
    extrapolated: boolean; // true outside the trained rain range or drainage other than 20 mm/h
    risk_score: number; // 0..10, one decimal
    share_flooded: number; // share of segments with p >= threshold (fragile: prefer expected_share)
    expected_share?: number; // mean p over all segments, 0..1, 4 decimals
    p: number[]; // per segment, same order as `segments`, 3 decimals
    top: { rank: number; segment_index: number; name: string; lon: number; lat: number; p: number }[];
  }[];
};

export type Scenario = ScenariosFile["scenarios"][number];
export type Segment = ScenariosFile["segments"][number];
export type TopArea = Scenario["top"][number];

export type LonLat = { lon: number; lat: number };

/* Validation */

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function fin(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function finOrNull(x: unknown): x is number | null {
  return x === null || fin(x);
}

function strings(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((item) => typeof item === "string");
}

function validMetrics(x: unknown): boolean {
  if (!isRec(x)) return false;
  const c = x.confusion;
  if (!isRec(c) || !fin(c.tp) || !fin(c.fp) || !fin(c.fn) || !fin(c.tn)) return false;
  return (
    fin(x.n) &&
    fin(x.threshold) &&
    fin(x.accuracy) &&
    fin(x.baseline_accuracy) &&
    fin(x.balanced_accuracy) &&
    finOrNull(x.roc_auc)
  );
}

function validBin(x: unknown): boolean {
  return isRec(x) && fin(x.from) && fin(x.to) && finOrNull(x.predicted_mean) && finOrNull(x.observed_rate) && fin(x.n) && x.n >= 0;
}

function validReliability(x: unknown): boolean {
  if (!isRec(x)) return false;
  if (!Array.isArray(x.bins) || x.bins.length === 0 || !x.bins.every(validBin)) return false;
  if (!Array.isArray(x.bins_raw) || x.bins_raw.length === 0 || !x.bins_raw.every(validBin)) return false;
  if (!fin(x.brier_before) || !fin(x.brier_after)) return false;
  if (x.at_70 !== null && !validBin(x.at_70)) return false;
  return typeof x.sentence === "string" && x.sentence.length > 0;
}

function validBands(x: unknown): boolean {
  return isRec(x) && fin(x.medium) && fin(x.high) && x.medium >= 0 && x.medium < x.high && x.high <= 1;
}

function validCalibration(x: unknown): boolean {
  return (
    isRec(x) &&
    typeof x.method === "string" &&
    typeof x.fitted_on === "string" &&
    fin(x.n) &&
    typeof x.note === "string" &&
    x.note.length > 0 &&
    (x.bands === undefined || validBands(x.bands))
  );
}

function validRealWorld(x: unknown): boolean {
  return (
    isRec(x) &&
    fin(x.n_points) &&
    fin(x.radius_m) &&
    fin(x.hits) &&
    fin(x.hit_rate) &&
    fin(x.random_rate) &&
    finOrNull(x.lift)
  );
}

function validSegment(x: unknown): boolean {
  return isRec(x) && typeof x.id === "string" && typeof x.name === "string" && fin(x.lon) && fin(x.lat) && fin(x.elev_m);
}

function validScenario(x: unknown, segmentCount: number): boolean {
  if (!isRec(x)) return false;
  if (typeof x.id !== "string" || typeof x.extrapolated !== "boolean") return false;
  if (!fin(x.rain_mm) || !fin(x.drainage_mm_h) || !fin(x.risk_score) || !fin(x.share_flooded)) return false;
  if (x.expected_share !== undefined && !(fin(x.expected_share) && x.expected_share >= 0 && x.expected_share <= 1)) {
    return false;
  }
  if (!Array.isArray(x.p) || x.p.length !== segmentCount || !x.p.every(fin)) return false;
  if (!Array.isArray(x.top)) return false;
  return x.top.every(
    (t: unknown) =>
      isRec(t) &&
      fin(t.rank) &&
      fin(t.segment_index) &&
      Number.isInteger(t.segment_index) &&
      t.segment_index >= 0 &&
      t.segment_index < segmentCount &&
      typeof t.name === "string" &&
      fin(t.lon) &&
      fin(t.lat) &&
      fin(t.p),
  );
}

/** Returns the file if it matches the contract fields the intro screen reads, otherwise null. Accepts v1 and v2. */
export function validateScenarios(x: unknown): ScenariosFile | null {
  if (!isRec(x) || x.kind !== "ml_scenario" || (x.version !== 1 && x.version !== 2)) return null;
  if (typeof x.caveat !== "string" || !x.caveat) return null;
  const { model, metrics, trust, segments, scenarios } = x;
  if (!isRec(model) || !fin(model.trained_storms)) return null;
  const rain = model.trained_rain_mm;
  if (!Array.isArray(rain) || rain.length !== 2 || !rain.every(fin)) return null;
  if (model.calibration !== undefined && !validCalibration(model.calibration)) return null;
  if (!isRec(metrics) || !validMetrics(metrics.spatial_cv)) return null;
  if (metrics.reliability !== undefined && !validReliability(metrics.reliability)) return null;
  if (metrics.calibrated_confusion !== undefined && !validMetrics(metrics.calibrated_confusion)) return null;
  if (!Array.isArray(metrics.real_world) || !metrics.real_world.every(validRealWorld)) return null;
  if (!isRec(trust) || (trust.level !== "low" && trust.level !== "medium" && trust.level !== "high")) return null;
  if (!strings(trust.reasons) || !strings(x.improvements)) return null;
  if (!Array.isArray(segments) || !segments.every(validSegment)) return null;
  if (!Array.isArray(scenarios) || scenarios.length === 0) return null;
  if (!scenarios.every((s: unknown) => validScenario(s, segments.length))) return null;
  // Every field the screen reads has been checked above, the rest is passed through untouched.
  return x as ScenariosFile;
}

/* Loading, same shape as the loaders in sim.ts. */

export const SCENARIOS_URL = "/data/ml/scenarios.json";

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError";
}

export async function loadScenarios(signal: AbortSignal): Promise<Loaded<ScenariosFile>> {
  let response: Response;
  try {
    response = await fetch(SCENARIOS_URL, {
      signal,
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { status: "error", message: "Could not load the scenario file." };
  }
  if (response.status === 404) {
    return { status: "error", message: "The scenario file has not been built yet." };
  }
  if (!response.ok) {
    return { status: "error", message: `Could not load the scenario file (${response.status}).` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    return { status: "error", message: "The scenario file could not be read." };
  }
  const data = validateScenarios(body);
  if (!data) return { status: "error", message: "The scenario file does not match the expected format." };
  return { status: "ready", source: "fixture", data };
}

/* Scenario lookup and numbers */

export function findScenario(file: ScenariosFile, rainMm: number, drainageMmH: number): Scenario | undefined {
  return file.scenarios.find((s) => s.rain_mm === rainMm && s.drainage_mm_h === drainageMmH);
}

/** Distinct values of a scenario field, ascending. Used to build the pill chips from the file itself. */
export function scenarioOptions(file: ScenariosFile, field: "rain_mm" | "drainage_mm_h"): number[] {
  return [...new Set(file.scenarios.map((s) => s[field]))].sort((a, b) => a - b);
}

/** Class cut used everywhere when the file does not carry one. The file's own threshold wins. */
export const FLOOD_THRESHOLD = 0.5;

/** Fallback only: the drainage every trained storm used. trainedDrainage() reads it from the file first. */
export const TRAINED_DRAINAGE_MM_H = 20;

export function floodThreshold(file: ScenariosFile): number {
  const cut = file.metrics.spatial_cv.threshold;
  return Number.isFinite(cut) ? cut : FLOOD_THRESHOLD;
}

/**
 * The score from which a street counts as at risk in user-facing logic. A calibrated (v2) file
 * carries its own medium band (matches riskWord); otherwise the matrix threshold is used.
 */
export function alertCut(file: ScenariosFile): number {
  const medium = file.model.calibration?.bands?.medium;
  return typeof medium === "number" && Number.isFinite(medium) ? medium : floodThreshold(file);
}

/** Top areas at or above the alert cut (medium band, or the matrix threshold on older files). */
export function areasAtRisk(file: ScenariosFile, scenario: Scenario): number {
  const cut = alertCut(file);
  return scenario.top.filter((area) => area.p >= cut).length;
}

/** True when every listed area is at risk, so the real count may be higher than the list can show. */
function areasAtRiskCapped(file: ScenariosFile, scenario: Scenario): boolean {
  return scenario.top.length > 0 && areasAtRisk(file, scenario) === scenario.top.length;
}

/** "3", or "10+" when the count equals the length of the top list. */
export function areasAtRiskLabel(file: ScenariosFile, scenario: Scenario): string {
  const count = areasAtRisk(file, scenario);
  return areasAtRiskCapped(file, scenario) ? `${count}+` : String(count);
}

/** Same as areasAtRiskLabel, written for a screen reader. */
export function areasAtRiskSpoken(file: ScenariosFile, scenario: Scenario): string {
  const count = areasAtRisk(file, scenario);
  if (areasAtRiskCapped(file, scenario)) return `${count} or more alert areas`;
  return `${count} alert ${count === 1 ? "area" : "areas"}`;
}

/** The drainage the model was trained on: what the non-extrapolated scenarios use. */
export function trainedDrainage(file: ScenariosFile): number {
  const trained = file.scenarios.filter((s) => !s.extrapolated).map((s) => s.drainage_mm_h);
  return trained.length > 0 ? Math.min(...trained) : TRAINED_DRAINAGE_MM_H;
}

/** Plain reasons why a scenario is extrapolated. Empty when it is not. */
export function extrapolationReasons(file: ScenariosFile, scenario: Scenario): string[] {
  if (!scenario.extrapolated) return [];
  const reasons: string[] = [];
  const drainage = trainedDrainage(file);
  const [lo, hi] = file.model.trained_rain_mm;
  if (scenario.drainage_mm_h !== drainage) {
    reasons.push(`Drainage the model never simulated (it only saw ${drainage} mm/h)`);
  }
  if (scenario.rain_mm < lo || scenario.rain_mm > hi) {
    reasons.push(`Rain outside what the model learned from (${lo} to ${hi} mm)`);
  }
  if (reasons.length === 0) reasons.push("Outside the conditions the model learned from");
  return reasons;
}

/** Lowest ROC AUC over the leave-one-storm-out runs: how it does on a storm it never saw. Null if none. */
export function worstStormAuc(file: ScenariosFile): number | null {
  const runs: unknown = file.metrics.leave_one_storm_out;
  if (!isRec(runs)) return null;
  const values: number[] = [];
  for (const run of Object.values(runs)) {
    if (isRec(run) && fin(run.roc_auc)) values.push(run.roc_auc);
  }
  return values.length > 0 ? Math.min(...values) : null;
}

/** 0..1 to "37%". Tiny shares read "under 1%", only an exact 0 reads "0%". Missing values read "n/a". */
export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  if (n > 0 && n < 0.01) return "under 1%";
  return `${Math.round(n * 100)}%`;
}

/** A plain decimal such as an AUC, "0.87". Missing values read "n/a". */
export function decimal(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

export function trustLabel(level: TrustLevel): string {
  if (level === "high") return "High trust";
  if (level === "medium") return "Medium trust";
  return "Low trust";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Button text for jumping to a stored storm day, built from an ISO date: "Show 2 Oct storm". */
export function stormButtonLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  const name = MONTHS[month - 1];
  if (!name || !Number.isFinite(day)) return "Show the storm";
  return `Show ${day} ${name} storm`;
}

/* Geography */

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineM(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type WhereToGo = {
  index: number;
  segment: Segment;
  distanceM: number;
  p: number;
  fromP: number;
  gainElevM: number;
};

/**
 * Nearest street within maxM that is lower risk, higher than the start and under the flood threshold,
 * never the start itself. Returns null when there is none, or when the data is empty or inconsistent.
 */
export function whereToGo(
  file: ScenariosFile,
  scenario: Scenario,
  segmentIndex: number,
  maxM = 600,
): WhereToGo | null {
  const start = file.segments[segmentIndex];
  const startP = scenario.p[segmentIndex];
  if (!start || startP === undefined) return null;
  const cut = alertCut(file);
  let best: WhereToGo | null = null;
  for (let i = 0; i < file.segments.length; i++) {
    if (i === segmentIndex) continue;
    const seg = file.segments[i];
    const p = scenario.p[i];
    if (p === undefined || !(p < cut) || !(p < startP) || !(seg.elev_m > start.elev_m)) continue;
    const distanceM = haversineM(start, seg);
    if (distanceM > maxM) continue;
    if (!best || distanceM < best.distanceM) {
      best = { index: i, segment: seg, distanceM, p, fromP: startP, gainElevM: seg.elev_m - start.elev_m };
    }
  }
  return best;
}

/** "A higher, lower-risk street nearby: C. X, about 180 m away (straight line)", or an honest line when none. */
export function adviceText(result: WhereToGo | null, maxM = 600): string {
  if (!result) return `No clearly safer, higher street within ${maxM} m. Follow local guidance.`;
  const metres = Math.max(10, Math.round(result.distanceM / 10) * 10);
  return `A higher, lower-risk street nearby: ${result.segment.name}, about ${metres} m away (straight line)`;
}

/* Zone cards near a point */

export type ZonePoint = { id: string; lon: number; lat: number };

const ZONE_POINT_FILES = ["resccue-hotspots", "buried-streams", "retention-tanks", "proof-oct2026"] as const;

function pointsOf(collection: unknown): ZonePoint[] {
  if (!isRec(collection) || !Array.isArray(collection.features)) return [];
  const out: ZonePoint[] = [];
  for (const feature of collection.features as unknown[]) {
    if (!isRec(feature) || !isRec(feature.geometry) || !isRec(feature.properties)) continue;
    const { geometry, properties } = feature;
    const coords = geometry.coordinates;
    if (geometry.type !== "Point" || !Array.isArray(coords) || !fin(coords[0]) || !fin(coords[1])) continue;
    if (typeof properties.id === "string") out.push({ id: properties.id, lon: coords[0], lat: coords[1] });
  }
  return out;
}

/** Point features of the zone layers. A file that fails to load is skipped, not an error. */
export async function loadZonePoints(signal: AbortSignal): Promise<ZonePoint[]> {
  const results = await Promise.allSettled(
    ZONE_POINT_FILES.map(async (file) => {
      const response = await fetch(`/data/geojson/${file}.geojson`, { signal });
      if (!response.ok) throw new Error(String(response.status));
      return pointsOf(await response.json());
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Preventive action of the nearest zone card within maxM of the point, or null. */
export function zoneActionNear(
  zones: ZoneMap | undefined,
  zonePoints: ZonePoint[],
  lon: number,
  lat: number,
  maxM: number,
): string | null {
  if (!zones) return null;
  let bestAction: string | null = null;
  let bestDistance = Infinity;
  for (const point of zonePoints) {
    const action = zones[point.id]?.preventiveAction;
    if (!action) continue;
    const distance = haversineM({ lon, lat }, point);
    if (distance <= maxM && distance < bestDistance) {
      bestDistance = distance;
      bestAction = action;
    }
  }
  return bestAction;
}
