import { hasToken } from "./style";
import type { HotspotsCollection, Loaded, StreetsCollection } from "./types";

export function readQuality(
  streets: Loaded<StreetsCollection>,
  hotspots: Loaded<HotspotsCollection>,
): { uncertainty: string; quality: string; synthetic: boolean; conditional: boolean } {
  const fromHotspots = hotspots.status === "ready" ? hotspots.data.features[0]?.properties : undefined;
  const fromStreets = streets.status === "ready" ? streets.data.features[0]?.properties : undefined;
  const feature = fromHotspots ?? fromStreets;
  const waiting = streets.status === "loading" && hotspots.status === "loading";
  const uncertainty = feature?.uncertainty_status ?? (waiting ? "Loading…" : "unavailable");
  const quality = feature?.data_quality ?? (waiting ? "Loading…" : "unavailable");
  const syntheticFlag =
    (streets.status === "ready" && streets.data.properties?.synthetic === true) ||
    (hotspots.status === "ready" && hotspots.data.properties?.synthetic === true);
  const text = `${uncertainty} ${quality}`;
  return {
    uncertainty,
    quality,
    synthetic: syntheticFlag || hasToken(text, "SYNTHETIC"),
    conditional: hasToken(text, "CONDITIONAL"),
  };
}
