import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";

maplibregl.setMaxParallelImageRequests(16);
import type { Feature } from "geojson";
import { useFloodData } from "./lib/data";
import { FLOOD_CLASSES, FLOOD_COLORS, FLOOD_LABELS, floodColorExpression, streetWidth } from "./lib/modelStyle";
import { DEPTH_WORDS, metresBetween, nearestPoint, worstStreetNear, type LngLat } from "./lib/nearby";
import {
  boxAround,
  boxOutline,
  chunksFor,
  insideAny,
  loadRunIndex,
  loadStreets,
  runBoxes,
  unionBox,
  type Bbox,
  type Loaded,
  type RunIndex,
  type StreetsCollection,
} from "./lib/sim";
import { DEFAULT_DAY, formatDay } from "./lib/weather";
import { t } from "./lib/i18n";
import { LangSwitch } from "./components/LangSwitch";
import { RESOURCES, closedNear, streetsToAvoid } from "./lib/evacuation";

// The resident view: one question ("what happened near me?"), plain words, and what to do next time.
// Same simulated streets as the city view, without the checklist, 3D or model internals.

const CITY_BOUNDS: [[number, number], [number, number]] = [
  [2.09, 41.332],
  [2.22, 41.47],
];
const CITY_CENTRE: LngLat = [2.17, 41.39];
// One word per class so the legend stays on one line on a phone.
const LEGEND_WORDS = { dry: t("Dry"), low: t("Ankle"), moderate: t("Shin"), high: t("Knee"), severe: t("Over knee") } as const;
const ADVICE_URL = "https://dsp.interior.gencat.cat/handle/20.500.14007/3307";

type Place = { at: LngLat; label: string; mine?: boolean };

const EXAMPLES: Place[] = [
  { at: [2.1705, 41.3846], label: "La Rambla" },
  { at: [2.18092, 41.46001], label: "Torre Baró" },
];

