import { t } from "../lib/i18n";
import { useMemo } from "react";
import {
  actionCategoryLabel,
  deriveCityActions,
  type CityAction,
} from "../lib/cityActions";
import type { HotspotsCollection, Loaded, StreetsCollection } from "../lib/sim";

type CityFocusPanelProps = {
  streets: Loaded<StreetsCollection>;
  hotspots: Loaded<HotspotsCollection>;
  onFocus: (action: CityAction) => void;
};

export function CityFocusPanel({ streets, hotspots, onFocus }: CityFocusPanelProps) {
  const actions = useMemo(() => {
    if (streets.status !== "ready" || hotspots.status !== "ready") return null;
    if (!streets.data.features.length) return [];
    return deriveCityActions(streets.data, hotspots.data, 10);
  }, [streets, hotspots]);

  const loading = streets.status === "loading" || hotspots.status === "loading";
  const error =
    streets.status === "error"
      ? streets.message
      : hotspots.status === "error"
        ? hotspots.message
        : null;

  return (
    <aside className="model-panel city-focus-panel" data-testid="city-focus-panel">
      <p className="model-note">{t("From the simulated run, not live orders. Tap a row to see it on the map.")}</p>
      {loading ? <p className="model-notice">{t("Building checklist from model layers…")}</p> : null}
      {error ? <p className="model-notice">{error}</p> : null}
      {actions && actions.length === 0 ? (
        <p className="model-notice">{t("No priority actions for this day in the model output.")}</p>
      ) : null}
      {actions && actions.length > 0 ? (
        <ol className="city-action-list">
          {actions.map((action, index) => (
            <li key={action.id}>
              <button type="button" className="city-action-row" onClick={() => onFocus(action)}>
                <span className="city-action-rank" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="city-action-body">
                  <span className={`city-action-chip city-action-chip-${action.category}`}>
                    {actionCategoryLabel(action.category)}
                  </span>
                  <span className="city-action-title">{action.title}</span>
                  <span className="city-action-evidence">
                    {action.evidence.slice(0, 3).map((item) => (
                      <span key={`${item.label}-${item.value}`}>
                        {item.label}: {item.value}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
