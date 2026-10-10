import type { ExpressionSpecification } from "maplibre-gl";
import type { FloodClass } from "./sim";

export const FLOOD_CLASSES: FloodClass[] = ["dry", "low", "moderate", "high", "severe"];

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

export function floodColorExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "flood_class"],
    ...FLOOD_CLASSES.flatMap((floodClass) => [floodClass, FLOOD_COLORS[floodClass]]),
    FLOOD_COLORS.dry,
  ] as unknown as ExpressionSpecification;
}
