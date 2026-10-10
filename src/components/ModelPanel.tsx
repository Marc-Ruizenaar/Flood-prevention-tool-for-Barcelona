import { t } from "../lib/i18n";
import {
  dayKey,
  dayLabels,
  formatQuantity,
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
      <p className="kicker">Flood model · {runId()}</p>
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
                  <dt>{field.label}</dt>
                  <dd>{formatQuantity(value)}</dd>
                </div>
              );
            })}
          </dl>
          {row.warnings.length > 0 ? (
            <ul className="model-warnings">
              {row.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <h3>{t("Mitigation comparison")}</h3>
      {mitigation.status === "error" ? <p className="model-notice">{mitigation.message}</p> : null}
      {mitigation.status === "ready" ? (
        <>
          <p className="model-notice">{mitigation.data.disclaimer}</p>
          {reportDay ? (
            <table className="model-compare">
              <tbody>
                <tr>
                  <th>{t("Baseline")}</th>
                  <td>{formatQuantity(reportDay.baseline.flooded_street_length, false)}</td>
                  <td>{formatQuantity(reportDay.baseline.peak_depth, false)}</td>
                </tr>
                {Object.entries(reportDay.scenarios).map(([name, scenario]) => (
                  <tr key={name}>
                    <th>
                      <code>{name}</code>
                    </th>
                    <td>{formatQuantity(scenario.delta_flooded_street_length, false)}</td>
                    <td>{formatQuantity(scenario.delta_peak_depth, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