export function CitizenApp() {
  const data = useFloodData();
  const [streets, setStreets] = useState<Loaded<StreetsCollection>>({ status: "loading" });
  const [index, setIndex] = useState<RunIndex | null>(null);
  const [view, setView] = useState<Bbox | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    loadRunIndex().then(setIndex).catch(() => undefined);
  }, []);

  // Streets for the chunks touching the view (plus the chosen place). Pans inside the same chunks do not reload.
  const want = place ? unionBox([view, boxAround(place.at, 150)]) : view;
  const chunkKey = index ? chunksFor(index, DEFAULT_DAY, want).map((c) => c.id).join(",") : "";
  useEffect(() => {
    if (!index) return;
    const ctrl = new AbortController();
    setStreets({ status: "loading" });
    loadStreets(DEFAULT_DAY, ctrl.signal, want).then(setStreets).catch(() => undefined);
    return () => ctrl.abort();
  }, [chunkKey]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      bounds: CITY_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;
    const readView = () => {
      const b = map.getBounds();
      setView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on("load", readView);
    map.on("moveend", readView);
    // ponytail: no start screen on the resident view, just a fade so the map does not pop in on a phone.
    map.once("load", () => containerRef.current?.classList.add("is-ready"));
    map.on("load", () => {
      const empty = { type: "FeatureCollection" as const, features: [] };
      map.addSource("streets", { type: "geojson", data: empty });
      map.addSource("area", { type: "geojson", data: empty });
      const dry: maplibregl.ExpressionSpecification = ["==", ["get", "flood_class"], "dry"];
      map.addLayer({
        id: "streets-casing",
        type: "line",
        source: "streets",
        paint: { "line-color": "#1c1917", "line-width": streetWidth(1.5), "line-opacity": ["case", dry, 0.1, 0.35] },
      });
      map.addLayer({
        id: "streets",
        type: "line",
        source: "streets",
        paint: { "line-color": floodColorExpression(), "line-width": streetWidth(), "line-opacity": ["case", dry, 0.3, 0.9] },
      });
      map.addLayer({
        id: "area",
        type: "line",
        source: "area",
        paint: { "line-color": "#142028", "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "area-label",
        type: "symbol",
        source: "area",
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 2000,
          "text-field": t("Simulated area"),
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, -0.8],
        },
        paint: { "text-color": "#142028", "text-halo-color": "#f6f1e7", "text-halo-width": 1.5 },
      });
    });
    map.on("click", (event) => setPlace({ at: [event.lngLat.lng, event.lngLat.lat], label: t("The place you tapped") }));
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || streets.status !== "ready") return;
    const apply = () => (map.getSource("streets") as GeoJSONSource | undefined)?.setData(streets.data);
    if (map.getSource("streets")) apply();
    else map.once("load", apply);
  }, [streets]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !index) return;
    const apply = () => (map.getSource("area") as GeoJSONSource | undefined)?.setData(boxOutline(runBoxes(index)));
    if (map.getSource("area")) apply();
    else map.once("load", apply);
  }, [index]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !place) return;
    // A located person gets a blue pulsing dot (screen readers get the label); a tapped place keeps the dark pin.
    markerRef.current?.remove();
    if (place.mine) {
      const el = document.createElement("div");
      el.className = "you-marker";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", t("Your location"));
      el.title = t("Your location");
      markerRef.current = new maplibregl.Marker({ element: el });
    } else {
      markerRef.current = new maplibregl.Marker({ color: "#142028" });
    }
    markerRef.current.setLngLat(place.at).addTo(map);
    // On a phone the result sheet covers the lower half, so lift the place into the visible gap.
    const phone = window.innerWidth < 960;
    map.flyTo({ center: place.at, zoom: Math.max(map.getZoom(), 15), duration: 700, offset: phone ? [0, -70] : [0, 0] });
  }, [place]);

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError(t("This browser cannot share a location. Tap the map instead."));
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const at: LngLat = [position.coords.longitude, position.coords.latitude];
        if (metresBetween(at, CITY_CENTRE) > 20000) {
          setLocateError(t("You seem to be outside Barcelona. Tap the map or try an example."));
          return;
        }
        setPlace({ at, label: t("Your location"), mine: true });
      },
      () => {
        setLocating(false);
        setLocateError(t("Could not get your location. Tap the map instead."));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const reports: Feature[] = [
    ...(data.collections["proof-oct2026"]?.features ?? []),
    ...(data.collections.signals?.features ?? []),
  ];

  return (
    <div className="citizen">
      <div ref={containerRef} className="map" />

      <header className="citizen-card">
        <div className="citizen-head">
          <p className="kicker">{t("Next rain · Barcelona · For residents")}</p>
          <LangSwitch />
        </div>
        <h1>{t("Is my street at risk?")}</h1>
        <p className="purpose">{t("See how deep the water got near you on {day}, and what to do before the next storm.", { day: formatDay(DEFAULT_DAY) })}</p>
        <div className="citizen-actions">
          <button type="button" className="citizen-primary" onClick={locateMe} disabled={locating}>
            {locating ? t("Finding you…") : t("Use my location")}
          </button>
          {EXAMPLES.map((example) => (
            <button key={example.label} type="button" className="citizen-example" onClick={() => setPlace(example)}>
              {example.label}
            </button>
          ))}
        </div>
        <p className="citizen-hint">{locateError ?? t("Or tap anywhere on the map.")}</p>
        <ul className="flood-legend-list citizen-legend" aria-label={t("Water depth, in plain words")}>
          {FLOOD_CLASSES.map((floodClass) => (
            <li key={floodClass} title={FLOOD_LABELS[floodClass]}>
              <span style={{ background: FLOOD_COLORS[floodClass] }} aria-hidden />
              <em>{LEGEND_WORDS[floodClass]}</em>
            </li>
          ))}
        </ul>
        <a className="citizen-switch" href="/">{t("City staff view →")}</a>
      </header>

      {place ? (
        <section className="citizen-result" aria-live="polite">
          <button type="button" className="close" aria-label={t("Close")} onClick={() => setPlace(null)}>
            ×
          </button>
          <p className="kicker">{place.label}</p>
          <Verdict place={place} streets={streets} boxes={index ? runBoxes(index) : []} reports={reports} zones={data.zones} />
          <h2>{t("Before the next storm")}</h2>
          <ul className="citizen-advice">
            <li>{t("When heavy rain is forecast, move your car off low streets and out of underpasses.")}</li>
            <li>{t("Keep drains, downpipes and the ground-floor or basement door clear, and have something ready to block water.")}</li>
            <li>{t("Never walk or drive through a flooded street. Go into a building and wait.")}</li>
            <li>{t("Follow Protecció Civil alerts. In an emergency, call 112.")}</li>
          </ul>
          <WhatToDo place={place} streets={streets} />
          <p className="citizen-source">
            {t("Advice from")}{" "}
            <a href={ADVICE_URL} target="_blank" rel="noreferrer">
              Protecció Civil de Catalunya, Consells d'autoprotecció: Inundacions
            </a>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Verdict({
  place,
  streets,
  boxes,
  reports,
  zones,
}: {
  place: Place;
  streets: Loaded<StreetsCollection>;
  boxes: Bbox[];
  reports: Feature[];
  zones: ReturnType<typeof useFloodData>["zones"];
}) {
  if (streets.status === "loading") return <p>{t("Loading the simulation…")}</p>;
  if (streets.status === "error") return <p>{t("The simulation did not load. Try again in a moment.")}</p>;

  const day = formatDay(DEFAULT_DAY);
  if (!insideAny(boxes, place.at)) {
    const report = nearestPoint(reports, place.at, 2000);
    const id = String(report?.feature.properties?.id ?? "");
    const card = zones?.[id];
    return (
      <>
        <h2>{t("We have not simulated this area yet")}</h2>
        <p>{t("The street simulation only covers the dashed area in the centre. Outside it, we cannot say how deep the water got.")}</p>
        {report ? (
          <p className="citizen-report">
            <strong>
              {report.metres < 150
                ? t("Reported here:")
                : t("Reported {dist} from here:", {
                    dist: report.metres < 1000 ? `${Math.round(report.metres / 50) * 50} m` : `${(report.metres / 1000).toFixed(1)} km`,
                  })}
            </strong>{" "}
            {String(report.feature.properties?.name ?? t("a flood report"))}.
            {card?.sourceUrl ? (
              <>
                {" "}
                <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                  {card.sourceLabel}
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p>{t("No reports near here either. That does not mean it stayed dry.")}</p>
        )}
      </>
    );
  }

  const worst = worstStreetNear(streets.data, place.at, 100);
  if (!worst || worst.street.flood_class === "dry") {
    return (
      <>
        <h2>{t("Streets near here stayed dry")}</h2>
        <p>{t("In the simulation of {day}, no street within 100 m held water. A different storm could behave differently.", { day })}</p>
        <p className="citizen-caveat">{t("A computer simulation of one storm, not a forecast, and not yet checked against every street.")}</p>
      </>
    );
  }

  const floodClass = worst.street.flood_class;
  return (
    <>
      <h2>
        {t("Water reached")} <span className="citizen-depth">{DEPTH_WORDS[floodClass]}</span> {t("near here")}
      </h2>
      <p>
        {t("{label} on {street}{away}, in the simulation of {day}.", {
          label: FLOOD_LABELS[floodClass],
          street: worst.street.name ?? t("a nearby street"),
          away: worst.metres > 10 ? t(", {m} m away", { m: Math.round(worst.metres) }) : "",
          day,
        })}
      </p>
      <p className="citizen-caveat">{t("A computer simulation of one storm, not a forecast, and not yet checked against every street.")}</p>
    </>
  );
}

// No evacuation routes exist for street flooding in Barcelona; the official plan is to stay inside and go up.
// So this lists the low streets to keep away from, what shut nearby last time, and who to call.
function WhatToDo({ place, streets }: { place: Place; streets: Loaded<StreetsCollection> }) {
  const avoid = streets.status === "ready" ? streetsToAvoid(streets.data, place.at) : [];
  const closed = closedNear(place.at);
  return (
    <>
      <h2>{t("If it floods: where to go")}</h2>
      <p>
        {t("Nowhere, if you can help it. Barcelona has no evacuation routes for street flooding: the plan is to stay inside, go to an upper floor, and keep out of basements, garages and underpasses. Leave only if 112 or Protecció Civil tell you to.")}
      </p>
      {avoid.length ? (
        <p>
          <strong>{t("Streets to keep away from near here:")}</strong>{" "}
          {avoid.map((s) => `${s.name} (${DEPTH_WORDS[s.depth >= 1 ? "severe" : s.depth >= 0.5 ? "high" : "moderate"]})`).join(", ")}.
        </p>
      ) : null}
      {closed.length ? (
        <p>
          <strong>{t("Shut during the October storm, within {km} km:", { km: 1.5 })}</strong>{" "}
          {closed.map((c) => `${c.name}, ${Math.round(c.metres / 100) * 100} m`).join("; ")}.{" "}
          <a href={RESOURCES.closedLastStormSource} target="_blank" rel="noreferrer">
            TMB, 4 Oct
          </a>
        </p>
      ) : null}
      <ul className="citizen-advice">
        {RESOURCES.phones.map((ph) => (
          <li key={ph.number}>
            <strong>{ph.number}</strong> · {t(ph.label)}
          </li>
        ))}
      </ul>
      <p className="citizen-source">
        {RESOURCES.links.map((l, i) => (
          <span key={l.url}>
            {i ? " · " : ""}
            <a href={l.url} target="_blank" rel="noreferrer">
              {t(l.label)}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}
