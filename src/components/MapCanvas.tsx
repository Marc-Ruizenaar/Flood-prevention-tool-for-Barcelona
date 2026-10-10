import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import mlcontour from "maplibre-contour";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { HotspotCard } from "./HotspotCard";
import { reportShowsOn, type GeoFile } from "../lib/data";
import { floodColorExpression } from "../lib/modelStyle";
import { streetsExtent, type HotspotProps, type HotspotsCollection, type StreetsCollection } from "../lib/sim";
import { dayByDate } from "../lib/weather";
import type { GroupId } from "../types";

export type MapHandle = {
  focus: (id: string) => void;
  reset: () => void;
  focusSimulation: (coordinates: [number, number], cellId?: string | null) => void;
  toggleTilt: () => void;
};

type Props = {
  collections: Partial<Record<GeoFile, FeatureCollection>>;
  visibility: Record<GroupId, boolean>;
  selectedId: string | null;
  day: string;
  focusNonce: number;
  onSelect: (id: string) => void;
  modelStreets?: StreetsCollection | null;
  modelHotspots?: HotspotsCollection | null;
  onTiltChange?: (tilted: boolean) => void;
};

const TILT = 45;

const CITY_BOUNDS: [[number, number], [number, number]] = [
  [2.09, 41.332],
  [2.22, 41.47],
];

// Topographic contours, traced in a web worker from the ICGC 5 m terrain model (terrain-RGB tiles,
// Catalonia only, z14 max). Same agency as the height on each card.
const dem = new mlcontour.DemSource({
  url: "https://geoserveis.icgc.cat/servei/catalunya/contextmaps-terreny-5m-rgb/wmts/{z}/{x}/{y}.png",
  encoding: "mapbox",
  maxzoom: 14,
  worker: true,
});
dem.setupMaplibre(maplibregl);

// Depth sets width, zoom scales it, so the city view stays readable instead of one red mass.
// `extra` widens it for the dark casing drawn underneath.
function streetWidth(extra = 0): maplibregl.ExpressionSpecification {
  const depth = ["coalesce", ["to-number", ["get", "max_depth_m"]], 0];
  const at = (shallow: number, deep: number) => ["interpolate", ["linear"], depth, 0, shallow + extra, 0.5, deep + extra];
  return ["interpolate", ["linear"], ["zoom"], 12, at(0.75, 3), 15, at(2, 8), 17, at(4, 16)] as unknown as maplibregl.ExpressionSpecification;
}

// Square footprint around each simulated hotspot, so it can stand up as a column in 3D.
function hotspotColumns(collection: HotspotsCollection | null): FeatureCollection {
  const d = 0.00016;
  return {
    type: "FeatureCollection",
    features: (collection?.features ?? []).flatMap((feature) => {
      if (feature.geometry.type !== "Point") return [];
      const [x, y] = feature.geometry.coordinates;
      const ring = [[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]];
      return [{ ...feature, geometry: { type: "Polygon" as const, coordinates: [ring] } }];
    }),
  };
}

const LAYER_GROUPS: { group: GroupId; ids: string[] }[] = [
  { group: "relief", ids: ["contour-line", "contour-label"] },
  { group: "proof", ids: ["proof-halo", "proof-circle", "proof-label"] },
];

const HIT_LAYERS = ["proof-circle"];

const HIT_RANK: Record<string, number> = {
  "proof-circle": 7,
};

function proofForDay(
  collection: FeatureCollection | undefined,
  day: string,
  signals?: FeatureCollection,
): FeatureCollection | undefined {
  if (!collection && !signals) return undefined;
  const ids = new Set(dayByDate(day).reportIds);
  return {
    type: "FeatureCollection",
    features: [
      ...(collection?.features ?? []).filter((feature) => ids.has(String(feature.properties?.id ?? ""))),
      ...signalsForDay(signals, day),
    ],
  };
}

// Reviewed reports (scripts/signals-build.mjs), one dot per barri, shown on their publication
// days and the day before (reportShowsOn). A feature without `days` shows on every day.
function signalsForDay(collection: FeatureCollection | undefined, day: string): Feature[] {
  return (collection?.features ?? []).filter((feature) => reportShowsOn(feature.properties?.days, day));
}

