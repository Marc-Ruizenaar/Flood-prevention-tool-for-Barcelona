import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { HotspotCard } from "./HotspotCard";
import { reportShowsOn, type GeoFile } from "../lib/data";
import { floodColorExpression } from "../lib/modelStyle";
import type { HotspotProps, HotspotsCollection, StreetsCollection } from "../lib/sim";
import { dayByDate } from "../lib/weather";
import type { GroupId, ReliefFile } from "../types";

export type MapHandle = {
  focus: (id: string) => void;
  reset: () => void;
  focusSimulation: (coordinates: [number, number], cellId?: string | null) => void;
};

type Props = {
  collections: Partial<Record<GeoFile, FeatureCollection>>;
  relief: Pick<ReliefFile, "image" | "bounds"> | null;
  visibility: Record<GroupId, boolean>;
  selectedId: string | null;
  day: string;
  focusNonce: number;
  onSelect: (id: string) => void;
  modelStreets?: StreetsCollection | null;
  modelHotspots?: HotspotsCollection | null;
};

const CITY_BOUNDS: [[number, number], [number, number]] = [
  [2.09, 41.332],
  [2.22, 41.47],
];

const LAYER_GROUPS: { group: GroupId; ids: string[] }[] = [
  { group: "relief", ids: ["relief-shade"] },
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

function pad(): maplibregl.PaddingOptions {
  const wide = window.innerWidth >= 960;
  return {
    top: wide ? 96 : 128,
    bottom: wide ? 56 : 248,
    left: wide ? 332 : 28,
    right: wide ? 48 : 28,
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
  { collections, relief, visibility, selectedId, day, focusNonce, onSelect, modelStreets = null, modelHotspots = null },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const indexRef = useRef<globalThis.Map<string, Feature>>(new globalThis.Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
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
      });
      if (!cellId) return;
      const feature = modelHotspotsRef.current?.features.find(
        (item) => item.properties.cell_id === cellId,
      );
      if (feature) openHotspotPopupRef.current(feature);
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
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      if (relief) {
        const [west, south, east, north] = relief.bounds;
        map.addSource("relief", {
          type: "image",
          url: `/data/${relief.image}`,
          coordinates: [
            [west, north],
            [east, north],
            [east, south],
            [west, south],
          ],
        });
        map.addLayer({
          id: "relief-shade",
          type: "raster",
          source: "relief",
          paint: { "raster-opacity": 0.72, "raster-fade-duration": 0 },
        });
      }
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
      map.addSource("model-streets", { type: "geojson", data: empty });
      map.addSource("model-hotspots", { type: "geojson", data: empty });
      map.addLayer({
        id: "model-streets",
        type: "line",
        source: "model-streets",
        paint: {
          "line-color": floodColor,
          "line-width": [
            "interpolate",
            ["linear"],
            ["coalesce", ["to-number", ["get", "max_depth_m"]], 0],
            0,
            4,
            0.5,
            16,
          ],
          "line-opacity": ["case", ["==", ["get", "flood_class"], "dry"], 0.75, 0.95],
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
            ["coalesce", ["to-number", ["get", "peak_depth_m"]], 0],
            0,
            8,
            0.5,
            18,
          ],
          "circle-color": floodColor,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
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
        activePopup = new maplibregl.Popup({ maxWidth: "340px", className: "model-popup" })
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
      if (!streets.features.length) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of streets.features) {
        if (feature.geometry.type !== "LineString") continue;
        for (const coord of feature.geometry.coordinates) bounds.extend(coord as [number, number]);
      }
      if (bounds.isEmpty()) return;
      const padding = pad();
      padding.top = Math.max(padding.top ?? 0, 96);
      padding.bottom = Math.max(padding.bottom ?? 0, 240);
      if (window.innerWidth >= 860) padding.right = Math.max(padding.right ?? 0, 380);
      map.fitBounds(bounds, { padding, maxZoom: 17, duration: 700 });
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
