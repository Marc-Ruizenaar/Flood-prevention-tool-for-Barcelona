import { t } from "./i18n";
import { explainHotspotProblem } from "./hotspotStory";
import { FLOOD_LABELS } from "./modelStyle";
import {
  formatDepth,
  formatMinutes,
  type FloodClass,
  type HotspotProps,
  type HotspotsCollection,
  type StreetsCollection,
} from "./sim";

export type ActionCategory = "traffic" | "drainage" | "structure" | "preposition";

export type CityActionEvidence = { label: string; value: string };

export type CityAction = {
  id: string;
  priority: number;
  category: ActionCategory;
  title: string;
  detail: string;
  locationLabel: string;
  coordinates: [number, number];
  segmentId?: string;
  cellId?: string;
  evidence: CityActionEvidence[];
};

const ARTERIAL =
  /\b(Gran Via|Diagonal|Ronda de|Paral·lel|Paral\.lel|Meridiana|La Rambla|Carretera de la Bordeta|Avinguda de Mistral|Avinguda del Paral)/i;

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  traffic: t("Traffic"),
  drainage: t("Drainage"),
  structure: t("Low point"),
  preposition: t("Upstream"),
};

export function actionCategoryLabel(category: ActionCategory): string {
  return CATEGORY_LABEL[category];
}

function qValue(q: { value: number | null } | null | undefined): number | null {
  if (!q || q.value == null) return null;
  return q.value;
}

function normalizeStreetName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function lineMidpoint(coords: number[][]): [number, number] | null {
  if (!coords.length) return null;
  const mid = coords[Math.floor(coords.length / 2)];
  if (mid.length < 2) return null;
  return [mid[0], mid[1]];
}

function arterialWeight(name: string | null | undefined): number {
  if (!name) return 0;
  return ARTERIAL.test(name) ? 1 : 0;
}

function durationHours(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  if (minutes < 90) return `${Math.round(minutes)} min`;
  return `${Math.round(minutes / 60)} h`;
}

function pushAction(actions: CityAction[], seen: Set<string>, action: CityAction) {
  if (seen.has(action.id)) return;
  seen.add(action.id);
  actions.push(action);
}

function hotspotActions(features: HotspotProps[], geometryByCell: Map<string, [number, number]>): CityAction[] {
  const out: CityAction[] = [];
  const seen = new Set<string>();

  for (const props of features) {
    const coords = geometryByCell.get(props.cell_id);
    if (!coords) continue;

    const street = props.nearest_street?.name || props.nearest_street?.segment_id || "this location";
    const peak = props.peak_depth_m;
    const min30 = props["minutes_above_0.30m"];
    const explanation = props.explanation;
    const inflow = qValue(explanation?.inflow) ?? 0;
    const rain = qValue(explanation?.rain_in) ?? 0;
    const roof = qValue(explanation?.roof_in) ?? 0;
    const drainage = qValue(explanation?.drainage_out) ?? 0;
    const localInput = rain + roof;
    const depression = qValue(props.depression_depth);
    const story = explainHotspotProblem(props);

    const baseEvidence: CityActionEvidence[] = [
      { label: t("Rank"), value: `#${props.rank}` },
      { label: t("Peak depth"), value: formatDepth(peak) },
      { label: t("Above 30 cm"), value: durationHours(min30) },
    ];

    if (props.rank <= 5 && peak != null && peak >= 0.8) {
      pushAction(out, seen, {
        id: `hotspot-priority-${props.cell_id}`,
        priority:
          200 +
          (10 - Math.min(props.rank, 10)) * 12 +
          peak * 30 +
          (min30 ?? 0) / 15 +
          arterialWeight(street) * 40,
        category: "traffic",
        title: t("Consider traffic management near {street}", { street }),
        detail: story.lead,
        locationLabel: street,
        coordinates: coords,
        cellId: props.cell_id,
        evidence: baseEvidence,
      });
    }

    if (depression != null && depression >= 0.25) {
      pushAction(out, seen, {
        id: `hotspot-dip-${props.cell_id}`,
        priority: 120 + depression * 40 + (peak ?? 0) * 20,
        category: "structure",
        title: t("Inspect low point / underpass drainage near {street}", { street }),
        detail: t("Terrain dips about {m} m in the model, so water can pool before it drains away.", { m: depression.toFixed(1) }),
        locationLabel: street,
        coordinates: coords,
        cellId: props.cell_id,
        evidence: [
          ...baseEvidence,
          { label: t("Depression"), value: `${depression.toFixed(2)} m ${t("(terrain diagnostic)")}` },
        ],
      });
    }

    const totalIn = localInput + inflow;
    if (totalIn > 50 && drainage < totalIn * 0.2) {
      pushAction(out, seen, {
        id: `hotspot-drain-${props.cell_id}`,
        priority: 95 + (totalIn - drainage) / 40 + (peak ?? 0) * 15,
        category: "drainage",
        title: t("Pre-clear gullies / plan pumping near {street}", { street }),
        detail: t("Modelled drainage removes less than 20% of incoming water at this cell for this scenario."),
        locationLabel: street,
        coordinates: coords,
        cellId: props.cell_id,
        evidence: [
          ...baseEvidence,
          { label: t("Inflow"), value: `${inflow.toFixed(0)} m³ ${t("(simulated)")}` },
          { label: t("Drainage out"), value: `${drainage.toFixed(0)} m³ ${t("(simulated)")}` },
        ],
      });
    }

    if (inflow > localInput * 1.25 && inflow > 20 && props.main_inflow_direction) {
      const upstream = (props.upstream_streets ?? [])
        .filter((n) => n && !n.startsWith("osm-"))
        .slice(0, 2)
        .join(", ");
      pushAction(out, seen, {
        id: `hotspot-upstream-${props.cell_id}`,
        priority: 88 + inflow / 50 + (peak ?? 0) * 10,
        category: "preposition",
        title: upstream
          ? t("Pre-position barriers upstream of {street}", { street })
          : t("Pre-position barriers upgradient of {street}", { street }),
        detail: upstream
          ? t("Most simulated inflow arrives from the {dir}; upgradient streets include {streets}.", { dir: props.main_inflow_direction, streets: upstream })
          : t("Most simulated inflow arrives from the {dir}.", { dir: props.main_inflow_direction }),
        locationLabel: street,
        coordinates: coords,
        cellId: props.cell_id,
        evidence: [
          ...baseEvidence,
          { label: t("Lateral inflow"), value: `${inflow.toFixed(0)} m³ ${t("(simulated)")}` },
        ],
      });
    }
  }

  return out;
}

