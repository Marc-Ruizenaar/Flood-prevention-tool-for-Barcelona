import { useEffect, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { AboutPanel } from "./components/AboutPanel";
import { FactSheet } from "./components/FactSheet";
import { LayerDock } from "./components/LayerDock";
import { MapCanvas, type MapHandle } from "./components/MapCanvas";
import { WeatherPanel } from "./components/WeatherPanel";
import { useFloodData } from "./lib/data";
import { readFlooding } from "./lib/flooding";
import {
  atlasLocked,
  fetchGauges,
  layersForRain,
  peakOf,
  rainCaption,
  RAIN_SNAPSHOT,
  rainStrength,
  type Gauge,
} from "./lib/rain";
import { dayByDate, daysForWeek, DEFAULT_DAY, formatDay, PROOF_DAY, weekDates } from "./lib/weather";
import { DEFAULT_VISIBILITY, groupForZone, type GroupId } from "./types";

// A reviewed signal dot dated this day counts as a report, so it unlocks the layer like a proof dot.
function hasReportsOn(date: string, signals?: FeatureCollection): boolean {
  if (dayByDate(date).reportIds.length > 0) return true;
  return (signals?.features ?? []).some((f) => (f.properties?.days as string[] | undefined)?.includes(date));
}

export function App() {
  const data = useFloodData();
  const [gauges, setGauges] = useState<Record<string, Gauge>>(RAIN_SNAPSHOT);
  const [rainLive, setRainLive] = useState<boolean | null>(null);
  const [visibility, setVisibility] = useState(() =>
    layersForRain(peakOf(RAIN_SNAPSHOT[DEFAULT_DAY.this])?.mm ?? null, false, DEFAULT_VISIBILITY),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [past, setPast] = useState(false);
  const [day, setDay] = useState<string>(DEFAULT_DAY.this);
  const mapRef = useRef<MapHandle>(null);
  const dayRef = useRef(day);
  dayRef.current = day;
  const packRef = useRef({ zones: data.zones, relief: data.relief, signals: data.collections.signals });
  packRef.current = { zones: data.zones, relief: data.relief, signals: data.collections.signals };

  useEffect(() => {
    let cancelled = false;
    fetchGauges()
      .then((next) => {
        if (cancelled) return;
        const merged = { ...RAIN_SNAPSHOT, ...next };
        setGauges(merged);
        setRainLive(true);
        const currentDay = dayRef.current;
        const { zones, relief } = packRef.current;
        setVisibility((current) => {
          if (!zones || !relief) {
            return layersForRain(
              peakOf(merged[currentDay])?.mm ?? null,
              hasReportsOn(currentDay, packRef.current.signals),
              current,
            );
          }
          const reading = readFlooding({
            day: currentDay,
            gauges: merged,
            zones,
            relief,
          });
          const next = {
            ...current,
            sewers: false,
            streams: false,
            slopes: false,
            proof: hasReportsOn(currentDay, packRef.current.signals),
          };
          for (const place of reading.places) next[place.group] = true;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setRainLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data.zones || !data.relief) return;
    setVisibility((current) => visibilityFor(day, gauges, current));
  }, [data.zones, data.relief, gauges, day]);

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
      setDay(proofDay);
      if (!weekDates(past).includes(proofDay)) setPast(true);
      setVisibility((current) => ({
        ...visibilityFor(proofDay, gauges, current),
        [groupForZone(data.zones![id])]: true,
      }));
    } else if (proofDay || !atlasLocked(peakOf(gauges[day])?.mm ?? null)) {
      setVisibility((current) => ({ ...current, [groupForZone(data.zones![id])]: true }));
    }
    setSelectedId(id);
    remember(id);
    if (fly) setFocusNonce((nonce) => nonce + 1);
  }

  function visibilityFor(date: string, source: Record<string, Gauge>, current: Record<GroupId, boolean>) {
    const reports = hasReportsOn(date, data.collections.signals);
    if (!data.zones || !data.relief) {
      return layersForRain(peakOf(source[date])?.mm ?? null, reports, current);
    }
    const reading = readFlooding({ day: date, gauges: source, zones: data.zones, relief: data.relief });
    const next = { ...current, sewers: false, streams: false, slopes: false, proof: reports };
    for (const place of reading.places) next[place.group] = true;
    return next;
  }

  function applyDay(date: string) {
    setDay(date);
    setVisibility((current) => visibilityFor(date, gauges, current));
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

  function blindSpot() {
    if (atlasLocked(peakOf(gauges[day])?.mm ?? null)) return;
    setVisibility({ relief: true, sewers: false, streams: false, slopes: true, proof: true });
    setSelectedId("slope-torre-baro");
    remember("slope-torre-baro");
    setFocusNonce((nonce) => nonce + 1);
  }

  function showPast() {
    if (past) return;
    setPast(true);
    applyDay(DEFAULT_DAY.past);
    setSelectedId(null);
    remember(null);
    mapRef.current?.reset();
  }

  function showThisWeek() {
    if (!past) return;
    setPast(false);
    applyDay(DEFAULT_DAY.this);
    setSelectedId(null);
    remember(null);
    mapRef.current?.reset();
  }

  const zone = selectedId && data.zones ? data.zones[selectedId] : undefined;

  return (
    <div className={`app${zone ? " sheet-open" : ""}${past ? " is-past" : ""}`}>
      <header className="topbar">
        <div className={`brand${past ? " is-past" : ""}`}>
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="kicker">{past ? "3–7 October" : "5–11 October"}</p>
            <h1>{formatDay(day)}</h1>
            <p className="rain-now">{rainCaption(gauges[day], rainLive)}</p>
          </div>
        </div>
        <div className="topbar-break" aria-hidden="true" />
        <div className="when" role="group" aria-label="Which week">
          <button type="button" aria-pressed={!past} onClick={showThisWeek}>
            This week
          </button>
          <button type="button" aria-pressed={past} onClick={showPast}>
            Past
          </button>
        </div>
        <div className="top-actions">
          <button type="button" className="pill" onClick={() => mapRef.current?.reset()}>
            City
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={weatherOpen}
            onClick={() => {
              setAboutOpen(false);
              setWeatherOpen(true);
            }}
          >
            Weather
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              setWeatherOpen(false);
              setAboutOpen(true);
            }}
          >
            About
          </button>
        </div>
      </header>

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
          relief={data.relief ? { image: data.relief.image, bounds: data.relief.bounds } : null}
          visibility={visibility}
          selectedId={selectedId}
          day={day}
          strength={rainStrength(peakOf(gauges[day])?.mm ?? null)}
          focusNonce={focusNonce}
          onSelect={(id) => openZone(id, false)}
        />
      ) : (
        <div className="map map-pending" />
      )}

      <LayerDock
        visibility={visibility}
        failed={data.failed}
        dayLabel={formatDay(day)}
        mm={peakOf(gauges[day])?.mm ?? null}
        hasReports={hasReportsOn(day, data.collections.signals)}
        proofLegend={dayByDate(day).proofLegend}
        reading={
          data.zones && data.relief
            ? readFlooding({ day, gauges, zones: data.zones, relief: data.relief })
            : null
        }
        onOpenPlace={(id) => openZone(id, true)}
        onToggle={(id: GroupId) => {
          if (id !== "relief" && id !== "proof" && atlasLocked(peakOf(gauges[day])?.mm ?? null)) return;
          setVisibility((current) => ({ ...current, [id]: !current[id] }));
        }}
        onBlindSpot={blindSpot}
      />

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
          past={past}
          day={day}
          days={daysForWeek(past)}
          gauges={gauges}
          rainLive={rainLive}
          zones={data.zones}
          relief={data.relief}
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
