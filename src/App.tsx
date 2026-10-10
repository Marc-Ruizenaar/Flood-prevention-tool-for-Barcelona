import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import { AboutPanel } from "./components/AboutPanel";
import { FloodLegend } from "./components/FloodLegend";
import { FactSheet } from "./components/FactSheet";
import { LayerDock } from "./components/LayerDock";
import { MapCanvas, type MapHandle } from "./components/MapCanvas";
import { BuildReport } from "./components/BuildReport";
import { CityFocusPanel } from "./components/CityFocusPanel";
import { ModelPanel } from "./components/ModelPanel";
import type { CityAction } from "./lib/cityActions";
import { WeatherPanel } from "./components/WeatherPanel";
import { reportShowsOn, useFloodData } from "./lib/data";
import {
  dayKey,
  isAbortError,
  loadDaily,
  loadHotspots,
  loadMitigation,
  loadStreets,
  streetsExtent,
  type DailySummary,
  type HotspotsCollection,
  type Loaded,
  type MitigationReport,
  type StreetsCollection,
} from "./lib/sim";
import {
  atlasLocked,
  fetchGauges,
  layersForRain,
  peakOf,
  rainCaption,
  RAIN_SNAPSHOT,
  type Gauge,
} from "./lib/rain";
import {
  APP_DAYS,
  dayByDate,
  DEFAULT_DAY,
  formatDay,
  listedDays,
  PROOF_DAY,
  shortDay,
} from "./lib/weather";
import { DEFAULT_VISIBILITY, groupForZone, type GroupId } from "./types";

// A reviewed signal dot dated this day counts as a report, so it unlocks the layer like a proof dot.
function hasReportsOn(date: string, signals?: FeatureCollection): boolean {
  if (dayByDate(date).reportIds.length > 0) return true;
  return (signals?.features ?? []).some((f) => Array.isArray(f.properties?.days) && reportShowsOn(f.properties?.days, date));
}

// Reported places (proof dots and reviewed reports) that sit outside the simulated streets' extent.
function blindSpotCount(extent: [number, number, number, number], reports: FeatureCollection[]) {
  const [w, s, e, n] = extent;
  const points = reports
    .flatMap((collection) => collection.features)
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => (feature.geometry as Point).coordinates);
  const outside = points.filter(([x, y]) => x < w || x > e || y < s || y > n).length;
  return { outside, total: points.length };
}