function streetActions(
  streets: StreetsCollection,
): CityAction[] {
  const out: CityAction[] = [];
  const seen = new Set<string>();
  const bestByName = new Map<
    string,
    {
      name: string;
      segment_id: string;
      max_depth_m: number;
      min30: number;
      coords: [number, number];
      flood_class: string;
    }
  >();

  for (const feature of streets.features) {
    if (feature.geometry.type !== "LineString") continue;
    const props = feature.properties;
    const name = props.name?.trim();
    const key = normalizeStreetName(name);
    if (!key || props.max_depth_m == null || props.flood_class === "dry") continue;
    if (props.max_depth_m < 0.15) continue;

    const coords = lineMidpoint(feature.geometry.coordinates);
    if (!coords) continue;

    const min30 = props["minutes_above_0.30m"] ?? 0;
    const existing = bestByName.get(key);
    if (!existing || props.max_depth_m > existing.max_depth_m) {
      bestByName.set(key, {
        name: name!,
        segment_id: props.segment_id,
        max_depth_m: props.max_depth_m,
        min30,
        coords,
        flood_class: props.flood_class,
      });
    }
  }

  for (const row of bestByName.values()) {
    const arterial = arterialWeight(row.name);
    const deep = row.max_depth_m >= 0.5 && row.min30 >= 45;
    const major = row.max_depth_m >= 1.0;
    if (!((arterial && deep) || major)) continue;

    const id = `street-${slug(row.name)}`;
    pushAction(out, seen, {
      id,
      priority:
        150 +
        arterial * 60 +
        row.max_depth_m * 35 +
        row.min30 / 12,
      category: "traffic",
      title: major
        ? t("Priority arterial flooding on {street}", { street: row.name })
        : t("Consider closing or diverting {street}", { street: row.name }),
      detail: t("Simulated peak depth {depth} on this corridor; water above 30 cm for about {time}.", { depth: formatDepth(row.max_depth_m), time: formatMinutes(row.min30) }),
      locationLabel: row.name,
      coordinates: row.coords,
      segmentId: row.segment_id,
      evidence: [
        { label: t("Peak depth"), value: formatDepth(row.max_depth_m) },
        { label: t("Above 30 cm"), value: durationHours(row.min30) },
        { label: t("Flood class"), value: FLOOD_LABELS[row.flood_class as FloodClass] ?? row.flood_class },
      ],
    });
  }

  return out;
}

/** Rule-based city ops list from simulated streets + hotspots (no new facts). */
export function deriveCityActions(
  streets: StreetsCollection,
  hotspots: HotspotsCollection,
  limit = 10,
): CityAction[] {
  const geometryByCell = new Map<string, [number, number]>();
  const hotspotProps: HotspotProps[] = [];
  for (const feature of hotspots.features) {
    if (feature.geometry.type !== "Point") continue;
    hotspotProps.push(feature.properties);
    geometryByCell.set(feature.properties.cell_id, feature.geometry.coordinates as [number, number]);
  }

  const merged = [...streetActions(streets), ...hotspotActions(hotspotProps, geometryByCell)];
  merged.sort((a, b) => b.priority - a.priority);

  const deduped: CityAction[] = [];
  const locationSeen = new Set<string>();
  for (const action of merged) {
    const locKey = `${action.category}:${normalizeStreetName(action.locationLabel) ?? action.id}`;
    if (locationSeen.has(locKey)) continue;
    locationSeen.add(locKey);
    deduped.push(action);
    if (deduped.length >= limit) break;
  }

  return deduped;
}
