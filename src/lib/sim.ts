import type { FeatureCollection, LineString, Point } from "geojson";
import { dailyAsset, hotspotsAsset, mitigationAsset, streetsAsset } from "./fixtures";

export type Quantity = { value: number | null; unit: string; kind: string };
export type FloodClass = "dry" | "low" | "moderate" | "high" | "severe";

export type StreetProps = {
  segment_id: string;
  name: string | null;
  max_depth_m: number | null;
  "minutes_above_0.10m"?: number | null;
  "minutes_above_0.30m"?: number | null;
  flood_class: FloodClass;
  uncertainty_status: string;
  data_quality: string;
};

export type Explanation = {
  budget_period?: string;
  rain_in?: Quantity;
  roof_in?: Quantity;
  inflow?: Quantity;
  runoff_out?: Quantity;
  drainage_out?: Quantity;
  infiltration_out?: Quantity;
  boundary_outflow?: Quantity;
  tank?: Quantity;
  storage_end?: Quantity;
  residual_rel?: Quantity;
  stored_depth_peak?: Quantity;
  best_mitigation?: { scenario: string; delta_peak_depth: Quantity; label: string } | null;
  best_mitigation_note?: string | null;
};

export type HotspotProps = {
  date: string;
  rank: number;
  cell_id: string;
  score?: Quantity;
  nearest_street?: { name: string | null; segment_id: string; distance_m: number };
  local_rainfall?: { label?: string; day_total?: Quantity; reason?: string | null };
  model_forcing_rain?: Quantity;
  peak_depth_m: number | null;
  peak_time_local: string | null;
  peak_time_resolution?: string | null;
  "minutes_above_0.10m": number | null;
  "minutes_above_0.30m": number | null;
  flood_class: FloodClass;
  main_inflow_direction: string | null;
  inflow_by_direction?: Partial<Record<"N" | "E" | "S" | "W", Quantity>>;
  upstream_contributing_area?: { simulated?: Quantity; d8_cross_check?: Quantity };
  upstream_streets?: string[];
  local_slope?: Quantity;
  depression_depth?: Quantity;
  explanation?: Explanation;
  uncertainty_status: string;
  data_quality: string;
};

export type FloodLayerMeta = {
  run_id?: string;
  date?: string;
  timezone?: string;
  synthetic?: boolean;
  street_network_stub?: boolean;
};

export type StreetsCollection = FeatureCollection<LineString, StreetProps> & { properties?: FloodLayerMeta };
export type HotspotsCollection = FeatureCollection<Point, HotspotProps> & { properties?: FloodLayerMeta };

export type DailySummary = {
  date_local: string;
  timezone: string;
  rainfall_volume: Quantity;
  infiltration_volume: Quantity;
  drainage_volume: Quantity;
  boundary_outflow_volume: Quantity;
  storage_start: Quantity;
  storage_end: Quantity;
  mass_balance_error_rel: Quantity;
  max_depth: Quantity;
  data_completeness: Quantity;
  status: string;
  synthetic: boolean;
  warnings: string[];
};

export type MitigationReport = {
  synthetic: boolean;
  disclaimer: string;
  flooded_threshold_m: number;
  street_network_stub?: boolean;
  days: Array<{
    date: string;
    baseline: { flooded_street_length: Quantity; peak_depth: Quantity };
    scenarios: Record<
      string,
      {
        delta_flooded_street_length: Quantity;
        delta_peak_depth: Quantity;
        min_cell_delta_max_depth: Quantity;
        lever_kind?: string;
        label?: string;
      }
    >;
  }>;
};

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; source: "api" | "fixture" | "empty"; data: T; note?: string }
  | { status: "error"; message: string };

/** Days with bundled/API output for the default urgell run (extend via sync-flood-fixtures). */
export const MODEL_DAYS = ["2026-10-02", "2026-10-03"] as const;

const EMPTY_STREETS: StreetsCollection = { type: "FeatureCollection", features: [] };
const EMPTY_HOTSPOTS: HotspotsCollection = { type: "FeatureCollection", features: [] };

function envValue(name: string, fallback: string): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  return env[name]?.trim() || fallback;
}

export function apiBase(): string {
  return envValue("VITE_API_URL", "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function runId(): string {
  return envValue("VITE_RUN_ID", "urgell-2026-10-02_03");
}

export function dayKey(value: string): string {
  return value.slice(0, 10);
}

export function dayLabels(iso: string): { short: string; long: string } {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    short: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(date),
    long: new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1_000_000)) return value.toExponential(2);
  return value.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

export function formatQuantity(q: Quantity | null | undefined, withKind = true): string {
  if (!q) return "—";
  if (q.value == null) return `— ${q.unit}`;
  const body = `${formatNumber(q.value)} ${q.unit}`;
  return withKind ? `${body} (${q.kind})` : body;
}

export function formatDepth(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(3)} m`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${formatNumber(value)} min`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function hasToken(text: string, token: string): boolean {
  return text.toUpperCase().includes(token);
}