export function App() {
  const data = useFloodData();
  const [gauges, setGauges] = useState<Record<string, Gauge>>(RAIN_SNAPSHOT);
  const [rainLive, setRainLive] = useState<boolean | null>(null);
  const [visibility, setVisibility] = useState(() =>
    layersForRain(dayByDate(DEFAULT_DAY).reportIds.length > 0, DEFAULT_VISIBILITY),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [modelStreets, setModelStreets] = useState<Loaded<StreetsCollection>>({ status: "loading" });
  const [modelHotspots, setModelHotspots] = useState<Loaded<HotspotsCollection>>({ status: "loading" });
  const [modelDaily, setModelDaily] = useState<Loaded<DailySummary[]>>({ status: "loading" });
  const [modelMitigation, setModelMitigation] = useState<Loaded<MitigationReport>>({ status: "loading" });
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [day, setDay] = useState<string>(DEFAULT_DAY);
  const [panelOpen, setPanelOpen] = useState(false);
  const dragRef = useRef<{ y: number; swiped: boolean }>({ y: 0, swiped: false });
  const mapRef = useRef<MapHandle>(null);
  const [tilted, setTilted] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchGauges()
      .then((next) => {
        if (cancelled) return;
        setGauges({ ...RAIN_SNAPSHOT, ...next });
        setRainLive(true);
      })
      .catch(() => {
        if (!cancelled) setRainLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data.ready || !data.zones) return;
    const id = new URLSearchParams(window.location.search).get("zone");
    if (!id || !data.zones[id]) return;
    const zone = data.zones[id];
    setVisibility((current) => ({ ...current, [groupForZone(zone)]: true }));
    setSelectedId(id);
    setFocusNonce((nonce) => nonce + 1);
  }, [data.ready, data.zones]);

  useEffect(() => {
    const ctrl = new AbortController();
    setModelStreets({ status: "loading" });
    setModelHotspots({ status: "loading" });
    void Promise.all([loadStreets(day, ctrl.signal), loadHotspots(day, ctrl.signal)])
      .then(([streets, hotspots]) => {
        if (ctrl.signal.aborted) return;
        setModelStreets(streets);
        setModelHotspots(hotspots);
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setModelStreets({ status: "error", message: "Could not load streets." });
        setModelHotspots({ status: "error", message: "Could not load hotspots." });
      });
    return () => ctrl.abort();
  }, [day]);

  useEffect(() => {
    const ctrl = new AbortController();
    setModelDaily({ status: "loading" });
    setModelMitigation({ status: "loading" });
    void (async () => {
      try {
        const daily = await loadDaily(ctrl.signal);
        if (!ctrl.signal.aborted) setModelDaily(daily);
        if (daily.status === "ready") {
          const dates = daily.data.map((row) => dayKey(row.date_local));
          setDay((current) => (dates.includes(current) ? current : dates[0] ?? current));
        }
      } catch (error) {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setModelDaily({ status: "error", message: "Could not load the daily summary." });
      }
      try {
        const mitigation = await loadMitigation(ctrl.signal);
        if (!ctrl.signal.aborted) setModelMitigation(mitigation);
      } catch (error) {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setModelMitigation({ status: "error", message: "Could not load mitigation." });
      }
    })();
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAboutOpen(false);
      setWeatherOpen(false);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function remember(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("zone", id);
    else url.searchParams.delete("zone");
    window.history.replaceState(null, "", url);
  }

  function openZone(id: string, fly: boolean) {
    if (!data.zones?.[id]) return;
    const proofDay = PROOF_DAY[id];
    const alreadyOnThisDay = dayByDate(day).reportIds.includes(id);
    if (proofDay && !alreadyOnThisDay) {
      applyDay(proofDay);
      setVisibility((current) => ({
        ...current,
        [groupForZone(data.zones![id])]: true,
      }));
    } else if (proofDay || !atlasLocked(peakOf(gauges[day])?.mm ?? null)) {
      setVisibility((current) => ({ ...current, [groupForZone(data.zones![id])]: true }));
    }
    setSelectedId(id);
    remember(id);
    if (fly) setFocusNonce((nonce) => nonce + 1);
  }

  function visibilityFor(date: string, current: Record<GroupId, boolean>) {
    return layersForRain(hasReportsOn(date, data.collections.signals), current);
  }

  function applyDay(date: string) {
    setDay(date);
    setVisibility((current) => visibilityFor(date, current));
  }

  function focusCityAction(action: CityAction) {
    setPanelOpen(false);
    mapRef.current?.focusSimulation(action.coordinates, action.cellId ?? null);
  }

  function selectDay(date: string) {
    applyDay(date);
    if (!selectedId || !data.zones?.[selectedId]) return;
    const proofDay = PROOF_DAY[selectedId];
    const listed = dayByDate(date).reportIds.includes(selectedId);
    const dry = atlasLocked(peakOf(gauges[date])?.mm ?? null);
    const problem = groupForZone(data.zones[selectedId]) !== "relief";
    if ((proofDay && proofDay !== date && !listed) || (dry && problem && !proofDay)) {
      setSelectedId(null);
      remember(null);
    }
  }

  const zone = selectedId && data.zones ? data.zones[selectedId] : undefined;
  const extent = modelStreets.status === "ready" ? streetsExtent(modelStreets.data) : null;
  const blindSpot = extent
    ? blindSpotCount(
        extent,
        [data.collections["proof-oct2026"], data.collections.signals].filter(
          (collection): collection is FeatureCollection => Boolean(collection),
        ),
      )
    : null;

  function showBlindSpot() {
    setPanelOpen(false);
    if (!hasReportsOn(day, data.collections.signals) && atlasLocked(peakOf(gauges[day])?.mm ?? null)) {
      selectDay(DEFAULT_DAY);
    }
    setVisibility((current) => ({ ...current, proof: true }));
    mapRef.current?.reset();
  }

  return (
    <div className={`app${zone ? " sheet-open" : ""}${panelOpen ? " panel-open" : ""}`}>
      <div className="rail">
        <header className="topbar">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <div className="brand-copy">
              <p className="kicker">Next rain · Barcelona</p>
              <h1>{formatDay(day)}</h1>
              <p className="rain-now">{rainCaption(gauges[day], rainLive)}</p>
            </div>
            <div className="when" role="group" aria-label="Which day">
              {APP_DAYS.map((date) => (
                <button
                  key={date}
                  type="button"
                  aria-pressed={day === date}
                  onClick={() => selectDay(date)}
                >
                  {shortDay(date)}
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className={`panel${panelOpen ? " is-open" : ""}`} aria-label="Layers and priorities">
          <button
            type="button"
            className="panel-handle"
            aria-expanded={panelOpen}
            onPointerDown={(event) => {
              dragRef.current = { y: event.clientY, swiped: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              const dy = event.clientY - dragRef.current.y;
              if (Math.abs(dy) < 24) return;
              dragRef.current.swiped = true;
              setPanelOpen(dy < 0);
            }}
            onClick={() => {
              if (dragRef.current.swiped) dragRef.current.swiped = false;
              else setPanelOpen((open) => !open);
            }}
          >
            <span className="handle" aria-hidden="true" />
            <span className="panel-title">Where to act first</span>
            <span className="panel-hint">{panelOpen ? "Show map" : "See list"}</span>
          </button>
          {blindSpot && blindSpot.outside > 0 ? (
            <button type="button" className="panel-claim" onClick={showBlindSpot}>
              <strong>
                {blindSpot.outside} of {blindSpot.total}
              </strong>{" "}
              reported places fall outside the simulated area. <span>Show them</span>
            </button>
          ) : null}

          <LayerDock
            visibility={visibility}
            failed={data.failed}
            dayLabel={formatDay(day)}
            mm={peakOf(gauges[day])?.mm ?? null}
            hasReports={hasReportsOn(day, data.collections.signals)}
            proofLegend={dayByDate(day).proofLegend}
            onToggle={(id: GroupId) => {
              if (
                id === "proof" &&
                !hasReportsOn(day, data.collections.signals) &&
                atlasLocked(peakOf(gauges[day])?.mm ?? null)
              ) {
                return;
              }
              setVisibility((current) => ({ ...current, [id]: !current[id] }));
            }}
          />
          {modelStreets.status === "ready" ? <FloodLegend /> : null}

          <div className="panel-body">
            <CityFocusPanel streets={modelStreets} hotspots={modelHotspots} onFocus={focusCityAction} />
            <details className="panel-more">
              <summary>How the model ran</summary>
              <ModelPanel
                day={day}
                onDay={selectDay}
                streets={modelStreets}
                hotspots={modelHotspots}
                daily={modelDaily}
                mitigation={modelMitigation}
              />
              <BuildReport />
            </details>
          </div>
        </section>
      </div>

      <div className="map-buttons">
        <button
          type="button"
          className="round tilt"
          aria-label="3D view"
          aria-pressed={tilted}
          onClick={() => mapRef.current?.toggleTilt()}
        >
          3D
        </button>
        <button
          type="button"
          className="round"
          aria-label="Weather for the storm week"
          aria-pressed={weatherOpen}
          onClick={() => {
            setAboutOpen(false);
            setWeatherOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 15a4 4 0 1 1 1.2-7.8A5 5 0 0 1 17.6 9 3 3 0 0 1 17 15Z" />
            <path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
          </svg>
        </button>
        <button
          type="button"
          className="round"
          aria-label="About and sources"
          onClick={() => {
            setWeatherOpen(false);
            setAboutOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.5" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        className="round recenter"
        aria-label="Show the whole city"
        onClick={() => mapRef.current?.reset()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>

      {data.fatal ? (
        <div className="banner banner-bad" role="alert">
          The fact cards did not load. {data.fatal}
        </div>
      ) : null}
      {!data.fatal && data.failed.length > 0 ? (
        <div className="banner" role="status">
          Some layers did not load: {data.failed.join(", ")}. The rest of the map is still available.
        </div>
      ) : null}
      {!data.ready && !data.fatal ? <div className="banner">Loading published layers…</div> : null}

      {data.ready && data.zones ? (
        <MapCanvas
          ref={mapRef}
          collections={data.collections}
          visibility={visibility}
          selectedId={selectedId}
          day={day}
          focusNonce={focusNonce}
          onSelect={(id) => openZone(id, false)}
          modelStreets={modelStreets.status === "ready" ? modelStreets.data : null}
          modelHotspots={modelHotspots.status === "ready" ? modelHotspots.data : null}
          onTiltChange={setTilted}
        />
      ) : (
        <div className="map map-pending" />
      )}

      {zone && data.zones ? (
        <FactSheet
          key={zone.id}
          zone={zone}
          zones={data.zones}
          relief={data.relief?.places[zone.id]}
          reliefSourceUrl={data.relief?.sourceUrl}
          onClose={() => {
            setSelectedId(null);
            remember(null);
          }}
          onOpen={(id) => openZone(id, true)}
        />
      ) : null}

      {weatherOpen && data.zones ? (
        <WeatherPanel
          day={day}
          days={listedDays()}
          gauges={gauges}
          rainLive={rainLive}
          zones={data.zones}
          onSelectDay={selectDay}
          onOpenReport={(id) => {
            setWeatherOpen(false);
            openZone(id, true);
          }}
          onClose={() => setWeatherOpen(false)}
        />
      ) : null}

      {aboutOpen ? <AboutPanel sources={data.sources} onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
