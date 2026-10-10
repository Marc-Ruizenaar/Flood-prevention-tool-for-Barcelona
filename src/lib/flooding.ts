import { groupForZone, type GroupId, type ReliefFile, type ZoneMap } from "../types";
import { formatMm, LAYER_MM, peakOf, type Gauge } from "./rain";
import { formatDay } from "./weather";

export const STATION_LIST_URL = "https://meteo.cat/observacions/llistat-xema";

type StationKey = "raval" | "fabra" | "universitaria";

type Station = {
  key: StationKey;
  name: string;
  lat: number;
  lon: number;
};

// Positions published on the Meteocat XEMA station list.
const STATIONS: Station[] = [
  { key: "raval", name: "el Raval", lat: 41.38386, lon: 2.16774 },
  { key: "fabra", name: "Fabra", lat: 41.41864, lon: 2.12379 },
  { key: "universitaria", name: "Zona Universitària", lat: 41.37922, lon: 2.10537 },
];

const FLOOD_GROUPS = new Set<GroupId>(["sewers", "streams", "slopes"]);

export type FloodPlace = {
  id: string;
  name: string;
  group: "sewers" | "streams" | "slopes";
  why: string;
};

export type FloodReading = {
  summary: string;
  places: FloodPlace[];
  held: { id: string; name: string; why: string }[];
};

type Candidate = FloodPlace & { score: number; point: boolean };

function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function nearestStation(lon: number, lat: number): Station {
  return STATIONS.reduce((best, station) =>
    distanceKm(lon, lat, station.lon, station.lat) < distanceKm(lon, lat, best.lon, best.lat)
      ? station
      : best,
  );
}

function stationByKey(key: StationKey): Station {
  const station = STATIONS.find((item) => item.key === key);
  if (!station) throw new Error(`missing station ${key}`);
  return station;
}

function priorMm(gauges: Record<string, Gauge>, day: string, key: StationKey): number {
  let sum = 0;
  for (const [date, gauge] of Object.entries(gauges)) {
    if (date < day) sum += gauge[key];
  }
  return sum;
}

function earlierPeak(
  gauges: Record<string, Gauge>,
  day: string,
): { date: string; name: string; mm: number } | null {
  let best: { date: string; name: string; mm: number } | null = null;
  for (const [date, gauge] of Object.entries(gauges)) {
    if (date >= day) continue;
    const peak = peakOf(gauge);
    if (peak && (!best || peak.mm > best.mm)) best = { date, ...peak };
  }
  return best;
}

function earlierSentence(gauges: Record<string, Gauge>, day: string): string {
  const earlier = earlierPeak(gauges, day);
  if (!earlier || earlier.mm < LAYER_MM.sewers) return "";
  return ` The heaviest earlier day in the file is ${formatDay(earlier.date)}, ${formatMm(earlier.mm)} mm at ${earlier.name}.`;
}

function rainFor(
  group: "sewers" | "streams" | "slopes",
  nearest: Station,
  gauge: Gauge,
): { station: Station; mm: number } {
  if (group === "slopes") {
    return { station: stationByKey("fabra"), mm: gauge.fabra };
  }
  if (group === "streams" && gauge.fabra >= gauge[nearest.key]) {
    return { station: stationByKey("fabra"), mm: gauge.fabra };
  }
  return { station: nearest, mm: gauge[nearest.key] };
}

