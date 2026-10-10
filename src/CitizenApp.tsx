import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
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

// The resident view: one question ("what happened near me?"), plain words, and what to do next time.
// Same simulated streets as the city view, without the checklist, 3D or model internals.

const CITY_BOUNDS: [[number, number], [number, number]] = [
  [2.09, 41.332],
  [2.22, 41.47],
];
const CITY_CENTRE: LngLat = [2.17, 41.39];
// One word per class so the legend stays on one line on a phone.
const LEGEND_WORDS = { dry: "Dry", low: "Ankle", moderate: "Shin", high: "Knee", severe: "Over knee" } as const;
const ADVICE_URL = "https://dsp.interior.gencat.cat/handle/20.500.14007/3307";

type Place = { at: LngLat; label: string };

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
          "text-field": "Simulated area",
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, -0.8],
        },
        paint: { "text-color": "#142028", "text-halo-color": "#f6f1e7", "text-halo-width": 1.5 },
      });
    });
    map.on("click", (event) => setPlace({ at: [event.lngLat.lng, event.lngLat.lat], label: "The place you tapped" }));
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
    markerRef.current ??= new maplibregl.Marker({ color: "#142028" });
    markerRef.current.setLngLat(place.at).addTo(map);
    // On a phone the result sheet covers the lower half, so lift the place into the visible gap.
    const phone = window.innerWidth < 960;
    map.flyTo({ center: place.at, zoom: Math.max(map.getZoom(), 15), duration: 700, offset: phone ? [0, -70] : [0, 0] });
  }, [place]);

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError("This browser cannot share a location. Tap the map instead.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const at: LngLat = [position.coords.longitude, position.coords.latitude];
        if (metresBetween(at, CITY_CENTRE) > 20000) {
          setLocateError("You seem to be outside Barcelona. Tap the map or try an example.");
          return;
        }
        setPlace({ at, label: "Your location" });
      },
      () => {
        setLocating(false);
        setLocateError("Could not get your location. Tap the map instead.");
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
        <p className="kicker">Next rain · Barcelona · For residents</p>
        <h1>Is my street at risk?</h1>
        <p className="purpose">See how deep the water got near you on {formatDay(DEFAULT_DAY)}, and what to do before the next storm.</p>
        <div className="citizen-actions">
          <button type="button" className="citizen-primary" onClick={locateMe} disabled={locating}>
            {locating ? "Finding you…" : "Use my location"}
          </button>
          {EXAMPLES.map((example) => (
            <button key={example.label} type="button" className="citizen-example" onClick={() => setPlace(example)}>
              {example.label}
            </button>
          ))}
        </div>
        <p className="citizen-hint">{locateError ?? "Or tap anywhere on the map."}</p>
        <ul className="flood-legend-list citizen-legend" aria-label="Water depth, in plain words">
          {FLOOD_CLASSES.map((floodClass) => (
            <li key={floodClass} title={FLOOD_LABELS[floodClass]}>
              <span style={{ background: FLOOD_COLORS[floodClass] }} aria-hidden />
              <em>{LEGEND_WORDS[floodClass]}</em>
            </li>
          ))}
        </ul>
        <a className="citizen-switch" href="/">City staff view →</a>
      </header>

      {place ? (
        <section className="citizen-result" aria-live="polite">
          <button type="button" className="close" aria-label="Close" onClick={() => setPlace(null)}>
            ×
          </button>
          <p className="kicker">{place.label}</p>
          <Verdict place={place} streets={streets} boxes={index ? runBoxes(index) : []} reports={reports} zones={data.zones} />
          <h2>Before the next storm</h2>
          <ul className="citizen-advice">
            <li>When heavy rain is forecast, move your car off low streets and out of underpasses.</li>
            <li>Keep drains, downpipes and the ground-floor or basement door clear, and have something ready to block water.</li>
            <li>Never walk or drive through a flooded street. Go into a building and wait.</li>
            <li>Follow Protecció Civil alerts. In an emergency, call 112.</li>
          </ul>
          <p className="citizen-source">
            Advice from{" "}
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
  if (streets.status === "loading") return <p>Loading the simulation…</p>;
  if (streets.status === "error") return <p>The simulation did not load. Try again in a moment.</p>;

  const day = formatDay(DEFAULT_DAY);
  if (!insideAny(boxes, place.at)) {
    const report = nearestPoint(reports, place.at, 2000);
    const id = String(report?.feature.properties?.id ?? "");
    const card = zones?.[id];
    return (
      <>
        <h2>We have not simulated this area yet</h2>
        <p>The street simulation only covers the dashed area in the centre. Outside it, we cannot say how deep the water got.</p>
        {report ? (
          <p className="citizen-report">
            <strong>
              {report.metres < 150
                ? "Reported here:"
                : `Reported ${report.metres < 1000 ? `${Math.round(report.metres / 50) * 50} m` : `${(report.metres / 1000).toFixed(1)} km`} from here:`}
            </strong>{" "}
            {String(report.feature.properties?.name ?? "a flood report")}.
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
          <p>No reports near here either. That does not mean it stayed dry.</p>
        )}
      </>
    );
  }

  const worst = worstStreetNear(streets.data, place.at, 100);
  if (!worst || worst.street.flood_class === "dry") {
    return (
      <>
        <h2>Streets near here stayed dry</h2>
        <p>In the simulation of {day}, no street within 100 m held water. A different storm could behave differently.</p>
        <p className="citizen-caveat">A computer simulation of one storm, not a forecast, and not yet checked against every street.</p>
      </>
    );
  }

  const floodClass = worst.street.flood_class;
  return (
    <>
      <h2>
        Water reached <span className="citizen-depth">{DEPTH_WORDS[floodClass]}</span> near here
      </h2>
      <p>
        {FLOOD_LABELS[floodClass]} on {worst.street.name ?? "a nearby street"}
        {worst.metres > 10 ? `, ${Math.round(worst.metres)} m away` : ""}, in the simulation of {day}.
      </p>
      <p className="citizen-caveat">A computer simulation of one storm, not a forecast, and not yet checked against every street.</p>
    </>
  );
}
