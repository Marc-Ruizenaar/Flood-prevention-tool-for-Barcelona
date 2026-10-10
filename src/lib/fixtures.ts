/** Static flood model snapshots live under data/flood/{runId}/ (copied to public/data on dev/build). */

export function floodDataBase(runId: string): string {
  return `/data/flood/${encodeURIComponent(runId)}`;
}

export function streetsAsset(runId: string, date: string): string {
  return `${floodDataBase(runId)}/streets/${date}.json`;
}

export function hotspotsAsset(runId: string, date: string): string {
  return `${floodDataBase(runId)}/hotspots/${date}.json`;
}

export function dailyAsset(runId: string): string {
  return `${floodDataBase(runId)}/daily.json`;
}

export function mitigationAsset(runId: string): string {
  return `${floodDataBase(runId)}/mitigation.json`;
}
