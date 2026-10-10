import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import "../scenario.css";
import { locale, t } from "../lib/i18n";
import { fetchOutlook, weatherGlyph, type OutlookDay } from "../lib/outlook";
import {
  DEFAULT_DRAIN_MM_H,
  DRAIN_LEVELS,
  RAIN_LEVELS,
  insideStudiedArea,
  likelihoodPct,
  nearestRainLevel,
  nearestSegmentIndex,
  riskWord,
} from "../lib/scenarioUi";
import {
  findScenario,
  floodThreshold,
  haversineM,
  loadScenarios,
  loadZonePoints,
  trustLabel,
  type Scenario,
  type ScenariosFile,
  type ZonePoint,
} from "../lib/scenarios";
import type { ZoneMap } from "../types";
import type { MapHandle } from "./MapCanvas";

type Props = {
  open: boolean;
  onClose: () => void;
  mapRef: RefObject<MapHandle | null>;
  zones: ZoneMap | null | undefined;
};

type Place = { name: string; lon: number; lat: number };
type Option = { key: string; label: string; place: Place | "centre" };
type Spot = { n: number; name: string; lon: number; lat: number; p: number };
type StripDay = { date: string; code: number | null; chancePct: number | null; rainMm: number | null };
type Choice<V extends string | number> = { value: V; label: string; content?: ReactNode };

// A day with less rain than this is far below the lightest model level, so it does not move the rain chip.
const MIN_RAIN_TO_PICK_MM = 12.5;
const RING_C = 2 * Math.PI * 36;
const MAX_OPTIONS = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const madridToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dateParts = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** What the "How sure?" sheet can say, read defensively: older scenario files have no reliability block. */
function readReliability(file: ScenariosFile): { observedAt70: number | null; testedN: number } {
  const metrics: unknown = file.metrics;
  let observedAt70: number | null = null;
  let testedN = file.metrics.spatial_cv.n;
  if (isRecord(metrics) && isRecord(metrics.reliability)) {
    const { at_70: at70, bins } = metrics.reliability;
    if (isRecord(at70) && typeof at70.observed_rate === "number") observedAt70 = likelihoodPct(at70.observed_rate);
    if (Array.isArray(bins)) {
      const total = bins.reduce<number>((sum, bin: unknown) => sum + (isRecord(bin) && typeof bin.n === "number" ? bin.n : 0), 0);
      if (total > 0) testedN = total;
    }
  }
  return { observedAt70, testedN };
}

/** The most at-risk spots within about a kilometre, kept apart so the rings do not pile up. */
function nearbySpots(file: ScenariosFile, scenario: Scenario, place: Place): Spot[] {
  const candidates: { index: number; distance: number; p: number }[] = [];
  file.segments.forEach((segment, index) => {
    const distance = haversineM(place, segment);
    const p = scenario.p[index] ?? 0;
    if (distance <= 1200 && p >= 0.1) candidates.push({ index, distance, p });
  });
  candidates.sort((a, b) => b.p - a.p || a.distance - b.distance);
  const spots: Spot[] = [];
  for (const candidate of candidates) {
    const segment = file.segments[candidate.index];
    if (spots.every((spot) => haversineM(spot, segment) >= 150)) {
      spots.push({ n: spots.length + 1, name: segment.name, lon: segment.lon, lat: segment.lat, p: candidate.p });
    }
    if (spots.length === 5) break;
  }
  return spots;
}

