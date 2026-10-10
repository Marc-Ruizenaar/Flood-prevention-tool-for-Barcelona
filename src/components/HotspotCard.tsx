import { t } from "../lib/i18n";
import { explainHotspotProblem } from "../lib/hotspotStory";
import { FLOOD_LABELS } from "../lib/modelStyle";
import { formatDepth, formatMinutes, formatQuantity, formatWhen, hasToken, type Explanation, type HotspotProps } from "../lib/sim";

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

const DIRECTIONS = ["N", "E", "S", "W"] as const;

// edgePonded: the deep reading sits at the closed edge of the run, so the depth is a wall artefact, an upper bound.
export function HotspotCard({ properties, edgePonded = false }: { properties: HotspotProps; edgePonded?: boolean }) {
  const street = properties.nearest_street?.name || properties.nearest_street?.segment_id || t("Unnamed street");
  const rain = properties.local_rainfall;
  const explanation = properties.explanation;
  const best = explanation?.best_mitigation;
  const story = explainHotspotProblem(properties);
  const qualityText = `${properties.uncertainty_status} ${properties.data_quality}`;
  const synthetic = hasToken(qualityText, "SYNTHETIC");
  const conditional = hasToken(qualityText, "CONDITIONAL");

  return (
    <article className="hotspot-card" data-testid="hotspot-popup">
      <p className="kicker">
        {t("Hotspot {n}", { n: properties.rank })}
        {FLOOD_LABELS[properties.flood_class] ? ` · ${FLOOD_LABELS[properties.flood_class]}` : ""}
      </p>
      <h2>{street}</h2>

      <section className="hotspot-story" aria-label={t("Why this is a problem")}>
        <p className="hotspot-lead">{story.lead}</p>
        <ul className="hotspot-reasons">
          {story.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="hotspot-caveat">{story.caveat}</p>
        {synthetic || conditional || edgePonded ? (
          <p
            className={`model-badge${synthetic ? " is-synthetic" : ""}${conditional ? " is-conditional" : ""}${edgePonded ? " is-edge" : ""}`}
          >
            {synthetic ? <strong>SYNTHETIC</strong> : null}
            {conditional ? <strong>CONDITIONAL</strong> : null}
            {edgePonded ? <strong>{t("Edge ponding")}</strong> : null}
            {edgePonded ? <span className="model-edge-note">{t("Depth is an upper bound")}</span> : null}
          </p>
        ) : null}
      </section>

      <h3>{t("What the model measured")}</h3>
      <dl className="model-facts">
        <dt>{t("Rainfall")}</dt>
        <dd>
          {rain?.label ? <span className="model-note">{rain.label}</span> : null}
          <span>Gauge day total: {formatQuantity(rain?.day_total)}</span>
          {rain?.day_total?.value == null && rain?.reason ? <span className="model-note">{rain.reason}</span> : null}
          <span>Model forcing: {formatQuantity(properties.model_forcing_rain)}</span>
        </dd>
        <dt>{t("Peak depth")}</dt>
        <dd>
          {edgePonded ? t("> 1 m (upper bound)") : formatDepth(properties.peak_depth_m)} at {formatWhen(properties.peak_time_local)}
          {properties.peak_time_resolution ? <span className="model-note">{properties.peak_time_resolution}</span> : null}
        </dd>
        <dt>Minutes above 0.10 m</dt>
        <dd>{formatMinutes(properties["minutes_above_0.10m"])}</dd>
        <dt>Minutes above 0.30 m</dt>
        <dd>{formatMinutes(properties["minutes_above_0.30m"])}</dd>
        <dt>Inflow direction</dt>
        <dd>
          Main inflow {properties.main_inflow_direction ?? "—"}
          <span className="model-inflow">
            {DIRECTIONS.map((dir) => (
              <span key={dir}>
                {dir} {formatQuantity(properties.inflow_by_direction?.[dir], false)}
              </span>
            ))}
          </span>
        </dd>
      </dl>

      <details className="hotspot-budget">
        <summary>{t("Water budget (technical)")}</summary>
        {explanation?.budget_period ? <p className="model-note">{explanation.budget_period}</p> : null}
        {explanation ? (
          <ol className="model-steps">
            {STEPS.map((step) => (
              <li key={step.key}>
                <span>{step.label}</span>
                <span>{formatQuantity(explanation[step.key] as Explanation[BudgetKey])}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>This hotspot has no explanation budget.</p>
        )}
      </details>

      <h3>{t("Best mitigation")}</h3>
      {best ? (
        <p>
          <strong>{best.scenario}</strong>
          <span className="model-note">Peak depth change {formatQuantity(best.delta_peak_depth)}</span>
          <span className="model-note">{best.label}</span>
        </p>
      ) : (
        <p>{explanation?.best_mitigation_note || "Best mitigation was not included in this response."}</p>
      )}
    </article>
  );
}
