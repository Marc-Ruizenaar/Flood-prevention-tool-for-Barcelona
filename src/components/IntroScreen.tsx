import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { edgePonding } from "../lib/artefacts";
import { lang, t } from "../lib/i18n";
import {
  findScenario,
  haversineM,
  loadScenarios,
  loadZonePoints,
  whereToGo,
  type Scenario,
  type ScenariosFile,
  type Segment,
} from "../lib/scenarios";
import { insideStudiedArea, likelihoodPct, nearestSegmentIndex, RAIN_LEVELS, riskWord } from "../lib/scenarioUi";
import { loadStreets, streetsExtent } from "../lib/sim";
import { decorateMap, HOME, homeZoom, reducedMotion, STYLE_URL, webglAvailable } from "./introMap";
import { fold, ListPopover, SearchPanel, type Option, type SearchEntry } from "./introPickers";
import "../intro.css";

export type IntroDoneOptions = { openPlanner?: boolean };

type Props = {
  onDone: (options?: IntroDoneOptions) => void;
  /** The Start pill is disabled while false. */
  canStart?: boolean;
  /** A short loading line near Start. Null or undefined means ready. */
  status?: string | null;
};

type Mode = "explore" | "alerts" | "plan";
type Stage = "idle" | "out" | "fade" | "quick";
type Pop = "risk" | "rain" | "hood" | "search" | null;
type Extent = [number, number, number, number];

const MODES: readonly Mode[] = ["explore", "alerts", "plan"];
const MODE_LABEL: Record<Mode, string> = { explore: "Explore", alerts: "Alerts", plan: "Plan" };
const DEFAULT_RAIN = 143;
const DRAINAGE = 20;
const MAX_NODES = 6;
const DEPTH_DAY = "2026-10-03";
const ZONE_RANGE_M = 2000;

