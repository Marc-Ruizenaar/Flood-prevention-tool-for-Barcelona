import type { HotspotProps, HotspotsCollection, Loaded, StreetProps, StreetsCollection } from "./sim";
import { hasToken } from "./sim";

export type ModelQuality = {
  uncertainty: string;
  quality: string;
  synthetic: boolean;
  conditional: boolean;
};

function firstStreetProps(streets: Loaded<StreetsCollection>): StreetProps | undefined {
  if (streets.status !== "ready") return undefined;
  return streets.data.features[0]?.properties;
}

function firstHotspotProps(hotspots: Loaded<HotspotsCollection>): HotspotProps | undefined {
  if (hotspots.status !== "ready") return undefined;
  return hotspots.data.features[0]?.properties;
}

function collectionMeta(
  streets: Loaded<StreetsCollection>,
  hotspots: Loaded<HotspotsCollection>,
): { synthetic?: boolean; street_network_stub?: boolean } | undefined {
  const fromStreets = streets.status === "ready" ? streets.data.properties : undefined;
  const fromHotspots = hotspots.status === "ready" ? hotspots.data.properties : undefined;
  return { ...fromHotspots, ...fromStreets };
}

/** Read uncertainty_status / data_quality from bundled or live model layers. */
export function readModelQuality(
  streets: Loaded<StreetsCollection>,
  hotspots: Loaded<HotspotsCollection>,
): ModelQuality {
  const streetProps = firstStreetProps(streets);
  const hotspotProps = firstHotspotProps(hotspots);
  const waiting = streets.status === "loading" && hotspots.status === "loading";

  const uncertainty =
    hotspotProps?.uncertainty_status ??
    streetProps?.uncertainty_status ??
    (waiting ? "Loading…" : "unavailable");
  const quality =
    hotspotProps?.data_quality ??
    streetProps?.data_quality ??
    (waiting ? "Loading…" : "unavailable");

  const meta = collectionMeta(streets, hotspots);
  const combined = [
    streetProps?.uncertainty_status,
    streetProps?.data_quality,
    hotspotProps?.uncertainty_status,
    hotspotProps?.data_quality,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    uncertainty,
    quality,
    synthetic: meta?.synthetic === true || hasToken(combined, "SYNTHETIC"),
    conditional: hasToken(combined, "CONDITIONAL"),
  };
}
