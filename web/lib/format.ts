import type { Quantity } from "./types";

export const DAYS = [
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
] as const;

export function dayKey(value: string): string {
  return value.slice(0, 10);
}

export function dayLabels(iso: string): { short: string; long: string } {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    short: new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date),
    long: new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1_000_000)) return value.toExponential(2);
  return value.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

export function formatQuantity(q: Quantity | null | undefined, withKind = true): string {
  if (!q) return "—";
  if (q.value == null) return `— ${q.unit}`;
  const body = `${formatNumber(q.value)} ${q.unit}`;
  return withKind ? `${body} (${q.kind})` : body;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${formatNumber(value)} min`;
}

export function formatDepth(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(3)} m`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
