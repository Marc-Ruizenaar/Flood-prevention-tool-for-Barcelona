"use client";

import { useMemo } from "react";
import {
  actionCategoryLabel,
  deriveCityActions,
  type CityAction,
} from "@/lib/cityActions";
import type { HotspotsCollection, Loaded, StreetsCollection } from "@/lib/types";

type CityFocusPanelProps = {
  streets: Loaded<StreetsCollection>;
  hotspots: Loaded<HotspotsCollection>;
  onFocus?: (action: CityAction) => void;
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
    <section className="city-focus-block" data-testid="city-focus-panel">
      <h2 className="section-title">City focus</h2>
      <p className="notice">
        Suggested priorities from the simulated run — not live orders.
        {onFocus ? " Tap a row to fly the map." : ""}
      </p>
      {loading ? <p className="muted">Building checklist…</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      {actions && actions.length === 0 ? (
        <p className="notice">No priority actions for this day.</p>
      ) : null}
      {actions && actions.length > 0 ? (
        <ol className="city-action-list">
          {actions.map((action, index) => (
            <li key={action.id}>
              {onFocus ? (
                <button type="button" className="city-action-row" onClick={() => onFocus(action)}>
                  <ActionBody action={action} index={index} />
                </button>
              ) : (
                <div className="city-action-row city-action-row-static">
                  <ActionBody action={action} index={index} />
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function ActionBody({ action, index }: { action: CityAction; index: number }) {
  return (
    <>
      <span className="city-action-rank" aria-hidden="true">
        {index + 1}
      </span>
      <span className="city-action-body">
        <span className={`city-action-chip city-action-chip-${action.category}`}>
          {actionCategoryLabel(action.category)}
        </span>
        <span className="city-action-title">{action.title}</span>
        <span className="city-action-detail">{action.detail}</span>
        <span className="city-action-evidence">
          {action.evidence.slice(0, 3).map((item) => (
            <span key={`${item.label}-${item.value}`}>
              {item.label}: {item.value}
            </span>
          ))}
        </span>
      </span>
    </>
  );
}