function zoneIdOf(feature: { properties?: Record<string, unknown> | null }): string | null {
  const selectId = feature.properties?.selectId;
  if (typeof selectId === "string") return selectId;
  const id = feature.properties?.id;
  if (typeof id === "string" && feature.properties?.tappable !== false) return id;
  return null;
}

// Mirrors the layout in styles.css: phone = top card + peeking sheet, desktop = 380px left rail.
function pad(): maplibregl.PaddingOptions {
  const wide = window.innerWidth >= 960;
  return {
    top: wide ? 32 : 120,
    bottom: wide ? 32 : 236,
    left: wide ? 428 : 24,
    right: wide ? 80 : 24,
  };
}

function boundsOf(geometry: Geometry): [[number, number], [number, number]] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      xs.push(value[0]);
      ys.push(value[1]);
      return;
    }
    value.forEach(walk);
  };
  if (geometry.type === "GeometryCollection") return null;
  walk(geometry.coordinates);
  if (!xs.length) return null;
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

export const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(
  { collections, visibility, selectedId, day, focusNonce, onSelect, modelStreets = null, modelHotspots = null, onTiltChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const indexRef = useRef<globalThis.Map<string, Feature>>(new globalThis.Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onTiltChangeRef = useRef(onTiltChange);
  onTiltChangeRef.current = onTiltChange;
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const dayRef = useRef(day);
  dayRef.current = day;
  const modelStreetsRef = useRef(modelStreets);
  modelStreetsRef.current = modelStreets;
  const modelHotspotsRef = useRef(modelHotspots);
  modelHotspotsRef.current = modelHotspots;
  const applyModelDataRef = useRef<() => void>(() => {});
  const openHotspotPopupRef = useRef<(feature: Feature) => void>(() => {});

  useImperativeHandle(ref, () => ({
    focus(id: string) {
      const map = mapRef.current;
      const feature = indexRef.current.get(id);
      if (!map || !feature) return;
      const bounds = boundsOf(feature.geometry);
      if (!bounds) return;
      if (feature.geometry.type === "Point") {
        map.flyTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: Math.max(map.getZoom(), 14.4),
          duration: 650,
        });
        return;
      }
      const west = bounds[0][0];
      const east = bounds[1][0];
      const south = bounds[0][1];
      const north = bounds[1][1];
      const tiny = east - west < 0.004 && north - south < 0.004;
      if (tiny && feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
        const center: [number, number] = [(west + east) / 2, (south + north) / 2];
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 15), duration: 650 });
        return;
      }
      map.fitBounds(bounds, { padding: pad(), maxZoom: 15.2, duration: 650 });
    },
    reset() {
      mapRef.current?.fitBounds(CITY_BOUNDS, { padding: pad(), duration: 500 });
    },
    focusSimulation(coordinates, cellId) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({
        center: coordinates,
        zoom: Math.max(map.getZoom(), 15.2),
        duration: 650,
        // On a phone, drop the point lower so its popup opens in the clear space above it.
        offset: window.innerWidth < 960 ? [0, 110] : [0, 0],
      });
      if (!cellId) return;
      const feature = modelHotspotsRef.current?.features.find(
        (item) => item.properties.cell_id === cellId,
      );
      if (feature) openHotspotPopupRef.current(feature);
    },
    toggleTilt() {
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({ pitch: map.getPitch() > 5 ? 0 : TILT, duration: 500 });
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      bounds: CITY_BOUNDS,
      fitBoundsOptions: { padding: pad() },
      attributionControl: { compact: true },
      pitch: TILT,
      maxPitch: 60,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // The button and two-finger tilt on a phone both end here, so the button always matches the map.
    map.on("pitchend", () => onTiltChangeRef.current?.(map.getPitch() > 5));

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      // Contours and buildings go under the basemap labels, so street names stay readable.
      const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
      map.addSource("contours", {
        type: "vector",
        tiles: [
          dem.contourProtocolUrl({
            // [minor, major] interval in metres per zoom. Majors are thicker and labelled.
            thresholds: { 11: [50, 250], 12: [20, 100], 13: [10, 50], 14: [5, 25], 15: [2, 10] },
            elevationKey: "ele",
            levelKey: "level",
            contourLayer: "contours",
          }),
        ],
        maxzoom: 15,
        attribution: '<a href="https://www.icgc.cat/">ICGC</a> terrain',
      });
      const major: maplibregl.ExpressionSpecification = [">", ["get", "level"], 0];
      map.addLayer(
        {
          id: "contour-line",
          type: "line",
          source: "contours",
          "source-layer": "contours",
          // The sea and port docks read at or below zero; they are not part of this story.
          filter: [">", ["get", "ele"], 0],
          paint: {
            "line-color": "#9a6b3f",
            "line-width": ["case", major, 1.3, 0.6],
            "line-opacity": ["case", major, 0.8, 0.45],
          },
        },
        firstLabel,
      );
      map.addLayer(
        {
          id: "contour-label",
          type: "symbol",
          source: "contours",
          "source-layer": "contours",
          filter: ["all", major, [">", ["get", "ele"], 0]],
          layout: {
            "symbol-placement": "line",
            "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 10,
          },
          paint: { "text-color": "#7c4a1e", "text-halo-color": "#f6f1e7", "text-halo-width": 1.5 },
        },
        firstLabel,
      );
      // Buildings carry the texture in the dense grid. Height grows in from z13 so the city view stays flat.
      map.addLayer(
        {
          id: "buildings-3d",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "fill-extrusion-color": "#f4f1ea",
            "fill-extrusion-height": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              0,
              14.5,
              ["coalesce", ["get", "render_height"], 12],
            ],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.92,
          },
        },
        firstLabel,
      );
      const add = (id: string, data: FeatureCollection | undefined) => {
        map.addSource(id, { type: "geojson", data: data ?? empty });
        for (const feature of data?.features ?? []) {
          const fid = feature.properties?.id;
          if (typeof fid === "string" && feature.properties?.tappable !== false) {
            indexRef.current.set(fid, feature);
          }
        }
      };

      add("proof", proofForDay(collections["proof-oct2026"], dayRef.current, collections.signals));
      for (const feature of [...(collections["proof-oct2026"]?.features ?? []), ...(collections.signals?.features ?? [])]) {
        const fid = feature.properties?.id;
        if (typeof fid === "string" && feature.properties?.tappable !== false) {
          indexRef.current.set(fid, feature);
        }
      }
      map.addSource("highlight", { type: "geojson", data: empty });

      map.addLayer({
        id: "proof-halo",
        type: "circle",
        source: "proof",
        paint: { "circle-radius": 14, "circle-color": "#9f1239", "circle-opacity": 0.28 },
      });
      map.addLayer({
        id: "proof-circle",
        type: "circle",
        source: "proof",
        paint: {
          "circle-radius": 7,
          "circle-color": "#1c1917",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#fff",
        },
      });

      const label = (
        id: string,
        source: string,
        minzoom: number,
        filter?: maplibregl.FilterSpecification,
      ): maplibregl.SymbolLayerSpecification => ({
        id,
        type: "symbol",
        source,
        minzoom,
        ...(filter ? { filter } : {}),
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-max-width": 12,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1c1917",
          "text-halo-color": "#f8f5ef",
          "text-halo-width": 1.4,
        },
      });

      map.addLayer(label("proof-label", "proof", 13));

      map.addLayer({
        id: "highlight-fill",
        type: "fill",
        source: "highlight",
        paint: { "fill-color": "#fff7ed", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "highlight-line",
        type: "line",
        source: "highlight",
        paint: { "line-color": "#142028", "line-width": 3 },
      });
      map.addLayer({
        id: "highlight-circle",
        type: "circle",
        source: "highlight",
        paint: {
          "circle-radius": 16,
          "circle-color": "#142028",
          "circle-opacity": 0.18,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#142028",
        },
      });

      const floodColor = floodColorExpression();
      map.addSource("model-area", { type: "geojson", data: empty });
      map.addLayer({
        id: "model-area",
        type: "line",
        source: "model-area",
        paint: { "line-color": "#142028", "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "model-area-label",
        type: "symbol",
        source: "model-area",
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
      map.addSource("model-streets", { type: "geojson", data: empty });
      map.addSource("model-hotspots", { type: "geojson", data: empty });
      const dry: maplibregl.ExpressionSpecification = ["==", ["get", "flood_class"], "dry"];
      // A thin dark edge keeps light classes (yellow "low") visible on the pale basemap.
      map.addLayer({
        id: "model-streets-casing",
        type: "line",
        source: "model-streets",
        paint: { "line-color": "#1c1917", "line-width": streetWidth(1.5), "line-opacity": ["case", dry, 0.1, 0.35] },
      }, "buildings-3d");
      map.addLayer({
        id: "model-streets",
        type: "line",
        source: "model-streets",
        paint: {
          "line-color": floodColor,
          "line-width": streetWidth(),
          "line-opacity": ["case", dry, 0.3, 0.9],
        },
      }, "buildings-3d");
      map.addSource("model-hotspot-columns", { type: "geojson", data: empty });
      map.addLayer({
        id: "model-hotspot-column",
        type: "fill-extrusion",
        source: "model-hotspot-columns",
        paint: {
          "fill-extrusion-color": floodColor,
          // A visual cue, not to scale: deeper peaks stand taller so they read from across the city.
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["coalesce", ["to-number", ["get", "peak_depth_m"]], 0],
            0,
            20,
            0.5,
            120,
            2,
            260,
            5,
            400,
          ],
          "fill-extrusion-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "model-hotspot",
        type: "circle",
        source: "model-hotspots",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "peak_depth_m"]], 0], 0, 5, 0.5, 9],
            16,
            ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "peak_depth_m"]], 0], 0, 8, 0.5, 18],
          ],
          "circle-color": floodColor,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      });
      // The rank on the dot ties it to "Rank: #n" in the list and "Hotspot n" in the popup without relying on colour.
      map.addLayer({
        id: "model-hotspot-rank",
        type: "symbol",
        source: "model-hotspots",
        minzoom: 13,
        layout: {
          "text-field": ["to-string", ["get", "rank"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#1c1917", "text-halo-color": "#fff7ed", "text-halo-width": 1.5 },
      });

      applyModelDataRef.current();

      for (const entry of LAYER_GROUPS) {
        const visible = visibilityRef.current[entry.group] ? "visible" : "none";
        for (const id of entry.ids) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible);
        }
      }

      let activePopup: maplibregl.Popup | null = null;
      let activeRoot: Root | null = null;
      const openHotspotPopup = (feature: Feature) => {
        if (feature.geometry.type !== "Point") return;
        const [lon, lat] = feature.geometry.coordinates;
        const node = document.createElement("div");
        activePopup?.remove();
        activeRoot?.unmount();
        activeRoot = createRoot(node);
        activeRoot.render(<HotspotCard properties={feature.properties as HotspotProps} />);
        activePopup = new maplibregl.Popup({ maxWidth: "min(340px, calc(100vw - 80px))", className: "model-popup" })
          .setLngLat([lon, lat])
          .setDOMContent(node)
          .addTo(map);
        activePopup.on("close", () => {
          activeRoot?.unmount();
          activeRoot = null;
        });
      };
      openHotspotPopupRef.current = openHotspotPopup;

      map.on("click", (event) => {
        if (map.getLayer("model-hotspot")) {
          const modelHits = map.queryRenderedFeatures(event.point, { layers: ["model-hotspot"] });
          const cellId = modelHits[0]?.properties?.cell_id;
          const feature = modelHotspotsRef.current?.features.find((item) => item.properties.cell_id === cellId);
          if (feature && feature.geometry.type === "Point") {
            openHotspotPopup(feature);
            return;
          }
        }
        const hits = map.queryRenderedFeatures(
          [
            [event.point.x - 22, event.point.y - 22],
            [event.point.x + 22, event.point.y + 22],
          ],
          { layers: HIT_LAYERS.filter((id) => map.getLayer(id)) },
        );
        const ranked = hits
          .map((feature) => ({ feature, id: zoneIdOf(feature) }))
          .filter((hit): hit is { feature: (typeof hits)[number]; id: string } => hit.id !== null)
          .sort((a, b) => (HIT_RANK[b.feature.layer.id] ?? 0) - (HIT_RANK[a.feature.layer.id] ?? 0));
        const top = ranked[0];
        if (!top) return;
        onSelectRef.current(top.id);
      });

      map.on("mousemove", (event) => {
        const layers = HIT_LAYERS.filter((id) => map.getLayer(id));
        if (map.getLayer("model-hotspot")) layers.push("model-hotspot");
        const hits = map.queryRenderedFeatures(event.point, { layers });
        const tappable = hits.some(
          (feature) => feature.layer.id === "model-hotspot" || zoneIdOf(feature) !== null,
        );
        map.getCanvas().style.cursor = tappable ? "pointer" : "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Map is created once, after data is ready. Visibility is applied on load and updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("proof") as GeoJSONSource | undefined;
      if (!source) return;
      const proof = proofForDay(collections["proof-oct2026"], day, collections.signals);
      source.setData(proof ?? { type: "FeatureCollection", features: [] });
    };
    if (map.getSource("proof")) apply();
    else map.once("idle", apply);
  }, [day, collections]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const entry of LAYER_GROUPS) {
        const visible = visibility[entry.group] ? "visible" : "none";
        for (const id of entry.ids) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible);
        }
      }
    };
    if (map.getLayer("proof-circle")) apply();
    else map.once("idle", apply);
  }, [visibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("highlight") as GeoJSONSource | undefined;
      if (!source) return;
      const feature = selectedId ? indexRef.current.get(selectedId) : undefined;
      source.setData(
        feature
          ? { type: "FeatureCollection", features: [feature] }
          : { type: "FeatureCollection", features: [] },
      );
    };
    if (map.getSource("highlight")) apply();
    else map.once("idle", apply);
  }, [selectedId, visibility]);

  useEffect(() => {
    applyModelDataRef.current = () => {
      const map = mapRef.current;
      if (!map) return;
      const streetsSource = map.getSource("model-streets") as GeoJSONSource | undefined;
      const hotspotsSource = map.getSource("model-hotspots") as GeoJSONSource | undefined;
      if (!streetsSource || !hotspotsSource) return;
      const streets = modelStreetsRef.current ?? { type: "FeatureCollection" as const, features: [] };
      const hotspots = modelHotspotsRef.current ?? { type: "FeatureCollection" as const, features: [] };
      streetsSource.setData(streets);
      hotspotsSource.setData(hotspots);
      (map.getSource("model-hotspot-columns") as GeoJSONSource | undefined)?.setData(hotspotColumns(hotspots));
      const extent = streetsExtent(streets);
      const [w, s, e, n] = extent ?? [0, 0, 0, 0];
      (map.getSource("model-area") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: extent
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[w, n], [e, n], [e, s], [w, s], [w, n]] } }]
          : [],
      });
      if (!extent) return;
      map.fitBounds([[w, s], [e, n]], { padding: pad(), maxZoom: 17, duration: 700 });
    };
    applyModelDataRef.current();
  }, [modelStreets, modelHotspots]);

  useEffect(() => {
    if (!selectedId || focusNonce === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const run = () => {
      const feature = indexRef.current.get(selectedId);
      if (!feature) return;
      const bounds = boundsOf(feature.geometry);
      if (!bounds) return;
      if (feature.geometry.type === "Point") {
        map.flyTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: Math.max(map.getZoom(), 14.4),
          duration: 650,
        });
      } else {
        map.fitBounds(bounds, { padding: pad(), maxZoom: 15.2, duration: 650 });
      }
    };
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  }, [focusNonce, selectedId]);

  return <div ref={containerRef} className="map" />;
});
