import type { FloodClass } from "./types";

export const FLOOD_COLORS: Record<FloodClass, string> = {
  dry: "#9ca3af",
  low: "#facc15",
  moderate: "#fb923c",
  high: "#ef4444",
  severe: "#7f1d1d",
};

export const FLOOD_LABELS: Record<FloodClass, string> = {
  dry: "Dry < 0.05 m",
  low: "Low 0.05–0.15 m",
  moderate: "Moderate 0.15–0.30 m",
  high: "High 0.30–0.50 m",
  severe: "Severe ≥ 0.50 m",
};

export function streetWeight(depthM: number | null | undefined): number {
  const depth = depthM ?? 0;
  return Math.min(14, Math.max(2, 2 + depth * 20));
}

export function hotspotRadius(depthM: number | null | undefined): number {
  const depth = depthM ?? 0;
  return Math.min(18, Math.max(8, 8 + depth * 22));
}

export function hasToken(text: string, token: string): boolean {
  return text.toUpperCase().includes(token);
}
