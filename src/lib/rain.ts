import type { GroupId } from "../types";

export type Gauge = {
  raval: number;
  fabra: number;
  universitaria: number;
};

export const RAIN_SOURCE_URL =
  "https://analisi.transparenciacatalunya.cat/Medi-Ambient/Dades-meteorol-giques-di-ries-de-la-XEMA/7bvh-jvq2";

export const LAYER_MM = {
  sewers: 10,
} as const;

export const RAIN_SNAPSHOT: Record<string, Gauge> = {
  "2026-10-02": { raval: 15.5, fabra: 15.8, universitaria: 15.6 },
  "2026-10-03": { raval: 190.8, fabra: 140, universitaria: 170.3 },
};

const STATIONS = [
  ["X4", "raval"],
  ["D5", "fabra"],
  ["X8", "universitaria"],
] as const;

export function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function peakOf(gauge: Gauge | undefined): { name: string; mm: number } | null {
  if (!gauge) return null;
  const stations = [
    { name: "el Raval", mm: gauge.raval },
    { name: "Fabra", mm: gauge.fabra },
    { name: "Zona Universitària", mm: gauge.universitaria },
  ];
  return stations.reduce((best, station) => (station.mm > best.mm ? station : best));
}

export function layersForRain(
  reports: boolean,
  current: Record<GroupId, boolean>,
): Record<GroupId, boolean> {
  return { ...current, sewers: false, streams: false, slopes: false, proof: reports };
}

export function atlasLocked(mm: number | null): boolean {
  return mm == null || mm < LAYER_MM.sewers;
}

export function rainCaption(gauge: Gauge | undefined, live: boolean | null): string {
  const peak = peakOf(gauge);
  if (!peak) {
    return live === false ? "Station file did not load" : "No daily total published yet";
  }
  return `${formatMm(peak.mm)} mm at ${peak.name} · ${live === false ? "saved XEMA copy" : "XEMA"}`;
}

export async function fetchGauges(): Promise<Record<string, Gauge>> {
  const params = new URLSearchParams({
    $select: "codi_estacio,data_lectura,valor",
    $where:
      "codi_variable='1300' AND codi_estacio in('X4','D5','X8') AND data_lectura >= '2026-10-02T00:00:00.000' AND data_lectura <= '2026-10-03T00:00:00.000'",
    $limit: "40",
  });
  const response = await fetch(
    `https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json?${params}`,
  );
  if (!response.ok) throw new Error(`XEMA ${response.status}`);
  const rows = (await response.json()) as { codi_estacio: string; data_lectura: string; valor: string }[];
  const draft = new Map<string, Partial<Gauge>>();
  for (const row of rows) {
    const date = row.data_lectura.slice(0, 10);
    const gauge = draft.get(date) ?? {};
    const value = Number(row.valor);
    const key = STATIONS.find(([code]) => code === row.codi_estacio)?.[1];
    if (key && Number.isFinite(value)) gauge[key] = value;
    draft.set(date, gauge);
  }
  const gauges: Record<string, Gauge> = {};
  for (const [date, gauge] of draft) {
    if (
      typeof gauge.raval === "number" &&
      typeof gauge.fabra === "number" &&
      typeof gauge.universitaria === "number"
    ) {
      gauges[date] = { raval: gauge.raval, fabra: gauge.fabra, universitaria: gauge.universitaria };
    }
  }
  return gauges;
}
