"use client";

import { useEffect, useState } from "react";
import { isAbort, loadDaily, loadHotspots, loadMitigation, loadStreets, runId } from "@/lib/api";
import { dayKey } from "@/lib/format";
import type { DailySummary, HotspotsCollection, Loaded, MitigationReport, StreetsCollection } from "@/lib/types";
import { readQuality } from "@/lib/quality";
import { DaySelector } from "./DaySelector";
import { FloodMap } from "./FloodMap";
import { QualityBadge } from "./QualityBadge";
import type { CityAction } from "@/lib/cityActions";
import { SidePanel } from "./SidePanel";

const loading = { status: "loading" } as const;

export default function FloodApp() {
  const [day, setDay] = useState("2026-10-03");
  const [streets, setStreets] = useState<Loaded<StreetsCollection>>(loading);
  const [hotspots, setHotspots] = useState<Loaded<HotspotsCollection>>(loading);
  const [daily, setDaily] = useState<Loaded<DailySummary[]>>(loading);
  const [mitigation, setMitigation] = useState<Loaded<MitigationReport>>(loading);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lon: number; nonce: number } | null>(null);

  function focusCityAction(action: CityAction) {
    const [lon, lat] = action.coordinates;
    setMapFocus({ lat, lon, nonce: Date.now() });
  }

  useEffect(() => {
    const ctrl = new AbortController();
    setStreets(loading);
    setHotspots(loading);

    void Promise.all([
      loadStreets(day, ctrl.signal),
      loadHotspots(day, ctrl.signal),
    ])
      .then(([streetResult, hotspotResult]) => {
        if (ctrl.signal.aborted) return;
        setStreets(streetResult);
        setHotspots(hotspotResult);
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted || isAbort(error)) return;
        setStreets({ status: "error", message: "Could not load streets." });
        setHotspots({ status: "error", message: "Could not load hotspots." });
      });

    return () => ctrl.abort();
  }, [day]);

  useEffect(() => {
    const ctrl = new AbortController();
    setDaily(loading);
    setMitigation(loading);

    void (async () => {
      try {
        const dailyResult = await loadDaily(ctrl.signal);
        if (!ctrl.signal.aborted) setDaily(dailyResult);
      } catch (error) {
        if (ctrl.signal.aborted || isAbort(error)) return;
        setDaily({ status: "error", message: "Could not load the daily summary." });
      }
      try {
        const mitigationResult = await loadMitigation(ctrl.signal);
        if (!ctrl.signal.aborted) setMitigation(mitigationResult);
      } catch (error) {
        if (ctrl.signal.aborted || isAbort(error)) return;
        setMitigation({ status: "error", message: "Could not load mitigation." });
      }
    })();

    return () => ctrl.abort();
  }, []);

  const availableDays = daily.status === "ready" ? daily.data.map((row) => dayKey(row.date_local)) : null;

  const quality = readQuality(streets, hotspots);
  const live = [streets, hotspots].some((layer) => layer.status === "ready" && layer.source === "api");
  const example = [streets, hotspots].some((layer) => layer.status === "ready" && layer.source !== "api");

  return (
    <div className="shell">
      <FloodMap day={day} streets={streets} hotspots={hotspots} mapFocus={mapFocus} />
      <header className="hud">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="kicker">Barcelona · {runId()}</p>
            <h1>Flood streets</h1>
          </div>
        </div>
        <DaySelector day={day} available={availableDays} onChange={setDay} />
        <QualityBadge {...quality} />
        {streets.status === "loading" ? <p className="source-chip">Loading {day}…</p> : null}
        {live ? <p className="source-chip">Live API</p> : null}
        {example && !live ? <p className="source-chip">Example fixture</p> : null}
      </header>
      <SidePanel
        day={day}
        streets={streets}
        hotspots={hotspots}
        daily={daily}
        mitigation={mitigation}
        onFocusAction={focusCityAction}
      />
    </div>
  );
}
