import { dayKey, dayLabels, formatQuantity } from "@/lib/format";
import { FLOOD_COLORS, FLOOD_LABELS } from "@/lib/style";
import type { DailySummary, FloodClass, HotspotsCollection, Loaded, MitigationReport, StreetsCollection } from "@/lib/types";
import { apiBase, runId } from "@/lib/api";

type SidePanelProps = {
  day: string;
  streets: Loaded<StreetsCollection>;
  hotspots: Loaded<HotspotsCollection>;
  daily: Loaded<DailySummary[]>;
  mitigation: Loaded<MitigationReport>;
};

type DailyQuantityKey = {
  [K in keyof DailySummary]: DailySummary[K] extends { value: number | null; unit: string; kind: string }
    ? K
    : never;
}[keyof DailySummary];

const DAILY_FIELDS: { key: DailyQuantityKey; label: string }[] = [
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

function notesFor(streets: Loaded<StreetsCollection>, hotspots: Loaded<HotspotsCollection>): string[] {
  const notes = [
    streets.status === "ready" ? streets.note : undefined,
    hotspots.status === "ready" ? hotspots.note : undefined,
    streets.status === "error" ? streets.message : undefined,
    hotspots.status === "error" ? hotspots.message : undefined,
  ];
  return [...new Set(notes.filter((note): note is string => Boolean(note)))];
}

function DailyBlock({ day, daily }: { day: string; daily: Loaded<DailySummary[]> }) {
  if (daily.status === "loading") return <p className="muted">Loading the daily summary…</p>;
  if (daily.status === "error") return <p className="notice">{daily.message}</p>;
  const row = daily.data.find((item) => dayKey(item.date_local) === day);
  if (!row) return <p className="notice">This day is missing from the daily summary.</p>;
  return (
    <>
      <p className="status-line">
        <span>{row.status}</span>
        <span>{row.timezone}</span>
        {row.synthetic ? <span>Synthetic run</span> : null}
      </p>
      <dl className="facts">
        {DAILY_FIELDS.map((field) => (
          <div key={field.key}>
            <dt>{field.label}</dt>
            <dd>{formatQuantity(row[field.key])}</dd>
          </div>
        ))}
      </dl>
      {row.warnings.length > 0 ? (
        <ul className="warnings">
          {row.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function deltaClass(value: number | null | undefined): string {
  if (value == null || value === 0) return "";
  return value < 0 ? "delta-less" : "delta-more";
}

function MitigationBlock({
  day,
  mitigation,
  fixtureHotspots,
}: {
  day: string;
  mitigation: Loaded<MitigationReport>;
  fixtureHotspots: boolean;
}) {
  if (mitigation.status === "loading") return <p className="muted">Comparing mitigation scenarios…</p>;
  if (mitigation.status === "error") {
    return (
      <p className="notice">
        {mitigation.message}
        {fixtureHotspots ? " Open a hotspot to read the example's best mitigation." : ""}
      </p>
    );
  }
  const report = mitigation.data;
  const row = report.days.find((item) => dayKey(item.date) === day);
  return (
    <>
      <p className="disclaimer">{report.disclaimer}</p>
      <p className="fact-note">
        A street counts as flooded above {report.flooded_threshold_m.toFixed(2)} m.
        {report.street_network_stub ? " Street network is a stub grid." : ""}
        {report.synthetic ? " Synthetic run." : ""}
      </p>
      {row ? (
        <table className="compare">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Flooded length</th>
              <th>Peak depth</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Baseline</th>
              <td>{formatQuantity(row.baseline.flooded_street_length, false)}</td>
              <td>{formatQuantity(row.baseline.peak_depth, false)}</td>
            </tr>
            {Object.entries(row.scenarios).map(([name, scenario]) => (
              <tr key={name}>
                <th scope="row">
                  <code>{name}</code>
                  {scenario.label ? <span className="fact-note">{scenario.label}</span> : null}
                  {scenario.lever_kind ? <span className="fact-note">{scenario.lever_kind}</span> : null}
                </th>
                <td className={deltaClass(scenario.delta_flooded_street_length.value)}>
                  {formatQuantity(scenario.delta_flooded_street_length, false)}
                  <span className="fact-note">
                    Deepest cell {formatQuantity(scenario.min_cell_delta_max_depth, false)}
                  </span>
                </td>
                <td className={deltaClass(scenario.delta_peak_depth.value)}>
                  {formatQuantity(scenario.delta_peak_depth, false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="notice">This day is missing from the mitigation comparison.</p>
      )}
    </>
  );
}

export function SidePanel({ day, streets, hotspots, daily, mitigation }: SidePanelProps) {
  const labels = dayLabels(day);
  const notes = notesFor(streets, hotspots);
  const classes = Object.keys(FLOOD_COLORS) as FloodClass[];
  const fixtureHotspots = hotspots.status === "ready" && hotspots.source === "fixture";

  return (
    <aside className="panel" data-testid="side-panel">
      <p className="kicker">Daily summary</p>
      <h2>{labels.long}</h2>
      <ul className="legend">
        {classes.map((floodClass) => (
          <li key={floodClass}>
            <span style={{ background: FLOOD_COLORS[floodClass] }} />
            {FLOOD_LABELS[floodClass]}
          </li>
        ))}
      </ul>
      <p className="fact-note">Wider lines are deeper water.</p>
      {notes.map((note) => (
        <p key={note} className="notice">
          {note}
        </p>
      ))}
      <DailyBlock day={day} daily={daily} />
      <h2 className="section-title">Mitigation comparison</h2>
      <MitigationBlock day={day} mitigation={mitigation} fixtureHotspots={fixtureHotspots} />
      <p className="footnote">
        Run <code>{runId()}</code>
        <span>{apiBase()}</span>
      </p>
    </aside>
  );
}
