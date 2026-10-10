import { t } from "./i18n";
import type { GroupId } from "../types";
import { TODAY } from "./weather";

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
    return live === false ? t("Station file did not load") : t("No daily total published yet");
  }
  return `${t("{mm} mm at {name}", { mm: formatMm(peak.mm), name: peak.name })} · ${live === false ? t("saved XEMA copy") : "XEMA"}`;
}

type Row = { codi_estacio: string; data_lectura: string; valor: string };

// The daily file calls the value `valor`, the half-hourly one `valor_lectura`; both come back as `valor`.
async function xema(resource: string, valueColumn: string, where: string, limit: number): Promise<Row[]> {
  const params = new URLSearchParams({ $select: `codi_estacio,data_lectura,${valueColumn} as valor`, $where: where, $limit: String(limit) });
  const response = await fetch(`https://analisi.transparenciacatalunya.cat/resource/${resource}.json?${params}`);
  if (!response.ok) throw new Error(`XEMA ${response.status}`);
  return (await response.json()) as Row[];
}

/** Daily totals (variable 1300) for the storm days, plus today summed from half-hourly readings (variable 35). */
export async function fetchGauges(today = TODAY): Promise<Record<string, Gauge>> {
  const stations = "codi_estacio in('X4','D5','X8')";
  const [daily, live] = await Promise.all([
    xema("7bvh-jvq2", "valor", `codi_variable='1300' AND ${stations} AND data_lectura >= '2026-10-02T00:00:00.000' AND data_lectura <= '${today}T00:00:00.000'`, 100),
    // ponytail: a failed live call just leaves today without a reading; the daily file still loads.
    xema("nzvn-apee", "valor_lectura", `codi_variable='35' AND ${stations} AND data_lectura >= '${today}T00:00:00.000'`, 200).catch(() => [] as Row[]),
  ]);
  const draft = new Map<string, Partial<Gauge>>();
  const add = (date: string, code: string, value: number, sum: boolean) => {
    const key = STATIONS.find(([c]) => c === code)?.[1];
    if (!key || !Number.isFinite(value)) return;
    const gauge = draft.get(date) ?? {};
    gauge[key] = sum ? (gauge[key] ?? 0) + value : value;
    draft.set(date, gauge);
  };
  for (const row of daily) add(row.data_lectura.slice(0, 10), row.codi_estacio, Number(row.valor), false);
  for (const row of live) add(today, row.codi_estacio, Number(row.valor), true);
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