type Place = { key: string; name: string; lon: number; lat: number; segIndex: number };
type ZoneEntry = { name: string; lon: number; lat: number };
type DepthState = { status: "idle" | "loading" | "ready" | "failed"; byId: Map<string, number | null>; extent: Extent | null };

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg {...ICON_PROPS} width={size} height={size}>
      {children}
    </svg>
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function isRec(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function zoneNames(raw: unknown, into: Map<string, string>): void {
  if (!isRec(raw)) return;
  for (const [id, value] of Object.entries(raw)) {
    if (isRec(value) && typeof value.name === "string" && value.name) into.set(id, value.name);
  }
}

async function loadZoneEntries(signal: AbortSignal): Promise<ZoneEntry[]> {
  const names = new Map<string, string>();
  zoneNames(await fetchJson("/data/zones.json", signal), names);
  if (lang !== "en") {
    try {
      zoneNames(await fetchJson(`/data/zones.${lang}.json`, signal), names);
    } catch {
      /* the English names stay */
    }
  }
  const points = await loadZonePoints(signal);
  const seen = new Set<string>();
  const out: ZoneEntry[] = [];
  for (const point of points) {
    const name = names.get(point.id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, lon: point.lon, lat: point.lat });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function riskText(p: number): string {
  const word = riskWord(p);
  return t(word === "high" ? "High" : word === "medium" ? "Medium" : "Low");
}

function riskLabel(p: number): string {
  const word = riskWord(p);
  return t(word === "high" ? "High risk" : word === "medium" ? "Medium risk" : "Low risk");
}

function depthView(depth: DepthState, seg: Segment | undefined): { value: string; sub: string | null } {
  const sim = t("3 Oct simulation");
  if (depth.status === "idle" || depth.status === "loading") return { value: t("Loading…"), sub: null };
  if (depth.status === "failed" || !seg || !depth.byId.has(seg.id)) return { value: t("n/a"), sub: null };
  const metres = depth.byId.get(seg.id);
  if (metres == null || !(metres > 0)) return { value: t("Dry"), sub: sim };
  if (metres > 1 && edgePonding(seg.lon, seg.lat, metres, depth.extent)) {
    return { value: "> 1 m", sub: `${t("upper bound")} · ${sim}` };
  }
  return { value: `${metres.toFixed(2)} m`, sub: sim };
}

export function IntroScreen({ onDone, canStart = true, status = null }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const miniElRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const nodeRefs = useRef(new Map<number, HTMLButtonElement>());
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const finishing = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const depthStarted = useRef(false);
  const layoutRef = useRef<() => void>(() => undefined);
  const placeRef = useRef<Place | null>(null);

  const [mode, setMode] = useState<Mode>("explore");
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<ScenariosFile | null>(null);
  const [zones, setZones] = useState<ZoneEntry[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [markers, setMarkers] = useState<{ key: string; el: HTMLDivElement }[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium">("all");
  const [rainMm, setRainMm] = useState(DEFAULT_RAIN);
  const [threeD, setThreeD] = useState(true);
  const [pop, setPop] = useState<Pop>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthState>({ status: "idle", byId: new Map(), extent: null });

  placeRef.current = place;

  /* Data: scenarios and zone names, one abort for the whole screen. */
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    loadScenarios(controller.signal)
      .then((result) => {
        if (result.status === "ready") setFile(result.data);
      })
      .catch(() => undefined);
    loadZoneEntries(controller.signal)
      .then(setZones)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const ensureDepth = useCallback(() => {
    if (depthStarted.current) return;
    const signal = abortRef.current?.signal;
    if (!signal) return;
    depthStarted.current = true;
    setDepth((d) => ({ ...d, status: "loading" }));
    loadStreets(DEPTH_DAY, signal)
      .then((result) => {
        if (result.status !== "ready") {
          setDepth({ status: "failed", byId: new Map(), extent: null });
          return;
        }
        const byId = new Map<string, number | null>();
        for (const feature of result.data.features) byId.set(feature.properties.segment_id, feature.properties.max_depth_m);
        setDepth({ status: "ready", byId, extent: streetsExtent(result.data) });
      })
      .catch(() => {
        if (!signal.aborted) setDepth({ status: "failed", byId: new Map(), extent: null });
      });
  }, []);

  const scenario: Scenario | null = useMemo(() => {
    if (!file) return null;
    return findScenario(file, rainMm, DRAINAGE) ?? file.scenarios[file.scenarios.length - 1] ?? null;
  }, [file, rainMm]);

  const areas: Place[] = useMemo(() => {
    if (!scenario) return [];
    return scenario.top
      .map((area) => ({ area, p: scenario.p[area.segment_index] ?? area.p }))
      .filter(({ p }) => riskFilter === "all" || riskWord(p) === riskFilter)
      .sort((a, b) => b.p - a.p)
      .slice(0, MAX_NODES)
      .map(({ area }) => ({
        key: `s${area.segment_index}`,
        name: area.name,
        lon: area.lon,
        lat: area.lat,
        segIndex: area.segment_index,
      }));
  }, [scenario, riskFilter]);

  const items: Place[] = useMemo(() => {
    if (place && !areas.some((a) => a.segIndex === place.segIndex)) return [...areas, place];
    return areas;
  }, [areas, place]);

  const hoods = useMemo(() => (file ? zones.filter((z) => insideStudiedArea(file, z.lon, z.lat)) : []), [file, zones]);

  const searchEntries: SearchEntry[] = useMemo(() => {
    if (!file) return [];
    const out: SearchEntry[] = [];
    const seen = new Set<string>();
    file.segments.forEach((segment, i) => {
      const norm = fold(segment.name);
      if (!segment.name || seen.has(norm)) return;
      seen.add(norm);
      out.push({ label: segment.name, norm, lon: segment.lon, lat: segment.lat, segIndex: i });
    });
    for (const zone of hoods) {
      const norm = fold(zone.name);
      if (!seen.has(norm)) out.push({ label: zone.name, norm, lon: zone.lon, lat: zone.lat, segIndex: null });
    }
    return out;
  }, [file, hoods]);

  /* Focus the dialog itself so a screen reader starts at the top. */
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  /* The floating 3D map. It fills the screen; a CSS mask turns it into an island. */
  useEffect(() => {
    const container = mapElRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      setMapFailed(true);
      return;
    }
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: STYLE_URL,
        center: HOME.center,
        zoom: homeZoom(window.innerWidth),
        pitch: HOME.pitch,
        bearing: HOME.bearing,
        maxPitch: 80,
        dragRotate: true,
        touchPitch: true,
        attributionControl: false,
      });
    } catch {
      setMapFailed(true);
      return;
    }
    mapRef.current = map;
    let loaded = false;
    const giveUp = window.setTimeout(() => {
      if (!loaded) setMapFailed(true);
    }, 15000);
    map.on("load", () => {
      loaded = true;
      decorateMap(map, true);
      setMapReady(true);
    });
    map.on("error", (event) => {
      // A failed style fetch has no source id. A missing terrain or basemap tile does, and is ignored.
      if (!loaded && !("sourceId" in event)) setMapFailed(true);
    });
    map.on("move", () => layoutRef.current());
    return () => {
      window.clearTimeout(giveUp);
      mapRef.current = null;
      setMapReady(false);
      map.remove();
    };
  }, []);

  /* Nodes: one real button per place, wrapped in a maplibre Marker. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || items.length === 0) return;
    const created = items.map((item) => {
      const el = document.createElement("div");
      el.className = "intro-node-host";
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([item.lon, item.lat]).addTo(map);
      return { key: item.key, el, marker };
    });
    setMarkers(created.map(({ key, el }) => ({ key, el })));
    return () => {
      created.forEach((entry) => entry.marker.remove());
      setMarkers([]);
    };
  }, [mapReady, items]);

  /* Mini view inside the open card: non-interactive, pitched street-level look. */
  const placeKey = place?.key ?? null;
  useEffect(() => {
    const el = miniElRef.current;
    const at = placeRef.current;
    if (placeKey === null || !el || !at || !webglAvailable()) return;
    let mini: MlMap;
    try {
      mini = new maplibregl.Map({
        container: el,
        style: STYLE_URL,
        center: [at.lon, at.lat],
        zoom: 16.5,
        pitch: 60,
        bearing: HOME.bearing,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
    } catch {
      return;
    }
    mini.on("load", () => decorateMap(mini, false));
    return () => mini.remove();
  }, [placeKey]);

  /* Card and leader line follow the node as the map moves. */
  layoutRef.current = () => {
    const map = mapRef.current;
    const card = cardRef.current;
    const line = lineRef.current;
    const root = rootRef.current;
    const at = placeRef.current;
    if (!map || !card || !line || !root || !at) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const pt = map.project([at.lon, at.lat]);
    const phone = width <= 640;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const flat = reducedMotion();
    let ex: number;
    let ey: number;
    if (phone) {
      card.style.setProperty("--tilt", "0deg");
      ex = clamp(pt.x, card.offsetLeft + 28, card.offsetLeft + w - 28);
      ey = card.offsetTop;
    } else {
      const right = pt.x + 30 + w + 16 <= width;
      const left = clamp(right ? pt.x + 30 : pt.x - 30 - w, 12, Math.max(12, width - w - 12));
      const top = clamp(pt.y - h / 2, 128, Math.max(128, height - h - 96));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.style.setProperty("--tilt", flat ? "0deg" : right ? "-8deg" : "8deg");
      ex = right ? left : left + w;
      ey = clamp(pt.y, top + 24, top + h - 24);
    }
    const dx = ex - pt.x;
    const dy = ey - pt.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 40) {
      line.style.visibility = "hidden";
      return;
    }
    line.style.visibility = "visible";
    line.setAttribute("x1", String(pt.x + (dx / dist) * 24));
    line.setAttribute("y1", String(pt.y + (dy / dist) * 24));
    line.setAttribute("x2", String(ex));
    line.setAttribute("y2", String(ey));
  };

  useLayoutEffect(() => {
    layoutRef.current();
  }, [place, depth, zones, scenario]);

  useEffect(() => {
    const onResize = () => layoutRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Move focus into the card when it opens. */
  useEffect(() => {
    if (placeKey !== null) closeRef.current?.focus({ preventScroll: true });
  }, [placeKey]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openPlace = useCallback(
    (next: Place) => {
      ensureDepth();
      setPlace(next);
    },
    [ensureDepth],
  );

  const closeCard = useCallback(
    (returnFocus: boolean) => {
      const at = place;
      setPlace(null);
      if (returnFocus && at) nodeRefs.current.get(at.segIndex)?.focus({ preventScroll: true });
    },
    [place],
  );

  const flyTo = useCallback((lon: number, lat: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15.6), duration: reducedMotion() ? 0 : 900, essential: true });
  }, []);

  const placeAt = useCallback(
    (name: string, lon: number, lat: number): Place | null => {
      if (!file) return null;
      const segIndex = nearestSegmentIndex(file.segments, lon, lat);
      const seg = file.segments[segIndex];
      if (!seg) return null;
      const known = areas.find((a) => a.segIndex === segIndex);
      return known ?? { key: `s${segIndex}`, name: name || seg.name, lon: seg.lon, lat: seg.lat, segIndex };
    },
    [file, areas],
  );

  const goToEntry = (entry: SearchEntry) => {
    setPop(null);
    let target: Place | null;
    if (entry.segIndex !== null && file) {
      const seg = file.segments[entry.segIndex];
      target = seg
        ? areas.find((a) => a.segIndex === entry.segIndex) ?? {
            key: `s${entry.segIndex}`,
            name: entry.label,
            lon: seg.lon,
            lat: seg.lat,
            segIndex: entry.segIndex,
          }
        : null;
    } else {
      target = placeAt(entry.label, entry.lon, entry.lat);
    }
    if (!target) return;
    flyTo(target.lon, target.lat);
    openPlace(target);
  };

  const goToHood = (name: string) => {
    setPop(null);
    const zone = hoods.find((z) => z.name === name);
    if (!zone) return;
    let target: Place | null = null;
    let best = 600;
    for (const area of areas) {
      const d = haversineM(zone, area);
      if (d <= best) {
        best = d;
        target = area;
      }
    }
    target = target ?? placeAt("", zone.lon, zone.lat);
    if (!target) return;
    flyTo(target.lon, target.lat);
    openPlace(target);
  };

  const findMyArea = () => {
    if (!file) return;
    if (!navigator.geolocation) {
      setToast(t("Location unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        if (!insideStudiedArea(file, longitude, latitude)) {
          setToast(t("Outside the studied area"));
          return;
        }
        const target = placeAt("", longitude, latitude);
        if (!target) return;
        flyTo(target.lon, target.lat);
        openPlace(target);
      },
      () => setToast(t("Location unavailable")),
      { timeout: 8000, maximumAge: 60000 },
    );
  };

  const openPop = (id: Exclude<Pop, null>, element: HTMLElement | null) => {
    if (!element) return;
    if (pop === id) {
      setPop(null);
      return;
    }
    setAnchor(element.getBoundingClientRect());
    setPop(id);
  };

  const closePop = () => {
    const id = pop;
    setPop(null);
    if (id === "search") searchBtnRef.current?.focus({ preventScroll: true });
    else if (id) chipRefs.current[id]?.focus({ preventScroll: true });
  };

  const finish = useCallback(
    (openPlanner: boolean, swoop: boolean) => {
      if (finishing.current) return;
      finishing.current = true;
      setPlace(null);
      setPop(null);
      const done = () => onDone(openPlanner ? { openPlanner: true } : undefined);
      const map = mapRef.current;
      if (!swoop || reducedMotion() || !map || !mapReady) {
        setStage("quick");
        timers.current.push(window.setTimeout(done, 200));
        return;
      }
      setStage("out");
      const top = areas[0];
      map.flyTo({
        center: top ? [top.lon, top.lat] : map.getCenter(),
        zoom: 17.5,
        pitch: 70,
        duration: 1600,
        essential: true,
      });
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        setStage("fade");
        timers.current.push(window.setTimeout(done, 300));
      };
      map.once("moveend", end);
      timers.current.push(window.setTimeout(end, 2300));
    },
    [areas, mapReady, onDone],
  );

  const onRootKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && place !== null) {
      event.preventDefault();
      closeCard(true);
    }
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = MODES.indexOf(mode);
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % MODES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current + MODES.length - 1) % MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    setMode(MODES[next]);
    tabRefs.current[next]?.focus();
  };

  const camera = (change: (map: MlMap, duration: number) => void) => {
    const map = mapRef.current;
    if (map) change(map, reducedMotion() ? 0 : 350);
  };

  const toggle3D = () => {
    const next = !threeD;
    setThreeD(next);
    camera((map, duration) => map.easeTo({ pitch: next ? HOME.pitch : 0, duration }));
  };

  const openSeg = place && file ? file.segments[place.segIndex] : undefined;
  const openP = place && scenario ? scenario.p[place.segIndex] ?? 0 : 0;
  const advice = useMemo(() => {
    if (!file || !scenario || !place) return null;
    return whereToGo(file, scenario, place.segIndex);
  }, [file, scenario, place]);
  const areaName = useMemo(() => {
    if (!place) return null;
    let best: ZoneEntry | null = null;
    let bestM = ZONE_RANGE_M;
    for (const zone of zones) {
      const d = haversineM(place, zone);
      if (d <= bestM) {
        bestM = d;
        best = zone;
      }
    }
    return best ? best.name : null;
  }, [place, zones]);
  const depthCell = depthView(depth, openSeg);

  const riskOptions: Option[] = [
    { id: "all", label: t("All") },
    { id: "high", label: t("High") },
    { id: "medium", label: t("Medium") },
  ];
  const rainOptions: Option[] = RAIN_LEVELS.map((level) => ({ id: String(level.mm), label: t(level.name) }));
  const hoodOptions: Option[] = hoods.map((z) => ({ id: z.name, label: z.name }));
  const rootWidth = rootRef.current?.clientWidth ?? window.innerWidth;

  const rootClass = ["intro", `intro--${mode}`, stage !== "idle" ? `intro--${stage}` : "", mapFailed ? "intro--failed" : ""]
    .filter(Boolean)
    .join(" ");
  const cycle = `${(items.length * 0.5 + 1.2).toFixed(1)}s`;

  const chip = (id: Exclude<Pop, null | "search">, label: string, disabled = false) => (
    <button
      key={id}
      ref={(el) => {
        chipRefs.current[id] = el;
      }}
      type="button"
      className="intro__chip"
      aria-haspopup="listbox"
      aria-expanded={pop === id}
      aria-controls={pop === id ? `intro-pop-${id}` : undefined}
      disabled={disabled}
      onClick={(event) => openPop(id, event.currentTarget)}
    >
      <span>{label}</span>
      <Icon size={14}>
        <path d="M6 9l6 6 6-6" />
      </Icon>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="dialog"
      aria-modal="true"
      aria-label={t("Barcelona street flooding")}
      tabIndex={-1}
      onKeyDown={onRootKey}
    >
      <h1 className="intro__title">{t("Barcelona street flooding")}</h1>
      <div className="intro__shadow" aria-hidden="true" />
      <div ref={mapElRef} className={mapFailed ? "intro__map intro__map--off" : "intro__map"} />
      <span className="intro__credit">
        <a href="https://www.icgc.cat/" target="_blank" rel="noreferrer">
          ICGC
        </a>{" "}
        · OpenFreeMap · OpenStreetMap
      </span>

      {mapFailed && (
        <ul className="intro__list" aria-label={t("Barcelona street flooding")}>
          {areas.map((area) => {
            const p = scenario?.p[area.segIndex] ?? 0;
            return (
              <li key={area.key} className="intro__place intro-ui">
                <span className="intro__place-name">{area.name}</span>
                <span className="intro__place-pct">{likelihoodPct(p)}%</span>
                <span className="intro__place-risk">{riskLabel(p)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {markers.map(({ key, el }) => {
        const item = items.find((i) => i.key === key);
        if (!item) return null;
        const pct = likelihoodPct(scenario?.p[item.segIndex] ?? 0);
        return createPortal(
          <button
            type="button"
            ref={(button) => {
              if (button) nodeRefs.current.set(item.segIndex, button);
              else nodeRefs.current.delete(item.segIndex);
            }}
            className={place?.segIndex === item.segIndex ? "intro-node intro-node--on" : "intro-node"}
            style={{ "--i": items.indexOf(item), "--cycle": cycle } as CSSProperties}
            aria-expanded={place?.segIndex === item.segIndex}
            aria-label={t("{place}, {pct}% chance of street flooding", { place: item.name, pct })}
            onClick={() => (place?.segIndex === item.segIndex ? closeCard(true) : openPlace(item))}
          >
            <span className="intro-node__disc" aria-hidden="true">
              <span className="intro-node__dot" />
            </span>
          </button>,
          el,
          key,
        );
      })}

      <svg className="intro__leader" aria-hidden="true" focusable="false">
        {place && <line ref={lineRef} />}
      </svg>

      {/* Top left: modes, then filters. */}
      <div className="intro__top intro-ui">
        <div className="intro__tabs" role="tablist" aria-label={t("Barcelona street flooding")} onKeyDown={onTabKey}>
          {MODES.map((id, i) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`intro-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={mode === id}
              tabIndex={mode === id ? 0 : -1}
              className={mode === id ? "intro__tab intro__tab--on" : "intro__tab"}
              onClick={() => setMode(id)}
            >
              {t(MODE_LABEL[id])}
            </button>
          ))}
        </div>
        <div className="intro__row">
          <button
            type="button"
            className="intro__pin"
            aria-label={t("Find my area")}
            title={t("Find my area")}
            disabled={!file}
            onClick={findMyArea}
          >
            <Icon>
              <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </Icon>
          </button>
          {chip("risk", t("Risk level"))}
          {chip("rain", t("Rain"))}
          {chip("hood", t("Neighbourhood"), hoods.length === 0)}
        </div>
      </div>

      {/* Top right: place and search. */}
      <div className="intro__corner intro-ui">
        <span className="intro__city">Barcelona</span>
        <button
          ref={searchBtnRef}
          type="button"
          className="intro__round"
          aria-label={t("Search")}
          aria-haspopup="listbox"
          aria-expanded={pop === "search"}
          disabled={!file}
          onClick={(event) => openPop("search", event.currentTarget)}
        >
          <Icon>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </Icon>
        </button>
      </div>

      {pop === "risk" && anchor && (
        <ListPopover
          id="intro-pop-risk"
          label={t("Risk level")}
          options={riskOptions}
          selected={riskFilter}
          anchor={anchor}
          rootWidth={rootWidth}
          onClose={closePop}
          onPick={(id) => {
            setRiskFilter(id === "high" || id === "medium" ? id : "all");
            closePop();
          }}
        />
      )}
      {pop === "rain" && anchor && (
        <ListPopover
          id="intro-pop-rain"
          label={t("Rain")}
          options={rainOptions}
          selected={String(rainMm)}
          anchor={anchor}
          rootWidth={rootWidth}
          onClose={closePop}
          onPick={(id) => {
            const mm = Number(id);
            if (Number.isFinite(mm)) setRainMm(mm);
            closePop();
          }}
        />
      )}
      {pop === "hood" && anchor && (
        <ListPopover
          id="intro-pop-hood"
          label={t("Neighbourhood")}
          options={hoodOptions}
          selected=""
          anchor={anchor}
          rootWidth={rootWidth}
          onClose={closePop}
          onPick={(id) => goToHood(id)}
        />
      )}
      {pop === "search" && anchor && (
        <SearchPanel entries={searchEntries} anchor={anchor} rootWidth={rootWidth} onClose={closePop} onPick={goToEntry} />
      )}

      {/* The place card. */}
      {place && (
        <div ref={cardRef} className="intro-card intro-ui" role="group" aria-label={place.name}>
          <div className="intro-card__top">
            <div ref={miniElRef} className="intro-card__mini" aria-hidden="true" />
            <div className="intro-card__scrim" aria-hidden="true" />
            <div className="intro-card__head">
              <h2 className="intro-card__name">{place.name}</h2>
              <span className="intro-card__sub">Barcelona</span>
            </div>
            <button ref={closeRef} type="button" className="intro-card__x" aria-label={t("Close")} onClick={() => closeCard(true)}>
              <Icon size={18}>
                <path d="M6 6l12 12M18 6L6 18" />
              </Icon>
            </button>
          </div>
          <dl className="intro-card__grid">
            <div className="intro-card__cell">
              <dt>
                <span className={riskWord(openP) === "high" ? "intro-card__icon intro-card__icon--high" : "intro-card__icon"}>
                  <Icon size={18}>
                    <path d="M12 4l9 16H3z" />
                    <path d="M12 10v4M12 17.2v.1" />
                  </Icon>
                </span>
                {t("Flood risk")}
              </dt>
              <dd>
                {riskText(openP)} · {likelihoodPct(openP)}%
              </dd>
            </div>
            <div className="intro-card__cell">
              <dt>
                <span className="intro-card__icon">
                  <Icon size={18}>
                    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
                  </Icon>
                </span>
                {t("Water depth")}
              </dt>
              <dd>{depthCell.value}</dd>
              {depthCell.sub && <span className="intro-card__note">{depthCell.sub}</span>}
            </div>
            <div className="intro-card__cell">
              <dt>
                <span className="intro-card__icon">
                  <Icon size={18}>
                    <path d="M4 12h15M13 6l6 6-6 6" />
                  </Icon>
                </span>
                {t("Go to")}
              </dt>
              <dd>{advice ? advice.segment.name : t("None nearby")}</dd>
              {advice && (
                <span className="intro-card__note">{`${Math.max(10, Math.round(advice.distanceM / 10) * 10)} m`}</span>
              )}
            </div>
            <div className="intro-card__cell">
              <dt>
                <span className="intro-card__icon">
                  <Icon size={18}>
                    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
                    <circle cx="12" cy="9.5" r="2.5" />
                  </Icon>
                </span>
                {t("Area")}
              </dt>
              <dd>{areaName ?? t("n/a")}</dd>
            </div>
          </dl>
        </div>
      )}

      {toast && (
        <span className="intro__toast intro-ui" role="status">
          {toast}
        </span>
      )}

      {/* Bottom left: map controls. */}
      <div className="intro__controls intro-ui" role="group" aria-label={t("Reset view")}>
        <button type="button" className="intro__three" aria-pressed={threeD} aria-label={t("Tilt 2D/3D")} onClick={toggle3D}>
          3D
        </button>
        <button
          type="button"
          className="intro__ctl"
          aria-label={t("North up")}
          onClick={() => camera((map, duration) => map.easeTo({ bearing: 0, duration }))}
        >
          <Icon>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 6l2.5 6h-5zM9.5 12L12 18l2.5-6" />
          </Icon>
        </button>
        <button type="button" className="intro__ctl" aria-label={t("Zoom in")} onClick={() => camera((map, duration) => map.zoomIn({ duration }))}>
          <Icon>
            <path d="M12 5v14M5 12h14" />
          </Icon>
        </button>
        <button type="button" className="intro__ctl" aria-label={t("Zoom out")} onClick={() => camera((map, duration) => map.zoomOut({ duration }))}>
          <Icon>
            <path d="M5 12h14" />
          </Icon>
        </button>
        <button
          type="button"
          className="intro__ctl"
          aria-label={t("Reset view")}
          onClick={() =>
            camera((map, duration) =>
              map.easeTo({
                center: HOME.center,
                zoom: homeZoom(window.innerWidth),
                pitch: threeD ? HOME.pitch : 0,
                bearing: HOME.bearing,
                duration,
              }),
            )
          }
        >
          <Icon>
            <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
          </Icon>
        </button>
      </div>

      {/* Bottom right: Start. */}
      <div className="intro__foot intro-ui">
        <span className="intro__status" role="status">
          {status ?? ""}
        </span>
        <div className="intro__actions">
          <button type="button" className="intro__skip" onClick={() => finish(false, false)}>
            {t("Skip")}
          </button>
          <button type="button" className="intro__start" disabled={!canStart} onClick={() => finish(mode === "plan", true)}>
            <Icon size={22}>
              <path d="M4 12h15M13 6l6 6-6 6" />
            </Icon>
            <span>{t("Start")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
