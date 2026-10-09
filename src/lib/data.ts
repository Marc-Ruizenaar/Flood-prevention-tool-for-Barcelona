import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { ZoneMap } from "../types";

export const GEOJSON_FILES = [
  "sewer-t10-stress",
  "resccue-hotspots",
  "buried-streams",
  "retention-tanks",
  "slopes-torrents",
  "proof-oct2026",
  "signals",
] as const;

export type GeoFile = (typeof GEOJSON_FILES)[number];

export type SourceEntry = {
  label: string;
  primary: string;
  secondary?: string;
  note?: string;
};

type LoadState = {
  zones: ZoneMap | null;
  sources: Record<string, SourceEntry>;
  collections: Partial<Record<GeoFile, FeatureCollection>>;
  failed: string[];
  fatal: string | null;
};

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} (${response.status})`);
  return response.json() as Promise<T>;
}

export function useFloodData(): LoadState & { ready: boolean } {
  const [state, setState] = useState<LoadState>({
    zones: null,
    sources: {},
    collections: {},
    failed: [],
    fatal: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const zones = await loadJson<ZoneMap>("/data/zones.json");
        // Reviewed signal cards (scripts/signals-build.mjs). Missing file = no signals, not an error.
        Object.assign(zones, await loadJson<ZoneMap>("/data/signals-cards.json").catch(() => ({})));
        const [sourcesResult, ...layers] = await Promise.allSettled([
          loadJson<Record<string, SourceEntry>>("/data/sources.json"),
          ...GEOJSON_FILES.map((file) =>
            loadJson<FeatureCollection>(`/data/geojson/${file}.geojson`),
          ),
        ]);
        if (cancelled) return;
        const collections: Partial<Record<GeoFile, FeatureCollection>> = {};
        const failed: string[] = [];
        GEOJSON_FILES.forEach((file, index) => {
          const result = layers[index];
          if (result.status === "fulfilled") collections[file] = result.value;
          else failed.push(file);
        });
        setState({
          zones,
          sources: sourcesResult.status === "fulfilled" ? sourcesResult.value : {},
          collections,
          failed,
          fatal: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          fatal: error instanceof Error ? error.message : "Could not load the map data.",
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, ready: state.zones !== null && state.fatal === null };
}