class ApiError extends Error {
  readonly kind: "offline" | "http" | "missing";
  constructor(message: string, kind: "offline" | "http" | "missing") {
    super(message);
    this.kind = kind;
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError";
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      // Avoid stale bundled JSON after sync:flood + copy (dev and PWA both cache aggressively otherwise).
      cache: import.meta.env.DEV ? "no-store" : "no-cache",
      headers: { Accept: "application/json, application/geo+json" },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("Could not load flood data.", "offline");
  }
  if (response.status === 404) {
    throw new ApiError(`Missing flood data at ${url}`, "missing");
  }
  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(`${response.status}: ${detail}`, "http");
  }
  return (await response.json()) as T;
}

function simulation(path: string): string {
  return `${apiBase()}/simulations/${encodeURIComponent(runId())}${path}`;
}

/** Set VITE_USE_FLOOD_API=true to read streets/hotspots from the live backend instead of static JSON. */
export function useFloodApi(): boolean {
  return envValue("VITE_USE_FLOOD_API", "") === "true";
}

async function loadStatic<T>(url: string, signal: AbortSignal): Promise<T> {
  return fetchJson<T>(url, signal);
}

async function loadStreetsStatic(date: string, signal: AbortSignal): Promise<Loaded<StreetsCollection>> {
  try {
    const data = await loadStatic<StreetsCollection>(streetsAsset(runId(), date), signal);
    return { status: "ready", source: "fixture", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "missing") {
      return {
        status: "ready",
        source: "empty",
        data: EMPTY_STREETS,
        note: `No bundled streets for ${date}. Run node scripts/sync-flood-fixtures.mjs.`,
      };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not load streets.",
    };
  }
}

async function loadHotspotsStatic(date: string, signal: AbortSignal): Promise<Loaded<HotspotsCollection>> {
  try {
    const data = await loadStatic<HotspotsCollection>(hotspotsAsset(runId(), date), signal);
    return { status: "ready", source: "fixture", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "missing") {
      return {
        status: "ready",
        source: "empty",
        data: EMPTY_HOTSPOTS,
        note: `No bundled hotspots for ${date}. Run node scripts/sync-flood-fixtures.mjs.`,
      };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not load hotspots.",
    };
  }
}

async function loadCollection<T>(url: string, signal: AbortSignal, empty: T): Promise<Loaded<T>> {
  try {
    return { status: "ready", source: "api", data: await fetchJson<T>(url, signal) };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "offline") {
      return { status: "ready", source: "empty", data: empty, note: "The flood API is offline." };
    }
    return { status: "error", message: error instanceof Error ? error.message : "Could not load this layer." };
  }
}

export function loadStreets(date: string, signal: AbortSignal): Promise<Loaded<StreetsCollection>> {
  if (useFloodApi()) {
    return loadCollection(simulation(`/streets?date=${date}`), signal, EMPTY_STREETS);
  }
  return loadStreetsStatic(date, signal);
}

export function loadHotspots(date: string, signal: AbortSignal): Promise<Loaded<HotspotsCollection>> {
  if (useFloodApi()) {
    return loadCollection(simulation(`/hotspots?date=${date}&limit=10`), signal, EMPTY_HOTSPOTS);
  }
  return loadHotspotsStatic(date, signal);
}

export async function loadDaily(signal: AbortSignal): Promise<Loaded<DailySummary[]>> {
  if (useFloodApi()) {
    try {
      return { status: "ready", source: "api", data: await fetchJson<DailySummary[]>(simulation("/daily"), signal) };
    } catch (error) {
      if (isAbort(error)) throw error;
      return { status: "error", message: error instanceof Error ? error.message : "Could not load the daily summary." };
    }
  }
  try {
    const data = await loadStatic<DailySummary[]>(dailyAsset(runId()), signal);
    return { status: "ready", source: "fixture", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    return {
      status: "error",
      message:
        error instanceof ApiError && error.kind === "missing"
          ? "Missing bundled daily summary. Run node scripts/sync-flood-fixtures.mjs."
          : error instanceof Error
            ? error.message
            : "Could not load the daily summary.",
    };
  }
}

export async function loadMitigation(signal: AbortSignal): Promise<Loaded<MitigationReport>> {
  if (useFloodApi()) {
    try {
      return { status: "ready", source: "api", data: await fetchJson<MitigationReport>(simulation("/mitigation"), signal) };
    } catch (error) {
      if (isAbort(error)) throw error;
      return { status: "error", message: error instanceof Error ? error.message : "Could not load mitigation." };
    }
  }
  try {
    const data = await loadStatic<MitigationReport>(mitigationAsset(runId()), signal);
    return { status: "ready", source: "fixture", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    return {
      status: "error",
      message:
        error instanceof ApiError && error.kind === "missing"
          ? "Missing bundled mitigation report. Run node scripts/sync-flood-fixtures.mjs."
          : error instanceof Error
            ? error.message
            : "Could not load mitigation.",
    };
  }
}

export function isAbortError(error: unknown): boolean {
  return isAbort(error);
}
