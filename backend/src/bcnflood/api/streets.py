"""Street-level aggregation (M2-A5-04, owned by Agent 5).
Street segments come from Agent 1's M2-A1-07 output manifests/derived/osm/bcn_streets_osm_25831
.geojson.gz (OSM, ODbL), clipped to the run grid. SYNTHETIC runs use a grid-aligned stub street
network by default (meta street_source="osm" forces OSM); every feature says which was used."""
from __future__ import annotations

import gzip
import json
import os
from datetime import date
from pathlib import Path

import numpy as np

from bcnflood.api.products import day_index, to_wgs84
from bcnflood.api.runstore import StoredRun, load_run

# Presentation thresholds on max depth [m], lower bound inclusive. kind=assumption.
FLOOD_CLASSES = [("dry", 0.0), ("low", 0.05), ("moderate", 0.15), ("high", 0.30),
                 ("severe", 0.50)]
AGGREGATION_METHOD = ("Cells crossed by the segment (sampled every dx/2 along it). Per snapshot "
                      "in the local day: max depth over those cells. max_depth_m = max over time; "
                      "p95_depth_m = 95th percentile of all cell x snapshot depths; "
                      "minutes_above_X = snapshots with segment max > X times the snapshot "
                      "interval.")


def flood_class(depth: float | None) -> str | None:
    if depth is None:
        return None
    cls = "dry"
    for name, lo in FLOOD_CLASSES:
        if depth >= lo:
            cls = name
    return cls


OSM_STREETS = Path(os.environ.get("BCNFLOOD_STREETS", Path(__file__).resolve().parents[3]
                                 / "manifests" / "derived" / "osm"
                                 / "bcn_streets_osm_25831.geojson.gz"))
_OSM_CACHE: list | None = None
# OSM highway classes served by /streets (vehicular/shared road network). Everything else
# (footway, path, steps, cycleway, track, pedestrian, corridor, bridleway, elevator, platform,
# construction, proposed, raceway, bus_stop, ...) is filtered out (G3 condition, Agent 3).
ROAD_CLASSES = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "busway"})


def is_road(props: dict) -> bool:
    return props.get("highway") in ROAD_CLASSES and not props.get("area", False)


def _osm_segments(run: StoredRun) -> list[dict]:
    global _OSM_CACHE
    if _OSM_CACHE is None:
        fc = json.loads(gzip.decompress(OSM_STREETS.read_bytes()))
        _OSM_CACHE = [f for f in fc["features"] if f["geometry"]["type"] == "LineString"
                      and is_road(f["properties"])]
    ny, nx = run.h.shape[1:]
    x0, y0, dx = run.meta["x0_m"], run.meta["y0_m"], run.meta["dx_m"]
    x1, y1 = x0 + nx * dx, y0 - ny * dx
    out = []
    for f in _OSM_CACHE:
        cs = f["geometry"]["coordinates"]
        if any(x0 <= x <= x1 and y1 <= y <= y0 for x, y in cs):
            p = f["properties"]
            out.append({"id": f"osm-{p['osm_id']}", "name": p.get("name"),
                        "highway": p.get("highway"),
                        "coords": [tuple(c) for c in cs]})
    return out


def load_segments(run: StoredRun) -> tuple[list[dict], bool]:
    """Returns (segments, is_stub). Segment: {id, name, coords: [(x, y), ...] in run CRS}."""
    src = run.meta.get("street_source", "stub" if run.synthetic else "osm")
    if src == "osm":
        if not OSM_STREETS.exists():
            raise FileNotFoundError(f"M2-A1-07 street file missing: {OSM_STREETS}")
        return _osm_segments(run), False
    ny, nx = run.h.shape[1:]
    x0, y0, dx = run.meta["x0_m"], run.meta["y0_m"], run.meta["dx_m"]
    segs = []
    for r in range(0, ny, 2):  # synthetic E-W "streets" along every other grid row
        y = y0 - (r + 0.5) * dx
        segs.append({"id": f"stub-ew-{r}", "name": f"Synthetic street row {r}",
                     "coords": [(x0 + 0.5 * dx, y), (x0 + (nx - 0.5) * dx, y)]})
    c = nx // 2
    segs.append({"id": f"stub-ns-{c}", "name": f"Synthetic street col {c}",
                 "coords": [(x0 + (c + 0.5) * dx, y0 - 0.5 * dx),
                            (x0 + (c + 0.5) * dx, y0 - (ny - 0.5) * dx)]})
    return segs, True