/** A radio group of buttons with arrow keys. One tab stop; the arrow keys pick and move focus. */
function RadioRow<V extends string | number>({
  label,
  choices,
  value,
  onChange,
  className,
  itemClass,
}: {
  label: string;
  choices: readonly Choice<V>[];
  value: V;
  onChange: (value: V) => void;
  className: string;
  itemClass: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const checked = Math.max(0, choices.findIndex((choice) => choice.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = choices.length - 1;
    let next = checked;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = checked === last ? 0 : checked + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = checked === 0 ? last : checked - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    onChange(choices[next].value);
    rowRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={rowRef} role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {choices.map((choice, index) => (
        <button
          key={String(choice.value)}
          type="button"
          role="radio"
          aria-checked={index === checked}
          aria-label={choice.content ? choice.label : undefined}
          tabIndex={index === checked ? 0 : -1}
          className={itemClass}
          onClick={() => onChange(choice.value)}
        >
          {choice.content ?? choice.label}
        </button>
      ))}
    </div>
  );
}

type Screen = { x: number; y: number } | null;

/** Numbered glass rings on the map. They follow the map by re-projecting each frame while shown. */
function Rings({ mapRef, spots }: { mapRef: RefObject<MapHandle | null>; spots: Spot[] }) {
  const [positions, setPositions] = useState<Screen[]>([]);
  useEffect(() => {
    if (spots.length === 0) {
      setPositions([]);
      return;
    }
    let frame = 0;
    const tick = () => {
      const next = spots.map((spot) => mapRef.current?.project(spot.lon, spot.lat) ?? null);
      setPositions((prev) =>
        prev.length === next.length &&
        prev.every((old, i) => old?.x.toFixed(0) === next[i]?.x.toFixed(0) && old?.y.toFixed(0) === next[i]?.y.toFixed(0))
          ? prev
          : next,
      );
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [spots, mapRef]);

  if (spots.length === 0) return null;
  return (
    <>
      <div className="sc-rings" aria-hidden="true">
        {spots.map((spot, index) => {
          const at = positions[index];
          if (!at) return null;
          return (
            <span
              key={spot.n}
              className={`sc-spot${riskWord(spot.p) === "high" ? " is-hot" : ""}`}
              style={{ left: at.x, top: at.y }}
            >
              {spot.n}
            </span>
          );
        })}
      </div>
      <ol className="sr-only" aria-label={t("Nearby risk spots")}>
        {spots.map((spot) => (
          <li key={spot.n}>{`${spot.name}, ${likelihoodPct(spot.p)}%`}</li>
        ))}
      </ol>
    </>
  );
}

export function ScenarioPanel({ open, onClose, mapRef, zones }: Props) {
  const ids = useId();
  const panelRef = useRef<HTMLElement>(null);
  const focusKeyRef = useRef<string | null>(null);
  const requested = useRef(false);

  const [file, setFile] = useState<ScenariosFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zonePoints, setZonePoints] = useState<ZonePoint[]>([]);
  const [outlook, setOutlook] = useState<OutlookDay[] | null>(null);

  const [dayIso, setDayIso] = useState<string | null>(null);
  const [rainMm, setRainMm] = useState(50);
  const [drainMm, setDrainMm] = useState(DEFAULT_DRAIN_MM_H);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sureOpen, setSureOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const [place, setPlace] = useState<Place | null>(null);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const todayIso = useMemo(madridToday, []);

  // Everything loads the first time the planner opens, never before.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    const controller = new AbortController();
    loadScenarios(controller.signal)
      .then((result) => {
        if (result.status === "ready") setFile(result.data);
        else if (result.status === "error") setLoadError(result.message);
      })
      .catch(() => setLoadError("Could not load the scenario file."));
    loadZonePoints(controller.signal)
      .then(setZonePoints)
      .catch(() => setZonePoints([]));
    fetchOutlook(controller.signal).then(setOutlook);
    // The requests are small and cached; they are left to finish even if the panel closes meanwhile.
  }, [open]);

  // Closing the planner by any route ends the simulation.
  useEffect(() => {
    if (!open) setRunning(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const days = useMemo<StripDay[]>(() => {
    if (outlook) return outlook.map((day) => ({ date: day.date, code: day.code, chancePct: day.chancePct, rainMm: day.rainMm }));
    return Array.from({ length: 7 }, (_, i) => ({ date: addDays(todayIso, i), code: null, chancePct: null, rainMm: null }));
  }, [outlook, todayIso]);

  const selectedDate = dayIso && days.some((day) => day.date === dayIso) ? dayIso : days[0].date;
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];

  const scenario = file ? findScenario(file, rainMm, drainMm) : undefined;
  const rainLevel = RAIN_LEVELS.find((level) => level.mm === rainMm) ?? nearestRainLevel(rainMm);

  const segmentIndex = file && place ? nearestSegmentIndex(file.segments, place.lon, place.lat) : -1;
  const placeP = scenario && segmentIndex >= 0 ? (scenario.p[segmentIndex] ?? 0) : null;
  // Without a place, show the expected share of streets flooding (mean p), not the fragile cut count.
  const ringValue = placeP ?? scenario?.expected_share ?? scenario?.share_flooded ?? 0;
  const pct = likelihoodPct(ringValue);
  const pctText = ringValue > 0 && pct === 0 ? "<1%" : `${pct}%`;
  const hot = riskWord(ringValue) === "high";
  const caption = place ? t("chance of street flooding here") : t("of streets at risk");

  const spots = useMemo(
    () => (running && file && scenario && place ? nearbySpots(file, scenario, place) : []),
    [running, file, scenario, place],
  );

  // Paint the map for this scenario; fly to the place only when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !running || !file || !scenario) return;
    const key = place ? `${place.lon},${place.lat}` : "";
    const focus = place && focusKeyRef.current !== key ? { lon: place.lon, lat: place.lat } : undefined;
    focusKeyRef.current = key;
    map.showScenario({
      points: file.segments.map((segment, index) => ({ lon: segment.lon, lat: segment.lat, p: scenario.p[index] ?? 0 })),
      threshold: floodThreshold(file),
      focus,
    });
  }, [running, file, scenario, place, mapRef]);

  useEffect(() => {
    if (running) return;
    focusKeyRef.current = null;
    mapRef.current?.clearScenario();
  }, [running, mapRef]);

  useEffect(
    () => () => {
      mapRef.current?.clearScenario();
    },
    [mapRef],
  );

  const neighbourhoods = useMemo<Place[]>(() => {
    if (!file || !zones) return [];
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const point of zonePoints) {
      if (point.id.startsWith("proof-")) continue;
      const name = zones[point.id]?.name;
      if (!name || seen.has(name) || !insideStudiedArea(file, point.lon, point.lat)) continue;
      seen.add(name);
      out.push({ name, lon: point.lon, lat: point.lat });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [file, zones, zonePoints]);

  const streets = useMemo<Place[]>(() => {
    if (!file) return [];
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const segment of file.segments) {
      if (!segment.name || seen.has(segment.name)) continue;
      seen.add(segment.name);
      out.push({ name: segment.name, lon: segment.lon, lat: segment.lat });
    }
    return out;
  }, [file]);

  const options = useMemo<Option[]>(() => {
    const typing = query !== (place?.name ?? "");
    const needle = typing ? fold(query.trim()) : "";
    const list: Option[] = [];
    if (!needle) list.push({ key: "centre", label: t("Use map centre"), place: "centre" });
    for (const hood of neighbourhoods) {
      if (!needle || fold(hood.name).includes(needle)) list.push({ key: `z-${hood.name}`, label: hood.name, place: hood });
    }
    if (needle.length >= 2) {
      for (const street of streets) {
        if (fold(street.name).includes(needle)) list.push({ key: `s-${street.name}`, label: street.name, place: street });
        if (list.length >= MAX_OPTIONS) break;
      }
    }
    return list.slice(0, MAX_OPTIONS);
  }, [query, place, neighbourhoods, streets]);

  const restoreFocus = () => document.querySelector<HTMLElement>("[data-scenario-trigger]")?.focus();
  const close = () => {
    onClose();
    restoreFocus();
  };

  const chooseDay = (date: string) => {
    setDayIso(date);
    const day = days.find((entry) => entry.date === date);
    if (day?.rainMm != null && day.rainMm >= MIN_RAIN_TO_PICK_MM) setRainMm(nearestRainLevel(day.rainMm).mm);
  };

  const choosePlace = (option: Option) => {
    setListOpen(false);
    if (option.place === "centre") {
      const centre = mapRef.current?.center();
      if (!centre || !file) return;
      if (!insideStudiedArea(file, centre.lon, centre.lat)) {
        setNotice(t("Outside the studied area"));
        return;
      }
      const nearest = file.segments[nearestSegmentIndex(file.segments, centre.lon, centre.lat)];
      setNotice(null);
      setPlace({ name: nearest.name, lon: centre.lon, lat: centre.lat });
      setQuery(nearest.name);
      return;
    }
    setNotice(null);
    setPlace(option.place);
    setQuery(option.place.name);
  };

  const clearPlace = () => {
    setPlace(null);
    setQuery("");
    setNotice(null);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setListOpen(true);
      setActive((index) => (options.length === 0 ? 0 : (index + 1) % options.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setListOpen(true);
      setActive((index) => (options.length === 0 ? 0 : (index - 1 + options.length) % options.length));
    } else if (event.key === "Enter" && listOpen && options[active]) {
      event.preventDefault();
      choosePlace(options[active]);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    // Handled here, so the app's own Escape handler does not also run.
    event.stopPropagation();
    if (listOpen) setListOpen(false);
    else if (sureOpen) setSureOpen(false);
    else close();
  };

  const rainChoices = RAIN_LEVELS.map((level) => ({ value: level.mm, label: t(level.name) }));
  const drainChoices = DRAIN_LEVELS.map((level) => ({ value: level.mmH, label: t(level.name) }));
  const dayChoices: Choice<string>[] = days.map((day) => {
    const long = dateParts(day.date, { weekday: "long", day: "numeric", month: "long" });
    const chance = day.chancePct != null ? `, ${t("{pct}% chance of rain", { pct: day.chancePct })}` : "";
    return {
      value: day.date,
      label: `${long}${chance}${day.date === todayIso ? `, ${t("Today")}` : ""}`,
      content: (
        <>
          <span className="sc-day-name">{dateParts(day.date, { weekday: "short" })}</span>
          {day.code != null && day.chancePct != null ? (
            <>
              <span className="sc-day-glyph" aria-hidden="true">
                {weatherGlyph(day.code)}
              </span>
              <span className="sc-day-chance">{`${day.chancePct}%`}</span>
            </>
          ) : (
            <span className="sc-day-chance">{dateParts(day.date, { day: "numeric" })}</span>
          )}
        </>
      ),
    };
  });

  const reliability = file ? readReliability(file) : null;
  const subline = [
    selectedDay.chancePct != null ? t("{pct}% chance of rain", { pct: selectedDay.chancePct }) : null,
    t(rainLevel.name),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const listId = `${ids}-list`;
  const sureId = `${ids}-sure`;

  return (
    <>
      <Rings mapRef={mapRef} spots={spots} />
      {open ? (
        <section
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t("Scenario planner")}
          className={`sc-panel${running ? " is-running" : ""}`}
          onKeyDown={onPanelKeyDown}
        >
          <header className="sc-head">
            <div>
              <p className="sc-kicker">{t("Scenario")}</p>
              <h2 className="sc-date">{dateParts(selectedDate, { weekday: "short", day: "numeric", month: "short" })}</h2>
              <p className="sc-sub">{subline}</p>
            </div>
            <button type="button" className="sc-close" aria-label={t("Close")} onClick={close}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {loadError ? (
            <p className="sc-status" role="status">
              {t(loadError)}
            </p>
          ) : !file ? (
            <p className="sc-status" role="status">
              {t("Loading…")}
            </p>
          ) : (
            <>
              <div className="sc-hero">
                <svg className="sc-ring" viewBox="0 0 88 88" role="img" aria-label={`${pctText} ${caption}`}>
                  <circle className="sc-ring-track" cx="44" cy="44" r="36" />
                  <circle
                    className={`sc-ring-fill${hot ? " is-hot" : ""}`}
                    cx="44"
                    cy="44"
                    r="36"
                    transform="rotate(-90 44 44)"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - Math.min(1, Math.max(0, ringValue)))}
                  />
                  <text className="sc-ring-num" x="44" y="45" textAnchor="middle" dominantBaseline="central">
                    {pctText}
                  </text>
                </svg>
                <div className="sc-hero-text">
                  <p className="sc-caption">{caption}</p>
                  <button
                    type="button"
                    className="sc-sure"
                    aria-expanded={sureOpen}
                    aria-controls={sureId}
                    onClick={() => setSureOpen((value) => !value)}
                  >
                    {t("How sure?")}
                  </button>
                </div>
              </div>

              {sureOpen && reliability ? (
                <div id={sureId} className="sc-sure-body">
                  <p className="sc-sure-level">{t(trustLabel(file.trust.level))}</p>
                  <ul>
                    <li>
                      {reliability.observedAt70 != null
                        ? t("When the model says 70%, the simulation flooded {x}% of the time.", { x: reliability.observedAt70 })
                        : t("The % is the share of similar streets that flooded in our simulation.")}
                    </li>
                    <li>{t("Tested on {n} street segments it never saw.", { n: reliability.testedN.toLocaleString(locale) })}</li>
                    <li>{t("Trained on {k} simulated storms. More storms make these numbers firmer.", { k: file.model.trained_storms })}</li>
                    <li>{t("{name} is {mm} mm of rain in the model.", { name: t(rainLevel.name), mm: rainLevel.mm })}</li>
                    <li>{t("Not yet checked against real floods.")}</li>
                  </ul>
                </div>
              ) : null}

              <div className="sc-focus">
                <p className="sc-place">{place?.name ?? t("Whole city")}</p>
                <button
                  type="button"
                  className="sc-go"
                  disabled={!scenario}
                  onClick={() => setRunning((value) => !value)}
                >
                  {running ? t("Stop simulation") : t("Start simulation")}
                </button>
              </div>

              <div className="sc-adjust">
                <RadioRow
                  label={t("Rain level")}
                  choices={rainChoices}
                  value={rainMm}
                  onChange={setRainMm}
                  className="sc-chips"
                  itemClass="sc-chip"
                />
                <button
                  type="button"
                  className="sc-more"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                >
                  {moreOpen ? t("Less") : t("More")}
                </button>
                {moreOpen ? (
                  <RadioRow
                    label={t("Drains")}
                    choices={drainChoices}
                    value={drainMm}
                    onChange={setDrainMm}
                    className="sc-seg"
                    itemClass="sc-seg-item"
                  />
                ) : null}
                {scenario?.extrapolated ? <p className="sc-flag">{t("Outside training range")}</p> : null}

                <RadioRow
                  label={t("Day")}
                  choices={dayChoices}
                  value={selectedDate}
                  onChange={chooseDay}
                  className="sc-strip"
                  itemClass={`sc-day`}
                />

                <div className="sc-loc">
                  <input
                    id={`${ids}-input`}
                    className="sc-input"
                    type="text"
                    role="combobox"
                    aria-label={t("Select location")}
                    aria-expanded={listOpen}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={listOpen && options[active] ? `${ids}-o${active}` : undefined}
                    placeholder={t("Select location")}
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(0);
                      setListOpen(true);
                    }}
                    onFocus={() => {
                      setActive(0);
                      setListOpen(true);
                    }}
                    onBlur={() => setListOpen(false)}
                    onKeyDown={onInputKeyDown}
                  />
                  {place ? (
                    <button type="button" className="sc-clear" aria-label={t("Clear place")} onClick={clearPlace}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  ) : null}
                  {listOpen && options.length > 0 ? (
                    <ul id={listId} role="listbox" aria-label={t("Select location")} className="sc-list">
                      {options.map((option, index) => (
                        <li
                          key={option.key}
                          id={`${ids}-o${index}`}
                          role="option"
                          aria-selected={index === active}
                          className={`sc-opt${index === active ? " is-active" : ""}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choosePlace(option)}
                        >
                          {option.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {notice ? (
                  <p className="sc-notice" role="status">
                    {notice}
                  </p>
                ) : null}

                {outlook ? (
                  <p className="sc-credit">
                    {t("Rain data:")}{" "}
                    <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                      Open-Meteo
                    </a>
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
