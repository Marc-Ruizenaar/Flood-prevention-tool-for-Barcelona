import { useEffect, useState } from "react";
import { formatNumber } from "../lib/sim";

type Stat = { min: number; max: number; mean: number; nan: number };

type BuildReportFile = {
  kind: string;
  dx_m: number;
  shape: [number, number];
  active_cells: number;
  building_cells: number;
  building_threshold: number;
  building_fraction_mean_active: number;
  roof_5m_cells: number;
  buildings: number;
  pervious_cells: number;
  stats: Record<string, Stat>;
  rain: {
    stations: string[];
    gap_fill: { interval: number; mean_fill_mm: number; fill_volume_m3: number }[];
    label: string;
    sensitivity_d5_area: {
      d5_cells: number;
      copy_x8_mm: number;
      idw_mm: number;
      copy_x8_m3: number;
      idw_m3: number;
    };
    total_mm_per_station: Record<string, number>;
    thiessen_cells: Record<string, number>;
    status: string;
  };
  labels: Record<string, string>;
};

const STAT_LABEL: Record<string, string> = {
  dem_m: "Ground height, m",
  building_fraction: "Building fraction",
  manning_n: "Manning n",
  ga_k_sat_m_s: "Green-Ampt Ksat, m/s",
  ga_psi_m: "Wetting front, m",
  ga_delta_theta: "Moisture deficit",
  pervious_fraction: "Pervious fraction",
};

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

function statLine(stat: Stat): string {
  const nan = stat.nan ? `, ${count(stat.nan)} NaN` : "";
  return `${formatNumber(stat.min)} – ${formatNumber(stat.max)}, mean ${formatNumber(stat.mean)}${nan}`;
}

export function BuildReport() {
  const [report, setReport] = useState<BuildReportFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/bcn_30m.report.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`bcn_30m report (${response.status})`);
        return response.json() as Promise<BuildReportFile>;
      })
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load bcn_30m.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rain = report?.rain;
  const gapMm = rain?.gap_fill.reduce((sum, row) => sum + row.mean_fill_mm, 0) ?? 0;
  const gapM3 = rain?.gap_fill.reduce((sum, row) => sum + row.fill_volume_m3, 0) ?? 0;

  return (
    <aside className="build-panel" data-testid="build-panel" aria-label="bcn_30m build report">
      <p className="kicker">Test inputs · bcn_30m.pkl</p>
      <h2>Build report</h2>
      {error ? <p className="model-notice">{error}</p> : null}
      {report && rain ? (
        <>
          <dl className="model-facts">
            <div>
              <dt>Grid</dt>
              <dd>
                {formatNumber(report.dx_m)} m · {count(report.shape[0])} × {count(report.shape[1])}
              </dd>
            </div>
            <div>
              <dt>Active cells</dt>
              <dd>{count(report.active_cells)}</dd>
            </div>
            <div>
              <dt>Buildings</dt>
              <dd>
                {count(report.building_cells)} cells at or above {formatNumber(report.building_threshold * 100)}% roof
                · mean fraction {formatNumber(report.building_fraction_mean_active)} · {count(report.buildings)}{" "}
                polygons · {count(report.roof_5m_cells)} roof cells at 5 m
              </dd>
            </div>
            <div>
              <dt>Pervious cells</dt>
              <dd>{count(report.pervious_cells)}</dd>
            </div>
            {Object.entries(STAT_LABEL).map(([key, label]) => {
              const stat = report.stats[key];
              if (!stat) return null;
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{statLine(stat)}</dd>
                </div>
              );
            })}
            <div>
              <dt>Rain, mm</dt>
              <dd>
                {rain.stations
                  .map((station) => `${station} ${formatNumber(rain.total_mm_per_station[station] ?? 0)}`)
                  .join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Thiessen cells</dt>
              <dd>
                {rain.stations
                  .map((station) => `${station} ${count(rain.thiessen_cells[station] ?? 0)}`)
                  .join(" · ")}
              </dd>
            </div>
            <div>
              <dt>D5 gap fill</dt>
              <dd>
                {rain.label}. {formatNumber(gapMm)} mm, {formatNumber(gapM3)} m³ over{" "}
                {count(rain.sensitivity_d5_area.d5_cells)} cells.
              </dd>
            </div>
            <div>
              <dt>D5 sensitivity</dt>
              <dd>
                IDW {formatNumber(rain.sensitivity_d5_area.idw_mm)} mm (
                {formatNumber(rain.sensitivity_d5_area.idw_m3)} m³) against an X8 copy of{" "}
                {formatNumber(rain.sensitivity_d5_area.copy_x8_mm)} mm (
                {formatNumber(rain.sensitivity_d5_area.copy_x8_m3)} m³).
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{rain.status}</dd>
            </div>
            <div>
              <dt>Labels</dt>
              <dd>
                Surface {report.labels.surface}. Aggregation {report.labels.aggregation}. Rain gap{" "}
                {report.labels.rain_gap_fill}.
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </aside>
  );
}
