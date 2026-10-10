import { hotspotsFixture, streetsFixture, FIXTURE_DATE } from "./fixtures";
import type {
  DailySummary,
  HotspotsCollection,
  Loaded,
  MitigationReport,
  StreetsCollection,
} from "./types";
import { EMPTY_HOTSPOTS, EMPTY_STREETS } from "./types";

export function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function runId(): string {
  const configured = process.env.NEXT_PUBLIC_RUN_ID?.trim();
  return configured || "synthetic-demo";
}

export class ApiError extends Error {
  readonly kind: "offline" | "http";
  readonly status?: number;

  constructor(message: string, kind: "offline" | "http", status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

function simulation(path: string): string {
  return `${apiBase()}/simulations/${encodeURIComponent(runId())}${path}`;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/geo+json, application/json" },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("The flood API is offline.", "offline");
  }
  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    try {
      const body = (await response.json()) as { detail?: unknown; error?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
      else if (typeof body.error === "string" && body.error) detail = body.error;
    } catch {
      /* error body was not JSON */
    }
    throw new ApiError(`${response.status}: ${detail}`, "http", response.status);
  }
  return (await response.json()) as T;
}

function fixtureNote(date: string): string | undefined {
  if (date === FIXTURE_DATE) {
    return "The API is offline. Showing the synthetic example for 3 Oct 2026.";
  }
  return `The API is offline. The example streets and hotspots are only for ${FIXTURE_DATE}.`;
}

async function loadCollection<T>(
  url: string,
  signal: AbortSignal,
  date: string,
  fixture: T,
  empty: T,
): Promise<Loaded<T>> {
  try {
    const data = await fetchJson<T>(url, signal);
    return { status: "ready", source: "api", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "offline") {
      if (date === FIXTURE_DATE) {
        return { status: "ready", source: "fixture", data: fixture, note: fixtureNote(date) };
      }
      return { status: "ready", source: "empty", data: empty, note: fixtureNote(date) };
    }
    const message = error instanceof Error ? error.message : "Could not load this layer.";
    return { status: "error", message };
  }
}

export function loadStreets(date: string, signal: AbortSignal): Promise<Loaded<StreetsCollection>> {
  return loadCollection(
    simulation(`/streets?date=${date}`),
    signal,
    date,
    streetsFixture,
    EMPTY_STREETS,
  );
}

export function loadHotspots(date: string, signal: AbortSignal): Promise<Loaded<HotspotsCollection>> {
  // include_mitigation re-runs the solver and blocks the API, so the map loads the ranked spots first.
  return loadCollection(
    simulation(`/hotspots?date=${date}&limit=10`),
    signal,
    date,
    hotspotsFixture,
    EMPTY_HOTSPOTS,
  );
}

export async function loadDaily(signal: AbortSignal): Promise<Loaded<DailySummary[]>> {
  try {
    const data = await fetchJson<DailySummary[]>(simulation("/daily"), signal);
    return { status: "ready", source: "api", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "offline") {
      return { status: "error", message: "The API is offline, so the daily summary is unavailable." };
    }
    const message = error instanceof Error ? error.message : "Could not load the daily summary.";
    return { status: "error", message };
  }
}

export async function loadMitigation(signal: AbortSignal): Promise<Loaded<MitigationReport>> {
  try {
    const data = await fetchJson<MitigationReport>(simulation("/mitigation"), signal);
    return { status: "ready", source: "api", data };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && error.kind === "offline") {
      return {
        status: "error",
        message: "The API is offline, so the mitigation comparison is unavailable.",
      };
    }
    const message = error instanceof Error ? error.message : "Could not load mitigation.";
    return { status: "error", message };
  }
}
