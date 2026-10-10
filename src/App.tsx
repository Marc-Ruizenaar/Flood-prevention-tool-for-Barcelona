import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./lib/i18n";
import { LangSwitch } from "./components/LangSwitch";
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
  chunksFor,
  dayKey,
  insideAny,
  isAbortError,
  loadDaily,
  loadHotspots,
  loadMitigation,
  loadRunIndex,
  loadStreets,
  runBoxes,
  streetsExtent,
  type Bbox,
  type DailySummary,
  type HotspotsCollection,
  type Loaded,
  type MitigationReport,
  type RunIndex,
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

// Reported places (proof dots and reviewed reports) that sit outside every simulated area.
function blindSpotCount(boxes: Bbox[], reports: FeatureCollection[]) {
  const points = reports
    .flatMap((collection) => collection.features)
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => (feature.geometry as Point).coordinates as [number, number]);
  const outside = points.filter((p) => !insideAny(boxes, p)).length;
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
  const [layersOpen, setLayersOpen] = useState(false);
  const [day, setDay] = useState<string>(DEFAULT_DAY);
  const [index, setIndex] = useState<RunIndex | null>(null);
  const [view, setView] = useState<Bbox | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const dragRef = useRef<{ y: number; swiped: boolean }>({ y: 0, swiped: false });
  const mapRef = useRef<MapHandle>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const [tilted, setTilted] = useState(true);

  // The top card's height depends on the language, so the floating buttons follow the measured height.
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const apply = () => el.closest<HTMLElement>(".app")?.style.setProperty("--top-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    let cancelled = false;
    loadRunIndex()
      .then((next) => {
        if (!cancelled) setIndex(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Same chunk set means no reload, so panning inside the loaded areas is free.
  const chunkKey = index ? chunksFor(index, day, view).map((c) => c.id).join(",") : "";

  useEffect(() => {
    const ctrl = new AbortController();
    setModelStreets({ status: "loading" });
    setModelHotspots({ status: "loading" });
    void Promise.all([loadStreets(day, ctrl.signal, view), loadHotspots(day, ctrl.signal, view)])
      .then(([streets, hotspots]) => {
        if (ctrl.signal.aborted) return;
        setModelStreets(streets);
        setModelHotspots(hotspots);
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setModelStreets({ status: "error", message: t("Could not load streets.") });
        setModelHotspots({ status: "error", message: t("Could not load hotspots.") });
      });
    return () => ctrl.abort();
    // `view` is read through chunkKey: a new view only matters when it changes the chunk set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, chunkKey]);

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
        setModelDaily({ status: "error", message: t("Could not load the daily summary.") });
      }
      try {
        const mitigation = await loadMitigation(ctrl.signal);
        if (!ctrl.signal.aborted) setModelMitigation(mitigation);
      } catch (error) {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setModelMitigation({ status: "error", message: t("Could not load mitigation.") });
      }
    })();
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAboutOpen(false);
      setWeatherOpen(false);
      setLayersOpen(false);
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
  // Run boxes from the index; in API mode the index has no boxes, so fall back to the loaded streets' extent.
  const boxes = useMemo<Bbox[]>(() => {
    const fromIndex = index ? runBoxes(index) : [];
    if (fromIndex.length > 0) return fromIndex;
    const extent = modelStreets.status === "ready" ? streetsExtent(modelStreets.data) : null;
    return extent ? [extent] : [];
  }, [index, modelStreets]);
  const blindSpot = boxes.length > 0
    ? blindSpotCount(
        boxes,
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
        <header className="topbar" ref={topbarRef}>
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <div className="brand-copy">
              <p className="kicker">{t("Next rain · Barcelona")}</p>
              <h1>{formatDay(day)}</h1>
              <p className="rain-now">{rainCaption(gauges[day], rainLive)}</p>
              <p className="purpose">{t("Where water collected, and where to act before the next storm.")}</p>
            </div>
            <div className="switches">
            <LangSwitch />
            <div className="when" role="group" aria-label={t("Which day")}>
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
          </div>
        </header>

        <section className={`panel${panelOpen ? " is-open" : ""}`} aria-label={t("Layers and priorities")}>
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
            <span className="panel-title">{t("Where to act first")}</span>
            <span className="panel-hint">{panelOpen ? t("Show map") : t("See list")}</span>
          </button>
          {blindSpot && blindSpot.outside > 0 ? (
            <button type="button" className="panel-claim" onClick={showBlindSpot}>
              <strong>{t("{n} of {total}", { n: blindSpot.outside, total: blindSpot.total })}</strong>{" "}
              {t("places that reported flooding are outside the simulated area.")} <span>{t("Show them")}</span>
            </button>
          ) : null}

          {modelStreets.status === "ready" ? <FloodLegend /> : null}

          <div className="panel-body">
            <CityFocusPanel streets={modelStreets} hotspots={modelHotspots} onFocus={focusCityAction} />
            <details className="panel-more">
              <summary>{t("How the model ran")}</summary>
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
          className="round"
          aria-label={t("Map layers")}
          aria-pressed={layersOpen}
          onClick={() => {
            setAboutOpen(false);
            setWeatherOpen(false);
            setLayersOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4l8 4.5-8 4.5-8-4.5Z" />
            <path d="M4 13l8 4.5 8-4.5" />
            <path d="M4 16.5L12 21l8-4.5" />
          </svg>
        </button>
        <button
          type="button"
          className="round tilt"
          aria-label={t("3D view")}
          aria-pressed={tilted}
          onClick={() => mapRef.current?.toggleTilt()}
        >
          3D
        </button>
        <button
          type="button"
          className="round"
          aria-label={t("Weather for the storm week")}
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
          aria-label={t("About and sources")}
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
        <a className="round" href="/citizen" aria-label={t("Resident view: is my street at risk?")} title={t("Resident view")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11l8-7 8 7" />
            <path d="M6 10v10h12V10" />
            <path d="M10 20v-5h4v5" />
          </svg>
        </a>
      </div>
      <button
        type="button"
        className="round recenter"
        aria-label={t("Show the whole city")}
        onClick={() => mapRef.current?.reset()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>

      {data.fatal ? (
        <div className="banner banner-bad" role="alert">
          {t("The fact cards did not load.")} {data.fatal}
        </div>
      ) : null}
      {!data.fatal && data.failed.length > 0 ? (
        <div className="banner" role="status">
          {t("Some layers did not load: {list}. The rest of the map is still available.", { list: data.failed.join(", ") })}
        </div>
      ) : null}
      {!data.ready && !data.fatal ? <div className="banner">{t("Loading published layers…")}</div> : null}

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
          modelBoxes={boxes}
          onViewChange={setView}
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

      {layersOpen ? (
        <LayerDock
          visibility={visibility}
          failed={data.failed}
          dayLabel={formatDay(day)}
          mm={peakOf(gauges[day])?.mm ?? null}
          hasReports={hasReportsOn(day, data.collections.signals)}
          proofLegend={dayByDate(day).proofLegend}
          onClose={() => setLayersOpen(false)}
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
      ) : null}

      {aboutOpen ? <AboutPanel sources={data.sources} onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