def _cells_on(run: StoredRun, coords) -> list[tuple[int, int]]:
    x0, y0, dx = run.meta["x0_m"], run.meta["y0_m"], run.meta["dx_m"]
    ny, nx = run.h.shape[1:]
    out = set()
    for (xa, ya), (xb, yb) in zip(coords[:-1], coords[1:], strict=True):
        n = max(2, int(np.hypot(xb - xa, yb - ya) / (dx / 2)) + 1)
        for f in np.linspace(0, 1, n):
            c = int((xa + f * (xb - xa) - x0) // dx)
            r = int((y0 - (ya + f * (yb - ya))) // dx)
            if 0 <= r < ny and 0 <= c < nx:
                out.add((r, c))
    return sorted(out)


def segment_stats(run: StoredRun, d: date, cells) -> dict | None:
    if run.grid is not None:  # run_grid output: per-local-day fields (see grid_adapter)
        from bcnflood.api.grid_adapter import grid_segment_stats
        return grid_segment_stats(run, d, cells)
    idx, _, _ = day_index(run, d)
    if len(idx) == 0 or not cells:
        return None
    rr, cc = zip(*cells, strict=True)
    sub = run.h[idx][:, list(rr), list(cc)]          # (nt, ncells)
    seg_max = sub.max(axis=1)
    dt_min = float(np.median(np.diff(run.t))) / 60 if len(run.t) > 1 else 0.0
    return {"max_depth_m": float(sub.max()), "p95_depth_m": float(np.percentile(sub, 95)),
            "minutes_above_0.10m": float((seg_max > 0.10).sum() * dt_min),
            "minutes_above_0.30m": float((seg_max > 0.30).sum() * dt_min)}


def streets_geojson(run: StoredRun, d: date) -> dict:
    segs, stub = load_segments(run)
    scen = run.meta.get("drainage_scenarios", {})  # {"low": run_id, "mid": ..., "high": ...}
    scen_runs = {k: load_run(v) for k, v in scen.items()}
    feats = []
    for s in segs:
        cells = _cells_on(run, s["coords"])
        st = segment_stats(run, d, cells)
        spread = {}
        for k in ("low", "mid", "high"):
            sr = scen_runs.get(k)
            ss = segment_stats(sr, d, cells) if sr is not None else None
            spread[k] = None if ss is None else ss["max_depth_m"]
        vals = [v for v in spread.values() if v is not None]
        base_key = next((k for k, v in scen.items() if v == run.run_id), None)
        xs, ys = zip(*s["coords"], strict=True)
        lon, lat = to_wgs84(run, list(xs), list(ys))
        mx = None if st is None else st["max_depth_m"]
        feats.append({"type": "Feature", "id": s["id"], "geometry": {
            "type": "LineString",
            "coordinates": [[float(a), float(b)] for a, b in zip(lon, lat, strict=True)]},
            "properties": {
                "segment_id": s["id"], "name": s.get("name"), "date": d.isoformat(),
                "max_depth_m": mx,
                "p95_depth_m": None if st is None else st["p95_depth_m"],
                "minutes_above_0.10m": None if st is None else st["minutes_above_0.10m"],
                "minutes_above_0.30m": None if st is None else st["minutes_above_0.30m"],
                "flood_class": flood_class(mx),
                "drainage_scenario_spread": {
                    "max_depth_m": spread, "range_m": (max(vals) - min(vals)) if vals else None,
                    "baseline_scenario": base_key, "unit": "m",
                    "kind": "assumption"},
                "uncertainty_status": "UNVALIDATED: synthetic, not calibrated" if run.synthetic
                else "UNVALIDATED: not calibrated against observations",
                "data_quality": ("SYNTHETIC run" if run.synthetic else "model run")
                + ("; SYNTHETIC stub street network" if stub
                   else "; OSM streets (M2-A1-07, CONDITIONAL fallback, ODbL)"),
                "aggregation_method": AGGREGATION_METHOD,
                "units": {"depth": "m", "time": "min"}, "kind": "simulated",
                "cells_sampled": len(cells)}})
    return {"type": "FeatureCollection", "features": feats, "properties": {
        "run_id": run.run_id, "date": d.isoformat(), "timezone": "Europe/Madrid",
        "crs": "EPSG:4326",
        "synthetic": run.synthetic, "street_network_stub": stub,
        "flood_class_thresholds_m": dict(FLOOD_CLASSES), "flood_class_kind": "assumption"}}
