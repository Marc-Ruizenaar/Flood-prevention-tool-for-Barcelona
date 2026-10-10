import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoFile } from "../lib/data";
import { dayByDate } from "../lib/weather";
import type { GroupId, ReliefFile } from "../types";

export type MapHandle = {
  focus: (id: string) => void;
  reset: () => void;
};

type Props = {
  collections: Partial<Record<GeoFile, FeatureCollection>>;
  relief: Pick<ReliefFile, "image" | "bounds"> | null;
  visibility: Record<GroupId, boolean>;
  selectedId: string | null;
  day: string;
  strength: number;
  focusNonce: number;
  onSelect: (id: string) => void;
};

const CITY_BOUNDS: [[number, number], [number, number]] = [
  [2.09, 41.332],
  [2.22, 41.47],
];

const LAYER_GROUPS: { group: GroupId; ids: string[] }[] = [
  { group: "relief", ids: ["relief-shade"] },
  { group: "slopes", ids: ["slope-fill", "slope-line", "slope-label"] },
  { group: "sewers", ids: ["sewer-fill", "sewer-line", "sewer-label", "hotspot-circle", "hotspot-label"] },
  { group: "streams", ids: ["stream-line", "stream-label", "stream-critical", "stream-critical-label", "tank-circle", "tank-label"] },
  { group: "proof", ids: ["proof-halo", "proof-circle", "proof-label"] },
];

const HIT_LAYERS = [
  "proof-circle",
  "stream-critical",
  "tank-circle",
  "hotspot-circle",
  "stream-line",
  "slope-fill",
  "sewer-fill",
];

const HIT_RANK: Record<string, number> = {
  "proof-circle": 7,
  "stream-critical": 6,
  "tank-circle": 5,
  "hotspot-circle": 4,
  "stream-line": 3,
  "slope-fill": 2,
  "sewer-fill": 1,
};

function proofForDay(
  collection: FeatureCollection | undefined,
  day: string,
): FeatureCollection | undefined {
  if (!collection) return undefined;
  const ids = new Set(dayByDate(day).reportIds);
  return {
    type: "FeatureCollection",
    features: collection.features.filter((feature) => ids.has(String(feature.properties?.id ?? ""))),
  };
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
  { collections, relief, visibility, selectedId, day, strength, focusNonce, onSelect },
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
  const strengthRef = useRef(strength);
  strengthRef.current = strength;

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

      add("slopes", collections["slopes-torrents"]);
      add("sewers", collections["sewer-t10-stress"]);
      add("streams", collections["buried-streams"]);
      add("tanks", collections["retention-tanks"]);
      add("hotspots", collections["resccue-hotspots"]);
      add("proof", proofForDay(collections["proof-oct2026"], dayRef.current));
      for (const feature of collections["proof-oct2026"]?.features ?? []) {
        const fid = feature.properties?.id;
        if (typeof fid === "string" && feature.properties?.tappable !== false) {
          indexRef.current.set(fid, feature);
        }
      }
      map.addSource("highlight", { type: "geojson", data: empty });

      map.addLayer({
        id: "slope-fill",
        type: "fill",
        source: "slopes",
        paint: { "fill-color": "#6d28d9", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "slope-line",
        type: "line",
        source: "slopes",
        paint: { "line-color": "#5b21b6", "line-width": 1.6 },
      });
      map.addLayer({
        id: "sewer-fill",
        type: "fill",
        source: "sewers",
        paint: { "fill-color": "#e07a2f", "fill-opacity": 0.32 },
      });
      map.addLayer({
        id: "sewer-line",
        type: "line",
        source: "sewers",
        paint: { "line-color": "#9a3412", "line-width": 1.5 },
      });
      map.addLayer({
        id: "stream-line",
        type: "line",
        source: "streams",
        paint: {
          "line-color": ["case", ["==", ["get", "highlight"], true], "#0f5f73", "#5eead4"],
          "line-width": ["case", ["==", ["get", "highlight"], true], 4, 1.3],
          "line-opacity": ["case", ["==", ["get", "highlight"], true], 0.95, 0.75],
        },
      });
      map.addLayer({
        id: "stream-critical",
        type: "circle",
        source: "streams",
        filter: ["==", ["get", "kind"], "critical"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#b42318",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      });
      map.addLayer({
        id: "tank-circle",
        type: "circle",
        source: "tanks",
        paint: {
          "circle-radius": 8,
          "circle-color": ["match", ["get", "status"], "planned", "#b45309", "#0f766e"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#f8fafc",
        },
      });
      map.addLayer({
        id: "hotspot-circle",
        type: "circle",
        source: "hotspots",
        paint: {
          "circle-radius": 8,
          "circle-color": "#b42318",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      });
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
        filter,
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

      map.addLayer(label("slope-label", "slopes", 12));
      map.addLayer(label("sewer-label", "sewers", 12));
      map.addLayer(
        label("stream-label", "streams", 13, [
          "all",
          ["==", ["get", "highlight"], true],
          ["!=", ["get", "quietLabel"], true],
        ]),
      );
      map.addLayer({
        id: "stream-critical-label",
        type: "symbol",
        source: "streams",
        minzoom: 9,
        filter: ["==", ["get", "kind"], "critical"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-line-height": 1.1,
          "text-max-width": 12,
          "text-anchor": ["get", "anchor"],
          "text-offset": [
            "match",
            ["get", "anchor"],
            "right",
            ["literal", [-0.7, 0]],
            ["literal", [0.7, 0]],
          ],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#9f1239",
          "text-halo-color": "#fff7ed",
          "text-halo-width": 1.6,
        },
      });
      map.addLayer(label("tank-label", "tanks", 13));
      map.addLayer(label("hotspot-label", "hotspots", 13.4));
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

      for (const entry of LAYER_GROUPS) {
        const visible = visibilityRef.current[entry.group] ? "visible" : "none";
        for (const id of entry.ids) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible);
        }
      }

      map.on("click", (event) => {
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
        const hits = map.queryRenderedFeatures(event.point, {
          layers: HIT_LAYERS.filter((id) => map.getLayer(id)),
        });
        const tappable = hits.some((feature) => zoneIdOf(feature) !== null);
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
      if (!map.getLayer("sewer-fill")) return;
      const weight = strengthRef.current;
      map.setPaintProperty("sewer-fill", "fill-opacity", 0.12 + 0.28 * weight);
      map.setPaintProperty("sewer-line", "line-width", 0.8 + 1.6 * weight);
      map.setPaintProperty("hotspot-circle", "circle-radius", 5 + 4 * weight);
      map.setPaintProperty("slope-fill", "fill-opacity", 0.08 + 0.22 * weight);
      map.setPaintProperty("slope-line", "line-width", 1 + weight);
    };
    if (map.getLayer("sewer-fill")) apply();
    else map.once("idle", apply);
  }, [strength]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("proof") as GeoJSONSource | undefined;
      if (!source) return;
      const proof = proofForDay(collections["proof-oct2026"], day);
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
    if (map.getLayer("sewer-fill")) apply();
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
