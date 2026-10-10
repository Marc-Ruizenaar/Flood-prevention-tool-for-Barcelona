// Closed-box ponding: the bundled Urgell run has no outflow at its edges, so water piles up
// against the downhill (east, south) sides of the box. A deep hotspot near an edge is an
// upper bound from the box wall, not a street depth. See AUDIT-2026-10-10.md section 2.

export const EDGE_PONDING_MARGIN_M = 400;
export const EDGE_PONDING_DEPTH_M = 1;

const M_PER_DEG_LAT = 111_320;

/** Metres from (lon, lat) to the nearest side of a [w, s, e, n] extent. Negative when outside. */
export function distanceToEdgeM(lon: number, lat: number, extent: [number, number, number, number]): number {
  const [w, s, e, n] = extent;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dx = Math.min(lon - w, e - lon) * mPerDegLon;
  const dy = Math.min(lat - s, n - lat) * M_PER_DEG_LAT;
  return Math.min(dx, dy);
}

/** True when a simulated depth sits close enough to the closed box edge to be a wall artefact. */
export function edgePonding(
  lon: number,
  lat: number,
  peakDepthM: number | null | undefined,
  extent: [number, number, number, number] | null,
): boolean {
  if (!extent || peakDepthM == null || !Number.isFinite(peakDepthM)) return false;
  if (peakDepthM <= EDGE_PONDING_DEPTH_M) return false;
  return distanceToEdgeM(lon, lat, extent) <= EDGE_PONDING_MARGIN_M;
}
