import { formatDepth, formatMinutes, formatQuantity, formatWhen } from "@/lib/format";
import { explainHotspotProblem } from "@/lib/hotspotStory";
import { hasToken } from "@/lib/style";
import type { HotspotProps, InflowDir } from "@/lib/types";

type BudgetKey =
  | "rain_in"
  | "roof_in"
  | "inflow"
  | "runoff_out"
  | "drainage_out"
  | "infiltration_out"
  | "boundary_outflow"
  | "tank"
  | "storage_end"
  | "stored_depth_peak"
  | "residual_rel";

const STEPS: { key: BudgetKey; label: string }[] = [
  { key: "rain_in", label: "Rain in" },
  { key: "roof_in", label: "Roof in" },
  { key: "inflow", label: "Lateral inflow" },
  { key: "runoff_out", label: "Runoff out" },
  { key: "drainage_out", label: "Drainage out" },
  { key: "infiltration_out", label: "Infiltration out" },
  { key: "boundary_outflow", label: "Boundary outflow" },
  { key: "tank", label: "Tank" },
  { key: "storage_end", label: "Storage at end" },
  { key: "stored_depth_peak", label: "Peak stored depth" },
  { key: "residual_rel", label: "Budget residual" },
];

const DIRECTIONS: InflowDir[] = ["N", "E", "S", "W"];

export function HotspotCard({ properties }: { properties: HotspotProps }) {
  const street = properties.nearest_street?.name || properties.nearest_street?.segment_id || "Unnamed street";
  const rain = properties.local_rainfall;
  const explanation = properties.explanation;
  const best = explanation?.best_mitigation;
  const story = explainHotspotProblem(properties);
  const qualityText = `${properties.uncertainty_status} ${properties.data_quality}`;
  const synthetic = hasToken(qualityText, "SYNTHETIC");
  const conditional = hasToken(qualityText, "CONDITIONAL");

  return (
    <article className="hotspot-card" data-testid="hotspot-popup">
      <p className="kicker">Hotspot {properties.rank}</p>
      <h2>{street}</h2>

      <section className="hotspot-story" aria-label="Why this is a problem">
        <p className="hotspot-lead">{story.lead}</p>
        <ul className="hotspot-reasons">
          {story.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="hotspot-caveat">{story.caveat}</p>
        {synthetic || conditional ? (
          <p className={`quality-badge${synthetic ? " is-synthetic" : ""}${conditional ? " is-conditional" : ""}`}>
            {synthetic ? <span>SYNTHETIC</span> : null}
            {conditional ? <span>CONDITIONAL</span> : null}
          </p>
        ) : null}
      </section>

      <h3>What the model measured</h3>
      <dl className="facts">
        <dt>Rainfall</dt>
        <dd>
          {rain?.label ? <span className="fact-note">{rain.label}</span> : null}
          <span>Gauge day total: {formatQuantity(rain?.day_total)}</span>
          {rain?.day_total?.value == null && rain?.reason ? (
            <span className="fact-note">{rain.reason}</span>
          ) : null}
          <span>Model forcing: {formatQuantity(properties.model_forcing_rain)}</span>
        </dd>
        <dt>Peak depth</dt>
        <dd>
          {formatDepth(properties.peak_depth_m)} at {formatWhen(properties.peak_time_local)}
          {properties.peak_time_resolution ? (
            <span className="fact-note">{properties.peak_time_resolution}</span>
          ) : null}
        </dd>
        <dt>Minutes above 0.10 m</dt>
        <dd>{formatMinutes(properties["minutes_above_0.10m"])}</dd>
        <dt>Minutes above 0.30 m</dt>
        <dd>{formatMinutes(properties["minutes_above_0.30m"])}</dd>
        <dt>Inflow direction</dt>
        <dd>
          <span>Main inflow {properties.main_inflow_direction ?? "—"}</span>
          <ul className="inflow">
            {DIRECTIONS.map((dir) => (
              <li key={dir}>
                {dir} {formatQuantity(properties.inflow_by_direction?.[dir], false)}
              </li>
            ))}
          </ul>
        </dd>
      </dl>

      <details className="hotspot-budget">
        <summary>Water budget (technical)</summary>
        {explanation?.budget_period ? <p className="fact-note">{explanation.budget_period}</p> : null}
        {explanation ? (
          <ol className="steps">
            {STEPS.map((step) => (
              <li key={step.key}>
                <span>{step.label}</span>
                <span>{formatQuantity(explanation[step.key])}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>This hotspot has no explanation budget.</p>
        )}
      </details>

      <h3>Best mitigation</h3>
      {best ? (
        <div className="mitigation-best">
          <strong>{best.scenario}</strong>
          <span>Peak depth change {formatQuantity(best.delta_peak_depth)}</span>
          <span className="fact-note">{best.label}</span>
        </div>
      ) : (
        <p>{explanation?.best_mitigation_note || "Best mitigation was not included in this response."}</p>
      )}
    </article>
  );
}