export function readFlooding(input: {
  day: string;
  gauges: Record<string, Gauge>;
  zones: ZoneMap;
  relief: ReliefFile;
}): FloodReading {
  const gauge = input.gauges[input.day];
  if (!gauge) {
    return {
      summary: `No daily total is published for this day, so no place is matched.${earlierSentence(input.gauges, input.day)}`,
      places: [],
      held: [],
    };
  }

  const candidates: Candidate[] = [];
  const held: FloodReading["held"] = [];

  for (const zone of Object.values(input.zones)) {
    if (zone.layerType === "proof") continue;
    const place = input.relief.places[zone.id];
    if (!place) continue;
    const [lon, lat] = place.at;
    const nearest = nearestStation(lon, lat);
    const group = groupForZone(zone);

    if (zone.mechanisms.includes("mitigation")) {
      const mm = gauge[nearest.key];
      if (mm >= LAYER_MM.sewers) {
        held.push({
          id: zone.id,
          name: zone.name,
          why: `${formatMm(mm)} mm at ${nearest.name}, the nearest station. This tank is already on the map as mitigation.`,
        });
      }
      continue;
    }

    if (!FLOOD_GROUPS.has(group) || group === "relief" || group === "proof") continue;
    const floodGroup = group as Candidate["group"];
    const rain = rainFor(floodGroup, nearest, gauge);
    const threshold = LAYER_MM[floodGroup];
    if (rain.mm < threshold) continue;

    const prior = priorMm(input.gauges, input.day, rain.station.key);
    const ratio = rain.mm / threshold;
    const memory = Math.min(prior, 200) / 200;
    const steep = place.fallMeters / 30;
    const stays = place.fallMeters < 5 ? 0.35 : 0;
    const score =
      ratio + memory * 0.25 + (floodGroup === "sewers" ? stays : steep);
    const earlier =
      prior >= LAYER_MM.sewers
        ? `, after ${formatMm(prior)} mm there on earlier days in the file`
        : "";
    const ground =
      floodGroup === "slopes"
        ? ` The ground is about ${place.meters} m and falls ${place.fallMeters} m in ${place.spanMeters} m toward the ${place.toward}.`
        : floodGroup === "streams"
          ? " The buried-stream layer names this corridor, and the station used for it is at least 100 mm."
          : place.fallMeters < 5
            ? ` About ${place.meters} m, with ${place.fallMeters} m of fall in ${place.spanMeters} m, so water that arrives here has little grade to leave.`
            : ` About ${place.meters} m, falling ${place.fallMeters} m in ${place.spanMeters} m toward the ${place.toward}.`;

    candidates.push({
      id: zone.id,
      name: zone.name,
      group: floodGroup,
      point: zone.layerIds.includes("resccue-hotspots"),
      score,
      why: `${formatMm(rain.mm)} mm at ${rain.station.name}${earlier}.${ground}`,
    });
  }

  const byScore = (a: Candidate, b: Candidate) => b.score - a.score;
  const slopes = candidates.filter((place) => place.group === "slopes").sort(byScore);
  const streams = candidates.filter((place) => place.group === "streams").sort(byScore).slice(0, 2);
  const sewerPoints = candidates.filter((place) => place.group === "sewers" && place.point).sort(byScore);
  const sewerAreas = candidates.filter((place) => place.group === "sewers" && !place.point).sort(byScore);
  const sewers = [...sewerPoints.slice(0, 5)];
  if (sewers.length < 4) sewers.push(...sewerAreas.slice(0, 4 - sewers.length));

  const places = [...slopes, ...streams, ...sewers].slice(0, 8).map(({ id, name, group, why }) => ({
    id,
    name,
    group,
    why,
  }));

  const totals = `el Raval ${formatMm(gauge.raval)} mm, Fabra ${formatMm(gauge.fabra)} mm, Zona Universitària ${formatMm(gauge.universitaria)} mm.`;
  const peak = peakOf(gauge);
  let summary = totals;
  if (!peak || places.length === 0) {
    summary = `${totals} All three are under 10 mm, so no published place matches.${earlierSentence(input.gauges, input.day)}`;
  } else {
    const kinds = [
      places.some((place) => place.group === "slopes") ? "slopes" : "",
      places.some((place) => place.group === "streams") ? "buried streams" : "",
      places.some((place) => place.group === "sewers") ? "sewers" : "",
    ].filter(Boolean);
    const list =
      kinds.length <= 1
        ? kinds[0]
        : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
    summary = `${totals} ${places.length} published places match, from ${list}. Slope places are read against Fabra. The others use the nearest of the three stations.`;
  }

  return { summary, places, held };
}
