import { locale, t } from "../lib/i18n";
import {
  dayKey,
  dayLabels,
  formatQuantity,
  formatValueWithUnit,
  MODEL_DAYS,
  runId,
  type DailySummary,
  type HotspotsCollection,
  type Loaded,
  type MitigationReport,
  type StreetsCollection,
} from "../lib/sim";

type ModelPanelProps = {
  day: string;
  onDay: (day: string) => void;
  streets: Loaded<StreetsCollection>;
  hotspots: Loaded<HotspotsCollection>;
  daily: Loaded<DailySummary[]>;
  mitigation: Loaded<MitigationReport>;
};

const DAILY_FIELDS: { key: keyof DailySummary; label: string }[] = [
  { key: "rainfall_volume", label: "Rainfall volume" },
  { key: "infiltration_volume", label: "Infiltration" },
  { key: "drainage_volume", label: "Drainage" },
  { key: "boundary_outflow_volume", label: "Boundary outflow" },
  { key: "storage_start", label: "Storage at start" },
  { key: "storage_end", label: "Storage at end" },
  { key: "max_depth", label: "Max depth" },
  { key: "mass_balance_error_rel", label: "Mass balance error" },
  { key: "data_completeness", label: "Data completeness" },
];

/** Backend scenario keys such as `drain_plus_10mm_h`, read as a sentence. */
function scenarioLabel(key: string): string {
  const drain = /^drain_plus_(\d+)mm_h$/.exec(key);
  if (drain) return t("Drains take {n} mm/h more", { n: drain[1] });
  return key.replaceAll("_", " ");
}

/** Backend warnings quote raw SI rates ("5.5e-06 m/s"); show them as mm/h. */
function humaniseWarning(warning: string): string {
  // The backend writes two fixed warnings; anything else passes through with rates converted.
  const capacity = warning.match(/^ASSUMPTION drainage scenario: capacity (\S+) m\/s$/);
  if (capacity) return t("Assumed drain capacity: {rate}. Nobody measured it.", { rate: formatValueWithUnit(Number(capacity[1]), "m/s") });
  if (warning.startsWith("PROVISIONAL: data_completeness")) return t("Data completeness is a placeholder until the rainfall quality checks land.");
  return warning.replace(/(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?) m\/s/g, (_, n: string) => formatValueWithUnit(Number(n), "m/s"));
}

// Street lengths come in metres; whole kilometres with one decimal read better in a table.
function km(q: { value: number | null } | null | undefined): string {
  if (q?.value == null) return "—";
  return `${(q.value / 1000).toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

export function ModelPanel({ day, onDay, streets, hotspots, daily, mitigation }: ModelPanelProps) {
  const available = daily.status === "ready" ? daily.data.map((row) => dayKey(row.date_local)) : null;
  const notes = [
    streets.status === "ready" ? streets.note : undefined,
    streets.status === "error" ? streets.message : undefined,
    hotspots.status === "error" ? hotspots.message : undefined,
  ].filter((note): note is string => Boolean(note));
  const row = daily.status === "ready" ? daily.data.find((item) => dayKey(item.date_local) === day) : undefined;
  const reportDay =
    mitigation.status === "ready" ? mitigation.data.days.find((item) => dayKey(item.date) === day) : undefined;

  return (
    <aside className="model-panel" data-testid="model-panel">
      <p className="kicker">{t("Flood model")} · {runId()}</p>
      <h2>{dayLabels(day).long}</h2>
      <div className="model-days" role="group" aria-label={t("Model day")}>
        {MODEL_DAYS.map((iso) => {
          const enabled = available == null || available.includes(iso);
          return (
            <button
              key={iso}
              type="button"
              aria-pressed={iso === day}
              disabled={!enabled}
              onClick={() => onDay(iso)}
            >
              {dayLabels(iso).short}
            </button>
          );
        })}
      </div>
      {notes.map((note) => (
        <p key={note} className="model-notice">
          {note}
        </p>
      ))}
      <h3>{t("Daily summary")}</h3>
      {daily.status === "error" ? <p className="model-notice">{daily.message}</p> : null}
      {row ? (
        <>
          <dl className="model-facts">
            {DAILY_FIELDS.map((field) => {
              const value = row[field.key];
              if (!value || typeof value !== "object" || !("unit" in value)) return null;
              return (
                <div key={field.key}>
                  <dt>{t(field.label)}</dt>
                  <dd>{formatQuantity(value)}</dd>
                </div>
              );
            })}
          </dl>
          {row.warnings.length > 0 ? (
            <ul className="model-warnings">
              {row.warnings.map((warning) => (
                <li key={warning}>{humaniseWarning(warning)}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <h3>{t("Mitigation comparison")}</h3>
      {mitigation.status === "error" ? <p className="model-notice">{mitigation.message}</p> : null}
      {mitigation.status === "ready" ? (
        <>
          <p className="model-notice">{t(mitigation.data.disclaimer)}</p>
          {reportDay ? (
            <table className="model-compare">
              <thead>
                <tr>
                  <th scope="col">{t("Scenario")}</th>
                  <th scope="col">{t("Flooded streets")}</th>
                  <th scope="col">{t("Peak depth")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t("Baseline")}</th>
                  <td>{km(reportDay.baseline.flooded_street_length)}</td>
                  <td>{formatQuantity(reportDay.baseline.peak_depth, false)}</td>
                </tr>
                {Object.entries(reportDay.scenarios).map(([name, scenario]) => (
                  <tr key={name}>
                    <th scope="row">{scenarioLabel(name)}</th>
                    <td>{km(scenario.delta_flooded_street_length)}</td>
                    <td>{formatQuantity(scenario.delta_peak_depth, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {reportDay ? <p className="model-notice">{t("Scenario rows show the change against the baseline.")}</p> : null}
        </>
      ) : null}
    </aside>
  );
}
