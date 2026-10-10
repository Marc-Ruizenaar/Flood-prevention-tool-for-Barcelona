import hotspotsJson from "../fixtures/hotspots_day.json";
import streetsJson from "../fixtures/streets_day.json";
import type { HotspotsCollection, StreetsCollection } from "./types";

/** Typed copies of backend/examples/streets_day.geojson and hotspots_day.geojson. */
export const streetsFixture = streetsJson as unknown as StreetsCollection;
export const hotspotsFixture = hotspotsJson as unknown as HotspotsCollection;

export const FIXTURE_DATE = streetsFixture.properties?.date ?? "2026-10-03";

if (streetsFixture.type !== "FeatureCollection" || streetsFixture.features.length === 0) {
  throw new Error("Street fixture is empty.");
}
if (hotspotsFixture.type !== "FeatureCollection" || hotspotsFixture.features.length === 0) {
  throw new Error("Hotspot fixture is empty.");
}
