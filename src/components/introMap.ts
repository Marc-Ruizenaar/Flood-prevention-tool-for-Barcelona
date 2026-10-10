import type { LayerSpecification, Map as MlMap } from "maplibre-gl";

// Map helpers for the intro screen: the aerial photo base, 3D buildings, terrain.

export const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
export const DEM_TILES = "https://geoserveis.icgc.cat/servei/catalunya/contextmaps-terreny-5m-rgb/wmts/{z}/{x}/{y}.png";
export const ORTHO_TILES = "https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/{z}/{x}/{y}.jpeg";
export const HOME = { center: [2.157, 41.3895] as [number, number], pitch: 55, bearing: -20 };
const BUILDING = "#e8e1d3";

export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function homeZoom(width: number): number {
  return width < 640 ? 13.4 : 14.2;
}

function sourceLayerOf(layer: LayerSpecification): string {
  return "source-layer" in layer && typeof layer["source-layer"] === "string" ? layer["source-layer"] : "";
}

/* Every call below is guarded: a different style layout must never crash the intro. */
function safePaint(map: MlMap, id: string, prop: string, value: string | number): void {
  try {
    map.setPaintProperty(id, prop, value);
  } catch {
    /* layer or property missing in this style */
  }
}

export function decorateMap(map: MlMap, withTerrain: boolean): void {
  try {
    const layers = map.getStyle().layers ?? [];
    const firstLabel = layers.find((layer) => layer.type === "symbol")?.id;
    const buildingLayer = layers.find((layer) => sourceLayerOf(layer) === "building");
    const vectorSource =
      buildingLayer && "source" in buildingLayer && typeof buildingLayer.source === "string"
        ? buildingLayer.source
        : "openmaptiles";

    // The photo goes above the background and land fills, below roads, buildings and labels.
    const above = layers.find((layer) => {
      const sl = sourceLayerOf(layer);
      return layer.type === "symbol" || layer.type === "line" || sl === "building" || sl === "transportation";
    });

    if (!map.getSource("intro-ortho")) {
      map.addSource("intro-ortho", {
        type: "raster",
        tiles: [ORTHO_TILES],
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://www.icgc.cat/">ICGC</a>',
      });
      map.addLayer({ id: "intro-ortho", type: "raster", source: "intro-ortho", paint: { "raster-fade-duration": 200 } }, above?.id);
    }

    for (const layer of layers) {
      const sl = sourceLayerOf(layer);
      if (layer.type === "symbol") map.setLayoutProperty(layer.id, "visibility", "none");
      if (layer.type === "line" && sl.startsWith("transportation")) safePaint(map, layer.id, "line-opacity", 0.35);
    }

    if (withTerrain && !map.getSource("intro-dem")) {
      map.addSource("intro-dem", {
        type: "raster-dem",
        tiles: [DEM_TILES],
        tileSize: 256,
        maxzoom: 14,
        encoding: "mapbox",
        attribution: '<a href="https://www.icgc.cat/">ICGC</a> terrain',
      });
      map.setTerrain({ source: "intro-dem", exaggeration: 1.5 });
    }

    if (map.getSource(vectorSource) && !map.getLayer("intro-buildings")) {
      map.addLayer(
        {
          id: "intro-buildings",
          type: "fill-extrusion",
          source: vectorSource,
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "fill-extrusion-color": BUILDING,
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
            "fill-extrusion-opacity": 0.85,
          },
        },
        firstLabel,
      );
      // The extrusion replaces the flat footprint, so the two never fight for the same pixels.
      if (buildingLayer && map.getLayer(buildingLayer.id)) {
        map.setLayoutProperty(buildingLayer.id, "visibility", "none");
      }
    }
  } catch {
    /* decoration is a bonus, the plain basemap is still fine */
  }
}
