export type Quantity = {
  value: number | null;
  unit: string;
  kind: string;
};

export type FloodClass = "dry" | "low" | "moderate" | "high" | "severe";

export type StreetProps = {
  segment_id: string;
  name: string | null;
  date: string;
  max_depth_m: number | null;
  p95_depth_m: number | null;
  "minutes_above_0.10m": number | null;
  "minutes_above_0.30m": number | null;
  flood_class: FloodClass;
  uncertainty_status: string;
  data_quality: string;
};

export type StreetsCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    properties: StreetProps;
  }>;
  properties?: {
    run_id?: string;
    date?: string;
    synthetic?: boolean;
    street_network_stub?: boolean;
  };
  label?: string;
};

export type InflowDir = "N" | "E" | "S" | "W";

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
  best_mitigation?: {
    scenario: string;
    delta_peak_depth: Quantity;
    label: string;
  } | null;
  best_mitigation_note?: string | null;
};

export type HotspotProps = {
  date: string;
  rank: number;
  cell_id: string;
  score?: Quantity;
  nearest_street?: { name: string | null; segment_id: string; distance_m: number };
  local_rainfall?: {
    label?: string;
    day_total?: Quantity;
    reason?: string | null;
  };
  model_forcing_rain?: Quantity;
  peak_depth_m: number | null;
  peak_time_local: string | null;
  peak_time_resolution?: string | null;
  "minutes_above_0.10m": number | null;
  "minutes_above_0.30m": number | null;
  flood_class: FloodClass;
  main_inflow_direction: string | null;
  inflow_by_direction?: Partial<Record<InflowDir, Quantity>>;
  upstream_contributing_area?: { simulated?: Quantity; d8_cross_check?: Quantity };
  upstream_streets?: string[];
  local_slope?: Quantity;
  depression_depth?: Quantity;
  explanation?: Explanation;
  uncertainty_status: string;
  data_quality: string;
};

export type HotspotsCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: HotspotProps;
  }>;
  properties?: {
    run_id?: string;
    date?: string;
    synthetic?: boolean;
  };
  label?: string;
};

export type DailySummary = {
  date_local: string;
  timezone: string;
  window_utc: [string, string];
  rainfall_volume: Quantity;
  infiltration_volume: Quantity;
  drainage_volume: Quantity;
  boundary_outflow_volume: Quantity;
  storage_start: Quantity;
  storage_end: Quantity;
  mass_balance_error_rel: Quantity;
  max_depth: Quantity;
  data_completeness: Quantity;
  status: "SIMULATED" | "INCOMPLETE" | "NOT_RUN" | string;
  synthetic: boolean;
  warnings: string[];
};

export type MitigationScenario = {
  delta_flooded_street_length: Quantity;
  delta_peak_depth: Quantity;
  min_cell_delta_max_depth: Quantity;
  lever_kind?: string;
  label?: string;
};

export type MitigationReport = {
  run_id: string;
  synthetic: boolean;
  disclaimer: string;
  flooded_threshold_m: number;
  street_network_stub?: boolean;
  days: Array<{
    date: string;
    baseline: {
      flooded_street_length: Quantity;
      peak_depth: Quantity;
    };
    scenarios: Record<string, MitigationScenario>;
  }>;
};

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; source: "api" | "fixture" | "empty"; data: T; note?: string }
  | { status: "error"; message: string };

export const EMPTY_STREETS: StreetsCollection = { type: "FeatureCollection", features: [] };
export const EMPTY_HOTSPOTS: HotspotsCollection = { type: "FeatureCollection", features: [] };
