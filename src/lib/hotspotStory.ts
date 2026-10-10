import { FLOOD_LABELS } from "./modelStyle";
import type { HotspotProps, Quantity } from "./sim";
import { formatDepth, formatNumber } from "./sim";

export type HotspotStory = {
  lead: string;
  reasons: string[];
  caveat: string;
};

function qValue(q: Quantity | null | undefined): number | null {
  if (!q || q.value == null) return null;
  return q.value;
}

function formatDuration(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

function directionPhrase(dir: string | null | undefined): string | null {
  if (!dir) return null;
  const map: Record<string, string> = {
    N: "north",
    E: "east",
    S: "south",
    W: "west",
    NE: "north-east",
    NW: "north-west",
    SE: "south-east",
    SW: "south-west",
  };
  return map[dir] ?? dir.toLowerCase();
}

function namedStreets(streets: string[] | undefined, limit: number): string[] {
  if (!streets?.length) return [];
  const named = streets.filter((name) => name && !name.startsWith("osm-"));
  return named.slice(0, limit);
}

function floodSeverityLabel(floodClass: HotspotProps["flood_class"]): string {
  const label = FLOOD_LABELS[floodClass];
  const short = label.split(" ")[0];
  return short.toLowerCase();
}

/** Plain-language summary of why the solver ranked this cell as a hotspot. */
export function explainHotspotProblem(properties: HotspotProps): HotspotStory {
  const street =
    properties.nearest_street?.name || properties.nearest_street?.segment_id || "this location";
  const explanation = properties.explanation;
  const peak = properties.peak_depth_m;
  const min10 = properties["minutes_above_0.10m"];
  const min30 = properties["minutes_above_0.30m"];
  const severity = floodSeverityLabel(properties.flood_class);

  const leadParts: string[] = [];
  leadParts.push(
    `Ranked #${properties.rank} near ${street}: the model simulates ${severity} ponding`,
  );
  if (peak != null) leadParts.push(` with a peak depth of ${formatDepth(peak)}`);
  if (min10 != null && min10 > 0) {
    leadParts.push(`, staying above 10 cm for about ${formatDuration(min10)}`);
  }
  leadParts.push(".");

  const reasons: string[] = [];

  const rain = qValue(explanation?.rain_in) ?? 0;
  const roof = qValue(explanation?.roof_in) ?? 0;
  const inflow = qValue(explanation?.inflow) ?? 0;
  const drainage = qValue(explanation?.drainage_out) ?? 0;
  const localInput = rain + roof;

  if (inflow > localInput * 1.25 && inflow > 20) {
    const from = directionPhrase(properties.main_inflow_direction);
    reasons.push(
      `Water mostly flows in from surrounding cells (${formatNumber(inflow)} m³ lateral inflow vs ${formatNumber(localInput)} m³ rain and roofs on this cell)${from ? `, mainly from the ${from}` : ""}.`,
    );
  } else if (localInput > inflow * 1.25 && localInput > 20) {
    reasons.push(
      `Rain and runoff from roofs on this cell dominate (${formatNumber(localInput)} m³) compared with water flowing in from neighbours (${formatNumber(inflow)} m³).`,
    );
  }

  const catchment = properties.upstream_contributing_area?.simulated;
  const catchmentM2 = qValue(catchment);
  if (catchmentM2 != null && catchmentM2 >= 8_000) {
    const ha = catchmentM2 / 10_000;
    reasons.push(
      `About ${ha < 10 ? ha.toFixed(1) : Math.round(ha)} ha of upstream area contributes flow toward this point in the simulation.`,
    );
  }

  const upstream = namedStreets(properties.upstream_streets, 4);
  if (upstream.length >= 2) {
    const list = upstream.slice(0, 3).join(", ");
    reasons.push(`Streets upgradient in the simulated flow network include ${list}${upstream.length > 3 ? ", and others" : ""}.`);
  }

  const slope = qValue(properties.local_slope);
  if (slope != null && slope < 0.025) {
    reasons.push(
      `The ground is relatively flat (${(slope * 100).toFixed(1)}% slope), so water drains away slowly once it collects.`,
    );
  }

  const depression = qValue(properties.depression_depth);
  if (depression != null && depression >= 0.25) {
    reasons.push(
      `Terrain dips about ${depression.toFixed(1)} m below neighbouring cells, which helps hold water in place.`,
    );
  }

  if (min30 != null && min30 >= 45) {
    reasons.push(`Deep water (above 30 cm) persists for about ${formatDuration(min30)} — long enough to disrupt movement on ${street}.`);
  }

  const totalIn = localInput + inflow;
  if (totalIn > 50 && drainage < totalIn * 0.2) {
    reasons.push(
      `Modeled drainage removes ${formatNumber(drainage)} m³ while roughly ${formatNumber(totalIn)} m³ arrives — drainage capacity looks insufficient for this storm in the model.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      "This cell scored highly because simulated depth and time flooded are both large compared with the rest of the domain for this day.",
    );
  }

  const caveat =
    "Simulated depths for this storm scenario — useful for comparing places, not a verified forecast of what happened or will happen.";

  return {
    lead: leadParts.join(""),
    reasons,
    caveat,
  };
}
